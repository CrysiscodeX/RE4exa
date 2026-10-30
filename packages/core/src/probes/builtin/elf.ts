// elf.info: header, interpreter, dynamic section (NEEDED, SONAME, RPATH, RUNPATH) and dynamic
// symbols, read with bounds checks from the bytes alone.

import type { Json } from "../../evidence/jcs.ts";
import { type Finding, findingKey } from "../../evidence/record.ts";
import { type AssayProbe, bytesAt, cstr, fail, NATIVE_NAME_CAP, u16, u32, u64, u64parts } from "../util.ts";

const MACHINES: Record<number, string> = {
  2: "sparc",
  3: "x86",
  8: "mips",
  20: "ppc",
  21: "ppc64",
  22: "s390",
  40: "arm",
  42: "superh",
  43: "sparcv9",
  50: "ia64",
  62: "x86-64",
  183: "aarch64",
  243: "riscv",
  247: "bpf",
  258: "loongarch",
};
const TYPES: Record<number, string> = { 0: "none", 1: "rel", 2: "exec", 3: "dyn", 4: "core" };
const SECTION_MARKERS: Record<string, string> = {
  ".go.buildinfo": "go-buildinfo",
  ".note.go.buildid": "go",
  ".gopclntab": "go",
  ".dep-v0": "rust-cargo-auditable",
  ".rustc": "rust",
};

/** Bytes of a binary read into memory for the native parsers. */
export const NATIVE_CAP = 512 * 1024 * 1024;

export interface ElfInfo {
  bits: 32 | 64;
  endian: "little" | "big";
  type: string;
  machine: string;
  entry: string;
  interpreter: string | null;
  needed: string[];
  soname: string | null;
  rpath: string | null;
  runpath: string | null;
  exports: { count: number; first: string[] };
  imports: { count: number; first: string[] };
  sections: string[];
  markers: string[];
  notes: string[];
}

interface Sec {
  name: string;
  type: number;
  addr: number;
  offset: number;
  size: number;
  link: number;
  entsize: number;
}

interface RawSec extends Omit<Sec, "name"> {
  nameOff: number;
}

/** firstN bounds the import preview; exports are kept up to NATIVE_NAME_CAP (or firstN, if larger)
 * so the verifier can check any export against the whole table. */
