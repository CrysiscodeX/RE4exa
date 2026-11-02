// SBX: a real child (test/fixtures/sbx-child.mjs) under the sandbox policy. What the child may and
// may not do is checked from outside it: the file the test reads back, the file that must be
// absent, and the connection count of a loopback listener the test itself owns. Every process
// these tests start is stopped by the pid the test holds.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { isCoreError } from "@re4exa/core/errors";
import { runSandboxed, type SandboxPolicy, sandboxBackend } from "../src/sandbox/index.ts";
import { macProfile } from "../src/sandbox/macos.ts";
import { TREE } from "../src/sandbox/tree.ts";
import { signalProblems, watchSignals } from "./fixtures/sbx-watch.ts";

const CHILD = join(import.meta.dirname, "fixtures", "sbx-child.mjs");
const FIXTURE = join(import.meta.dirname, "..", "fixtures", "bin", "hello-x86_64-linux-musl-s");
const backend = sandboxBackend();
const noSandbox = process.platform === "win32" ? `no sandbox on win32 in W1-1` : false;
const child = (...args: string[]) => [process.execPath, CHILD, ...args];
/** What macOS (EPERM) and Landlock (EACCES) report for a refused write or connect. */
const DENIED = /"ok":false,"code":"(EPERM|EACCES)"/;
const outcome = (stdout: string) => JSON.parse(stdout.trim().split("\n").at(-1) ?? "{}");

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
/** Wait up to ms for pid to be gone; true when it is. */
async function gone(pid: number, ms = 2000) {
  for (let i = 0; i < ms / 50 && alive(pid); i++) await new Promise((r) => setTimeout(r, 50));
  return !alive(pid);
}
/** Kill a pid this test holds, if it survived, so nothing leaks even when an assertion fails. */
const reap = (pid: number) => {
  if (pid > 0 && alive(pid)) process.kill(pid, "SIGKILL");
};
/** The pid a child wrote to a file in scratch, or 0. */
const pidIn = (file: string) => (existsSync(file) ? Number(readFileSync(file, "utf8")) || 0 : 0);

/** A temp root holding scratch/ (the only writable place) and outside/ (a sibling the test owns). */
function dirs() {
  const root = mkdtempSync(join(tmpdir(), "reax-sbx-"));
  const scratch = join(root, "scratch");
  const outside = join(root, "outside");
  mkdirSync(scratch);
  mkdirSync(outside);
  const policy: SandboxPolicy = { scratch, network: false, required: true };
  return { root, scratch, outside, policy, done: () => rmSync(root, { recursive: true, force: true }) };
}

/** A loopback listener that counts the connections it accepts. */
async function listener() {
  let count = 0;
  const server = createServer((s) => {
    count++;
    s.destroy();
  });
  await new Promise<void>((res) => server.listen(0, "127.0.0.1", res));
  const port = (server.address() as { port: number }).port;
  return {
    port,
    count: async () => {
      await new Promise((r) => setTimeout(r, 200)); // let a late accept land before reading
      return count;
    },
    close: () => new Promise<void>((res) => server.close(() => res())),
  };
}

test(`the sandbox backend on ${process.platform}: ${backend.name}${backend.abi !== undefined ? ` (Landlock ABI ${backend.abi})` : ""}`, () => {
  const want = { darwin: "sandbox-exec", linux: "landlock", win32: "none" }[process.platform as string];
  assert.equal(backend.name, want ?? "none", backend.why);
  if (process.platform === "linux") assert.ok((backend.abi ?? 0) >= 4, backend.why);
});

test("[+RX-SBX/enforced] a sandboxed child reads a file outside scratch and writes inside it", {
  skip: noSandbox,
}, async () => {
  const d = dirs();
  try {
    const r = await runSandboxed(child("read", FIXTURE), d.policy, { timeoutMs: 20_000 });
    assert.equal(r.code, 0, r.stderr);
    assert.ok(r.enforcement === "sandbox-exec" || r.enforcement === "landlock", r.enforcement);
    assert.equal(outcome(r.stdout).sha256, createHash("sha256").update(readFileSync(FIXTURE)).digest("hex"));
    const inside = join(d.scratch, "out.txt");
    const w = await runSandboxed(child("write", inside, "written in scratch"), d.policy, { timeoutMs: 20_000 });
    assert.deepEqual(outcome(w.stdout), { op: "write", ok: true }, w.stderr);
    assert.equal(readFileSync(inside, "utf8"), "written in scratch");
  } finally {
    d.done();
  }
});

