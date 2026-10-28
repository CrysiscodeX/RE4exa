// reax inside Assay: reax's operations run as core probes (stored, citable, marked as
// target-derived evidence), and the core verifier's native.arch and native.exports predicates
// check claims about every fixture against LLVM's reading of it (bench/oracle-facts.json), using
// core's own readers rather than reax's.
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { isCoreError } from "@re4exa/core/errors";
import type { Json } from "@re4exa/core/evidence/jcs";
import { recordClaim } from "@re4exa/core/evidence/store";
import { normalizeArch } from "@re4exa/core/probes/arch";
import { createProbeEngine } from "@re4exa/core/probes/engine";
import { openTemp } from "@re4exa/core/testing/helpers";
import { createVerifier } from "@re4exa/core/verifier/verifier";
import { REAX_VERSION, reaxProbes } from "../src/ops/probes.ts";

const REAX = join(import.meta.dirname, "..");
const facts = JSON.parse(readFileSync(join(REAX, "bench", "oracle-facts.json"), "utf8")).facts as Record<
  string,
  { format: string; arch: string[]; exports: string[] }
>;

function setup() {
  const store = openTemp();
  const ws = mkdtempSync(join(tmpdir(), "reax-assay-"));
  cpSync(join(REAX, "fixtures", "bin"), ws, { recursive: true });
  const engine = createProbeEngine({ kernel: store.k, workspace: ws, which: () => null, probes: reaxProbes() });
  const verifier = createVerifier({ kernel: store.k, engine });
  const verify = (predicate: string, params: Json) =>
    verifier.verify(
      "case_r",
      recordClaim(store.k, "case_r", "agent-a", {
        text: `${predicate} ${JSON.stringify(params)}`,
        label: "seen",
        predicate,
        params,
      }),
    );
  return {
    ws,
    engine,
    verify,
    cleanup: () => {
      store.cleanup();
      rmSync(ws, { recursive: true, force: true });
    },
  };
}

test("[+RX-1/assay-probes] reax's operations run as Assay probes: stored, keyed, cited and marked as target-derived", async () => {
  const s = setup();
  try {
    const ids = s.engine.list().map((p) => p.id);
    assert.ok(ids.includes("reax.identify.file") && ids.includes("reax.inventory.native"), ids.join(","));
    assert.equal(reaxProbes()[0]!.version, REAX_VERSION);
    const pkg = JSON.parse(readFileSync(join(REAX, "package.json"), "utf8")) as { version: string };
    assert.equal(REAX_VERSION, pkg.version, "the probe version is reax's version");
    const rec = await s.engine.run({
      caseId: "case_r",
      probeId: "reax.inventory.native",
      path: "hello-universal-macos-s",
    });
    assert.equal(rec.predicate, "reax.inventory.native");
    assert.equal(rec.taint, "target", "text read from the target reaches a model only inside the envelope");
    assert.equal(rec.confidence, "observed", "reax reads the file's own bytes");
    const slices = (rec.result as { slices: { arch: string }[] }).slices.map((x) => x.arch).sort();
    assert.deepEqual(slices, ["aarch64", "x86_64"]);
    assert.equal(rec.coverage?.status, "complete");
    const again = await s.engine.run({
      caseId: "case_r",
      probeId: "reax.inventory.native",
      path: "hello-universal-macos-s",
    });
    assert.equal(again.observation_id, rec.observation_id, "the same inputs reuse the stored evidence");
    const id = await s.engine.run({
      caseId: "case_r",
      probeId: "reax.identify.file",
      path: "lib-x86_64-windows-gnu-s.dll",
    });
    assert.equal((id.result as { format: string }).format, "pe");
  } finally {
    s.cleanup();
  }
});

test("[-RX-1/assay-probes] a reax probe refuses a path outside the case workspace and a file it does not apply to", async () => {
  const s = setup();
  try {
    await assert.rejects(
      s.engine.run({ caseId: "case_r", probeId: "reax.inventory.native", path: "../../etc/passwd" }),
      (e) => isCoreError(e, "path_outside_workspace"),
    );
    writeFileSync(join(s.ws, "notes.txt"), "plain text\n");
    await assert.rejects(s.engine.run({ caseId: "case_r", probeId: "reax.inventory.native", path: "notes.txt" }), (e) =>
      isCoreError(e),
    );
    const inv = reaxProbes().find((p) => p.id === "reax.inventory.native")!;
    assert.equal(inv.appliesTo({ format: "text", kind: "file" }), false);
    assert.equal(inv.appliesTo({ format: "elf", kind: "file" }), true);
  } finally {
    s.cleanup();
  }
});

test("[+RX-1/verify-native] every fixture's architectures and exports, as LLVM reads them, verify; a wrong architecture is refuted", async () => {
  const s = setup();
  try {
    for (const [file, f] of Object.entries(facts)) {
      for (const a of f.arch) {
        const v = await s.verify("native.arch", { path: file, arch: a });
        assert.equal(v.verdict, "verified", `${file} ${a}: ${v.reason}`);
      }
      const wrong = await s.verify("native.arch", { path: file, arch: "riscv64" });
      assert.equal(wrong.verdict, "refuted", `${file}: ${wrong.reason}`);
      for (const sym of f.exports) {
        const v = await s.verify("native.exports", { path: file, symbol: sym });
        assert.equal(v.verdict, "verified", `${file} ${sym}: ${v.reason}`);
      }
    }
    assert.equal(normalizeArch("AMD64"), "x86_64");
    const alias = await s.verify("native.arch", { path: "hello-aarch64-macos-s", arch: "arm64" });
    assert.equal(alias.verdict, "verified", "arm64 and aarch64 are one architecture");
  } finally {
    s.cleanup();
  }
});

test("[-RX-1/verify-native] a hidden symbol is refuted only when the export list is complete; a cut file is never refuted", async () => {
  const s = setup();
  try {
    for (const lib of ["lib-x86_64-linux-gnu.2.28-s.so", "lib-x86_64-windows-gnu-s.dll", "lib-aarch64-macos-s.dylib"]) {
      const v = await s.verify("native.exports", { path: lib, symbol: "reax_hidden" });
      assert.equal(v.verdict, "refuted", `${lib}: ${v.reason}`);
    }
    const fat = readFileSync(join(s.ws, "hello-universal-macos-s"));
    writeFileSync(join(s.ws, "cut-universal"), fat.subarray(0, 20_000));
    const cut = await s.verify("native.exports", { path: "cut-universal", symbol: "reax_nothing" });
    assert.equal(cut.verdict, "unverifiable", cut.reason);
    writeFileSync(join(s.ws, "readme.txt"), "not a binary\n");
    const text = await s.verify("native.arch", { path: "readme.txt", arch: "x86_64" });
    assert.equal(text.verdict, "unverifiable", text.reason);
    assert.match(text.reason, /not a supported native binary/);
  } finally {
    s.cleanup();
  }
});