export function parseElf(b: Uint8Array, firstN = 64): ElfInfo {
  const exportCap = Math.max(firstN, NATIVE_NAME_CAP);
  if (!bytesAt(b, 0, [0x7f, 0x45, 0x4c, 0x46])) fail("not an ELF file");
  const cls = b[4];
  const data = b[5];
  if (cls !== 1 && cls !== 2) fail("ELF: bad class");
  if (data !== 1 && data !== 2) fail("ELF: bad data encoding");
  const is64 = cls === 2;
  const le = data === 1;
  const word = (o: number) => (is64 ? u64(b, o, le) : u32(b, o, le));
  const notes: string[] = [];
  const type = u16(b, 16, le);
  const machine = u16(b, 18, le);
  const entry = is64 ? u64parts(b, 24, le) : { hi: 0, lo: u32(b, 24, le) };
  const phoff = word(is64 ? 32 : 28);
  const shoff = word(is64 ? 40 : 32);
  const phentsize = u16(b, is64 ? 54 : 42, le);
  const phnum = u16(b, is64 ? 56 : 44, le);
  const shentsize = u16(b, is64 ? 58 : 46, le);
  let shnum = u16(b, is64 ? 60 : 48, le);
  const shstrndx = u16(b, is64 ? 62 : 50, le);

  // program headers
  const loads: { vaddr: number; offset: number; filesz: number }[] = [];
  let interp: string | null = null;
  let dyn: { offset: number; size: number } | null = null;
  if (phoff > 0 && phnum > 0) {
    if (phentsize < (is64 ? 56 : 32)) fail("ELF: program header entry too small");
    for (let i = 0; i < Math.min(phnum, 1024); i++) {
      const o = phoff + i * phentsize;
      const ptype = u32(b, o, le);
      const offset = word(o + (is64 ? 8 : 4));
      const vaddr = word(o + (is64 ? 16 : 8));
      const filesz = word(o + (is64 ? 32 : 16));
      if (ptype === 1) loads.push({ vaddr, offset, filesz });
      else if (ptype === 3 && offset < b.length) interp = cstr(b, offset, Math.min(filesz || 4096, 4096));
      else if (ptype === 2) dyn = { offset, size: filesz };
    }
  }

  // section headers
  const secs: Sec[] = [];
  if (shoff > 0 && shnum > 0 && shoff < b.length) {
    if (shentsize < (is64 ? 64 : 40)) fail("ELF: section header entry too small");
    if (shnum > 65_280) shnum = 65_280;
    const raw: RawSec[] = [];
    for (let i = 0; i < Math.min(shnum, 4096); i++) {
      const o = shoff + i * shentsize;
      raw.push({
        nameOff: u32(b, o, le),
        type: u32(b, o + 4, le),
        addr: word(o + (is64 ? 16 : 12)),
        offset: word(o + (is64 ? 24 : 16)),
        size: word(o + (is64 ? 32 : 20)),
        link: u32(b, o + (is64 ? 40 : 24), le),
        entsize: word(o + (is64 ? 56 : 36)),
      });
    }
    const strSec = raw[shstrndx];
    for (const r of raw) {
      let name = "";
      if (strSec && strSec.type !== 8 && strSec.offset + r.nameOff < b.length && r.nameOff < strSec.size)
        name = cstr(b, strSec.offset + r.nameOff, 256, strSec.offset + strSec.size);
      secs.push({ name, type: r.type, addr: r.addr, offset: r.offset, size: r.size, link: r.link, entsize: r.entsize });
    }
  } else notes.push("no section headers: symbols are not listed");

  const vaToOff = (va: number): number => {
    for (const l of loads) if (va >= l.vaddr && va < l.vaddr + l.filesz) return l.offset + (va - l.vaddr);
    for (const s of secs)
      if (s.addr !== 0 && s.type !== 8 && va >= s.addr && va < s.addr + s.size) return s.offset + (va - s.addr);
    return -1;
  };

  // dynamic section
  const dynSec = secs.find((s) => s.type === 6);
  if (!dyn && dynSec) dyn = { offset: dynSec.offset, size: dynSec.size };
  const needed: string[] = [];
  let soname: string | null = null;
  let rpath: string | null = null;
  let runpath: string | null = null;
  if (dyn) {
    const esz = is64 ? 16 : 8;
    const tags: { tag: number; val: number }[] = [];
    let strtab = -1;
    let strsz = 0;
    for (let i = 0; i < Math.min(Math.floor(dyn.size / esz), 8192); i++) {
      const o = dyn.offset + i * esz;
      const t = is64 ? u64parts(b, o, le) : { hi: 0, lo: u32(b, o, le) };
      const v = is64 ? u64parts(b, o + 8, le) : { hi: 0, lo: u32(b, o + 4, le) };
      if (t.hi === 0 && t.lo === 0) break;
      const val = v.hi > 0x1fffff ? -1 : v.hi * 0x100000000 + v.lo;
      if (t.hi !== 0) continue;
      if (t.lo === 5) strtab = val;
      else if (t.lo === 10) strsz = val;
      tags.push({ tag: t.lo, val });
    }
    let strOff = strtab >= 0 ? vaToOff(strtab) : -1;
    if (strOff < 0 && dynSec && secs[dynSec.link]) strOff = secs[dynSec.link]!.offset;
    if (strOff < 0) notes.push("dynamic string table not mapped: library names unavailable");
    const str = (v: number): string | null =>
      strOff >= 0 && v >= 0 && strOff + v < b.length
        ? cstr(b, strOff + v, 4096, strsz > 0 ? strOff + strsz : b.length)
        : null;
    for (const t of tags) {
      if (t.tag === 1) {
        const s = str(t.val);
        if (s !== null && needed.length < 4096) needed.push(s);
      } else if (t.tag === 14) soname = str(t.val);
      else if (t.tag === 15) rpath = str(t.val);
      else if (t.tag === 29) runpath = str(t.val);
    }
  }

  // dynamic symbols
  const exports: string[] = [];
  const imports: string[] = [];
  let nExp = 0;
  let nImp = 0;
  const dynsym = secs.find((s) => s.type === 11);
  if (dynsym && secs[dynsym.link]) {
    const strs = secs[dynsym.link]!;
    const esz = is64 ? 24 : 16;
    const count = Math.min(Math.floor(dynsym.size / esz), 1_000_000);
    for (let i = 1; i < count; i++) {
      const o = dynsym.offset + i * esz;
      const nameOff = u32(b, o, le);
      const info = b[o + (is64 ? 4 : 12)];
      const shndx = u16(b, o + (is64 ? 6 : 14), le);
      if (info === undefined) fail("ELF: symbol past end");
      const bind = info >> 4;
      if (nameOff === 0 || nameOff >= strs.size) continue;
      const name = cstr(b, strs.offset + nameOff, 1024, strs.offset + strs.size);
      if (shndx === 0) {
        nImp++;
        if (imports.length < firstN) imports.push(name);
      } else if (bind === 1 || bind === 2 || bind === 10) {
        nExp++;
        if (exports.length < exportCap) exports.push(name);
      }
    }
  }
  const markers = [...new Set(secs.map((s) => SECTION_MARKERS[s.name]).filter((m): m is string => !!m))].sort();
  const typeName = type === 3 && interp ? "pie" : (TYPES[type] ?? `0x${type.toString(16)}`);
  return {
    bits: is64 ? 64 : 32,
    endian: le ? "little" : "big",
    type: typeName,
    machine: MACHINES[machine] ?? `0x${machine.toString(16)}`,
    entry: `0x${(entry.hi * 0x100000000 + entry.lo).toString(16)}`,
    interpreter: interp,
    needed,
    soname,
    rpath,
    runpath,
    exports: { count: nExp, first: exports },
    imports: { count: nImp, first: imports },
    sections: secs.slice(0, 128).map((s) => s.name),
    markers,
    notes,
  };
}

export function libFindings(libs: string[]): Finding[] {
  return [...new Set(libs)]
    .sort()
    .map((lib) => ({ key: findingKey("native.lib", { lib }), class: "native.lib", label: lib }));
}

export const elfInfo: AssayProbe = {
  id: "elf.info",
  version: "2", // 2: export names kept up to NATIVE_NAME_CAP, so large libraries can be verified
  predicate: "elf.info",
  summary: "ELF class, machine, type, interpreter, NEEDED libraries, RPATH/RUNPATH, dynamic symbols",
  appliesTo: (i) => i.format === "elf",
  platforms: ["linux", "darwin", "win32"],
  cost: "cheap",
  confidence: "observed",
  sweep: ["each"],
  async run(ctx) {
    const b = await ctx.read(undefined, NATIVE_CAP);
    const info = parseElf(b);
    return {
      result: info as unknown as Json,
      findings: libFindings(info.needed),
      limitations: [
        "libraries loaded with dlopen at run time are not in the dynamic section",
        ...info.notes,
        ...(ctx.subject.size > NATIVE_CAP ? [`only the first ${NATIVE_CAP} bytes were read`] : []),
      ],
    };
  },
};
