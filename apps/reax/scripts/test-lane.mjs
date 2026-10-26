#!/usr/bin/env node
// Run the test suite and write its JUnit report as reports/<lane>.xml, where the lane is this
// platform (linux, darwin, win32) plus REAX_LANE_SUFFIX when set (e.g. "engines" -> linux-engines).
// scripts/parity-check.ts reads one such file per CI lane.
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const suffix = process.env.REAX_LANE_SUFFIX;
const lane = suffix ? `${process.platform}-${suffix}` : process.platform;
const reports = join(import.meta.dirname, "..", "reports");
mkdirSync(reports, { recursive: true });
const opts = (process.env.NODE_OPTIONS ?? "").split(/\s+/).filter(Boolean);
if (!opts.includes("--conditions=source")) opts.push("--conditions=source");
const r = spawnSync(
  process.execPath,
  [
    "--test",
    "--test-concurrency=1",
    "--disable-warning=ExperimentalWarning",
    "--test-reporter=spec",
    "--test-reporter-destination=stdout",
    "--test-reporter=junit",
    `--test-reporter-destination=${join(reports, `${lane}.xml`)}`,
    "test/*.test.ts",
  ],
  { stdio: "inherit", env: { ...process.env, NODE_OPTIONS: opts.join(" ") } },
);
if (r.error) {
  console.error(String(r.error));
  process.exit(1);
}
process.exit(r.status ?? 1);
