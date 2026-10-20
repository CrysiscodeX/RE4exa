#!/usr/bin/env node
// E10b: does one REA session's memory grow with retained Evidence? Retain one
// artifact inventory, then request N single-file views of it (each view is a
// distinct derived record) and sample RSS and the retained-record count.
// usage: REA_PACKAGE_DIR=... node e10-ledger-growth.mjs <package-dir> <package.zip> <count> <out.json>

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openRea } from "./rea-mcp.mjs";

const [pkg, zip, count, out] = process.argv.slice(2);
const files = [];
const walk = (d) => { for (const n of readdirSync(d)) { const p = join(d, n); const s = statSync(p); if (s.isDirectory()) walk(p); else if (s.size > 4096) files.push(p); } };
walk(join(pkg, "dist"));
const rea = await openRea();
await rea.call("open_binary", { path: zip });
const parent = (await rea.call("inspect_artifact", { detail: "summary" })).normalized_result.parent_evidence_id;
const rss = () => Number(/VmRSS:\s+(\d+)/.exec(readFileSync(`/proc/${rea.pid}/status`, "utf8"))[1]) * 1024;
const records = async () => (await rea.call("get_evidence_bundle", { detail: "summary" })).result.total_retained_records;
const samples = [{ calls: 0, rss: rss(), records: await records() }];
let errors = 0;
for (let i = 0; i < Math.min(Number(count), files.length); i++) {
  const logical = "package/" + files[i].slice(pkg.length + 1);
  try { await rea.call("inspect_analysis_view", { source: { kind: "retained-evidence", evidence_id: parent }, view: { kind: "inventory", collection: "occurrences", logical_paths: [logical] } }); }
  catch (e) { if (errors++ === 0) console.error(e.message); }
  if ((i + 1) % 50 === 0) { global.gc?.(); samples.push({ calls: i + 1, rss: rss(), records: await records() }); }
}
const exportPath = join(process.env.TMPDIR ?? "/tmp", "growth-bundle.json");
await rea.call("export_evidence_bundle", { path: exportPath, overwrite: true });
const result = { samples, errors, bundle_bytes: statSync(exportPath).size };
await rea.close();
writeFileSync(out, JSON.stringify(result, null, 1));
console.log(JSON.stringify(result));
