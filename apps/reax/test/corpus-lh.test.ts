// reax on real binaries: the native libraries LearnHarness ships (scripts/corpus.ts), read by reax
// and by core's readers (which Assay's verifier uses), each compared with LLVM 18's reading
// (bench/corpus/learnharness.facts.json). Needs the npm registry, so it runs when REAX_CORPUS=1
// (every CI lane sets it); a skip counts as not run.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { test } from "node:test";
import type { Json } from "@re4exa/core/evidence/jcs";
import { recordClaim } from "@re4exa/core/evidence/store";
import { normalizeArch } from "@re4exa/core/probes/arch";
import { parseElf } from "@re4exa/core/probes/builtin/elf";
import { parseMachO } from "@re4exa/core/probes/builtin/macho";
import { parsePe } from "@re4exa/core/probes/builtin/pe";
import { parseWasm } from "@re4exa/core/probes/builtin/wasm";
import { createProbeEngine } from "@re4exa/core/probes/engine";
import { NATIVE_NAME_CAP } from "@re4exa/core/probes/util";
import { openTemp } from "@re4exa/core/testing/helpers";
import { createVerifier } from "@re4exa/core/verifier/verifier";
import {
  type CorpusFile,
  corpusDir,
  FACTS,
  type Fact,
  fetchCorpus,
  loadManifest,
  localPath,
  unpack,
} from "../scripts/corpus.ts";
import { runOperation } from "../src/ops/registry.ts";

const skip = process.env.REAX_CORPUS === "1" ? false : "needs the npm registry: set REAX_CORPUS=1 (every CI lane does)";
const facts = (JSON.parse(readFileSync(FACTS, "utf8")) as { facts: Record<string, Fact> }).facts;
const sha = (names: string[]) =>
  createHash("sha256")
    .update([...names].sort().join("\n"))
    .digest("hex");

interface Slice {
  arch: string;
  ownName: string | null;
  links: string[];
  exports: { count: number; names: string[]; complete: boolean };
}

/** Export names as core's own readers see them: what the verifier checks claims against. */
function coreExports(b: Uint8Array, format: string): string[] {
  if (format === "elf") return parseElf(b).exports.first;
  if (format === "pe") return parsePe(b).exports.names;
  if (format === "macho") return parseMachO(b).slices.flatMap((s) => s.exports.names);
  return parseWasm(b, NATIVE_NAME_CAP).exports.map((e) => e.name);
}

function setup(files: CorpusFile[], dir: string) {
  const store = openTemp();
  const ws = mkdtempSync(join(tmpdir(), "reax-corpus-ws-"));
  for (const f of files) cpSync(localPath(dir, f), join(ws, basename(f.path)));
  const engine = createProbeEngine({ kernel: store.k, workspace: ws, which: () => null });
  const verifier = createVerifier({ kernel: store.k, engine });
  const verify = (predicate: string, params: Json) =>
    verifier.verify(
      "case_lh",
      recordClaim(store.k, "case_lh", "agent", {
        text: `${predicate} ${JSON.stringify(params)}`,
        label: "seen",
        predicate,
        params,
      }),
    );
  return {
    verify,
    cleanup: () => {
      store.cleanup();
      rmSync(ws, { recursive: true, force: true });
    },
  };
}

test("[+RX-1/corpus-lh] on the native libraries LearnHarness ships, reax and core's readers agree with LLVM, and true claims verify", {
  skip,
  timeout: 600_000,
}, async () => {
  const dir = corpusDir();
  const files = fetchCorpus(dir);
  assert.equal(files.length, Object.keys(facts).length, "every pinned file has LLVM's reading");
  const s = setup(files, dir);
  try {
    for (const f of files) {
      const want = facts[f.key]!;
      assert.ok(want, `${f.key} has no LLVM facts`);
      const path = localPath(dir, f);

      // reax, as an agent sees it
      const r = await runOperation("inventory.native", { path: basename(path) }, { workspace: join(path, "..") });
      const d = r.data as { format: string; slices: Slice[] };
      assert.equal(d.format, want.format, f.key);
      assert.deepEqual(
        d.slices.map((x) => normalizeArch(x.arch)).sort(),
        [...want.arch].sort(),
        `${f.key}: architectures`,
      );
      const slice = d.slices[0]!;
      assert.deepEqual([...slice.links].sort(), want.links, `${f.key}: links`);
      assert.equal(slice.ownName, want.ownName, `${f.key}: own name`);
      assert.equal(slice.exports.count, want.exports.count, `${f.key}: export count`);
      if (slice.exports.complete) assert.equal(sha(slice.exports.names), want.exports.sha256, `${f.key}: export names`);
      else assert.ok(slice.exports.names.length < want.exports.count, `${f.key}: a capped list says so`);

      // core's readers, which Assay's verifier uses, see the whole export table
      assert.equal(
        sha(coreExports(readFileSync(path), want.format)),
        want.exports.sha256,
        `${f.key}: core's export names`,
      );

      // claims about it, checked the way Assay checks them
      for (const arch of want.arch) {
        const v = await s.verify("native.arch", { path: basename(path), arch });
        assert.equal(v.verdict, "verified", `${f.key} ${arch}: ${v.reason}`);
      }
      for (const symbol of want.exports.sample) {
        const v = await s.verify("native.exports", { path: basename(path), symbol });
        assert.equal(v.verdict, "verified", `${f.key} ${symbol}: ${v.reason}`);
      }
      for (const library of want.links.slice(0, 3)) {
        if (want.format === "wasm") break;
        const v = await s.verify("native.links", { path: basename(path), library });
        assert.equal(v.verdict, "verified", `${f.key} links ${library}: ${v.reason}`);
      }
    }
  } finally {
    s.cleanup();
  }
});

test("[-RX-1/corpus-lh] a tarball that is not the pinned one is refused, and false claims about the real libraries are refuted", {
  skip,
  timeout: 600_000,
}, async () => {
  const dir = corpusDir();
  const files = fetchCorpus(dir);
  const pkg = loadManifest().packages[0]!;
  const out = mkdtempSync(join(tmpdir(), "reax-corpus-bad-"));
  try {
    assert.throws(() => unpack(new Uint8Array([0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 0, 3]), pkg, out), /sha512/);
    assert.throws(() => unpack(new Uint8Array(0), { ...pkg, files: ["package/none.node"] }, out), /sha512/);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
  const s = setup(files, dir);
  try {
    for (const f of files) {
      const want = facts[f.key]!;
      const name = basename(f.path);
      const arch = await s.verify("native.arch", { path: name, arch: "riscv64" });
      assert.equal(arch.verdict, "refuted", `${f.key}: ${arch.reason}`);
      const sym = await s.verify("native.exports", { path: name, symbol: "reax_not_exported_anywhere" });
      assert.equal(sym.verdict, "refuted", `${f.key}: ${sym.reason}`);
      if (want.format !== "wasm") {
        const lib = await s.verify("native.links", { path: name, library: "libreax-not-linked.so" });
        assert.equal(lib.verdict, "refuted", `${f.key}: ${lib.reason}`);
      }
    }
  } finally {
    s.cleanup();
  }
});
