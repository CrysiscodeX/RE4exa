#!/usr/bin/env node
// E3 scoring, E4 feature traces, E5 version comparison over retained application graphs.
// Mode "bundle": re-import an exported ledger (REA's own persistence path) and query it.
// Mode "live": run both analyses in this session first (needed when the bundle is
// too large for REA to re-import).
// usage: REA_PACKAGE_DIR=... node e3-e5-query.mjs bundle <bundle.json> <e2-e3.json> <outdir>
//        REA_PACKAGE_DIR=... node e3-e5-query.mjs live <pkg-new> <pkg-old> <outdir>

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { openRea } from "./rea-mcp.mjs";

const [mode, a, b, outDir] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const ref = (id) => ({ kind: "retained-evidence", evidence_id: id });
const rea = await openRea({ log: (e) => console.error(JSON.stringify(e)) });
const rssOf = () => { try { return Number(/VmHWM:\s+(\d+)/.exec(readFileSync(`/proc/${rea.pid}/status`, "utf8"))[1]) * 1024; } catch { return null; } };
const out = { timings: {} };
const timed = async (key, fn) => {
  const t = performance.now();
  try { const v = await fn(); out.timings[key] = { ok: true, ms: Math.round(performance.now() - t) }; return v; }
  catch (e) { out.timings[key] = { ok: false, ms: Math.round(performance.now() - t), error: e.message.slice(0, 500), diagnostic: e.diagnostic ?? null }; return null; }
};
const save = (name, v) => writeFileSync(join(outDir, `${name}.json`), JSON.stringify(v, null, 1));

let parentNew, parentOld;
if (mode === "bundle") {
  await timed("import_bundle", () => rea.call("import_evidence_bundle", { path: a }));
  const stages = JSON.parse(readFileSync(b, "utf8")).stages;
  parentNew = stages.e3_analyze_new.value.normalized_result.parent_evidence_id;
  parentOld = stages.e3_analyze_old.value.normalized_result.parent_evidence_id;
} else {
  const analyze = (input_path) => rea.call("analyze_javascript_application", { input_path, format: "directory", detail: "summary", max_heap_mb: 6144, analysis_timeout_ms: 1_200_000 });
  parentNew = (await timed("analyze_new", () => analyze(a)))?.normalized_result.parent_evidence_id;
  parentOld = (await timed("analyze_old", () => analyze(b)))?.normalized_result.parent_evidence_id;
}
out.parents = { parentNew, parentOld };
out.rea_peak_rss_after_setup = rssOf();

// E3: every module row of the 6.7.0 graph.
const modules = [];
for (let offset = 0; ; ) {
  const page = await timed(`modules_${offset}`, () => rea.call("inspect_analysis_view", { source: ref(parentNew), view: { kind: "page", collection: "modules", offset, limit: 256 } }));
  if (!page) break;
  const n = page.normalized_result;
  const rows = n.items ?? n.page?.items ?? n.modules ?? [];
  modules.push(...rows);
  const next = n.coverage?.next_offset ?? n.page?.next_offset ?? null;
  if (next === null || rows.length === 0) break;
  offset = next;
}
save("modules-670", modules);

// Typed references of the modules that carry the predicted gaps.
const probes = ["scripts/rea.mjs", "dist/javascript/analysis/JavaScriptAnalysisWorker.js", "dist/windows/WindowsNativeLoader.js", "dist/hopper/HopperProvider.js", "dist/evm/EvmoleInterfaceWorker.js", "dist/android/JadxProvider.js"];
for (const path of probes) {
  const r = await timed(`refs:${path}`, () => rea.call("inspect_analysis_view", { source: ref(parentNew), view: { kind: "javascript", collection: "modules", projection: "references", where: { path }, offset: 0, limit: 256 } }));
  if (r) save(`refs-${path.replaceAll("/", "__")}`, r.normalized_result);
}
const pkgFacts = await timed("facts:package.json", () => rea.call("inspect_analysis_view", { source: ref(parentNew), view: { kind: "javascript-facts", where: { paths: ["package.json"] }, property_keys: [], include_available_property_keys: true } }));
if (pkgFacts) save("facts-package-json", pkgFacts.normalized_result);

// E4: feature traces from the seeds the answer key says are reachable.
const seeds = {
  worker_incoming: { seed: { kind: "module", value: "dist/composition/javascriptAnalysisWorkerProcess.js", match: "exact" }, direction: "incoming" },
  bin_outgoing: { seed: { kind: "module", value: "scripts/rea.mjs", match: "exact" }, direction: "outgoing" },
  hopper_bridge_string: { seed: { kind: "string", value: "hopper_bridge.py", match: "contains" }, direction: "both" },
  windows_addon_string: { seed: { kind: "string", value: "rea-windows-x64.node", match: "contains" }, direction: "both" },
};
for (const [name, s] of Object.entries(seeds)) {
  const r = await timed(`trace:${name}`, () => rea.call("trace_application_feature", { application: ref(parentNew), ...s }));
  if (r) save(`trace-${name}`, { evidence_id: r.evidence_id, bytes: JSON.stringify(r).length, normalized_result: r.normalized_result });
}

// E5: version comparison 6.5.0 -> 6.7.0 on the retained graphs.
const cmp = await timed("compare_application_versions", () => rea.call("compare_application_versions", { left: ref(parentOld), right: ref(parentNew) }));
if (cmp) save("compare-versions", { evidence_id: cmp.evidence_id, confidence: cmp.confidence, limitations: cmp.limitations, normalized_result: cmp.normalized_result });

out.rea_peak_rss_final = rssOf();
out.wire = rea.calls;
await rea.close();
save("_query-summary", out);
console.log(JSON.stringify(out.timings, null, 1));
