import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { ASSAY_FAILURE_MODES, FAILURE_MODES } from "../src/errors.ts";

// Core codes are exercised by packages/core/test (its own failure-modes test); this checks Assay's.
test("every Assay failure mode is exercised by at least one Assay test", () => {
  const dir = import.meta.dirname;
  const text = readdirSync(dir)
    .filter((f) => f.endsWith(".test.ts") && f !== "failure-modes.test.ts")
    .map((f) => readFileSync(join(dir, f), "utf8"))
    .join("\n");
  const missing = Object.keys(ASSAY_FAILURE_MODES).filter((code) => !text.includes(`"${code}"`));
  assert.deepEqual(missing, [], `failure modes without a test: ${missing.join(", ")}`);
});

test("every failure mode has a message and a fix", () => {
  for (const [code, m] of Object.entries(FAILURE_MODES)) {
    assert.ok(m.message.length > 10, code);
    assert.ok(m.fix.length > 5, code);
  }
});
