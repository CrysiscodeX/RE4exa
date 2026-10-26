import assert from "node:assert/strict";
import { test } from "node:test";
import { isCoreError } from "../src/errors.ts";
import { findingKey } from "../src/evidence/record.ts";
import { archiveList, listArchive, parseAsar, parseTar, parseZip, zipSlip } from "../src/probes/builtin/archive.ts";
import { pkgManifest } from "../src/probes/builtin/pkg.ts";
import { concat, gzipStored, makeAsar, makeNpmTgz, makeTar, makeZip } from "../src/testing/gen.ts";
import { runOn } from "../src/testing/harness.ts";

const enc = new TextEncoder();

test("zip: central directory names, sizes, dirs, symlinks; zip-slip names become findings", async () => {
  const z = makeZip([
    { name: "a.txt", data: "hello" },
    { name: "d", dir: true },
    { name: "../evil", data: "x" },
    { name: "/abs", data: "x" },
    { name: "C:/win", data: "x" },
    { name: "ln", symlink: "../../etc/passwd" },
  ]);
  const l = parseZip(z);
  assert.deepEqual(
    l.entries.map((e) => [e.name, e.size, e.type]),
    [
      ["a.txt", 5, "file"],
      ["d/", 0, "dir"],
      ["../evil", 1, "file"],
      ["/abs", 1, "file"],
      ["C:/win", 1, "file"],
      ["ln", 16, "symlink"],
    ],
  );
  const out = await runOn(archiveList, z, "x.zip");
  const r = out.result as { zipSlip: { name: string; reason: string }[]; container: string };
  assert.equal(r.container, "zip");
  assert.deepEqual(
    r.zipSlip.map((s) => s.name),
    ["../evil", "/abs", "C:/win", "ln"],
  );
  assert.ok(out.findings?.some((f) => f.key === findingKey("archive.zip-slip", { name: "../evil" })));
  assert.equal(out.coverage?.status, "complete");
});

test("zip: a prefix (CRX header / self-extractor) is skipped; the entry cap makes coverage partial", async () => {
  const z = makeZip([
    { name: "a", data: "1" },
    { name: "b", data: "2" },
    { name: "c", data: "3" },
  ]);
  const prefixed = concat([enc.encode("Cr24\x03\0\0\0junkjunk"), z]);
  const l = parseZip(prefixed);
  assert.equal(l.prefixBytes, 16);
  assert.equal(l.entries.length, 3);
  const out = await runOn(archiveList, z, "x.zip", { max: 2 });
  assert.equal(out.coverage?.status, "partial");
  assert.equal((out.result as { truncated: boolean }).truncated, true);
});

test("zipSlip classifies traversal, absolute, drive and NUL names, and allows inner dot-dots", () => {
  assert.equal(zipSlip("a/b/../c"), null);
  assert.equal(zipSlip("./a"), null);
  assert.equal(zipSlip("a/../../b"), "parent-directory traversal");
  assert.equal(zipSlip("..\\x"), "parent-directory traversal");
  assert.equal(zipSlip("/etc/x"), "absolute path");
  assert.equal(zipSlip("D:\\x"), "drive-letter path");
  assert.equal(zipSlip("a\0b"), "NUL byte in name");
});

test("tar: ustar entries with prefix (long names), dirs, symlinks; gzip-wrapped tar", () => {
  const long = `${"d".repeat(60)}/${"e".repeat(60)}/file.txt`;
  const t = makeTar([
    { name: "a.txt", data: "abc" },
    { name: "dir", dir: true },
    { name: long, data: "x" },
    { name: "lnk", symlink: "a.txt" },
  ]);
  const l = parseTar(t);
  assert.deepEqual(
    l.entries.map((e) => [e.name, e.size, e.type]),
    [
      ["a.txt", 3, "file"],
      ["dir", 0, "dir"],
      [long, 1, "file"],
      ["lnk", 0, "symlink"],
    ],
  );
  assert.equal(l.entries[3]!.linkTarget, "a.txt");
  const g = listArchive(gzipStored(t));
  assert.equal(g.container, "tar.gz");
  assert.equal(g.total, 4);
  // a corrupt checksum after the first header stops the listing and marks it truncated
  const bad = Uint8Array.from(t);
  bad[1024] = bad[1024]! ^ 0xff; // the second header (after a.txt's header and data block)
  const b = parseTar(bad);
  assert.equal(b.truncated, true);
  assert.equal(b.entries.length, 1);
});