test("[-RX-SBX/enforced] a sandboxed child cannot write outside scratch, even through a symlink, nor connect to loopback", {
  skip: noSandbox,
}, async () => {
  // SBPL takes the last matching rule: network is denied last, so no earlier allow can reopen it
  const rules = macProfile("/private/tmp/scratch").trim().split("\n");
  assert.equal(rules.at(-1), "(deny network*)");
  assert.equal(rules.filter((x) => /network/.test(x)).length, 1);
  const d = dirs();
  const l = await listener();
  try {
    const sibling = join(d.outside, "escaped.txt");
    const w = await runSandboxed(child("write", sibling, "x"), d.policy, { timeoutMs: 20_000 });
    assert.equal(w.enforcement === "none", false);
    assert.match(JSON.stringify(outcome(w.stdout)), DENIED, w.stdout);
    assert.equal(existsSync(sibling), false, "nothing was written outside scratch");
    const target = join(d.outside, "via-link.txt");
    symlinkSync(target, join(d.scratch, "link"));
    const s = await runSandboxed(child("write", join(d.scratch, "link"), "x"), d.policy, { timeoutMs: 20_000 });
    assert.match(JSON.stringify(outcome(s.stdout)), DENIED, s.stdout);
    assert.equal(existsSync(target), false, "nothing was written through the symlink");
    const c = await runSandboxed(child("connect", String(l.port)), d.policy, { timeoutMs: 20_000 });
    const o = outcome(c.stdout);
    assert.match(JSON.stringify(o), DENIED, c.stdout);
    assert.equal(await l.count(), 0, "the listener saw no connection from the sandboxed child");
    // control: the same child, unsandboxed, does connect, so the listener works
    const u = await runSandboxed(
      child("connect", String(l.port)),
      { ...d.policy, required: false },
      { timeoutMs: 20_000, forceBackend: "none" },
    );
    assert.equal(u.enforcement, "none");
    assert.deepEqual(outcome(u.stdout), { op: "connect", ok: true }, u.stderr);
    assert.equal(await l.count(), 1);
  } finally {
    await l.close();
    d.done();
  }
});

test("a sandboxed child past its deadline is killed together with its grandchild", { skip: noSandbox }, async () => {
  const d = dirs();
  const pidFile = join(d.scratch, "grandchild.pid");
  let grandchild = 0;
  try {
    const t0 = Date.now();
    const r = await runSandboxed(child("tree", pidFile), d.policy, { timeoutMs: 1500 });
    assert.equal(r.timedOut, true);
    assert.ok(Date.now() - t0 < 15_000, "termination did not hang");
    assert.notEqual(r.enforcement, "none");
    grandchild = Number(readFileSync(pidFile, "utf8"));
    assert.ok(grandchild > 0);
    for (let i = 0; i < 40 && alive(grandchild); i++) await new Promise((res) => setTimeout(res, 50));
    assert.equal(alive(grandchild), false, "the grandchild is gone too");
  } finally {
    if (grandchild > 0 && alive(grandchild)) process.kill(grandchild, "SIGKILL");
    d.done();
  }
});

test("[+RX-SBX/fail-closed] work that does not require the sandbox runs without one, labelled none", async () => {
  const d = dirs();
  try {
    const marker = join(d.scratch, "marker");
    const r = await runSandboxed(
      child("write", marker, "ran"),
      { ...d.policy, required: false },
      { timeoutMs: 20_000, forceBackend: "none" },
    );
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.enforcement, "none");
    assert.equal(readFileSync(marker, "utf8"), "ran");
  } finally {
    d.done();
  }
});

test("[-RX-SBX/fail-closed] work that requires the sandbox is refused with sandbox_unavailable where none is enforced, and nothing runs", async () => {
  const d = dirs();
  try {
    const marker = join(d.scratch, "marker");
    const runs = [runSandboxed(child("write", marker, "ran"), d.policy, { timeoutMs: 20_000, forceBackend: "none" })];
    if (process.platform === "win32")
      runs.push(runSandboxed(child("write", marker, "ran"), d.policy, { timeoutMs: 20_000 }));
    for (const p of runs)
      await assert.rejects(p, (e) => isCoreError(e, "sandbox_unavailable") && e.retryable === false);
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(existsSync(marker), false, "the child never started");
  } finally {
    d.done();
  }
});

