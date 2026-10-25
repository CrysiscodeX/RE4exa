// Model-free benchmark: measures M1–M11 and M13 from the plan, against fixed targets and the
// baselines measured in the merger debate (docs/merger). `--gate` exits 1 when a target is missed.
// Live model runs (M12) are in bench/live.ts and need ASSAY_LIVE=1.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { App } from "../src/app/app.ts";
import type { AccountRef, AgentSession, ProviderAdapter, ProviderId } from "../src/contracts.ts";
import { recordClaim } from "../src/evidence/store.ts";
import { Orchestrator } from "../src/orchestrator/orchestrator.ts";
import { tmp } from "../test/helpers.ts";

const ROOT = join(import.meta.dirname, "..");
const OUT = join(ROOT, "bench", "results");
mkdirSync(OUT, { recursive: true });
const gate = process.argv.includes("--gate");

interface Row {
  id: string;
  measure: string;
  baseline: string;
  target: string;
  value: string;
  pass: boolean;
  how: string;
}
const rows: Row[] = [];
const add = (r: Row) => {
  rows.push(r);
  console.log(`${r.pass ? "PASS" : "MISS"} ${r.id.padEnd(4)} ${r.measure}: ${r.value} (target ${r.target})`);
};
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s[Math.floor((s.length - 1) / 2)]! + s[Math.ceil((s.length - 1) / 2)]!) / 2 : Number.NaN;
};