test("asar: header JSON tree with nested dirs, unpacked files and links", async () => {
  const a = makeAsar({
    "package.json": '{"name":"x"}',
    lib: { "a.js": "1", deep: { "b.js": "22" } },
    "addon.node": { unpacked: 100 },
  });
  const l = parseAsar(a);
  assert.deepEqual(
    l.entries.map((e) => [e.name, e.size, e.type, e.unpacked ?? false]),
    [
      ["addon.node", 100, "file", true],
      ["lib/", 0, "dir", false],
      ["package.json", 12, "file", false],
      ["lib/a.js", 1, "file", false],
      ["lib/deep/", 0, "dir", false],
      ["lib/deep/b.js", 2, "file", false],
    ],
  );
  const out = await runOn(archiveList, a, "app.asar");
  assert.equal((out.result as { container: string }).container, "asar");
  const broken = Uint8Array.from(a);
  broken[20] = 0x7b;
  broken[21] = 0x7b;
  assert.throws(
    () => parseAsar(broken),
    (e) => isCoreError(e, "probe_failed"),
  );
});

test("archive.list: gzip bombs and non-archives fail with probe_failed", async () => {
  await assert.rejects(runOn(archiveList, enc.encode("not an archive at all"), "x.zip"), (e) =>
    isCoreError(e, "probe_failed"),
  );
  const g = gzipStored(enc.encode("hello"));
  g[g.length - 8] = g[g.length - 8]! ^ 1; // CRC mismatch
  await assert.rejects(runOn(archiveList, g, "x.gz"), (e) => isCoreError(e, "probe_failed"));
});

test("pkg.manifest: npm tarball fields, install hooks and dependency findings", async () => {
  const tgz = makeNpmTgz(
    {
      name: "@s/p",
      version: "1.2.3",
      main: "i.js",
      bin: "cli.js",
      exports: { ".": "./i.js" },
      scripts: { preinstall: "node pre.js", postinstall: "node post.js", test: "x" },
      dependencies: { a: "^1" },
      devDependencies: { b: "2" },
    },
    { "i.js": "" },
  );
  const out = await runOn(pkgManifest, tgz, "p-1.2.3.tgz");
  const r = out.result as Record<string, unknown>;
  assert.equal(r.name, "@s/p");
  assert.equal(r.version, "1.2.3");
  assert.equal(r.source, "package/package.json");
  assert.deepEqual(r.bin, { p: "cli.js" });
  assert.deepEqual(r.exports, { ".": "./i.js" });
  assert.deepEqual(r.installHooks, [
    { hook: "preinstall", command: "node pre.js" },
    { hook: "postinstall", command: "node post.js" },
  ]);
  const classes = out.findings?.map((f) => f.class).sort();
  assert.deepEqual(classes, ["pkg.dependency", "pkg.dependency", "pkg.install-script", "pkg.install-script"]);
  assert.ok(out.findings?.some((f) => f.key === findingKey("pkg.dependency", { scope: "dependencies", name: "a" })));
});

test("pkg.manifest: binding.gyp in a tarball is an implicit install hook; a lone package.json says what it cannot see", async () => {
  const tgz = makeNpmTgz({ name: "n", version: "1.0.0" }, { "binding.gyp": "{}" });
  const r = (await runOn(pkgManifest, tgz, "n.tgz")).result as { installHooks: unknown[]; gypfile: boolean };
  assert.deepEqual(r.installHooks, [{ hook: "install", command: "node-gyp rebuild", implicit: true }]);
  assert.equal(r.gypfile, true);
  const lone = await runOn(pkgManifest, enc.encode('{"name":"x"}'), "package.json");
  assert.ok(lone.limitations?.some((l) => l.includes("lone package.json")));
  await assert.rejects(runOn(pkgManifest, enc.encode("[1]"), "package.json"), (e) => isCoreError(e, "probe_failed"));
  await assert.rejects(runOn(pkgManifest, enc.encode("{bad"), "package.json"), (e) => isCoreError(e, "probe_failed"));
  const noPkg = gzipStored(makeTar([{ name: "other/readme", data: "x" }]));
  await assert.rejects(runOn(pkgManifest, noPkg, "x.tgz"), (e) => isCoreError(e, "probe_failed"));
});
