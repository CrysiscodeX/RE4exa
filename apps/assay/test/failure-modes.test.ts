import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { FAILURE_MODES } from "../src/errors.ts";

test("every failure mode is exercised by at least one test", () => {
  const dir = import.meta.dirname;
  const text = readdirSync(dir)
    .filter((f) => f.endsWith(".test.ts") && f !== "failure-modes.test.ts")
    .map((f) => readFileSync(join(dir, f), "utf8"))
    .join("\n");
  const missing = Object.keys(FAILURE_MODES).filter((code) => !text.includes(`"${code}"`));
  assert.deepEqual(missing, [], `failure modes without a test: ${missing.join(", ")}`);
});

test("every failure mode has a message and a fix", () => {
  for (const [code, m] of Object.entries(FAILURE_MODES)) {
    assert.ok(m.message.length > 10, code);
    assert.ok(m.fix.length > 5, code);
  }
});
