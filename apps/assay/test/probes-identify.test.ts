import assert from "node:assert/strict";
import { test } from "node:test";
import { isAssayError } from "../src/errors.ts";
import { extractStrings, fileContains, fileStrings } from "../src/probes/builtin/bytes.ts";
import { familiesOf, fileIdentify, identifyBytes } from "../src/probes/builtin/identify.ts";
import { fixtureSet, gzipStored, makeMachO, makeTar, makeZip } from "./fixtures/probes/gen.ts";
import { runOn } from "./fixtures/probes/harness.ts";

const enc = new TextEncoder();

test("file.identify names every generated fixture's format from its bytes", () => {
  for (const fx of fixtureSet()) {
    if (fx.files.length !== 1) continue;
    const b = fx.files[0]!.bytes;
    const id = identifyBytes(b, fx.subject, b.length);
    assert.equal(id.format, fx.format, `${fx.name}: got ${id.format}`);
    for (const fam of familiesOf(fx.format)) assert.ok(id.families.includes(fam), `${fx.name}: family ${fam}`);
  }
});

test("file.identify: Mach-O thin in both endiannesses and widths, fat, and Java class files", () => {
  for (const bits of [32, 64] as const)
    for (const le of [true, false]) {
      const b = makeMachO({ bits, le, cpu: bits === 64 ? "x86_64" : "x86" });
      const id = identifyBytes(b, "x", b.length);
      assert.equal(id.format, "macho");
      assert.equal(id.details.bits, bits);
      assert.equal(id.details.endian, le ? "little" : "big");
    }
  const java = Uint8Array.from([0xca, 0xfe, 0xba, 0xbe, 0, 0, 0, 0x41]);
  assert.equal(identifyBytes(java, "A.class", java.length).format, "java-class");
  const fat = Uint8Array.from([0xca, 0xfe, 0xba, 0xbe, 0, 0, 0, 2]);
  assert.equal(identifyBytes(fat, "u", fat.length).format, "macho-fat");
});

test("file.identify: tar by ustar at 257, gzip vs tar.gz vs npm tarball, zip family by extension", () => {
  const tar = makeTar([{ name: "x.txt", data: "x" }]);
  assert.equal(identifyBytes(tar, "a.tar", tar.length).format, "tar");
  assert.equal(identifyBytes(gzipStored(tar), "a.tar.gz", 999).format, "tar.gz");
  const npm = gzipStored(makeTar([{ name: "package/package.json", data: "{}" }]));
  assert.equal(identifyBytes(npm, "p-1.0.0.tgz", npm.length).format, "npm-tgz");
  assert.equal(identifyBytes(gzipStored(enc.encode("hi")), "a.gz", 30).format, "gzip");
  const zip = makeZip([{ name: "a", data: "b" }]);
  for (const [ext, fmt] of [
    ["x.zip", "zip"],
    ["x.jar", "jar"],
    ["x.apk", "apk"],
    ["x.vsix", "vsix"],
    ["x.crx", "crx"],
  ])
    assert.equal(identifyBytes(zip, ext!, zip.length).format, fmt);
});

