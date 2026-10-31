// inventory.symbols, inventory.procedures, read.symbol and inventory.overview against LLVM 18's
// reading of every native fixture (bench/oracle/symbols.json and layout.json, from llvm-nm,
// llvm-readobj, llvm-objdump and llvm-dwarfdump; written by scripts/oracle.ts).
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { isCoreError } from "@re4exa/core/errors";
import { runOperation } from "../src/ops/registry.ts";
import type { Procedure, Sym } from "../src/readers/symbols.ts";

const REAX = join(import.meta.dirname, "..");
const BIN = join(REAX, "fixtures", "bin");
const ctx = { workspace: BIN };
// biome-ignore lint/suspicious/noExplicitAny: the key's shape differs per format
type Any = any;
const KEY = JSON.parse(readFileSync(join(REAX, "bench", "oracle", "symbols.json"), "utf8")).files as Record<
  string,
  Any
>;
const LAYOUT = JSON.parse(readFileSync(join(REAX, "bench", "oracle", "layout.json"), "utf8")).files as Record<
  string,
  Any
>;
const refused = (e: unknown) => isCoreError(e) && e.code === "bad_request";

async function all<T>(op: string, args: Record<string, unknown>): Promise<T[]> {
  const out: T[] = [];
  let offset: number | null = 0;
  while (offset !== null) {
    const r = await runOperation(op, { ...args, offset, limit: 5000 }, ctx);
    const d = r.data as { items: T[]; page: { next: number | null } };
    out.push(...d.items);
    offset = d.page.next;
  }
  return out;
}

const sorted = <T>(xs: T[]) => xs.map((x) => JSON.stringify(x)).sort();
const KIND: Record<string, string> = {
  FUNC: "function",
  OBJECT: "object",
  TLS: "tls",
  NOTYPE: "other",
  IFUNC: "function",
};
const bindOf = (cls: string) =>
  /^[wWvV]$/.test(cls) ? "weak" : cls === cls.toLowerCase() && cls !== "U" ? "local" : "global";
const versioned = (s: Sym) =>
  `${s.name}${s.version ? `${s.versionHidden || !s.defined ? "@" : "@@"}${s.version}` : ""}`;

/** reax's ELF symbols of one table in llvm-nm's sysv shape (FILE and SECTION symbols are hidden by nm). */
const elfRows = (syms: Sym[], source: string) =>
  syms
    .filter((s) => s.source === source && s.kind !== "file" && s.kind !== "section")
    .map((s) => ({
      name: source === "dynsym" ? versioned(s) : s.name,
      addr: s.addr,
      size: s.defined ? s.size : null,
      kind: s.kind,
      bind: s.bind,
      section: s.defined ? s.section : "*UND*",
    }));
const nmRows = (rows: Any[]) =>
  rows.map((r) => ({
    name: r.name,
    addr: r.addr,
    size: r.size,
    kind: KIND[r.type] ?? "other",
    bind: bindOf(r.cls),
    section: r.section,
  }));

test("[+rea.tool/list_names] every fixture's symbols equal LLVM's: ELF .symtab and versioned .dynsym, Mach-O nlist per slice, PE exports and imports, wasm", async () => {
  let compared = 0;
  for (const [file, key] of Object.entries(KEY)) {
    const fmt = LAYOUT[file].format as string;
    for (const [i, k] of (key.slices as Any[]).entries()) {
      const arch = LAYOUT[file].slices[i].arch;
      const syms = await all<Sym>("inventory.symbols", { path: file, arch });
      if (fmt === "elf") {
        assert.deepStrictEqual(sorted(elfRows(syms, "symtab")), sorted(nmRows(k.symtab)), `${file} .symtab`);
        assert.deepStrictEqual(sorted(elfRows(syms, "dynsym")), sorted(nmRows(k.dynsym)), `${file} .dynsym`);
        compared += k.symtab.length + k.dynsym.length;
      } else if (fmt === "macho" || fmt === "macho-fat") {
        const got = syms.map((s) => ({ name: s.name, addr: s.addr, external: s.bind !== "local" }));
        const want = k.nm.map((r: Any) => ({ name: r.name, addr: r.addr, external: r.cls === r.cls.toUpperCase() }));
        assert.deepStrictEqual(sorted(got), sorted(want), `${file} ${arch}`);
        compared += want.length;
      } else if (fmt === "pe") {
        const base = BigInt(k.imageBase);
        const ex = syms
          .filter((s) => s.source === "export")
          .map((s) => ({ name: s.name, rva: `0x${(BigInt(s.addr!) - base).toString(16)}` }));
        assert.deepStrictEqual(
          sorted(ex),
          sorted(k.exports.map((e: Any) => ({ name: e.name ?? `#${e.ordinal}`, rva: e.rva }))),
          `${file} exports`,
        );
        const im = syms
          .filter((s) => s.source === "import" || s.source === "delay-import")
          .map((s) => ({ dll: s.library, name: s.name }));
        assert.deepStrictEqual(sorted(im), sorted(k.imports), `${file} imports`);
        compared += ex.length + im.length;
      } else {
        const fns = syms.filter((s) => s.kind === "function" && s.defined).map((s) => s.name);
        assert.deepStrictEqual(
          fns.sort(),
          k.symbols
            .filter((s: Any) => s.type === "FUNCTION")
            .map((s: Any) => s.name)
            .sort(),
          `${file} functions`,
        );
        // function addresses are where llvm-nm places them
        const at = Object.fromEntries(syms.filter((s) => s.kind === "function").map((s) => [s.name, s.addr]));
        for (const r of k.nm.filter((x: Any) => x.cls === "T")) assert.equal(at[r.name], r.addr, `${file} ${r.name}`);
        compared += fns.length;
      }
    }
  }
  assert.ok(compared >= 210, `${compared} symbols compared`);
});

