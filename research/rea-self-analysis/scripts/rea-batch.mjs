#!/usr/bin/env node
// Run a batch of REA MCP calls in one fresh REA process, optionally after
// re-importing an exported Evidence bundle (REA's own persistence path).
// Steps may reference earlier results: "$0.normalized_result.parent_evidence_id".
// usage: REA_PACKAGE_DIR=... node rea-batch.mjs <batch.json> <outdir>
//   batch.json: {"import": "/abs/bundle.json"|null, "calls": [{"id": "x", "tool": "...", "args": {...}}]}

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openRea } from "./rea-mcp.mjs";

const [batchPath, outDir] = process.argv.slice(2);
const batch = JSON.parse(readFileSync(batchPath, "utf8"));
mkdirSync(outDir, { recursive: true });
const rea = await openRea({ log: (e) => console.error(JSON.stringify(e)) });
const results = {};
const resolveRefs = (v) => {
  if (typeof v === "string" && v.startsWith("$")) {
    const [id, ...path] = v.slice(1).split(".");
    return path.reduce((o, k) => o?.[k], results[id]);
  }
  if (Array.isArray(v)) return v.map(resolveRefs);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, resolveRefs(x)]));
  return v;
};
const summary = [];
try {
  if (batch.import) {
    const t = performance.now();
    const r = await rea.call("import_evidence_bundle", { path: batch.import });
    summary.push({ id: "import", ms: Math.round(performance.now() - t), result: r?.result ?? r });
  }
  for (const { id, tool, args } of batch.calls) {
    const t = performance.now();
    try {
      results[id] = await rea.call(tool, resolveRefs(args));
      writeFileSync(join(outDir, `${id}.json`), JSON.stringify(results[id], null, 1));
      summary.push({ id, tool, ok: true, ms: Math.round(performance.now() - t), bytes: JSON.stringify(results[id]).length });
    } catch (e) {
      summary.push({ id, tool, ok: false, ms: Math.round(performance.now() - t), error: e.message.slice(0, 400), diagnostic: e.diagnostic ?? null });
    }
  }
} finally {
  summary.push({ wire: rea.calls });
  await rea.close();
}
writeFileSync(join(outDir, "_summary.json"), JSON.stringify(summary, null, 1));
console.log(JSON.stringify(summary.slice(0, -1), null, 1).slice(0, 20000));
