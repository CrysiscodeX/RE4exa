// inventory.pe against llvm-readobj 18: the header mitigations on the zig corpus and extra fixtures
// (bench/oracle/pesec.json) and the load configuration of the real MSVC-built DLLs LearnHarness
// ships (bench/corpus/pesec.facts.json; needs the npm registry, so REAX_CORPUS=1).
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { test } from "node:test";
import { isCoreError } from "@re4exa/core/errors";
import { corpusDir, fetchCorpus, loadManifest, localPath, PESEC_FACTS } from "../scripts/corpus.ts";
import { EXTRA } from "../scripts/extra-fixtures.ts";
import type { PeSecKey } from "../scripts/oracle-formats.ts";
import { buildSynth, SYNTH } from "../scripts/pe-synth.ts";
import { runOperation } from "../src/ops/registry.ts";

const REAX = join(import.meta.dirname, "..");
const BIN = join(REAX, "fixtures", "bin");
// biome-ignore lint/suspicious/noExplicitAny: operation data is JSON
type Any = any;
const KEY = JSON.parse(readFileSync(join(REAX, "bench", "oracle", "pesec.json"), "utf8")).files as Record<
  string,
  PeSecKey
>;
const FACTS = JSON.parse(readFileSync(PESEC_FACTS, "utf8")).facts as Record<string, PeSecKey>;
const skip = process.env.REAX_CORPUS === "1" ? false : "needs the npm registry: set REAX_CORPUS=1 (every CI lane does)";
const refused = (e: unknown) => isCoreError(e) && e.code === "bad_request";
const sorted = (a: string[]) => [...a].sort();

/** reax's reading of one file, compared with LLVM's: the same mitigation bits, the same load config. */
function same(d: Any, k: PeSecKey & { pefile?: Record<string, string> }, label: string) {
  assert.deepStrictEqual(sorted(d.mitigations.dllCharacteristics), sorted(k.dllCharacteristics), label);
  if (!k.loadConfig) return assert.equal(d.loadConfig, null, label);
  const lc = d.loadConfig;
  assert.equal(lc.size, k.loadConfig.size, label);
  assert.equal(lc.guardFlagsRaw, k.loadConfig.guardFlagsRaw, label);
  assert.deepStrictEqual(sorted(lc.guardFlags), sorted(k.loadConfig.guardFlags), label);
  assert.equal(lc.seHandlerCount, k.loadConfig.seHandlerCount, label);
  assert.equal(lc.guardCFFunctionCount, k.loadConfig.guardCFFunctionCount, label);
  // every field LLVM prints; LLVM 18 prints none past the layouts it knows, and neither does reax
  const typed: Record<string, string> = {
    TimeDateStamp: `0x${lc.timeDateStamp.toString(16).toUpperCase()}`,
    MajorVersion: `0x${Number(lc.version.split(".")[0]).toString(16).toUpperCase()}`,
    MinorVersion: `0x${Number(lc.version.split(".")[1]).toString(16).toUpperCase()}`,
    GlobalFlagsClear: `0x${lc.globalFlagsClear.toString(16).toUpperCase()}`,
    GlobalFlagsSet: `0x${lc.globalFlagsSet.toString(16).toUpperCase()}`,
  };
  // pefile (and the Windows SDK's header) put ProcessHeapFlags before ProcessAffinityMask in the
  // 32-bit layout; LLVM 18 has them the other way round. Where pefile has a key, reax follows it.
  for (const [name, v] of Object.entries(k.loadConfig.fields))
    if (!k.pefile?.[name]) assert.equal(typed[name] ?? lc.fields[name], v, `${label} ${name}`);
  for (const [name, v] of Object.entries(k.pefile ?? {})) assert.equal(lc.fields[name], v, `${label} ${name} (pefile)`);
}

test("[+rea.tool/inspect_pe_load_config] header mitigations equal llvm-readobj's on every zig and extra PE; images without a load configuration say so", async () => {
  let n = 0;
  for (const [key, k] of Object.entries(KEY)) {
    if (key.startsWith("synthetic/")) continue;
    const extra = key.startsWith("extra/");
    const r = await runOperation(
      "inventory.pe",
      { path: extra ? key.slice(6) : key },
      { workspace: extra ? EXTRA : BIN },
    );
    same(r.data, k, key);
    assert.equal(r.coverage, "complete", key);
    n++;
  }
  assert.ok(n >= 4, `${n} PE files compared`);
});

