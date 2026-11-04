// scripts/bounded.mjs (D-54), checked against the OS itself: the pids the runner and the child
// print are probed with kill(pid, 0), wall time is measured here, and exit codes are compared with
// the POSIX convention (124 on timeout, 128+n on a signal). The tests signal only processes they
// started: in cleanup, each group the runner created for a test and each grandchild pid it printed.
import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { join } from "node:path";
import { after, test } from "node:test";
import { pathToFileURL } from "node:url";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const BOUNDED = join(ROOT, "scripts", "bounded.mjs");
const CHILD = join(import.meta.dirname, "fixtures", "bounded-child.mjs");
const WIN = process.platform === "win32";
const posix = { skip: WIN ? "POSIX process groups and signals" : false };

/** Every pid and pgid a test started (through the runner), for the cleanup and the report. */
const pids = new Set<number>();
const groups = new Set<number>();

/** kill(x, 0) on one recorded pid (or -pgid): written here, not imported from the runner. */
function alive(x: number): boolean {
  try {
    process.kill(x, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Poll until `x` is gone, at most `ms`; true if it went. */
async function gone(x: number, ms = 1500): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (!alive(x)) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return !alive(x);
}

interface Run {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  ms: number;
  pid: number | null;
  pgid: number | null;
  grandchild: number | null;
}

/** Run the runner; `onStart` gets the runner process once the child has printed its first line. */
function run(args: string[], onStart?: (p: ChildProcess, r: Run) => void): Promise<Run> {
  const t0 = process.hrtime.bigint();
  const p = spawn(process.execPath, [BOUNDED, ...args], { stdio: ["ignore", "pipe", "pipe"] });
  const r: Run = { code: null, signal: null, stdout: "", stderr: "", ms: 0, pid: null, pgid: null, grandchild: null };
  let fired = false;
  const scan = () => {
    const s = /bounded: started pid=(\d+) pgid=(\d+|none)/.exec(r.stderr);
    if (s && r.pid === null) {
      r.pid = Number(s[1]);
      pids.add(r.pid);
      if (s[2] !== "none") {
        r.pgid = Number(s[2]);
        groups.add(r.pgid);
      }
    }
    const g = /grandchild=(\d+)/.exec(r.stdout);
    if (g && r.grandchild === null) {
      r.grandchild = Number(g[1]);
      pids.add(r.grandchild);
    }
    if (onStart && !fired && r.pid !== null && /\n/.test(r.stdout)) {
      fired = true;
      onStart(p, r);
    }
  };
  p.stdout.on("data", (d) => {
    r.stdout += d;
    scan();
  });
  p.stderr.on("data", (d) => {
    r.stderr += d;
    scan();
  });
  // "exit", not "close": a surviving grandchild would hold the pipes open
  return new Promise((res) =>
    p.on("exit", (code, signal) => {
      r.code = code;
      r.signal = signal;
      r.ms = Number(process.hrtime.bigint() - t0) / 1e6;
      // let the last stderr chunk arrive
      setTimeout(() => {
        scan();
        // a survivor that kept the pipes open must not keep this test file alive
        p.stdout.destroy();
        p.stderr.destroy();
        res(r);
      }, 50);
    }),
  );
}

after(async () => {
  // only what these tests started: each runner-created group, then each printed pid
  if (!WIN)
    for (const g of groups)
      try {
        process.kill(-g, "SIGKILL");
      } catch {}
  for (const x of pids)
    try {
      if (alive(x)) process.kill(x, "SIGKILL");
    } catch {}
  // the report's PID list (D-47): every pid these tests started, and which (if any) still exist
  const left: number[] = [];
  for (const x of pids) if (!(await gone(x))) left.push(x);
  process.stderr.write(`bounded.test: started ${[...pids].join(" ")}; still alive: ${left.join(" ") || "none"}\n`);
});

test("[+RX-INFRA/bounded-runner] at the deadline the whole tree is stopped, the runner exits 124 and reports none alive", async () => {
  const r = await run(["1", "--", process.execPath, CHILD, "tree"]);
  assert.equal(r.code, 124, r.stderr);
  assert.ok(r.ms >= 1000 && r.ms < 4500, `took ${r.ms} ms`);
  assert.ok(r.pid !== null && r.grandchild !== null, r.stderr + r.stdout);
  assert.match(r.stderr, new RegExp(`bounded: started pid=${r.pid} pgid=${WIN ? "none" : r.pid} deadline=1s`));
  assert.match(r.stderr, /bounded: still alive: none\n/);
  assert.ok(await gone(r.pid!), "child gone");
  assert.ok(await gone(r.grandchild!), "grandchild gone");
  if (!WIN) assert.ok(await gone(-r.pgid!), "group gone");
});

test("[+RX-INFRA/bounded-runner] a child that ignores SIGTERM gets SIGKILL 5 s later", async () => {
  const r = await run(["1", "--", process.execPath, CHILD, "trap"]);
  assert.equal(r.code, 124, r.stderr);
  if (!WIN) assert.ok(r.ms >= 6000 && r.ms < 9500, `took ${r.ms} ms`);
  assert.match(r.stderr, /bounded: still alive: none\n/);
  assert.ok(await gone(r.pid!), "trapping child gone");
});

test("[+RX-INFRA/bounded-runner] before the deadline the exit code passes through", async () => {
  for (const n of [0, 3, 77]) {
    const r = await run(["30", "--", process.execPath, CHILD, "exit", String(n)]);
    assert.equal(r.code, n, r.stderr);
    assert.ok(r.ms < 10_000);
    assert.match(r.stderr, /bounded: still alive: none\n/);
  }
});

test("[+RX-INFRA/bounded-runner] a child killed by a signal gives 128+signo", posix, async () => {
  const r = await run(["30", "--", "sh", "-c", "kill -9 $$"]);
  assert.equal(r.code, 137, r.stderr);
});

test(
  "[+RX-INFRA/bounded-runner] sh -c 'sleep 300 & sleep 300': both sleeps and the group are gone at the deadline",
  posix,
  async () => {
    const r = await run(["1", "--", "sh", "-c", "sleep 300 & sleep 300"]);
    assert.equal(r.code, 124, r.stderr);
    assert.ok(r.ms < 4500, `took ${r.ms} ms`);
    assert.match(r.stderr, /bounded: still alive: none\n/);
    assert.ok(await gone(-r.pgid!), "group gone");
  },
);

test("[+RX-INFRA/bounded-runner] SIGTERM to the runner is forwarded to the group; exit 143", posix, async () => {
  const r = await run(["60", "--", process.execPath, CHILD, "tree"], (p) => {
    p.kill("SIGTERM");
  });
  assert.equal(r.code, 143, r.stderr);
  assert.ok(r.ms < 10_000);
  assert.ok(r.grandchild !== null);
  assert.ok(await gone(r.grandchild!), "grandchild gone");
  assert.ok(await gone(-r.pgid!), "group gone");
  assert.match(r.stderr, /bounded: still alive: none\n/);
});

test("[-RX-INFRA/bounded-runner] a bad deadline or a missing command is a usage error (2) and starts nothing", async () => {
  for (const args of [
    ["0", "--", "x"],
    ["3601", "--", "x"],
    ["abc", "--", "x"],
    ["1.5", "--", "x"],
    ["10", "x"],
    ["10", "--"],
    [],
  ]) {
    const r = await run(args);
    assert.equal(r.code, 2, JSON.stringify(args));
    assert.doesNotMatch(r.stderr, /started/);
    assert.match(r.stderr, /usage: node scripts\/bounded\.mjs/);
  }
  const r = await run(["3600", "--", process.execPath, CHILD, "exit", "0"]);
  assert.equal(r.code, 0, "3600 is allowed");
});

test("[-RX-INFRA/bounded-runner] a process outside the runner's group is not signalled at the deadline", async () => {
  const sibling = spawn(process.execPath, ["-e", "setTimeout(() => {}, 300000)"], { stdio: "ignore" });
  pids.add(sibling.pid!);
  try {
    const r = await run(["1", "--", process.execPath, CHILD, "tree"]);
    assert.equal(r.code, 124);
    assert.ok(alive(sibling.pid!), "the sibling is still alive");
  } finally {
    sibling.kill("SIGKILL");
  }
});

test("[-RX-INFRA/bounded-runner] a survivor is listed as still alive, never silently dropped", async () => {
  const m = (await import(pathToFileURL(BOUNDED).href)) as {
    aliveLine: (t: { label: string; target: number }[], alive: (x: number) => boolean) => string;
  };
  const targets = [
    { label: "pid=41", target: 41 },
    { label: "pgid=41", target: -41 },
  ];
  assert.equal(
    m.aliveLine(targets, () => true),
    "bounded: still alive: pid=41 pgid=41",
  );
  assert.equal(
    m.aliveLine(targets, (x) => x < 0),
    "bounded: still alive: pgid=41",
  );
  assert.equal(
    m.aliveLine(targets, () => false),
    "bounded: still alive: none",
  );
});

test(
  "[+RX-INFRA/bounded-runner] a command that exits leaving its group running: the runner waits, stops the rest at the deadline and keeps the command's exit code",
  posix,
  async () => {
    const r = await run(["2", "--", process.execPath, CHILD, "leave"]);
    assert.equal(r.code, 0, r.stderr);
    assert.ok(r.ms >= 2000 && r.ms < 5500, `took ${r.ms} ms`);
    assert.match(r.stderr, /bounded: command exited; waiting for the rest of group/);
    assert.match(r.stderr, /bounded: deadline: stopping the rest of group/);
    assert.match(r.stderr, /bounded: still alive: none\n/);
    assert.ok(r.grandchild !== null);
    assert.ok(await gone(r.grandchild!), "leftover grandchild gone");
    assert.ok(await gone(-r.pgid!), "group gone");
    // leftovers that finish before the deadline: the runner ends with them, exit code kept
    const q = await run(["30", "--", "sh", "-c", "sleep 1 & exit 5"]);
    assert.equal(q.code, 5, q.stderr);
    assert.ok(q.ms >= 900 && q.ms < 5000, `took ${q.ms} ms`);
    assert.match(q.stderr, /bounded: still alive: none\n/);
  },
);

test(
  "[-RX-INFRA/bounded-runner] not controlled: a process that leaves the group (setsid) is not waited for or signalled, and the report cannot see it",
  posix,
  async () => {
    const r = await run(["30", "--", process.execPath, CHILD, "escape"]);
    assert.equal(r.code, 0, r.stderr);
    assert.ok(r.ms < 5000, `took ${r.ms} ms`);
    assert.match(r.stderr, /bounded: still alive: none\n/);
    assert.ok(r.grandchild !== null && alive(r.grandchild), "the escaped grandchild still runs");
    // it is this test's own process: stopped by its exact pid
    process.kill(r.grandchild!, "SIGKILL");
    assert.ok(await gone(r.grandchild!), "cleaned up");
  },
);