test("a grandchild that left the process group (setsid, a detached spawn) is killed at the deadline while its parent still runs", {
  skip: noSandbox,
}, async () => {
  const d = dirs();
  const pidFile = join(d.scratch, "setsid.pid");
  const w = watchSignals();
  try {
    const r = await runSandboxed(child("setsid", pidFile), d.policy, { timeoutMs: 1500 });
    w.restore();
    assert.equal(r.timedOut, true);
    assert.ok(pidIn(pidFile) > 0, "the grandchild was started");
    assert.equal(await gone(pidIn(pidFile)), true, "the setsid grandchild is gone");
    assert.ok(w.state.root > 1 && w.state.calls.walk === 1 && w.state.calls.group === 1, JSON.stringify(w.state));
    assert.deepEqual(signalProblems(w.state), [], "only reax's walk and group kill, and nothing after the exit");
  } finally {
    w.restore();
    reap(pidIn(pidFile));
    d.done();
  }
});

test("a grandchild backgrounded in the child's group is killed when the child exits normally", {
  skip: noSandbox,
}, async () => {
  const d = dirs();
  const pidFile = join(d.scratch, "background.pid");
  try {
    const r = await runSandboxed(child("background", pidFile), d.policy, { timeoutMs: 20_000 });
    assert.equal(r.timedOut, false);
    assert.equal(r.code, 0, r.stderr);
    assert.ok(pidIn(pidFile) > 0, "the grandchild was started");
    assert.equal(await gone(pidIn(pidFile)), true, "the backgrounded grandchild is gone");
  } finally {
    reap(pidIn(pidFile));
    d.done();
  }
});

/** Run runSandboxed(child(action, pidFile), timeout 1500 ms) in a CLI-like process the test holds:
 * its only work is the run, so an unsettled promise ends it with exit 13. */
