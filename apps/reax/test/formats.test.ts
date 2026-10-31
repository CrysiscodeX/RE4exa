// inventory.notes and inventory.go against independent readers: llvm-readobj --notes and Go's own
// debug/buildinfo and debug/gosym (bench/oracle/notes.json and go.json, from scripts/oracle.ts),
// on the zig corpus and the extra fixtures (fixtures/extra, pinned by digest).
import assert from "node:assert/strict";
import { copyFileSync, cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { isCoreError } from "@re4exa/core/errors";
import { checkExtra, EXTRA } from "../scripts/extra-fixtures.ts";
import { digestRows } from "../scripts/oracle.ts";
import { runOperation } from "../src/ops/registry.ts";
import type { GoFunc } from "../src/readers/go.ts";
import type { Note } from "../src/readers/notes.ts";

const REAX = join(import.meta.dirname, "..");
const BIN = join(REAX, "fixtures", "bin");
// biome-ignore lint/suspicious/noExplicitAny: the keys are JSON from other tools
type Any = any;
const NOTES = JSON.parse(readFileSync(join(REAX, "bench", "oracle", "notes.json"), "utf8")).files as Record<
  string,
  Any[]
>;
const GO = JSON.parse(readFileSync(join(REAX, "bench", "oracle", "go.json"), "utf8")).files as Record<string, Any>;
const refused = (e: unknown) => isCoreError(e) && e.code === "bad_request";

test("[+RX-1/extra-fixtures] every extra fixture matches its manifest digest", () => {
  assert.deepStrictEqual(checkExtra(), []);
});

test("[-RX-1/extra-fixtures] a changed, an unlisted and a missing fixture are each reported", () => {
  const dir = mkdtempSync(join(tmpdir(), "reax-extra-"));
  try {
    cpSync(EXTRA, dir, { recursive: true });
    writeFileSync(join(dir, "c-notes-x86_64-linux-gnu"), "changed");
    writeFileSync(join(dir, "stray"), "x");
    rmSync(join(dir, "go-hello-x86_64-windows.exe"));
    const p = checkExtra(dir);
    assert.ok(
      p.some((x) => /c-notes.*digest/.test(x)),
      p.join("; "),
    );
    assert.ok(p.some((x) => /stray is not in the manifest/.test(x)));
    assert.ok(p.some((x) => /windows.exe is missing/.test(x)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** reax's note in llvm-readobj's shape: its section, owner, size, type name and decoded fields. */
function asKey(n: Note) {
  const fields: Record<string, string> = {};
  if (n.buildId) fields["Build ID"] = n.buildId;
  if (n.abi) {
    fields.OS = n.abi.os;
    fields.ABI = n.abi.version;
  }
  for (const p of n.properties ?? []) fields[p.type] = p.values.join(", ");
  return { section: n.in, owner: n.owner, dataSize: n.descSize, type: n.typeName, fields };
}

test("[+rea.tool/inspect_elf_notes] every ELF fixture's notes equal llvm-readobj's: build ID, ABI tag, x86 property note, Go build ID", async () => {
  let n = 0;
  for (const [key, want] of Object.entries(NOTES)) {
    const extra = key.startsWith("extra/");
    const path = extra ? key.slice(6) : key;
    const r = await runOperation("inventory.notes", { path }, { workspace: extra ? EXTRA : BIN });
    const got = (r.data as { notes: Note[] }).notes.map(asKey);
    // llvm-readobj names no Go note type and prints a raw dump; reax decodes it
    const expected = want.map((k: Any) => ({
      ...k,
      type: k.type === "Unknown" && k.owner === "Go" ? "NT_GO_BUILD_ID" : k.type,
      fields: k.owner === "Go" ? {} : k.fields,
    }));
    assert.deepStrictEqual(got, expected, key);
    n += got.length;
  }
  assert.ok(n >= 9, `${n} notes compared`);
  // the Go build ID note decodes to the same text Go's linker wrote
  const go = (await runOperation("inventory.notes", { path: "go-hello-x86_64-linux" }, { workspace: EXTRA })).data as {
    notes: Note[];
  };
  assert.match(go.notes.find((x) => x.owner === "Go")!.goBuildId!, /^[\w-]+\/[\w-]+\/[\w-]+\/[\w-]+$/);
});

test("[-rea.tool/inspect_elf_notes] a PE or Mach-O file is refused, and a cut note is not invented", async () => {
  for (const path of ["hello-x86_64-windows-gnu-s.exe", "hello-aarch64-macos-s"])
    await assert.rejects(runOperation("inventory.notes", { path }, { workspace: BIN }), refused, path);
  const dir = mkdtempSync(join(tmpdir(), "reax-notes-"));
  try {
    // cut the build ID's descriptor in half: that note is dropped, the ones before it stay
    const b = Buffer.from(readFileSync(join(EXTRA, "c-notes-x86_64-linux-gnu")));
    const at = b.indexOf(Buffer.from("GNU\0", "latin1"), b.indexOf(Buffer.from([0x14, 0, 0, 0, 3, 0, 0, 0])));
    b.writeUInt32LE(0x7fffffff, at - 8); // an impossible descriptor size
    writeFileSync(join(dir, "cut"), b);
    const r = (await runOperation("inventory.notes", { path: "cut" }, { workspace: dir })).data as { notes: Note[] };
    assert.ok(!r.notes.some((x) => x.buildId), "no build ID is reported from a broken note");
    assert.ok(
      r.notes.some((x) => x.properties),
      "the property note before it is still read",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

async function goFuncs(path: string, workspace = EXTRA): Promise<GoFunc[]> {
  const out: GoFunc[] = [];
  let offset: number | null = 0;
  while (offset !== null) {
    const r = await runOperation("inventory.go", { path, offset, limit: 10_000 }, { workspace });
    const d = r.data as { items: GoFunc[]; page: { next: number | null } };
    out.push(...d.items);
    offset = d.page.next;
  }
  return out;
}

test("[+rea.tool/inspect_go_binary] [+leanrea/LEAN-C21] [+leanrea/LEAN-C28] build information equals Go's debug/buildinfo on Linux and Windows binaries", async () => {
  for (const [file, k] of Object.entries(GO)) {
    const r = await runOperation("inventory.go", { path: file, limit: 1 }, { workspace: EXTRA });
    const d = r.data as Any;
    assert.equal(d.go, true);
    const bi = d.buildInfo;
    const mod = (m: Any) => (m ? { path: m.path, version: m.version, sum: m.sum ?? "" } : null);
    assert.equal(bi.goVersion, k.goVersion, file);
    assert.equal(bi.path, k.path, file);
    assert.deepStrictEqual(mod(bi.main), mod(k.main), file);
    assert.deepStrictEqual(
      bi.deps.map((x: Any) => ({ ...mod(x), replace: mod(x.replace) })),
      k.deps.map((x: Any) => ({ ...mod(x), replace: mod(x.replace) })),
      file,
    );
    assert.deepStrictEqual(
      bi.settings.map((s: Any) => [s.key, s.value]),
      k.settings,
      file,
    );
    assert.equal(r.coverage, "complete");
  }
});

test("[-rea.tool/inspect_go_binary] [-leanrea/LEAN-C21] [-leanrea/LEAN-C28] a non-Go binary says so; a damaged pclntab is reported, not guessed", async () => {
  const c = (await runOperation("inventory.go", { path: "hello-x86_64-linux-gnu.2.28-s" }, { workspace: BIN }))
    .data as Any;
  assert.equal(c.go, false);
  assert.equal(c.buildInfo, null);
  await assert.rejects(
    runOperation("inventory.go", { path: "lib-wasm32-freestanding-s.wasm" }, { workspace: BIN }),
    refused,
  );
  const dir = mkdtempSync(join(tmpdir(), "reax-go-"));
  try {
    const b = Buffer.from(readFileSync(join(EXTRA, "go-hello-x86_64-windows.exe")));
    // break every pclntab header magic (0xfffffff1, little-endian)
    for (
      let at = b.indexOf(Buffer.from([0xf1, 0xff, 0xff, 0xff]));
      at >= 0;
      at = b.indexOf(Buffer.from([0xf1, 0xff, 0xff, 0xff]), at + 1)
    )
      b[at] = 0;
    writeFileSync(join(dir, "broken.exe"), b);
    copyFileSync(join(EXTRA, "go-hello-x86_64-linux"), join(dir, "ok"));
    const r = await runOperation("inventory.go", { path: "broken.exe" }, { workspace: dir });
    assert.equal((r.data as Any).go, true, "the build information still identifies Go");
    assert.equal(r.coverage, "partial");
    assert.match(r.limitations.join(" "), /no pclntab/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("[+leanrea/LEAN-T10] every function of a stripped Go binary, with its entry, equals Go's debug/gosym", async () => {
  for (const [file, k] of Object.entries(GO)) {
    const funcs = await goFuncs(file);
    assert.deepStrictEqual(digestRows(funcs.map((f) => ({ name: f.name, entry: f.entry }))), k.funcs, file);
    assert.deepStrictEqual(
      funcs.filter((f) => f.name.startsWith("main.")),
      k.mainFuncs,
      file,
    );
    // stripped: the symbol table is empty, yet main.main is found
    const syms = (await runOperation("inventory.symbols", { path: file, search: "main.main" }, { workspace: EXTRA }))
      .data as { page: { total: number } };
    assert.equal(syms.page.total, 0, `${file} has no symbol table`);
  }
});

test("[-leanrea/LEAN-T10] a search for a function the binary lacks finds nothing", async () => {
  const r = (
    await runOperation("inventory.go", { path: "go-hello-x86_64-linux", search: "main.nothere" }, { workspace: EXTRA })
  ).data as { page: { total: number } };
  assert.equal(r.page.total, 0);
});

const RES = JSON.parse(readFileSync(join(REAX, "bench", "oracle", "resources.json"), "utf8")).files as Record<
  string,
  Any
>;

test("[+rea.tool/inspect_pe_resources] the resource tree equals llvm-readobj's, and version, strings and manifest equal pefile's", async () => {
  let n = 0;
  for (const [key, k] of Object.entries(RES)) {
    const extra = key.startsWith("extra/");
    const path = extra ? key.slice(6) : key;
    const r = await runOperation("inventory.resources", { path }, { workspace: extra ? EXTRA : BIN });
    const d = r.data as Any;
    assert.deepStrictEqual(
      d.resources.map((x: Any) => ({ type: x.type, name: x.name, language: x.language, rva: x.rva, size: x.size })),
      k.tree,
      key,
    );
    const p = k.pefile;
    if (p.version) {
      assert.deepStrictEqual(
        {
          fileVersion: d.version.fileVersion,
          productVersion: d.version.productVersion,
          fileOs: d.version.fileOs,
          fileType: d.version.fileType,
          strings: d.version.strings,
          translations: d.version.translations,
        },
        p.version,
        key,
      );
    } else assert.equal(d.version, null, key);
    assert.deepStrictEqual(d.strings, p.strings, key);
    assert.equal(d.manifest, p.manifest, key);
    assert.equal(r.coverage, "complete");
    n += d.resources.length;
  }
  assert.ok(n >= 3, `${n} resources compared`);
});

test("[-rea.tool/inspect_pe_resources] a non-PE file is refused; a resource directory that loops is read once and reported", async () => {
  await assert.rejects(
    runOperation("inventory.resources", { path: "hello-aarch64-macos-s" }, { workspace: BIN }),
    refused,
  );
  const dir = mkdtempSync(join(tmpdir(), "reax-rsrc-"));
  try {
    const b = Buffer.from(readFileSync(join(EXTRA, "rsrc-x86_64-windows.exe")));
    // point the first type entry's subdirectory back at the root directory
    const k = RES["extra/rsrc-x86_64-windows.exe"].tree[0];
    const rsrc = b.indexOf(Buffer.from([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 0]));
    assert.ok(rsrc > 0 && k, "found the resource root");
    b.writeUInt32LE(0x80000000, rsrc + 16 + 4);
    writeFileSync(join(dir, "loop.exe"), b);
    const r = await runOperation("inventory.resources", { path: "loop.exe" }, { workspace: dir });
    assert.equal(r.coverage, "partial");
    assert.match(r.limitations.join(" "), /repeated or cut/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const MACHO = JSON.parse(readFileSync(join(REAX, "bench", "oracle", "macho.json"), "utf8")).files as Record<
  string,
  Any[]
>;
/** Versions compare as numbers, so llvm's "13.0" equals reax's "13.0.0". */
const ver = (v: string) =>
  v
    .split(".")
    .map(Number)
    .join(".")
    .replace(/(\.0)+$/, "");

test("[+rea.tool/inspect_macho] every slice's header and load commands equal llvm-objdump's", async () => {
  let n = 0;
  for (const [file, slices] of Object.entries(MACHO)) {
    const d = (await runOperation("inventory.macho", { path: file }, { workspace: BIN })).data as Any;
    assert.equal(d.slices.length, slices.length, file);
    for (const [i, k] of slices.entries()) {
      const s = d.slices[i];
      assert.equal(s.header.filetype, k.filetype, file);
      // the flags are a set; llvm-objdump prints them in its own order
      assert.deepStrictEqual([...s.header.flags].sort(), [...k.flags].sort(), file);
      assert.equal(s.header.ncmds, k.ncmds, file);
      assert.equal(s.header.sizeofcmds, k.sizeofcmds, file);
      assert.deepStrictEqual(
        s.loadCommands.map((c: Any) => c.cmd),
        k.cmds.map((c: Any) => c.cmd),
        file,
      );
      for (const [j, kc] of k.cmds.entries())
        for (const [field, want] of Object.entries(kc.fields as Record<string, string>)) {
          const got = String(s.loadCommands[j].fields[field]);
          const same = /Version$|^(sdk|minos|version)$/.test(field) ? ver(got) === ver(want) : got === want;
          assert.ok(same, `${file} ${s.arch} ${kc.cmd}.${field}: ${got} vs ${want}`);
          n++;
        }
    }
  }
  assert.ok(n >= 100, `${n} fields compared`);
});

test("[-rea.tool/inspect_macho] a file that is not Mach-O is refused; cut load commands are reported", async () => {
  await assert.rejects(
    runOperation("inventory.macho", { path: "lib-x86_64-linux-gnu.2.28-s.so" }, { workspace: BIN }),
    refused,
  );
  const dir = mkdtempSync(join(tmpdir(), "reax-macho-"));
  try {
    const b = Buffer.from(readFileSync(join(BIN, "hello-x86_64-macos-s")));
    b.writeUInt32LE(0x7fffffff, 32 + 4); // the first load command claims an impossible size
    writeFileSync(join(dir, "cut"), b);
    const r = await runOperation("inventory.macho", { path: "cut" }, { workspace: dir });
    assert.equal(r.coverage, "partial");
    assert.match(r.limitations.join(" "), /impossible size/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("[+rea.tool/inspect_signature] every signed slice's code pages hash to the values its CodeDirectory records", async () => {
  let pages = 0;
  for (const file of Object.keys(MACHO)) {
    const d = (await runOperation("inventory.macho", { path: file }, { workspace: BIN })).data as Any;
    for (const s of d.slices) {
      const lc = s.loadCommands.find((c: Any) => c.cmd === "LC_CODE_SIGNATURE");
      assert.equal(!!s.signature, !!lc, `${file} ${s.arch}: signature iff LC_CODE_SIGNATURE`);
      if (!s.signature) continue;
      assert.equal(s.signature.offset, lc.fields.dataoff);
      const cd = s.signature.codeDirectories[0];
      assert.ok(cd.codeSlots > 0);
      assert.equal(cd.pagesVerified, cd.codeSlots, `${file} ${s.arch}`);
      // zig's linker signs ad hoc: no certificate, flags say so
      assert.deepStrictEqual(cd.flags, ["adhoc", "linker-signed"]);
      assert.equal(s.signature.cms, false);
      pages += cd.codeSlots;
    }
  }
  assert.ok(pages >= 12, `${pages} pages verified`);
});

test("[-rea.tool/inspect_signature] a changed byte inside a signed page fails its hash, and is reported", async () => {
  const dir = mkdtempSync(join(tmpdir(), "reax-sig-"));
  try {
    const b = Buffer.from(readFileSync(join(BIN, "hello-aarch64-macos-s")));
    b[0x700] = b[0x700]! ^ 0xff; // inside __TEXT, the second page
    writeFileSync(join(dir, "tampered"), b);
    const r = await runOperation("inventory.macho", { path: "tampered" }, { workspace: dir });
    const cd = (r.data as Any).slices[0].signature.codeDirectories[0];
    assert.equal(cd.pagesVerified, cd.codeSlots - 1);
    assert.equal(r.coverage, "partial");
    assert.match(r.limitations.join(" "), /1 of \d+ code pages do not match/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
