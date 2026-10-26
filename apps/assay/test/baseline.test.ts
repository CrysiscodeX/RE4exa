import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

// The live benchmark's Tier 0 arm must get leanrea's skill exactly as published (bench/baseline/README.md).
test("the vendored leanrea skill is byte-identical to upstream 09ba4aa", () => {
  const bytes = readFileSync(join(import.meta.dirname, "..", "bench", "baseline", "leanrea-SKILL.md"));
  assert.equal(bytes.length, 8374);
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    "53581bd7fb1fae4352ab43252e67b84667b68895a68e372b99d302b58d9c782d",
  );
});