async function runner(policy: SandboxPolicy, action: string, pidFile: string) {
  const url = (...p: string[]) => JSON.stringify(pathToFileURL(join(import.meta.dirname, ...p)).href);
  const script = `
    const { runSandboxed } = await import(${url("..", "src", "sandbox", "index.ts")});
    const { watchSignals, signalProblems } = await import(${url("fixtures", "sbx-watch.ts")});
    const w = watchSignals();
    const t0 = Date.now();
    const r = await runSandboxed(${JSON.stringify(child(action, pidFile))}, ${JSON.stringify(policy)}, { timeoutMs: 1500 });
    w.restore();
    process.stdout.write(JSON.stringify({ ms: Date.now() - t0, timedOut: r.timedOut, code: r.code, signal: r.signal, watch: w.state, problems: signalProblems(w.state) }));`;
  const p = spawn(
    process.execPath,
    ["--conditions=source", "--disable-warning=ExperimentalWarning", "--input-type=module", "-e", script],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let out = "";
  let err = "";
  p.stdout.on("data", (c) => {
    out += c;
  });
  p.stderr.on("data", (c) => {
    err += c;
  });
  try {
    const code = await new Promise<number | null>((res) => {
      const t = setTimeout(() => res(-1), 40_000);
      p.once("exit", (c) => {
        clearTimeout(t);
        res(c);
      });
    });
    return { code, out, err };
  } finally {
    if (p.pid && p.exitCode === null && p.signalCode === null) p.kill("SIGKILL");
  }
}

test("runSandboxed settles within a bound, in a process with nothing else to keep it alive, when a descendant escapes", {
  skip: noSandbox,
}, async () => {
  const d = dirs();
  const pidFile = join(d.scratch, "escaped.pid");
  try {
    const r = await runner(d.policy, "escape", pidFile);
    assert.equal(r.code, 0, `the runner exited ${r.code}: ${r.err}`);
    const o = JSON.parse(r.out);
    assert.equal(o.timedOut, true);
    assert.ok(o.ms < 20_000, `settled after ${o.ms} ms`);
    // the pipes were let go once the group was killed, so close came with the kill's signal (core's
    // own fallback, 2 s later, would resolve with signal null)
    assert.equal(o.signal, "SIGKILL", r.out);
    assert.deepEqual(o.problems, [], "only reax's group kill, and nothing after the exit");
    // the double-forked grandchild did escape (ADR 0006's stated limit), so the settle path was
    // really exercised; the test ends it by its pid
    assert.ok(pidIn(pidFile) > 0 && alive(pidIn(pidFile)), "the grandchild escaped");
  } finally {
    reap(pidIn(pidFile));
    d.done();
  }
});

test("runSandboxed settles at a plain deadline in a process with nothing else to keep it alive", {
  skip: noSandbox,
}, async () => {
  const d = dirs();
  const pidFile = join(d.scratch, "tree.pid");
  try {
    const r = await runner(d.policy, "tree", pidFile);
    assert.equal(r.code, 0, `the runner exited ${r.code}: ${r.err}`);
    const o = JSON.parse(r.out);
    assert.equal(o.timedOut, true);
    assert.ok(o.watch.root > 1 && o.watch.calls.walk === 1 && o.watch.calls.group === 1, r.out);
    assert.deepEqual(o.problems, [], "only reax's walk and group kill, and nothing after the exit");
    assert.ok(pidIn(pidFile) > 0, "the grandchild was started");
    assert.equal(await gone(pidIn(pidFile)), true, "the grandchild is gone");
  } finally {
    reap(pidIn(pidFile));
    d.done();
  }
});

test("once the root has exited and been reaped, nothing signals its pid or its group: no walk, no group kill and no core stop at the deadline, only the group kill in the exit turn", {
  skip: noSandbox,
}, async () => {
  const d = dirs();
  const pidFile = join(d.scratch, "stale.pid");
  const w = watchSignals();
  try {
    // the root exits at once; its setsid grandchild holds the pipes, so the run lasts to the deadline
    const r = await runSandboxed(child("setsid-exit", pidFile), d.policy, { timeoutMs: 1500 });
    w.restore();
    // the wrappers exec the child, so the pid the child saw is the root's
    const root = pidIn(`${pidFile}.root`);
    assert.ok(root > 1, "the child wrote its pid");
    assert.equal(w.state.root, root);
    assert.equal(r.timedOut, true);
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(
      w.state.calls,
      { walk: 0, group: 0, exit: 1 },
      "only the group kill in the turn of the root's exit",
    );
    assert.deepEqual(signalProblems(w.state), [], "no group or root signal after the exit event, none from core");
  } finally {
    w.restore();
    reap(pidIn(pidFile));
    d.done();
  }
});

test("the tree functions refuse pids 0 and 1 (checked against a stub: the real kill is never called)", () => {
  const realKill = process.kill;
  const got: string[] = [];
  const stub = ((p: number, sig?: string | number) => {
    got.push(`kill(${p}, ${sig})`);
    return true;
  }) as typeof process.kill;
  process.kill = stub;
  try {
    assert.equal(process.kill, stub, "the stub is in place before any call");
    TREE.killGroup(1);
    TREE.killGroup(0);
    TREE.killDescendants(1);
    TREE.killDescendants(0);
  } finally {
    process.kill = realKill;
  }
  assert.deepEqual(got, []);
});

test("the child gets an allowlisted environment: a parent variable is absent unless passed by name", async () => {
  const d = dirs();
  const name = "REAX_SBX_TEST_SECRET";
  process.env[name] = "parent-only";
  const policy = { ...d.policy, required: !noSandbox };
  const o = noSandbox ? { forceBackend: "none" as const } : {};
  try {
    const r = await runSandboxed(child("env", name), policy, { timeoutMs: 20_000, ...o });
    assert.deepEqual(outcome(r.stdout), { op: "env", ok: true, value: null }, r.stderr);
    const h = await runSandboxed(child("env", "HOME"), policy, { timeoutMs: 20_000, ...o });
    assert.equal(outcome(h.stdout).value, realpathSync(d.scratch));
    const p = await runSandboxed(child("env", name), policy, { timeoutMs: 20_000, passEnv: [name], ...o });
    assert.equal(outcome(p.stdout).value, "parent-only");
  } finally {
    delete process.env[name];
    d.done();
  }
});
