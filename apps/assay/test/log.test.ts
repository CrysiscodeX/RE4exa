import assert from "node:assert/strict";
import { test } from "node:test";
import { log, setLogSink } from "../src/log.ts";

test("logs are JSON lines, respect ASSAY_LOG, and redact secrets", () => {
  const lines: string[] = [];
  setLogSink((l) => lines.push(l));
  const prev = process.env.ASSAY_LOG;
  process.env.ASSAY_LOG = "info";
  log("debug", "hidden");
  log("info", "turn.start", { trace: "t1", note: "key ghp_abcdefghijklmnopqrstuvwxyz0123456789" });
  process.env.ASSAY_LOG = "off";
  log("error", "silenced");
  process.env.ASSAY_LOG = prev;
  assert.equal(lines.length, 1);
  const rec = JSON.parse(lines[0]!) as Record<string, string>;
  assert.equal(rec.event, "turn.start");
  assert.equal(rec.trace, "t1");
  assert.doesNotMatch(rec.note!, /ghp_abcdef/);
  setLogSink((l) => process.stderr.write(`${l}\n`));
});
