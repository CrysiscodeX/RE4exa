// Checks that keep the code base reviewable: a size limit per source file (donor row T3-1) and a
// pinned snapshot of core's public API (donor row PD-9).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DEFAULT_ROOTS, MAX_LINES, oversized } from "../scripts/size-lint.ts";

const CORE = join(import.meta.dirname, "..", "..", "..", "packages", "core");

test("[+T3-1] no source file in core or reax is over the line limit", () => {
  assert.deepEqual(oversized(DEFAULT_ROOTS), []);
  assert.equal(MAX_LINES, 1200);
});

test("[-T3-1] a file over the limit is reported with its line count", () => {
  const d = mkdtempSync(join(tmpdir(), "reax-size-"));
  try {
    writeFileSync(join(d, "big.ts"), "x\n".repeat(50));
    writeFileSync(join(d, "small.ts"), "x\n");
    const bad = oversized([d], 20);
    assert.equal(bad.length, 1);
    assert.match(bad[0]!.file, /big\.ts$/);
    assert.equal(bad[0]!.lines, 51);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

const api = (...args: string[]) =>
  spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", join(CORE, "scripts", "api.ts"), ...args], {
    cwd: CORE,
    encoding: "utf8",
  });

test("[+PD-9] core's public API matches its committed snapshot", () => {
  const r = api("--check");
  assert.equal(r.status, 0, r.stderr + r.stdout);
});

test("[-PD-9] a change to an exported signature is caught and the module is named", () => {
  const d = mkdtempSync(join(tmpdir(), "reax-api-"));
  try {
    const altered = readFileSync(join(CORE, "api-snapshot.txt"), "utf8").replace(
      /export declare class WriteBatcher \{/,
      "export declare class WriteBatcher {\n    removedLater(): void;",
    );
    const snap = join(d, "snap.txt");
    writeFileSync(snap, altered);
    const r = api("--check", "--snapshot", snap);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /changed: kernel\/writer\.d\.ts/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
