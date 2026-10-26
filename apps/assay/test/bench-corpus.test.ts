// Assay's committed benchmark corpus (bench/tasks/) must equal what @re4exa/core builds.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { buildTasks, writeFixtures } from "@re4exa/core/testing/bench-tasks";
import { tmp } from "./helpers.ts";

test("bench fixtures and task files are deterministic and match the committed copies", () => {
  const a = tmp("assay-fx-a-");
  const b = tmp("assay-fx-b-");
  try {
    const fa = writeFixtures(a.dir);
    const fb = writeFixtures(b.dir);
    assert.deepEqual(fa, fb);
    const committed = new URL("../bench/tasks/fixtures/", import.meta.url);
    for (const rel of fa) {
      const x = readFileSync(join(a.dir, rel));
      assert.ok(x.equals(readFileSync(join(b.dir, rel))), rel);
      assert.ok(
        x.equals(readFileSync(new URL(rel, committed))),
        `bench/tasks/fixtures/${rel} is stale: run node --conditions=source bench/tasks/make-fixtures.ts`,
      );
    }
    for (const task of buildTasks().tasks) {
      const onDisk = JSON.parse(readFileSync(new URL(`../bench/tasks/${task.id}.json`, import.meta.url), "utf8"));
      assert.deepEqual(onDisk, JSON.parse(JSON.stringify(task)), `bench/tasks/${task.id}.json is stale`);
    }
    assert.equal(buildTasks().tasks.length, 8);
    for (const id of ["electron", "native", "go", "deep"]) {
      const l = JSON.parse(readFileSync(new URL(`../bench/tasks/leanrea-${id}.json`, import.meta.url), "utf8"));
      assert.equal(l.licence, "MIT");
      assert.match(l.credit, /aicodeking\/leanrea/);
      assert.ok(Object.keys(l.key).length > 0);
    }
  } finally {
    a.cleanup();
    b.cleanup();
  }
});