test("[-rea.tool/list_names] filters narrow the list exactly; a non-binary, a bad filter and an unknown slice are refused", async () => {
  const f = "shapes-x86_64-linux-gnu.2.28-g";
  const everything = await all<Sym>("inventory.symbols", { path: f });
  const undef = await all<Sym>("inventory.symbols", { path: f, defined: "undefined" });
  assert.deepStrictEqual(
    undef,
    everything.filter((s) => !s.defined),
  );
  const fns = await all<Sym>("inventory.symbols", { path: f, kind: "function", search: "REAX", ignore_case: true });
  assert.deepStrictEqual(
    fns,
    everything.filter((s) => s.kind === "function" && s.name.toLowerCase().includes("reax")),
  );
  for (const bad of [
    { path: f, kind: "code" },
    { path: f, defined: "maybe" },
    { path: "hello-universal-macos-s", arch: "ppc" },
  ])
    await assert.rejects(runOperation("inventory.symbols", bad, ctx), refused, JSON.stringify(bad));
  const dir = mkdtempSync(join(tmpdir(), "reax-sym-"));
  try {
    writeFileSync(join(dir, "a.txt"), "text");
    await assert.rejects(runOperation("inventory.symbols", { path: "a.txt" }, { workspace: dir }), refused);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("[+rea.tool/list_procedures] procedures come from every table LLVM reads: .eh_frame FDEs (stripped ELF included), FUNC symbols, .pdata, nlist, wasm bodies", async () => {
  let compared = 0;
  for (const [file, key] of Object.entries(KEY)) {
    const fmt = LAYOUT[file].format as string;
    for (const [i, k] of (key.slices as Any[]).entries()) {
      const arch = LAYOUT[file].slices[i].arch;
      const procs = await all<Procedure>("inventory.procedures", { path: file, arch });
      const at = new Map(procs.map((p) => [p.addr, p]));
      const has = (addr: string, size: number | null, what: string) => {
        const p = at.get(addr);
        assert.ok(p, `${file} ${arch}: no procedure at ${addr} (${what})`);
        if (size) assert.equal(p.size, size, `${file} ${arch} ${addr} size (${what})`);
        compared++;
      };
      if (fmt === "elf") {
        for (const f of k.fdes) has(f.addr, f.size, "FDE");
        for (const s of [...k.symtab, ...k.dynsym])
          if (s.type === "FUNC" && s.addr && s.addr !== "0x0") has(s.addr, s.size || null, s.name);
        // nothing is invented: every procedure is an FDE or a FUNC symbol
        const known = new Set([
          ...k.fdes.map((f: Any) => f.addr),
          ...[...k.symtab, ...k.dynsym].map((s: Any) => s.addr),
        ]);
        for (const p of procs) assert.ok(known.has(p.addr), `${file}: ${p.addr} has no source in LLVM's reading`);
      } else if (fmt === "pe") {
        for (const r of k.pdata) has(r.addr, r.size, "pdata");
      } else if (fmt === "macho" || fmt === "macho-fat") {
        const text = LAYOUT[file].slices[i].sections.find((s: Any) => s.name === "__text");
        const inText = (a: string) =>
          BigInt(a) >= BigInt(text.addr) && BigInt(a) < BigInt(text.addr) + BigInt(text.size);
        const want = k.nm.filter((r: Any) => r.addr && /[Tt]/.test(r.cls) && inText(r.addr)).map((r: Any) => r.addr);
        for (const a of want) has(a, null, "nlist");
        assert.deepStrictEqual([...new Set(want)].sort(), procs.map((p) => p.addr).sort(), `${file} ${arch}`);
      } else {
        const want = k.nm.filter((r: Any) => r.cls === "T").map((r: Any) => r.addr);
        for (const a of want) has(a, null, "wasm");
      }
    }
  }
  assert.ok(compared > 120, `${compared} procedures compared`);
});

test("[-rea.tool/list_procedures] a stripped binary's procedures are found but unnamed, and say where they came from", async () => {
  const procs = await all<Procedure>("inventory.procedures", { path: "shapes-x86_64-linux-gnu.2.28-s" });
  assert.equal(procs.length, KEY["shapes-x86_64-linux-gnu.2.28-s"].slices[0].fdes.length);
  assert.ok(procs.every((p) => p.name === null && p.sources.join() === "eh_frame"));
  const r = await runOperation("inventory.procedures", { path: "shapes-x86_64-linux-gnu.2.28-s" }, ctx);
  assert.match(r.limitations.join(" "), /stripped/);
});

test("[+rea.tool/search_procedures] a search keeps exactly the named procedures that match", async () => {
  for (const f of ["shapes-x86_64-linux-gnu.2.28-g", "lib-x86_64-windows-gnu-s.dll", "hello-aarch64-macos-s"]) {
    const every = await all<Procedure>("inventory.procedures", { path: f });
    for (const q of ["reax", "main", "a"]) {
      const got = await all<Procedure>("inventory.procedures", { path: f, search: q });
      assert.deepStrictEqual(
        got,
        every.filter((p) => p.name?.includes(q)),
        `${f} ${q}`,
      );
    }
  }
});

test("[-rea.tool/search_procedures] a search over unnamed procedures says they cannot match", async () => {
  const r = await runOperation("inventory.procedures", { path: "shapes-x86_64-linux-gnu.2.28-s", search: "main" }, ctx);
  assert.equal((r.data as { page: { total: number } }).page.total, 0);
  assert.match(r.limitations.join(" "), /4 procedures have no name/);
});

test("[+rea.tool/procedure_address] [+rea.tool/procedure_info] a name gives its address, size, section and file offset, as LLVM reads them", async () => {
  const f = "shapes-x86_64-linux-gnu.2.28-g";
  for (const s of KEY[f].slices[0].symtab.filter((x: Any) => x.type === "FUNC" && x.addr)) {
    const d = (await runOperation("read.symbol", { path: f, name: s.name }, ctx)).data as Any;
    assert.equal(d.found, true, s.name);
    const sym = d.symbols.find((x: Any) => x.source === "symtab");
    assert.equal(sym.addr, s.addr, s.name);
    assert.equal(sym.size, s.size, s.name);
    assert.equal(sym.section, s.section, s.name);
    assert.equal(d.procedure.addr, s.addr);
    // the file offset follows the segment that loads it (checked against llvm-readobj in layout.test)
    const text = LAYOUT[f].slices[0].sections.find((x: Any) => x.name === s.section);
    assert.equal(sym.offset, text.offset + Number(BigInt(s.addr) - BigInt(text.addr)), s.name);
  }
  const dll = (await runOperation("read.symbol", { path: "lib-x86_64-windows-gnu-s.dll", name: "reax_add" }, ctx))
    .data as Any;
  assert.equal(
    dll.procedure.size,
    KEY["lib-x86_64-windows-gnu-s.dll"].slices[0].pdata.find((p: Any) => p.addr === dll.procedure.addr).size,
  );
  const imp = (await runOperation("read.symbol", { path: "hello-x86_64-linux-gnu.2.28-s", name: "printf" }, ctx))
    .data as Any;
  assert.equal(imp.symbols[0].defined, false);
  assert.equal(imp.symbols[0].version, "GLIBC_2.2.5");
});

test("[-rea.tool/procedure_address] [-rea.tool/procedure_info] an unknown name is not found, and name with address together is refused", async () => {
  const d = (await runOperation("read.symbol", { path: "lib-x86_64-linux-gnu.2.28-s.so", name: "reax_nope" }, ctx))
    .data as Any;
  assert.equal(d.found, false);
  assert.deepStrictEqual(d.symbols, []);
  for (const bad of [
    { path: "lib-x86_64-linux-gnu.2.28-s.so" },
    { path: "lib-x86_64-linux-gnu.2.28-s.so", name: "x", address: "0x1" },
    { path: "lib-x86_64-linux-gnu.2.28-s.so", address: "main" },
  ])
    await assert.rejects(runOperation("read.symbol", bad, ctx), refused, JSON.stringify(bad));
});

test("[+rea.tool/address_name] [+rea.tool/resolve_containing_procedure] every address inside a procedure resolves to it with the right offset", async () => {
  let n = 0;
  for (const f of [
    "shapes-x86_64-linux-gnu.2.28-g",
    "shapes-x86_64-linux-gnu.2.28-s",
    "lib-x86_64-windows-gnu-s.dll",
  ]) {
    const fmt = LAYOUT[f].format;
    const ranges: { addr: string; size: number }[] =
      fmt === "pe" ? KEY[f].slices[0].pdata : KEY[f].slices[0].fdes.filter((r: Any) => r.size > 0);
    for (const r of ranges)
      for (const delta of [0, 1, r.size - 1]) {
        const a = `0x${(BigInt(r.addr) + BigInt(delta)).toString(16)}`;
        const d = (await runOperation("read.symbol", { path: f, address: a }, ctx)).data as Any;
        assert.equal(d.procedure?.addr, r.addr, `${f} ${a}`);
        assert.equal(d.delta, delta, `${f} ${a}`);
        n++;
      }
  }
  assert.ok(n > 100, `${n} addresses resolved`);
});

test("[-rea.tool/address_name] [-rea.tool/resolve_containing_procedure] an address past every procedure, or between two, is in none", async () => {
  const f = "shapes-x86_64-linux-gnu.2.28-s";
  const fdes = KEY[f].slices[0].fdes as { addr: string; size: number }[];
  const last = fdes.at(-1)!;
  const after = `0x${(BigInt(last.addr) + BigInt(last.size)).toString(16)}`;
  const d = (await runOperation("read.symbol", { path: f, address: after }, ctx)).data as Any;
  assert.equal(d.procedure, null);
  // the gap between the first FDE's end and the next FDE's start (alignment padding)
  const gap = `0x${(BigInt(fdes[0]!.addr) + BigInt(fdes[0]!.size)).toString(16)}`;
  if (BigInt(gap) < BigInt(fdes[1]!.addr)) {
    const g = (await runOperation("read.symbol", { path: f, address: gap }, ctx)).data as Any;
    assert.equal(g.procedure, null);
  }
});

test("[+rea.tool/binary_overview] one call names each slice's architecture, kind, entry point and counts, as LLVM reads them", async () => {
  for (const [file, key] of Object.entries(KEY)) {
    const fmt = LAYOUT[file].format as string;
    const d = (await runOperation("inventory.overview", { path: file }, ctx)).data as Any;
    assert.equal(d.format, fmt);
    for (const [i, s] of (d.slices as Any[]).entries()) {
      const L = LAYOUT[file].slices[i];
      assert.equal(s.arch, L.arch, file);
      assert.equal(s.sections, L.sections.length, `${file} sections`);
      assert.equal(s.segments, L.segments.length, `${file} segments`);
      const k = key.slices[i];
      let entry: string | null = null;
      if (fmt === "elf" || fmt === "pe") entry = k.entry;
      else if (fmt !== "wasm" && k.entryoff !== null) {
        const seg = L.segments.find(
          (g: Any) => g.filesize > 0 && k.entryoff >= g.fileoff && k.entryoff < g.fileoff + g.filesize,
        );
        entry = `0x${(BigInt(seg.addr) + BigInt(k.entryoff - seg.fileoff)).toString(16)}`;
      }
      assert.equal(s.entry, entry, `${file} ${s.arch} entry`);
    }
  }
});

test("[-rea.tool/binary_overview] a file that is not a binary is refused rather than summarised", async () => {
  const dir = mkdtempSync(join(tmpdir(), "reax-ov-"));
  try {
    writeFileSync(join(dir, "x.json"), "{}");
    await assert.rejects(runOperation("inventory.overview", { path: "x.json" }, { workspace: dir }), refused);
    // the fixtures are not packed: no section reaches the 7.2 bits-per-byte mark
    const r = (await runOperation("inventory.overview", { path: "lib-x86_64-linux-gnu.2.28-s.so" }, ctx)).data as Any;
    assert.deepStrictEqual(r.slices[0].highEntropySections, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