test("[+rea.tool/inspect_pe_load_config] every field of a PE32 and a PE32+ load configuration, with a different value in each, equals llvm-readobj's", async () => {
  const dir = mkdtempSync(join(tmpdir(), "reax-synth-"));
  try {
    for (const c of SYNTH) {
      writeFileSync(join(dir, `${c.name}.exe`), buildSynth(c));
      const r = await runOperation("inventory.pe", { path: `${c.name}.exe` }, { workspace: dir });
      const k = KEY[`synthetic/${c.name}`]!;
      same(r.data, k, c.name);
      assert.ok(Object.keys(k.loadConfig!.fields).length >= (c.size >= 0xac ? 29 : 20), `${c.name}: fields compared`);
      assert.equal((r.data as Any).loadConfig.guardCFFunctionStride, c.guardFlags >>> 28);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("[+rea.tool/inspect_pe_load_config] the load configuration of the real MSVC-built DLLs equals llvm-readobj's", {
  skip,
}, async () => {
  const dir = corpusDir();
  const files = fetchCorpus(dir);
  let withConfig = 0;
  for (const f of files) {
    const k = FACTS[f.key];
    if (!k) continue;
    const ws = mkdtempSync(join(tmpdir(), "reax-pe-ws-"));
    try {
      cpSync(localPath(dir, f), join(ws, basename(f.path)));
      const r = await runOperation("inventory.pe", { path: basename(f.path) }, { workspace: ws });
      same(r.data, k, f.key);
      if (k.loadConfig) withConfig++;
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  }
  assert.ok(withConfig >= 3, `${withConfig} real load configurations compared`);
  assert.ok(loadManifest().packages.length > 0);
});

test("[-rea.tool/inspect_pe_load_config] a non-PE file is refused; a directory that points outside the file, or a structure cut short, is reported not invented", async () => {
  await assert.rejects(runOperation("inventory.pe", { path: "hello-aarch64-macos-s" }, { workspace: BIN }), refused);
  const dir = mkdtempSync(join(tmpdir(), "reax-pe-"));
  try {
    const orig = readFileSync(join(BIN, "hello-x86_64-windows-gnu-s.exe"));
    const pe = orig.readUInt32LE(0x3c);
    const dirEntry = pe + 24 + 112 + 80; // data directory 10: the load configuration
    // 1. an RVA that maps to no file bytes
    const a = Buffer.from(orig);
    a.writeUInt32LE(0x7fff0000, dirEntry);
    a.writeUInt32LE(0x40, dirEntry + 4);
    writeFileSync(join(dir, "outside.exe"), a);
    const r1 = await runOperation("inventory.pe", { path: "outside.exe" }, { workspace: dir });
    assert.equal((r1.data as Any).loadConfig, null);
    assert.equal(r1.coverage, "partial");
    assert.match(r1.limitations.join(" "), /maps to no bytes/);
    // 2. a structure whose own Size stops before the guard fields: nothing past Size is read
    const b = Buffer.from(orig);
    const text = orig.indexOf(Buffer.from(".rdata\0\0"));
    assert.ok(text > 0);
    const rdataRva = b.readUInt32LE(text + 12);
    const rdataOff = b.readUInt32LE(text + 20);
    b.writeUInt32LE(rdataRva, dirEntry);
    b.writeUInt32LE(0x40, dirEntry + 4);
    b.fill(0xff, rdataOff, rdataOff + 0x100);
    b.writeUInt32LE(0x40, rdataOff);
    writeFileSync(join(dir, "short.exe"), b);
    const r2 = await runOperation("inventory.pe", { path: "short.exe" }, { workspace: dir });
    const lc = (r2.data as Any).loadConfig;
    assert.equal(lc.size, 0x40);
    assert.equal(lc.fields.SecurityCookie, undefined, "a field past Size is not read");
    assert.equal(lc.fields.DeCommitFreeBlockThreshold, "0xFFFFFFFFFFFFFFFF");
    assert.deepStrictEqual(lc.guardFlags, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
