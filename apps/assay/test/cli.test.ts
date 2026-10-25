import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { test } from "node:test";
import { tmp } from "./helpers.ts";

const CLI = join(import.meta.dirname, "..", "src", "cli.ts");
const run = (args: string[], home: string) =>
  spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", CLI, ...args, "--home", home], {
    encoding: "utf8",
    timeout: 60_000,
  });

test("CLI: version, help, unknown options rejected, sweep, probe list, forget", () => {
  const h = tmp("assay-cli-");
  assert.equal(
    spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", CLI, "version"], {
      encoding: "utf8",
    }).stdout.trim(),
    "0.1.0",
  );
  const bad = run(["sweep", ".", "--nope"], h.dir);
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /unknown option --nope/);
  const missing = run(["export", "case_x", "--format"], h.dir);
  assert.equal(missing.status, 2);
  const sweep = run(
    ["sweep", join(import.meta.dirname, "..", "src", "kernel"), "--workspace", join(import.meta.dirname, "..")],
    h.dir,
  );
  assert.equal(sweep.status, 0, sweep.stderr);
  assert.match(sweep.stdout, /evidence records/);
  // Output over a pipe is complete: process.exit used to drop all but the first 64 KiB.
  const big = run(
    ["sweep", join(import.meta.dirname, "..", "src"), "--json", "--workspace", join(import.meta.dirname, "..")],
    h.dir,
  );
  assert.equal(big.status, 0, big.stderr);
  assert.ok(big.stdout.length > 65_536, `sweep JSON is ${big.stdout.length} bytes`);
  JSON.parse(big.stdout);
  assert.match(run(["key"], h.dir).stdout, /BEGIN PUBLIC KEY/);
  const list = run(["probe", "--list"], h.dir);
  assert.match(list.stdout, /file\.identify/);
  assert.equal(run(["forget", "--all"], h.dir).status, 0);
  const unknown = run(["frobnicate"], h.dir);
  assert.equal(unknown.status, 2);
  h.cleanup();
});
