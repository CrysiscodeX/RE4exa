// Seeded mutation fuzzing: 2,000 mutations of each parser's fixture. Every outcome must be a
// result or AssayError("probe_failed"), never another exception, and never take over 200 ms.

import assert from "node:assert/strict";
import { test } from "node:test";
import type { ProbeDef } from "../src/contracts.ts";
import { isAssayError } from "../src/errors.ts";
import { canonicalize } from "../src/evidence/jcs.ts";
import { archiveList, parseTar } from "../src/probes/builtin/archive.ts";
import { elfInfo } from "../src/probes/builtin/elf.ts";
import { fileIdentify } from "../src/probes/builtin/identify.ts";
import { codeObfuscation, jsEndpoints, jsImports } from "../src/probes/builtin/js.ts";
import { tokenize } from "../src/probes/builtin/js-tokens.ts";
import { machoInfo } from "../src/probes/builtin/macho.ts";
import { peInfo } from "../src/probes/builtin/pe.ts";
import { pkgManifest, pkgNativeAddons } from "../src/probes/builtin/pkg.ts";
import { wasmInfo } from "../src/probes/builtin/wasm.ts";
import { json } from "../src/probes/util.ts";
import { APP_JS, makeElf64, makeTar, makeZip } from "./fixtures/probes/gen.ts";
import { bytesOf, runOn } from "./fixtures/probes/harness.ts";
import { lcg } from "./helpers.ts";

const N = 2000;
const LIMIT_MS = 200;
const INTERESTING = [0, 1, 0x7f, 0x80, 0xff, 0xffff, 0x7fffffff, 0x80000000, 0xffffffff];

export function mutate(src: Uint8Array, rnd: () => number): Uint8Array {
  const pick = (n: number) => Math.floor(rnd() * n);
  let b = Uint8Array.from(src);
  const ops = 1 + pick(4);
  for (let k = 0; k < ops; k++) {
    switch (pick(7)) {
      case 0:
        if (b.length) b[pick(b.length)] = pick(256);
        break;
      case 1:
        if (b.length) b[pick(b.length)]! ^= 1 << pick(8);
        break;
      case 2:
        b = b.subarray(0, pick(b.length + 1));
        break;
      case 3: {
        const extra = Uint8Array.from({ length: 1 + pick(64) }, () => pick(256));
        const at = pick(b.length + 1);
        b = Uint8Array.from([...b.subarray(0, at), ...extra, ...b.subarray(at)]);
        break;
      }
      case 4:
        if (b.length >= 4) {
          const at = pick(b.length - 3) & ~3;
          new DataView(b.buffer, b.byteOffset).setUint32(at, INTERESTING[pick(INTERESTING.length)]! >>> 0, rnd() < 0.5);
        }
        break;
      case 5:
        if (b.length >= 8) {
          const from = pick(b.length - 4);
          const len = 1 + pick(Math.min(64, b.length - from));
          const to = pick(b.length - len + 1);
          b.copyWithin(to, from, from + len);
        }
        break;
      default:
        if (b.length >= 2) b[pick(b.length)] = 0;
    }
  }
  return b;
}

async function fuzz(name: string, probe: ProbeDef, seed: Uint8Array, file: string, seedNo: number) {
  const rnd = lcg(seedNo);
  let ok = 0;
  let failed = 0;
  let worst = 0;
  for (let i = 0; i < N; i++) {
    const input = mutate(seed, rnd);
    const t0 = performance.now();
    try {
      const out = await runOn(probe, input, file);
      assert.ok(out && "result" in out, `${name} #${i}: no result`);
      canonicalize(json(out.result));
      ok++;
    } catch (e) {
      if (!isAssayError(e, "probe_failed")) {
        const hex = Buffer.from(input).toString("base64");
        assert.fail(`${name} #${i} threw ${(e as Error)?.stack ?? e}\ninput (base64): ${hex.slice(0, 2000)}`);
      }
      failed++;
    }
    const ms = performance.now() - t0;
    worst = Math.max(worst, ms);
    assert.ok(ms < LIMIT_MS, `${name} #${i} took ${ms.toFixed(1)} ms`);
  }
  return { ok, failed, worst };
}

const enc = new TextEncoder();
const CASES: [string, ProbeDef, () => Uint8Array, string][] = [
  ["identify/elf", fileIdentify, () => bytesOf("elf"), "a.so"],
  ["identify/npm-tgz", fileIdentify, () => bytesOf("npm-tgz"), "p.tgz"],
  ["identify/macho-fat", fileIdentify, () => bytesOf("macho-fat"), "u"],
  ["identify/json", fileIdentify, () => bytesOf("package-json"), "package.json"],
  ["archive/zip", archiveList, () => bytesOf("zip"), "a.zip"],
  ["archive/crx", archiveList, () => bytesOf("crx"), "a.crx"],
  ["archive/tar", archiveList, () => bytesOf("tar"), "a.tar"],
  ["archive/tar.gz", archiveList, () => bytesOf("tar.gz"), "a.tar.gz"],
  ["archive/asar", archiveList, () => bytesOf("asar"), "app.asar"],
  ["pkg.manifest/tgz", pkgManifest, () => bytesOf("npm-tgz"), "p.tgz"],
  ["pkg.manifest/json", pkgManifest, () => bytesOf("package-json"), "package.json"],
  ["pkg.native-addons/tgz", pkgNativeAddons, () => bytesOf("npm-tgz"), "p.tgz"],
  [
    "elf",
    elfInfo,
    () => makeElf64({ needed: ["libssl.so.3", "libc.so.6"], soname: "x.so", runpath: "$ORIGIN" }),
    "a.so",
  ],
  ["pe/exe", peInfo, () => bytesOf("pe"), "a.exe"],
  ["pe/dll", peInfo, () => bytesOf("pe-dll"), "a.dll"],
  ["macho/thin", machoInfo, () => bytesOf("macho"), "m"],
  ["macho/fat", machoInfo, () => bytesOf("macho-fat"), "u"],
  ["wasm", wasmInfo, () => bytesOf("wasm"), "m.wasm"],
  ["js.imports", jsImports, () => enc.encode(APP_JS), "a.js"],
  ["js.endpoints", jsEndpoints, () => enc.encode(APP_JS), "a.js"],
  ["code.obfuscation", codeObfuscation, () => enc.encode(APP_JS), "a.js"],
];

