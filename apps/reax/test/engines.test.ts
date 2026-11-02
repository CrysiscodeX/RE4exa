// ENG: the engine adapter contract and registry (against a fake engine, test/fixtures/fake-engine.mjs,
// whose outputs are fixed by its source) and the LLVM provider (llvm-nm in the sandbox, against the
// committed key bench/oracle/symbols.json, read here as JSON, never through reax's parsers).
// Processes: each run's engine is stopped by the sandbox's own kill at the deadline or abort (its
// group and the descendants a ps snapshot lists); the tests then check, by the pids the fake engine
// wrote, that the engine and its grandchild are gone, and SIGKILL any survivor by those pids.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { test } from "node:test";
import { isCoreError } from "@re4exa/core/errors";
import { setSpawnObserver } from "@re4exa/core/vendor/orca-process-host/spawn-observer";
import { llvmCandidates, llvmProvider, llvmSpec, llvmVersion, type NmSymbol, parseNm } from "../src/engines/llvm.ts";
import { provider, providers, registerProvider } from "../src/engines/registry.ts";
import { type CommandEngineSpec, commandEngine } from "../src/engines/run.ts";
import { sandboxBackend } from "../src/sandbox/index.ts";

const FAKE = join(import.meta.dirname, "fixtures", "fake-engine.mjs");
const REAX = join(import.meta.dirname, "..");
const win = process.platform === "win32";
/** Contract runs: enforced where a sandbox exists; on win32 explicitly unenforced, labelled "none". */
const required = !win;
const label = win ? "none" : sandboxBackend().name;

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
async function gone(pid: number, ms = 3000) {
  for (let i = 0; i < ms / 50 && alive(pid); i++) await new Promise((r) => setTimeout(r, 50));
  return !alive(pid);
}
const reap = (pid: number) => {
  if (pid > 1 && alive(pid)) process.kill(pid, "SIGKILL");
};
const sha = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");

function scratchDir() {
  const root = mkdtempSync(join(tmpdir(), "reax-eng-"));
  const scratch = join(root, "scratch");
  mkdirSync(scratch);
  return { root, scratch, done: () => rmSync(root, { recursive: true, force: true }) };
}

interface FakeReq {
  mode: string;
  n?: number;
}
function fakeSpec(o: { candidates?: string[]; claim?: string } = {}): CommandEngineSpec<FakeReq, NmSymbol[]> {
  return {
    id: "fake",
    operations: ["symbols"],
    resourceClass: "light",
    candidates: () => o.candidates ?? [FAKE],
    launcher: (p) => ({ program: process.execPath, prefix: [p, ...(o.claim ? ["--claim-version", o.claim] : [])] }),
    parseVersion: (out) => /^fake-engine version (\S+)$/m.exec(out)?.[1] ?? null,
    minMajor: 18,
    remediation: () => "install it with: fake-pkg add fake-engine",
    args: (r) => [r.mode, ...(r.n !== undefined ? [String(r.n)] : [])],
    maxOutputBytes: 1 << 20,
    alwaysRequired: false,
    parse: (s) => {
      const p = parseNm(s);
      return p.ok ? { ok: true, data: p.data } : p;
    },
  };
}
const fake = (o: { candidates?: string[]; claim?: string } = {}) => commandEngine(fakeSpec(o));