test("file.identify: text kinds — shebang, JSON, package.json, JS/TS by extension, plain, empty, binary", () => {
  const id = (s: string, name: string) => identifyBytes(enc.encode(s), name, enc.encode(s).length);
  const sh = id("#!/bin/sh\necho hi\n", "run");
  assert.equal(sh.format, "script");
  assert.equal(sh.details.interpreter, "sh");
  assert.ok(!sh.families.includes("javascript"));
  const node = id("#!/usr/bin/env -S node --flag\nx()\n", "cli");
  assert.equal(node.details.interpreter, "node");
  assert.ok(node.families.includes("javascript"));
  assert.equal(id('{"a":1}', "x.json").format, "json");
  assert.equal(id('{"name":"x"}', "package.json").format, "package-json");
  assert.equal(id("[1,2", "x.json").format, "text");
  assert.equal(id("export {}", "a.mjs").format, "javascript");
  assert.equal(id("let x: number", "a.tsx").format, "typescript");
  assert.equal(id("hello", "README").format, "text");
  assert.equal(identifyBytes(new Uint8Array(0), "e", 0).format, "empty");
  assert.equal(identifyBytes(Uint8Array.from([0, 1, 2, 3, 0xff]), "b", 5).format, "unknown");
  // a UTF-8 character cut at the end of the identification window is still text
  const cut = enc.encode("héllo").subarray(0, 2);
  assert.equal(identifyBytes(cut, "t.txt", 100).format, "text");
  // MZ without PE is not called PE
  const mz = new Uint8Array(128);
  mz.set(enc.encode("MZ"));
  assert.equal(identifyBytes(mz, "a.exe", 128).format, "unknown");
});

test("file.identify probe records observed bytes facts and is name-sensitive", async () => {
  assert.equal(fileIdentify.confidence, "observed");
  assert.equal(fileIdentify.nameSensitive, true);
  const out = await runOn(fileIdentify, enc.encode("export const a = 1;\n"), "src/a.js");
  assert.equal((out.result as { format: string }).format, "javascript");
});

test("file.strings: runs of at least n printable bytes, capped, regex filter, bad patterns refused", async () => {
  const b = concatBytes(
    enc.encode("abc"),
    Uint8Array.from([0]),
    enc.encode("hello world"),
    Uint8Array.from([1, 2]),
    enc.encode("token=SECRET1"),
  );
  const r = extractStrings(b, 4, 10, null);
  assert.deepEqual(
    r.strings.map((s) => s.value),
    ["hello world", "token=SECRET1"],
  );
  assert.equal(r.strings[0]!.offset, 4);
  const out = await runOn(fileStrings, b, "f", { min: 4, pattern: "^token=" });
  assert.equal((out.result as { matched: number }).matched, 1);
  assert.equal(out.coverage?.status, "complete");
  const capped = await runOn(fileStrings, enc.encode("aaaa\0bbbb\0cccc"), "f", { min: 4, limit: 2 });
  assert.equal((capped.result as { truncated: boolean }).truncated, true);
  await assert.rejects(runOn(fileStrings, b, "f", { pattern: "(" }), (e) => isAssayError(e, "probe_failed"));
  await assert.rejects(runOn(fileStrings, b, "f", { pattern: "(a+)+$" }), (e) => isAssayError(e, "probe_failed"));
  await assert.rejects(runOn(fileStrings, b, "f", { min: 1 }), (e) => isAssayError(e, "probe_failed"));
});

test("file.contains: text, hex, offset, ignoreCase, and parameter errors", async () => {
  const b = enc.encode("\x7fELF....Hello World");
  const res = async (p: Record<string, unknown>) =>
    (await runOn(fileContains, b, "f", p as never)).result as { found: boolean; offsets: number[] };
  assert.deepEqual(await res({ text: "World" }), { found: true, offsets: [14], count: 1, needleLength: 5 });
  assert.equal((await res({ hex: "7f 45 4c 46", offset: 0 })).found, true);
  assert.equal((await res({ hex: "7f454c46", offset: 1 })).found, false);
  assert.equal((await res({ text: "world" })).found, false);
  assert.equal((await res({ text: "world", ignoreCase: true })).found, true);
  assert.equal((await res({ text: "absent" })).found, false);
  for (const bad of [
    {},
    { text: "a", hex: "61" },
    { hex: "abc" },
    { hex: "zz" },
    { text: "" },
    { text: "a", offset: -1 },
  ])
    await assert.rejects(
      runOn(fileContains, b, "f", bad as never),
      (e) => isAssayError(e, "probe_failed"),
      JSON.stringify(bad),
    );
});

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  return Uint8Array.from(parts.flatMap((p) => [...p]));
}
