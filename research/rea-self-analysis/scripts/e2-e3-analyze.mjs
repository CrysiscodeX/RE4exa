#!/usr/bin/env node
// E2 + E3: artifact inventory and JavaScript application analysis of REA's own
// package (two versions), run once in one REA session; the ledger is exported so
// later stages can re-import it instead of repeating the analysis.
// usage: REA_PACKAGE_DIR=... node e2-e3-analyze.mjs <pkg-new> <pkg-old> <outdir>

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openRea } from "./rea-mcp.mjs";

const [pkgNew, pkgOld, outDir] = process.argv.slice(2);
const log = (o) => console.error(JSON.stringify(o));
const rea = await openRea({ log });
const peakRss = () => { try { return Number(/VmHWM:\s+(\d+)/.exec(readFileSync(`/proc/${rea.pid}/status`, "utf8"))[1]) * 1024; } catch { return null; } };
const results = { stages: {} };
const step = async (key, fn) => {
  const started = performance.now();
  try { results.stages[key] = { ok: true, value: await fn() }; }
  catch (e) { results.stages[key] = { ok: false, error: e.message, diagnostic: e.diagnostic ?? null }; }
  results.stages[key].ms = Math.round(performance.now() - started);
  results.stages[key].rea_peak_rss_bytes = peakRss();
  log({ stage: key, ok: results.stages[key].ok, ms: results.stages[key].ms });
};
const brief = (ev) => ev && ({ evidence_id: ev.evidence_id, operation: ev.operation, confidence: ev.confidence, authority: ev.authority, limitations: ev.limitations, normalized_result: ev.normalized_result });

for (const [label, pkg] of [["new", pkgNew], ["old", pkgOld]]) {
  await step(`e2_open_${label}`, async () => (await rea.call("open_binary", { path: pkg })).result ?? null);
  await step(`e2_inventory_${label}`, async () => brief(await rea.call("inspect_artifact", { detail: "summary", integrity_policy: "record-and-continue" })));
  await step(`e3_analyze_${label}`, async () => brief(await rea.call("analyze_javascript_application", {
    input_path: pkg, format: "directory", detail: "summary", max_heap_mb: 6144, analysis_timeout_ms: 1_200_000,
  })));
}
await step("export_bundle", async () => (await rea.call("export_evidence_bundle", { path: join(outDir, "e2-e3-bundle.json"), overwrite: true })).result ?? null);
results.calls = rea.calls;
results.stderr_tail = rea.stderr().slice(-4000);
await rea.close();
writeFileSync(join(outDir, "e2-e3.json"), JSON.stringify(results, null, 1));
console.log(JSON.stringify(results, (k, v) => (typeof v === "string" && v.length > 600 ? v.slice(0, 600) + "…" : v), 1).slice(0, 30000));