/** Wait for the fake's pids.json (sleep mode) in scratch. */
async function pids(scratch: string, ms = 10_000): Promise<{ root: number; grandchild: number }> {
  const f = join(scratch, "pids.json");
  for (let i = 0; i < ms / 50 && !existsSync(f); i++) await new Promise((r) => setTimeout(r, 50));
  for (let i = 0; i < 20; i++) {
    try {
      return JSON.parse(readFileSync(f, "utf8"));
    } catch {
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  return { root: 0, grandchild: 0 };
}

// A1: what discovery finds on this lane, in the test's name (CI's JUnit report shows it per lane)
const llvm = llvmProvider();
const found = await llvm.discover();
const foundText = found.available
  ? JSON.stringify({ path: found.path, version: found.version, enforcement: found.enforcement })
  : `unavailable: ${found.reason}`;

test(`LLVM discovery on ${process.platform}: ${foundText}`, () => {
  assert.equal(found.available, true, foundText);
  if (!found.available) return;
  assert.ok(Number(found.version.split(".")[0]) >= 18);
  assert.equal(found.sha256, sha(found.path), "the digest is of the resolved file");
  assert.equal(found.enforcement, win ? "none" : sandboxBackend().name);
});

test("the registry holds the LLVM provider once, and refuses a second provider with the same id", () => {
  assert.equal(provider("llvm")?.id, "llvm");
  assert.ok(providers().some((p) => p.id === "llvm"));
  assert.deepEqual(provider("llvm")?.operations, ["symbols"]);
  assert.equal(provider("no-such-engine"), undefined);
  assert.throws(() => registerProvider(llvmProvider() as never), /already registered/);
});

test("[+RX-ENG/contract] discovery reports the real path, the version and the digest of the file; a run returns its parsed output and its sandbox", async () => {
  const d = scratchDir();
  try {
    // through a symlink where the platform allows it: the record must name the file it points to
    let entry = FAKE;
    if (!win) {
      entry = join(d.root, "fake-link.mjs");
      symlinkSync(FAKE, entry);
    }
    const p = fake({ candidates: [entry] });
    const a = await p.discover();
    assert.ok(a.available, JSON.stringify(a));
    if (!a.available) return;
    assert.equal(a.path, realpathSync(FAKE));
    assert.equal(a.version, "18.2.0");
    assert.equal(a.sha256, sha(FAKE));
    const shasum = win ? null : spawnSync("shasum", ["-a", "256", FAKE], { encoding: "utf8" });
    if (shasum && shasum.status === 0) assert.equal(a.sha256, shasum.stdout.split(/\s+/)[0]);
    const r = await p.run({ mode: "ok" }, { scratch: d.scratch, required, timeoutMs: 20_000 });
    assert.deepEqual(r.data, [
      { name: "alpha", type: "T", addr: "0x1000", size: 16 },
      { name: "beta", type: "D", addr: "0x2000", size: 8 },
    ]);
    assert.equal(r.coverage, "complete");
    assert.deepEqual(r.limitations, []);
    assert.equal(r.enforcement, label);
    assert.deepEqual(r.engine, { id: "fake", path: a.path, version: "18.2.0", sha256: a.sha256 });
  } finally {
    d.done();
  }
});

test("[-RX-ENG/contract] a missing engine gives engine_unavailable with an install line, and starts nothing", async () => {
  const d = scratchDir();
  const started: string[] = [];
  setSpawnObserver((cmd, args) => started.push([cmd, ...args].join(" ")));
  try {
    const p = fake({ candidates: [join(d.root, "no-such-engine")] });
    const a = await p.discover();
    assert.equal(a.available, false);
    if (a.available) return;
    assert.match(a.reason, /not found/);
    assert.match(a.remediation, /install it with: fake-pkg add fake-engine/);
    await assert.rejects(
      p.run({ mode: "ok" }, { scratch: d.scratch, required }),
      (e) => isCoreError(e, "engine_unavailable") && /fake-pkg add/.test(String(e.detail?.remediation)),
    );
    assert.deepEqual(started, [], "no process was started (nothing probed, nothing installed)");
    assert.deepEqual(readdirSync(d.scratch), []);
  } finally {
    setSpawnObserver(null);
    d.done();
  }
});

test("[-RX-ENG/contract] an engine older than the minimum gives engine_unavailable with the reason", async () => {
  const d = scratchDir();
  try {
    const p = fake({ claim: "12.0.1" });
    const a = await p.discover();
    assert.equal(a.available, false);
    if (a.available) return;
    assert.match(a.reason, /version 12\.0\.1; fake 18 or later is needed/);
    await assert.rejects(
      p.run({ mode: "ok" }, { scratch: d.scratch, required }),
      (e) => isCoreError(e, "engine_unavailable") && /12\.0\.1/.test(String(e.detail?.reason)),
    );
  } finally {
    d.done();
  }
});

test("[-RX-ENG/contract] a run past its deadline gives engine_timeout, and the engine and its in-group grandchild are dead", async () => {
  const d = scratchDir();
  let held = { root: 0, grandchild: 0 };
  try {
    const run = fake().run({ mode: "sleep" }, { scratch: d.scratch, required, timeoutMs: 2000 });
    held = await pids(d.scratch);
    await assert.rejects(run, (e) => {
      assert.ok(isCoreError(e, "engine_timeout"), String(e));
      assert.equal(e.detail?.enforcement, label);
      assert.doesNotMatch(e.message + JSON.stringify(e.detail), /whole|tree|every/i, "no claim beyond ADR 0006");
      return true;
    });
    assert.ok(held.root > 1 && held.grandchild > 1, JSON.stringify(held));
    assert.equal(await gone(held.root), true, "the engine is gone");
    assert.equal(await gone(held.grandchild), true, "its grandchild is gone");
  } finally {
    reap(held.root);
    reap(held.grandchild);
    d.done();
  }
});

test("[-RX-ENG/contract] aborting a run gives engine_cancelled, and the engine and its in-group grandchild are dead", async () => {
  const d = scratchDir();
  let held = { root: 0, grandchild: 0 };
  const ac = new AbortController();
  try {
    const run = fake().run({ mode: "sleep" }, { scratch: d.scratch, required, timeoutMs: 30_000, signal: ac.signal });
    held = await pids(d.scratch);
    ac.abort();
    await assert.rejects(run, (e) => isCoreError(e, "engine_cancelled") && e.detail?.enforcement === label);
    assert.ok(held.root > 1 && held.grandchild > 1, JSON.stringify(held));
    assert.equal(await gone(held.root), true, "the engine is gone");
    assert.equal(await gone(held.grandchild), true, "its grandchild is gone");
  } finally {
    reap(held.root);
    reap(held.grandchild);
    d.done();
  }
});

test("[-RX-ENG/contract] a failing engine gives engine_failed with its stderr, capped at 2 KiB and marked untrusted", async () => {
  const d = scratchDir();
  try {
    await assert.rejects(fake().run({ mode: "fail" }, { scratch: d.scratch, required, timeoutMs: 20_000 }), (e) => {
      assert.ok(isCoreError(e, "engine_failed"), String(e));
      assert.equal(e.detail?.code, 3);
      assert.equal(e.detail?.stderrCut, true);
      const s = String(e.detail?.stderr);
      assert.match(s, /^<untrusted-content id="u-[0-9a-f]+" origin="fake stderr">\n/);
      const inner = s.slice(s.indexOf("\n") + 1, s.lastIndexOf("\n</untrusted-content"));
      assert.ok(inner.startsWith("fake failure: xxx"), inner.slice(0, 40));
      assert.equal(Buffer.byteLength(inner), 2048);
      return true;
    });
  } finally {
    d.done();
  }
});

test("[-RX-ENG/contract] output that does not parse gives engine_output_invalid, never an empty result", async () => {
  const d = scratchDir();
  try {
    await assert.rejects(
      fake().run({ mode: "garbage" }, { scratch: d.scratch, required, timeoutMs: 20_000 }),
      (e) =>
        isCoreError(e, "engine_output_invalid") &&
        e.detail?.line === 1 &&
        /^<untrusted-content id="u-[0-9a-f]+" origin="fake output">\nthis is not llvm-nm output\n<\/untrusted-content id="u-[0-9a-f]+">$/.test(
          String(e.detail?.excerpt),
        ),
    );
  } finally {
    d.done();
  }
});

test("[-RX-ENG/contract] output past the cap gives a partial result that names the cap, never a complete one", async () => {
  const d = scratchDir();
  try {
    const r = await fake().run(
      { mode: "big", n: 200_000 },
      { scratch: d.scratch, required, timeoutMs: 20_000, maxOutputBytes: 4096 },
    );
    assert.equal(r.coverage, "partial");
    assert.equal(r.limitations.length, 1);
    assert.match(r.limitations[0]!, /cut at the cap of 4096 bytes/);
    assert.ok(r.data.length > 10 && r.data.length < 1000, String(r.data.length));
    assert.deepEqual(
      r.data.map((s) => s.name),
      r.data.map((_, i) => `s${i}`),
    );
  } finally {
    d.done();
  }
});

test("[-RX-ENG/contract] a run that does not say `required` requires the sandbox: where none is enforced it is refused", async () => {
  const d = scratchDir();
  try {
    await assert.rejects(
      fake().run({ mode: "ok" }, { scratch: d.scratch, timeoutMs: 20_000, forceBackend: "none" }),
      (e) => isCoreError(e, "sandbox_unavailable"),
    );
    assert.deepEqual(readdirSync(d.scratch), []);
  } finally {
    d.done();
  }
});

test("[-RX-ENG/contract] without a cap from the caller, the provider's default cap applies", async () => {
  const d = scratchDir();
  try {
    // the fake's default is 1 MiB (its spec above); 1.5 MB of output is cut there
    const r = await fake().run({ mode: "big", n: 1_500_000 }, { scratch: d.scratch, required, timeoutMs: 30_000 });
    assert.equal(r.coverage, "partial");
    assert.match(r.limitations[0]!, /cut at the cap of 1048576 bytes/);
    // LLVM's default cap is 32 MiB
    assert.equal(llvmSpec().maxOutputBytes, 32 * 1024 * 1024);
  } finally {
    d.done();
  }
});

test("[-RX-ENG/contract] a discovery that throws is not cached: the next call discovers again", async () => {
  let calls = 0;
  const p = commandEngine<FakeReq, NmSymbol[]>({
    ...fakeSpec(),
    candidates: () => {
      calls++;
      if (calls === 1) throw new Error("first discovery fails");
      return [FAKE];
    },
  });
  await assert.rejects(p.discover(), /first discovery fails/);
  const a = await p.discover();
  assert.equal(a.available, true, JSON.stringify(a));
  assert.equal(calls, 2);
  assert.equal(await p.discover(), a, "a successful discovery is cached");
});

// ---------------------------------------------------------------------------------------- LLVM

test("the LLVM version is read from its --version text: Homebrew, Ubuntu and plain, and nothing else", () => {
  assert.equal(llvmVersion("Homebrew LLVM version 18.1.8\n  Optimized build.\n"), "18.1.8");
  assert.equal(llvmVersion("Ubuntu LLVM version 18.1.3\n  Optimized build.\n"), "18.1.3");
  assert.equal(llvmVersion("LLVM (http://llvm.org/):\n  LLVM version 20.1.8\n"), "20.1.8");
  assert.equal(llvmVersion("Apple clang version 17.0.0 (clang-1700.0.13.3)\n"), null, "not an LLVM version line");
  assert.equal(llvmVersion("version 18.1.8"), null);
  assert.equal(llvmVersion("\u0000garbage 1.2.3 LLVMversion 9.9.9"), null);
});

test("LLVM discovery looks in REAX_LLVM_BIN, then PATH for llvm-nm-18, then PATH for llvm-nm, then the fixed directories", () => {
  const exe = (n: string) => (win ? `${n}.exe` : n);
  const bin = join("env", "llvm", "bin");
  const env = { REAX_LLVM_BIN: bin, PATH: [join("p1"), join("p2")].join(delimiter) };
  assert.deepEqual(llvmCandidates(env), [
    join(bin, exe("llvm-nm")),
    join("p1", exe("llvm-nm-18")),
    join("p2", exe("llvm-nm-18")),
    join("p1", exe("llvm-nm")),
    join("p2", exe("llvm-nm")),
    join("/usr/lib/llvm-18/bin", exe("llvm-nm")),
    join("/opt/homebrew/opt/llvm@18/bin", exe("llvm-nm")),
    join("/usr/local/opt/llvm@18/bin", exe("llvm-nm")),
    join("C:\\Program Files\\LLVM\\bin", exe("llvm-nm")),
  ]);
  assert.deepEqual(llvmCandidates({ PATH: "" }).length, 4, "no REAX_LLVM_BIN, no PATH: only the fixed directories");
});

const posixOnly = win ? "a shell script and a symlink as llvm-nm: POSIX only" : false;

test("[-RX-ENG/contract] an LLVM older than 18, found through REAX_LLVM_BIN, is unavailable with the reason", {
  skip: posixOnly,
}, async () => {
  const d = scratchDir();
  try {
    const dir = join(d.root, "llvm17");
    mkdirSync(dir);
    writeFileSync(join(dir, "llvm-nm"), "#!/bin/sh\necho 'Homebrew LLVM version 17.0.6'\n", { mode: 0o755 });
    const p = llvmProvider({ ...process.env, REAX_LLVM_BIN: dir });
    const a = await p.discover();
    assert.equal(a.available, false, JSON.stringify(a));
    if (a.available) return;
    assert.match(a.reason, /version 17\.0\.6; llvm 18 or later is needed/);
    assert.equal(a.reason.startsWith(realpathSync(join(dir, "llvm-nm"))), true, a.reason);
    await assert.rejects(
      p.run({ target: join(REAX, "fixtures", "bin", "hello-x86_64-linux-gnu.2.28-g") }, { scratch: d.scratch }),
      (e) => isCoreError(e, "engine_unavailable") && /17\.0\.6/.test(String(e.detail?.reason)),
    );
  } finally {
    d.done();
  }
});

test("[+RX-ENG/contract] REAX_LLVM_BIN is used first: through a symlink there, discovery records the real path and its digest", {
  skip: posixOnly,
}, async () => {
  assert.ok(found.available);
  if (!found.available) return;
  const d = scratchDir();
  try {
    const dir = join(d.root, "linkdir");
    mkdirSync(dir);
    symlinkSync(found.path, join(dir, "llvm-nm"));
    const a = await llvmProvider({ ...process.env, REAX_LLVM_BIN: dir }).discover();
    assert.ok(a.available, JSON.stringify(a));
    if (!a.available) return;
    assert.equal(a.path, found.path);
    assert.equal(a.sha256, sha(found.path));
  } finally {
    d.done();
  }
});

test("[-RX-ENG/llvm] option-shaped requests are refused with bad_request and start nothing", async () => {
  assert.ok(found.available, "LLVM is needed to reach the request check");
  const d = scratchDir();
  const started: string[] = [];
  try {
    await llvm.discover();
    setSpawnObserver((cmd, args) => started.push([cmd, ...args].join(" ")));
    const target = join(REAX, "fixtures", "bin", "hello-x86_64-linux-gnu.2.28-g");
    for (const req of [{ target: "-help" }, { target: join("rel", "x") }, { target, arch: "x86_64 --format=bsd" }])
      await assert.rejects(
        llvm.run(req, { scratch: d.scratch, timeoutMs: 20_000 }),
        (e) => isCoreError(e, "bad_request"),
        JSON.stringify(req),
      );
    assert.deepEqual(started, [], "nothing was started");
  } finally {
    setSpawnObserver(null);
    d.done();
  }
});

const noLlvmRun = win ? "no sandbox on win32: LLVM runs on targets fail closed (tested below)" : false;
const KEY = JSON.parse(readFileSync(join(REAX, "bench", "oracle", "symbols.json"), "utf8")).files as Record<
  string,
  { slices: { symtab?: KeySym[]; nm?: KeySym[] }[] }
>;
const LAYOUT = JSON.parse(readFileSync(join(REAX, "bench", "oracle", "layout.json"), "utf8"));
interface KeySym {
  name: string;
  addr: string | null;
  cls: string;
}
const LLVM_ARCH: Record<string, string> = { aarch64: "arm64", x86_64: "x86_64", x86: "i386" };

test("[+RX-ENG/llvm] llvm-nm in the sandbox lists each fixture's defined symbols (name, type, address) exactly as the committed key", {
  skip: noLlvmRun,
}, async () => {
  const d = scratchDir();
  let compared = 0;
  let nonEmpty = 0;
  try {
    for (const [file, k] of Object.entries(KEY)) {
      for (const [i, s] of k.slices.entries()) {
        const key = s.symtab ?? s.nm;
        if (!key) continue; // PE and the like: the key has no llvm-nm listing
        const archs = (LAYOUT.files ?? LAYOUT)[file].slices.map((x: { arch: string }) => x.arch);
        const arch = k.slices.length > 1 ? (LLVM_ARCH[archs[i]] ?? archs[i]) : undefined;
        const r = await llvm.run(
          { target: join(REAX, "fixtures", "bin", file), ...(arch ? { arch } : {}) },
          { scratch: d.scratch, timeoutMs: 30_000 },
        );
        assert.ok(r.enforcement === "landlock" || r.enforcement === "sandbox-exec", r.enforcement);
        assert.equal(r.coverage, "complete");
        const defined = key.filter((x) => x.cls !== "U");
        assert.deepEqual(
          defined.filter((x) => x.addr === null),
          [],
          `${file}: every defined key entry has an address`,
        );
        const want = defined.map((x) => `${x.name} ${x.cls} ${BigInt(x.addr!)}`).sort();
        const got = r.data.map((x) => `${x.name} ${x.type} ${BigInt(x.addr)}`).sort();
        assert.deepEqual(got, want, `${file}${arch ? ` (${arch})` : ""}`);
        compared++;
        if (want.length) nonEmpty++;
      }
    }
    assert.ok(compared >= 15, `${compared} slices compared`);
    assert.ok(nonEmpty >= 11, `${nonEmpty} slices with symbols compared`);
  } finally {
    d.done();
  }
});

/** A root with target/ (a text file), sibling/ and scratch/, and a listing of what is in each. */
function llvmDirs() {
  const root = mkdtempSync(join(tmpdir(), "reax-eng-llvm-"));
  for (const x of ["target", "sibling", "scratch"]) mkdirSync(join(root, x));
  writeFileSync(join(root, "target", "notes.txt"), "not a binary\n");
  const list = () => ["target", "sibling", "scratch"].map((x) => [x, readdirSync(join(root, x)).sort()]);
  return { root, list, done: () => rmSync(root, { recursive: true, force: true }) };
}

test("[-RX-ENG/llvm] llvm-nm on a file that is not a binary gives engine_failed, not an empty list, and writes nothing outside scratch", {
  skip: noLlvmRun,
}, async () => {
  const d = llvmDirs();
  try {
    const before = d.list();
    await assert.rejects(
      llvm.run(
        { target: join(d.root, "target", "notes.txt") },
        { scratch: join(d.root, "scratch"), timeoutMs: 30_000 },
      ),
      (e) => isCoreError(e, "engine_failed") && e.detail?.code === 1 && /notes\.txt/.test(String(e.detail?.stderr)),
    );
    assert.deepEqual(d.list(), before);
  } finally {
    d.done();
  }
});

test("[-RX-ENG/llvm] where no sandbox is enforced, an LLVM run on a target is refused with sandbox_unavailable and nothing runs", async () => {
  const d = llvmDirs();
  const started: string[] = [];
  try {
    const target = join(REAX, "fixtures", "bin", "hello-x86_64-linux-gnu.2.28-g");
    const opts = { scratch: join(d.root, "scratch"), timeoutMs: 30_000 };
    await llvm.discover(); // discovery's own version run is not what is checked here
    setSpawnObserver((cmd, args) => started.push([cmd, ...args].join(" ")));
    // forced to "none" on every lane; on win32 also the real backend; a per-call required: false is
    // ignored for LLVM (D-22)
    const runs = [
      llvm.run({ target }, { ...opts, forceBackend: "none" }),
      llvm.run({ target }, { ...opts, forceBackend: "none", required: false }),
    ];
    if (win) runs.push(llvm.run({ target }, opts));
    for (const p of runs) await assert.rejects(p, (e) => isCoreError(e, "sandbox_unavailable"));
    assert.deepEqual(started, [], "nothing was started");
    assert.deepEqual(readdirSync(join(d.root, "scratch")), []);
  } finally {
    setSpawnObserver(null);
    d.done();
  }
});

test("known limit: a symbol name with a newline is read as two symbols, the first forged by the target (docs/engines-known-limits.md)", {
  skip: noLlvmRun,
}, async () => {
  // a copy of a fixture whose 14-byte name "_IO_stdin_used" is replaced by "a T 1 1\nevil_x"
  const d = scratchDir();
  try {
    const b = readFileSync(join(REAX, "fixtures", "bin", "hello-x86_64-linux-gnu.2.28-g"));
    const from = Buffer.from("\0_IO_stdin_used\0", "latin1");
    const to = Buffer.from("\0a T 1 1\nevil_x\0", "latin1");
    assert.equal(from.length, to.length);
    let n = 0;
    for (let i = b.indexOf(from); i >= 0 && n < 16; i = b.indexOf(from, i + 1), n++) to.copy(b, i);
    assert.ok(n >= 1);
    const target = join(d.root, "forged.elf");
    writeFileSync(target, b);
    const r = await llvm.run({ target }, { scratch: d.scratch, timeoutMs: 30_000 });
    // current behaviour, to be turned around when the parser is fixed
    assert.equal(r.coverage, "complete");
    assert.deepEqual(
      r.data.filter((x) => ["a", "evil_x", "_IO_stdin_used"].includes(x.name)),
      [
        { name: "a", type: "T", addr: "0x1", size: 1 },
        { name: "evil_x", type: "R", addr: "0x1000480", size: 4 },
      ],
    );
  } finally {
    d.done();
  }
});