// ---------- metrics printed by the test suites (M1, M4, M5, M10) and assertion-backed ones (M6–M9) ----------
function runTests(files: string[]): { ok: boolean; metrics: Record<string, string> } {
  const r = spawnSync(
    process.execPath,
    ["--test", "--test-concurrency=1", "--disable-warning=ExperimentalWarning", ...files],
    { cwd: ROOT, encoding: "utf8", timeout: 600_000 },
  );
  const metrics: Record<string, string> = {};
  for (const line of `${r.stdout}\n${r.stderr}`.split("\n")) {
    const m = line.match(/#\s*\\?#\s*(M\d+)\s+(.*)$/) ?? line.match(/^#\s*(M\d+)\s+(.*)$/);
    if (m) metrics[m[1]!] = m[2]!.trim();
  }
  return { ok: r.status === 0, metrics };
}

const durability = runTests(["test/fault-injection.test.ts", "test/kernel.test.ts"]);
add({
  id: "M1",
  measure: "Work lost per SIGKILL",
  baseline: "rea: the whole session ledger (in-memory)",
  target: "0 lost evidence, ≤1 step re-run per kill, 30 kills",
  value: durability.metrics.M1 ?? "not printed",
  pass:
    durability.ok &&
    /kills=(\d+)/.test(durability.metrics.M1 ?? "") &&
    Number(/kills=(\d+)/.exec(durability.metrics.M1 ?? "")![1]) >= 30,
  how: "test/fault-injection.test.ts",
});
add({
  id: "M6",
  measure: "Two processes on one store",
  baseline: "PGlite: committed rows lost in 5 of 8 runs",
  target: "1000/1000 second opens refused, 0 rows lost",
  value: durability.ok ? "1000/1000 refused, 0 rows lost" : "test failed",
  pass: durability.ok,
  how: "test/kernel.test.ts (two-process test)",
});
add({
  id: "M7",
  measure: "Stale-lease writes accepted",
  baseline: "absurd: expired, unswept leases accept writes",
  target: "0 of 1000",
  value: durability.ok ? "0 of 1000" : "test failed",
  pass: durability.ok,
  how: "test/kernel.test.ts (fence race)",
});

const probes = runTests([
  "test/probes-engine.test.ts",
  "test/probes-js.test.ts",
  "test/verifier.test.ts",
  "test/evidence.test.ts",
]);
add({
  id: "M8",
  measure: "Identity stable across paths and hosts",
  baseline: "rea: nested ids change with the path",
  target: "100% equal keys",
  value: probes.ok ? "100% (ProbeKey, ObservationId, FindingKey)" : "test failed",
  pass: probes.ok,
  how: "test/evidence.test.ts, test/probes-engine.test.ts",
});
add({
  id: "M9",
  measure: "False 'complete' coverage",
  baseline: "rea: 'complete' with unresolved imports",
  target: "0 on the ablation corpus",
  value: probes.ok ? "0 of 300" : "test failed",
  pass: probes.ok,
  how: "test/probes-js.test.ts",
});
const m10 = probes.metrics.M10 ?? "";
// either "sweep-median-max=5.3ms" or per-fixture "name=identify/sweep" pairs; take the slowest sweep
const sweepMs = /sweep-median-max=([\d.]+)ms/.test(m10)
  ? Number(/sweep-median-max=([\d.]+)ms/.exec(m10)![1])
  : Math.max(...[...m10.matchAll(/=[\d.]+\/([\d.]+)/g)].map((m) => Number(m[1])));
add({
  id: "M10",
  measure: "Time to first evidence (warm, per fixture)",
  baseline: "rea CLI start 2.1–2.2 s per call",
  target: "median ≤ 1000 ms",
  value: m10 || "not printed",
  pass: sweepMs <= 1000,
  how: "test/probes-engine.test.ts",
});
const tripwire = runTests(["test/tripwire.test.ts"]);
add({
  id: "M5",
  measure: "Effects executed from planted instructions",
  baseline: "no parent measured it",
  target: "0 executed, 100% routed to approval (24 fixtures)",
  value: tripwire.metrics.M5 ?? "not printed",
  pass: tripwire.ok && /executed=0/.test(tripwire.metrics.M5 ?? ""),
  how: "test/tripwire.test.ts (adversarial fake agent)",
});

// ---------- M2, M3, M4 over real MCP against the bench fixtures ----------
const fixturesSrc = join(ROOT, "bench", "tasks", "fixtures");
const ws = tmp("assay-bench-ws-");
cpSync(fixturesSrc, ws.dir, { recursive: true });
const home = tmp("assay-bench-home-");
const app = new App({ home: home.dir, workspace: ws.dir, demo: true });
const server = await app.listen();
const c = app.kernel.createCase({ title: "bench", workspace: ws.dir });
const token = app.tokens.issue({ caseId: c.id, caller: "coordinator" });
let rpcId = 0;
async function rpc(
  method: string,
  params: unknown,
): Promise<{ bytes: number; body: { result?: Record<string, unknown> } }> {
  const res = await fetch(`${server.url}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
  });
  const text = await res.text();
  return { bytes: Buffer.byteLength(text), body: JSON.parse(text) };
}
await rpc("initialize", {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "bench", version: "1" },
});
const list = await rpc("tools/list", {});
add({
  id: "M2",
  measure: "Bytes an agent loads to start (tools/list)",
  baseline: "rea default catalog 3,211,385 B",
  target: "≤ 12,288 B",
  value: `${list.bytes} B (${(list.body.result?.tools as unknown[] | undefined)?.length ?? 0} tools)`,
  pass: list.bytes <= 12_288,
  how: "MCP wire capture",
});

const tasks = readdirSync(join(ROOT, "bench", "tasks"))
  .filter((f) => f.endsWith(".json") && !f.startsWith("leanrea-"))
  .map(
    (f) =>
      JSON.parse(readFileSync(join(ROOT, "bench", "tasks", f), "utf8")) as {
        id: string;
        subjectFiles: string[];
        oracle: { predicate: string; params: Record<string, unknown>; expect: string }[];
      },
  );
const resultBytes: number[] = [];
let duplicated = 0;
let calls = 0;
for (const t of tasks) {
  for (const f of t.subjectFiles) {
    for (const [name, args] of [
      ["assay_sweep", { path: f }],
      ["assay_probe", { probe: "file.identify", path: f }],
      ["assay_read_file", { path: f, length: 4096 }],
    ] as const) {
      const r = await rpc("tools/call", { name, arguments: args });
      resultBytes.push(r.bytes);
      calls++;
      const res = r.body.result ?? {};
      const text = ((res.content as { text?: string }[] | undefined) ?? []).map((x) => x.text ?? "").join("");
      if (
        res.structuredContent &&
        text.length > 200 &&
        JSON.stringify(res.structuredContent).includes(text.slice(0, 200))
      )
        duplicated++;
    }
  }
}
const medBytes = median(resultBytes);
add({
  id: "M3",
  measure: "Bytes per tool result (median)",
  baseline: "rea sends each result twice (178,983 B vs 20,829 B summary)",
  target: "median ≤ 8,192 B, one copy",
  value: `median ${medBytes} B, max ${Math.max(...resultBytes)} B over ${calls} calls; duplicated payloads: ${duplicated}`,
  pass: medBytes <= 8192 && duplicated === 0,
  how: "MCP wire capture on the bench fixtures",
});

let correct = 0;
let falseVerified = 0;
let verifiedTotal = 0;
let total = 0;
for (const t of tasks) {
  for (const o of t.oracle) {
    const cl = recordClaim(app.kernel, c.id, "bench", {
      text: `${o.predicate} ${JSON.stringify(o.params)}`,
      label: "seen",
      predicate: o.predicate,
      params: o.params as never,
    });
    const out = await app.verifier.verify(c.id, { ...cl });
    total++;
    if (out.verdict === "verified") verifiedTotal++;
    if (out.verdict === o.expect) correct++;
    if (out.verdict === "verified" && o.expect !== "verified") falseVerified++;
  }
}
add({
  id: "M4",
  measure: "Verifier on oracle claims",
  baseline: "Tier 0 / leanrea: labels only, 0 machine-verified",
  target: "false-verified 0; agreement with oracle ≥ 95%",
  value: `${correct}/${total} agree with the oracle; ${verifiedTotal} verified; false-verified ${falseVerified}`,
  pass: falseVerified === 0 && correct / Math.max(1, total) >= 0.95,
  how: "bench/tasks/*.json oracles through the verifier",
});
await app.close();
ws.cleanup();
home.cleanup();

// ---------- M11: parallel workers (orchestration overhead, synthetic 300 ms tasks) ----------
async function speedup(workers: number): Promise<{ serialMs: number; parallelMs: number }> {
  const t = tmp("assay-bench-par-");
  const { Kernel } = await import("../src/kernel/kernel.ts");
  const k = Kernel.open({ path: join(t.dir, "a.db") });
  const account: AccountRef = { id: "a", provider: "fake", label: "a", home: null };
  const adapter: ProviderAdapter = {
    id: "fake",
    detect: async () => ({
      id: "fake",
      installed: true,
      version: "x",
      program: null,
      enforcement: "enforced",
      notes: [],
    }),
    status: async () => ({ signedIn: true, method: null, detail: {} }),
    loginCommand: () => ({ program: "true", args: [], env: {} }),
    start: async (): Promise<AgentSession> => ({
      providerSessionId: null,
      send: async () => {
        await new Promise((r) => setTimeout(r, 300));
        return { text: "done", stopReason: "end_turn" };
      },
      interrupt: async () => undefined,
      close: async () => undefined,
    }),
  };
  const orch = new Orchestrator({
    kernel: k,
    providers: new Map<ProviderId, ProviderAdapter>([["fake", adapter]]),
    account: () => account,
    mcp: { url: "", issue: () => "t", revoke: () => undefined, stdioProxy: () => ({ program: "", args: [] }) },
    approve: async () => undefined,
    home: t.dir,
    emit: () => undefined,
  });
  const cs = k.createCase({ title: "par" });
  k.updateCase(cs.id, { meta: { settings: { provider: "fake", accountId: "a" } } });
  const s0 = Date.now();
  for (let i = 0; i < workers; i++) await new Promise((r) => setTimeout(r, 300));
  const serialMs = Date.now() - s0;
  const p0 = Date.now();
  for (let i = 0; i < workers; i++) await orch.spawnWorker(cs.id, { task: `task ${i}` });
  while (orch.workers(cs.id).some((w) => w.status === "working" || w.status === "starting"))
    await new Promise((r) => setTimeout(r, 10));
  const parallelMs = Date.now() - p0;
  await orch.shutdown();
  k.close();
  t.cleanup();
  return { serialMs, parallelMs };
}
const sp = await speedup(4);
add({
  id: "M11",
  measure: "Speed-up from 4 parallel workers",
  baseline: "serial",
  target: "≥ 2.5×",
  value: `${(sp.serialMs / sp.parallelMs).toFixed(2)}× (serial ${sp.serialMs} ms, parallel ${sp.parallelMs} ms; synthetic 300 ms turns)`,
  pass: sp.serialMs / sp.parallelMs >= 2.5,
  how: "orchestrator with a 300 ms stub provider",
});

// ---------- M13 from the browser e2e, M12 from live runs ----------
const e2e = join(ROOT, "test-results", "e2e", "metrics.json");
if (existsSync(e2e)) {
  const m = JSON.parse(readFileSync(e2e, "utf8")) as { serve_to_first_verified_claim_ms?: number };
  const ms = m.serve_to_first_verified_claim_ms ?? Number.NaN;
  add({
    id: "M13",
    measure: "Server start to first verified claim (browser)",
    baseline: "—",
    target: "≤ 60,000 ms after `npm ci && npm run build:ui && assay serve`",
    value: `${ms} ms`,
    pass: ms <= 60_000,
    how: "test/e2e/run.ts",
  });
}
const live = join(OUT, "live.json");
if (existsSync(live)) {
  const l = JSON.parse(readFileSync(live, "utf8")) as { summary?: string; pass?: boolean };
  add({
    id: "M12",
    measure: "Cost per correct-and-verified answer vs Tier 0 (live)",
    baseline: "Tier 0: model + Bash + leanrea skill",
    target: "whole 95% interval ≤ 1.0× and accuracy ≥ Tier 0",
    value: l.summary ?? "see live.json",
    pass: l.pass === true,
    how: "bench/live.ts",
  });
}

const stamp = new Date().toISOString();
writeFileSync(
  join(OUT, "latest.json"),
  `${JSON.stringify({ at: stamp, node: process.version, platform: process.platform, rows }, null, 2)}\n`,
);
writeFileSync(
  join(OUT, "latest.md"),
  [
    `# Assay benchmark (${stamp}, ${process.platform}, Node ${process.version})`,
    "",
    "| | Measure | Baseline | Target | Result | | How |",
    "|---|---|---|---|---|---|---|",
    ...rows.map(
      (r) =>
        `| ${r.id} | ${r.measure} | ${r.baseline} | ${r.target} | ${r.value} | ${r.pass ? "pass" : "**miss**"} | ${r.how} |`,
    ),
    "",
  ].join("\n"),
);
const missed = rows.filter((r) => !r.pass);
console.log(`\n${rows.length - missed.length}/${rows.length} targets met`);
// M12 comes from live model runs (bench/live.ts) that CI cannot repeat: it is reported, not gated
if (gate && missed.some((r) => r.id !== "M12")) process.exit(1);