CASES.forEach(([name, probe, seed, file], idx) => {
  test(`fuzz ${name}: ${N} seeded mutations, only results or probe_failed, each < ${LIMIT_MS} ms`, async (t) => {
    const r = await fuzz(name, probe, seed(), file, 1000 + idx);
    t.diagnostic(`fuzz ${name}: ok=${r.ok} probe_failed=${r.failed} worst=${r.worst.toFixed(1)}ms`);
    assert.equal(r.ok + r.failed, N);
  });
});

test("fuzz the raw tar parser and tokenizer directly (no gzip/CRC in front of them)", () => {
  const rnd = lcg(77);
  const tar = makeTar([
    { name: "a.txt", data: "abc" },
    { name: "dir", dir: true },
    { name: "lnk", symlink: "a.txt" },
  ]);
  for (let i = 0; i < N; i++) {
    const input = mutate(tar, rnd);
    try {
      parseTar(input);
    } catch (e) {
      assert.ok(isAssayError(e, "probe_failed"), `tar #${i}: ${e}`);
    }
    const text = new TextDecoder().decode(mutate(enc.encode(APP_JS), rnd));
    const r = tokenize(text);
    assert.ok(Array.isArray(r.tokens));
  }
});

// ---------------------------------------------------------------- named regressions ----
// Inputs found while fuzzing and hardening the parsers; each stays as its own test.

test('regression: unterminated regex classes stay linear ("(/[" repeated was quadratic)', async () => {
  const t0 = performance.now();
  const out = await runOn(jsImports, enc.encode("(/[".repeat(100_000)), "bomb.js");
  assert.ok(performance.now() - t0 < 1000);
  assert.equal(out.coverage?.status, "partial");
});

test("regression: a template substitution still open at end of file is reported, so the census is partial", async () => {
  const out = await runOn(jsImports, enc.encode('import "./a.js";\nconst t = `x ${'), "open.js");
  assert.equal(out.coverage?.status, "partial");
  assert.ok(out.coverage?.skipped.some((s) => /unterminated template/.test(s.reason)));
});

test("regression: zip symlink entries are checked by their target, not only their name", async () => {
  const out = await runOn(archiveList, makeZip([{ name: "innocent", symlink: "../../../etc/passwd" }]), "s.zip");
  assert.deepEqual((out.result as { zipSlip: { reason: string }[] }).zipSlip, [
    { name: "innocent", reason: "symlink escapes the extraction directory" },
  ]);
});

test("regression: hostile structures fail cleanly or are bounded (deep ASAR, deep JSON, huge counts)", async () => {
  const outcome = async (p: Promise<unknown>) => {
    try {
      await p;
      return "ok";
    } catch (e) {
      assert.ok(isAssayError(e, "probe_failed"), String(e));
      return "probe_failed";
    }
  };
  const asarJson = `{"files":${'{"d":{"files":'.repeat(5000)}{}${"}}".repeat(5000)}}`;
  const hdr = enc.encode(asarJson);
  const asar = new Uint8Array(16 + hdr.length);
  const dv = new DataView(asar.buffer);
  dv.setUint32(0, 4, true);
  dv.setUint32(4, hdr.length + 8, true);
  dv.setUint32(8, hdr.length + 4, true);
  dv.setUint32(12, hdr.length, true);
  asar.set(hdr, 16);
  const deep = await runOn(archiveList, asar, "deep.asar");
  assert.ok((deep.result as { notes: string[] }).notes.some((n) => /depth limit/.test(n)));
  assert.equal(await outcome(runOn(pkgManifest, enc.encode("[".repeat(200_000)), "package.json")), "probe_failed");
  const zip = makeZip([{ name: "a", data: "b" }]);
  const zv = new DataView(zip.buffer);
  zv.setUint16(zip.length - 12, 0xffff, true);
  zv.setUint16(zip.length - 14, 0xffff, true);
  const z = await runOn(archiveList, zip, "a.zip");
  assert.equal((z.result as { truncated: boolean }).truncated, true);
  const elf = makeElf64();
  new DataView(elf.buffer).setUint16(60, 0xffff, true);
  assert.equal(await outcome(runOn(elfInfo, elf, "a.so")), "probe_failed");
  const tar = makeTar([{ name: "a", data: "x" }]);
  tar[124] = 0x80;
  tar.fill(0xff, 125, 136);
  assert.equal(await outcome(Promise.resolve().then(() => parseTar(tar))), "probe_failed");
});
