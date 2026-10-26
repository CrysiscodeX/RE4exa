import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { computeReach, PLATFORMS, serializeReach } from "@re4exa/core/probes/reach";
import { fixtureSet } from "@re4exa/core/testing/gen";
import { REACH_PATH } from "../scripts/reach.ts";

test("docs/reach.json is generated from the fixture sweeps and is not stale", async () => {
  const table = await computeReach(fixtureSet());
  assert.ok(
    existsSync(REACH_PATH),
    "docs/reach.json is missing: run node --conditions=source scripts/reach.ts --write",
  );
  const onDisk = readFileSync(REACH_PATH, "utf8");
  assert.equal(
    onDisk,
    serializeReach(table),
    "docs/reach.json is stale: run `node --conditions=source scripts/reach.ts --write`",
  );
});

test("reach table: every fixture format has a row for each platform with a reason", async () => {
  const table = await computeReach(fixtureSet());
  const formats = new Set(table.rows.map((r) => r.format));
  for (const fx of fixtureSet()) assert.ok(formats.has(fx.format), fx.format);
  for (const r of table.rows)
    for (const p of PLATFORMS) {
      assert.ok(["covered", "partial", "not-covered"].includes(r.platforms[p].status));
      assert.ok(r.platforms[p].reason.length > 0);
    }
  const by = (f: string) => table.rows.find((r) => r.format === f)!;
  assert.equal(by("elf").platforms.linux.status, "covered");
  assert.equal(by("sqlite").platforms.linux.status, "partial");
  assert.equal(by("router:website").platforms.linux.status, "not-covered");
  assert.match(by("plist").platforms.darwin.reason, /plutil/);
  assert.doesNotMatch(by("plist").platforms.linux.reason, /plutil/);
});
