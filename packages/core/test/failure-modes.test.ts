import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { CORE_FAILURE_MODES, CoreError, defineFailureModes, failureModes, isCoreError } from "../src/errors.ts";

test("every core failure mode is exercised by at least one core test", () => {
  const dir = import.meta.dirname;
  const text = readdirSync(dir)
    .filter((f) => f.endsWith(".test.ts") && f !== "failure-modes.test.ts")
    .map((f) => readFileSync(join(dir, f), "utf8"))
    .join("\n");
  const missing = Object.keys(CORE_FAILURE_MODES).filter((code) => !text.includes(`"${code}"`));
  assert.deepEqual(missing, [], `core failure modes without a test: ${missing.join(", ")}`);
});

test("every core failure mode has a message and a fix", () => {
  for (const [code, m] of Object.entries(CORE_FAILURE_MODES)) {
    assert.ok(m.message.length > 10, code);
    assert.ok(m.fix.length > 5, code);
  }
});

test("apps extend the table; a reworded core code keeps its retryable flag", () => {
  defineFailureModes({ test_only_code: { retryable: true, message: "A code defined by a test", fix: "None" } });
  assert.equal(failureModes().test_only_code?.retryable, true);
  const e = new CoreError("test_only_code" as never);
  assert.ok(isCoreError(e));
  assert.equal(e.toJSON().fix, "None");
  assert.throws(
    () => defineFailureModes({ not_found: { retryable: true, message: "changed", fix: "changed" } }),
    /may reword it but not change retryable/,
  );
  assert.throws(() => new CoreError("never_registered" as never), /unregistered failure code/);
});
