// The symbols of a native binary, and its procedures (function starts and sizes), from the file's
// own tables:
// - ELF: .symtab and .dynsym (with GNU symbol versions), and .eh_frame FDEs, which give function
//   ranges even in a stripped binary;
// - PE: the export directory, the import directory (each function's import-table slot) and, on
//   x64, .pdata, whose RUNTIME_FUNCTION entries give every non-leaf function's exact range;
// - Mach-O: the LC_SYMTAB nlist entries (debugger stabs skipped, as nm does), the library of each
//   undefined symbol (two-level namespace), and LC_FUNCTION_STARTS;
// - WebAssembly: imports, exports, the "name" section and the code section's function bodies.
// Checked against llvm-nm, llvm-readobj and llvm-dwarfdump (bench/oracle/symbols.json).
import { type LayoutSlice, layout } from "./layout.ts";

export interface Sym {
  name: string;
  /** Hex address (wasm: the function body's file offset), or null when undefined. */
  addr: string | null;
  /** Bytes, where the format records a size. */
  size: number | null;
  kind: "function" | "object" | "tls" | "section" | "file" | "other";
  bind: "local" | "global" | "weak";
  defined: boolean;
  section: string | null;
  /** Where it was read: symtab, dynsym, nlist, export, import, wasm-name. */
  source: string;
  /** ELF: the symbol version (GLIBC_2.2.5); hidden marks a non-default version (name@VER). */
  version: string | null;
  versionHidden: boolean;
  /** PE import: its DLL. Mach-O undefined: the dylib that provides it. */
  library: string | null;
}

export interface Procedure {
  addr: string;
  /** Bytes, where known; from the symbol, the unwind entry, or the distance to the next start. */
  size: number | null;
  name: string | null;
  /** Every table that names this start: symtab, dynsym, eh_frame, pdata, export, nlist, function-starts, wasm-code. */
  sources: string[];
  section: string | null;
}

export interface SymbolSlice {
  arch: string;
  symbols: Sym[];
  procedures: Procedure[];
  notes: string[];
}

const hex = (v: bigint | number) => `0x${v.toString(16)}`;

class R {
  readonly b: Uint8Array;
  readonly dv: DataView;
  readonly le: boolean;
  constructor(b: Uint8Array, le: boolean) {
    this.b = b;
    this.le = le;
    this.dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  }
  ok(o: number, n: number) {
    return o >= 0 && n >= 0 && o + n <= this.b.length;
  }
  u8(o: number) {
    return this.dv.getUint8(o);
  }
  u16(o: number) {
    return this.dv.getUint16(o, this.le);
  }
  i32(o: number) {
    return this.dv.getInt32(o, this.le);
  }
  u32(o: number) {
    return this.dv.getUint32(o, this.le);
  }
  u64(o: number) {
    return this.dv.getBigUint64(o, this.le);
  }
  cstr(o: number, end = this.b.length): string {
    let e = o;
    while (e < end && e < this.b.length && this.b[e] !== 0) e++;
    return new TextDecoder("utf-8").decode(this.b.subarray(o, e));
  }
}

function uleb(b: Uint8Array, o: number): { v: number; n: number } {
  let v = 0;
  let shift = 0;
  for (let i = 0; i < 10 && o + i < b.length; i++) {
    const x = b[o + i]!;
    v += (x & 0x7f) * 2 ** shift;
    if ((x & 0x80) === 0) return { v, n: i + 1 };
    shift += 7;
  }
  throw new Error("a LEB128 number runs past its table");
}

/** Procedures from several tables, one per start address, sizes from the most direct source. */
function mergeProcedures(
  entries: { addr: bigint; size: number | null; name: string | null; source: string; section?: string | null }[],
  sectionOf: (a: bigint) => { name: string; end: bigint } | null,
): Procedure[] {
  const by = new Map<bigint, Procedure & { _a: bigint }>();
  for (const e of entries) {
    const p = by.get(e.addr);
    if (!p) {
      by.set(e.addr, {
        _a: e.addr,
        addr: hex(e.addr),
        size: e.size,
        name: e.name,
        sources: [e.source],
        section: e.section ?? sectionOf(e.addr)?.name ?? null,
      });
      continue;
    }
    if (!p.sources.includes(e.source)) p.sources.push(e.source);
    if (p.name === null && e.name) p.name = e.name;
    if ((p.size === null || p.size === 0) && e.size) p.size = e.size;
  }
  const sorted = [...by.values()].sort((a, b) => (a._a < b._a ? -1 : a._a > b._a ? 1 : 0));
  // a start with no recorded size runs to the next start or to the end of its section
  for (let i = 0; i < sorted.length; i++) {
    const p = sorted[i]!;
    if (p.size !== null && p.size > 0) continue;
    const sec = sectionOf(p._a);
    const next = sorted[i + 1]?._a;
    const end = sec ? (next !== undefined && next < sec.end ? next : sec.end) : next;
    if (end !== undefined && end > p._a) p.size = Number(end - p._a);
  }
  return sorted.map(({ _a, ...p }) => p);
}

function sectionFinder(s: LayoutSlice) {
  const secs = s.sections
    .filter((x) => x.addr !== null && x.size > 0)
    .map((x) => ({ name: x.name, start: BigInt(x.addr!), end: BigInt(x.addr!) + BigInt(x.size) }));
  return (a: bigint) => secs.find((x) => a >= x.start && a < x.end) ?? null;
}

// ------------------------------------------------------------------------------------------- ELF

const ELF_KIND: Record<number, Sym["kind"]> = {
  1: "object",
  2: "function",
  3: "section",
  4: "file",
  6: "tls",
  10: "function",
};

interface ElfSec {
  name: string;
  type: number;
  addr: bigint;
  offset: number;
  size: number;
  link: number;
  entsize: number;
}

function elfSections(r: R, is64: boolean): ElfSec[] {
  const word = (o: number) => (is64 ? r.u64(o) : BigInt(r.u32(o)));
  const shoff = Number(word(is64 ? 40 : 32));
  const shentsize = r.u16(is64 ? 58 : 46);
  let shnum = r.u16(is64 ? 60 : 48);
  let shstrndx = r.u16(is64 ? 62 : 50);
  if (!shoff || !r.ok(shoff, is64 ? 64 : 40)) return [];
  if (shnum === 0) shnum = Number(word(shoff + (is64 ? 32 : 20)));
  if (shstrndx === 0xffff) shstrndx = r.u32(shoff + (is64 ? 40 : 24));
  const raw: (ElfSec & { nameOff: number })[] = [];
  for (let i = 0; i < Math.min(shnum, 65_536); i++) {
    const o = shoff + i * shentsize;
    if (!r.ok(o, is64 ? 64 : 40)) break;
    raw.push({
      nameOff: r.u32(o),
      name: "",
      type: r.u32(o + 4),
      addr: word(o + (is64 ? 16 : 12)),
      offset: Number(word(o + (is64 ? 24 : 16))),
      size: Number(word(o + (is64 ? 32 : 20))),
      link: r.u32(o + (is64 ? 40 : 24)),
      entsize: Number(word(o + (is64 ? 56 : 36))),
    });
  }
  const str = raw[shstrndx];
  for (const s of raw) if (str && s.nameOff < str.size) s.name = r.cstr(str.offset + s.nameOff, str.offset + str.size);
  return raw;
}

/** GNU symbol versions for .dynsym: index -> [name, hidden]. */
function elfVersions(r: R, secs: ElfSec[], dynsymCount: number): ([string, boolean] | null)[] {
  const versym = secs.find((s) => s.type === 0x6fffffff);
  if (!versym) return [];
  const names = new Map<number, string>();
  for (const s of secs) {
    const strtab = secs[s.link];
    if (!strtab) continue;
    const str = (o: number) => r.cstr(strtab.offset + o, strtab.offset + strtab.size);
    if (s.type === 0x6ffffffe) {
      // verneed: what this file needs from each library
      let o = s.offset;
      for (let i = 0; i < 4096 && r.ok(o, 16); i++) {
        const cnt = r.u16(o + 2);
        let a = o + r.u32(o + 8);
        for (let k = 0; k < cnt && r.ok(a, 16); k++) {
          names.set(r.u16(a + 6) & 0x7fff, str(r.u32(a + 8)));
          const next = r.u32(a + 12);
          if (!next) break;
          a += next;
        }
        const next = r.u32(o + 12);
        if (!next) break;
        o += next;
      }
    } else if (s.type === 0x6ffffffd) {
      // verdef: the versions this file defines
      let o = s.offset;
      for (let i = 0; i < 4096 && r.ok(o, 20); i++) {
        const flags = r.u16(o + 2);
        const ndx = r.u16(o + 4);
        const aux = o + r.u32(o + 12);
        if (r.ok(aux, 8) && (flags & 1) === 0) names.set(ndx & 0x7fff, str(r.u32(aux)));
        const next = r.u32(o + 16);
        if (!next) break;
        o += next;
      }
    }
  }
  const out: ([string, boolean] | null)[] = [];
  for (let i = 0; i < dynsymCount; i++) {
    const o = versym.offset + i * 2;
    if (!r.ok(o, 2)) break;
    const v = r.u16(o);
    const idx = v & 0x7fff;
    out.push(idx >= 2 && names.has(idx) ? [names.get(idx)!, (v & 0x8000) !== 0] : null);
  }
  return out;
}

function elfSymbols(b: Uint8Array, s: LayoutSlice): SymbolSlice {
  const is64 = b[4] === 2;
  const r = new R(b, b[5] !== 2);
  const notes: string[] = [];
  const secs = elfSections(r, is64);
  const symbols: Sym[] = [];
  for (const tab of secs.filter((x) => x.type === 2 || x.type === 11)) {
    const strtab = secs[tab.link];
    const ent = is64 ? 24 : 16;
    if (!strtab || tab.entsize < ent) {
      notes.push(`${tab.name || "a symbol table"} has no string table or a short entry size`);
      continue;
    }
    const count = Math.floor(tab.size / tab.entsize);
    const versions = tab.type === 11 ? elfVersions(r, secs, count) : [];
    for (let i = 1; i < count; i++) {
      const o = tab.offset + i * tab.entsize;
      if (!r.ok(o, ent)) {
        notes.push(`${tab.name} is cut after ${i} of ${count} entries`);
        break;
      }
      const nameOff = r.u32(o);
      const info = is64 ? r.u8(o + 4) : r.u8(o + 12);
      const shndx = is64 ? r.u16(o + 6) : r.u16(o + 14);
      const value = is64 ? r.u64(o + 8) : BigInt(r.u32(o + 4));
      const size = is64 ? Number(r.u64(o + 16)) : r.u32(o + 8);
      const type = info & 0xf;
      const bind = info >> 4;
      const defined = shndx !== 0;
      const v = versions[i] ?? null;
      symbols.push({
        name: nameOff < strtab.size ? r.cstr(strtab.offset + nameOff, strtab.offset + strtab.size) : "",
        addr: defined ? hex(value) : null,
        size: defined ? size : null,
        kind: ELF_KIND[type] ?? "other",
        bind: bind === 0 ? "local" : bind === 2 ? "weak" : "global",
        defined,
        section:
          shndx === 0xfff1
            ? "*ABS*"
            : shndx === 0xfff2
              ? "*COM*"
              : shndx > 0 && shndx < 0xff00
                ? (secs[shndx]?.name ?? null)
                : null,
        source: tab.type === 2 ? "symtab" : "dynsym",
        version: v?.[0] ?? null,
        versionHidden: v?.[1] ?? false,
        library: null,
      });
    }
  }
  if (!secs.some((x) => x.type === 2)) notes.push("no .symtab (stripped): only dynamic symbols and unwind ranges");
  const procs: Parameters<typeof mergeProcedures>[0] = symbols
    .filter((x) => x.kind === "function" && x.defined && x.addr !== null && x.addr !== "0x0")
    .map((x) => ({ addr: BigInt(x.addr!), size: x.size, name: x.name, source: x.source, section: x.section }));
  const eh = secs.find((x) => x.name === ".eh_frame" && x.type !== 8);
  if (eh) {
    try {
      for (const f of ehFrame(r, eh, is64)) procs.push({ addr: f.start, size: f.size, name: null, source: "eh_frame" });
    } catch (e) {
      notes.push(`.eh_frame could not be read to its end: ${(e as Error).message}`);
    }
  }
  return { arch: s.arch, symbols, procedures: mergeProcedures(procs, sectionFinder(s)), notes };
}

/** Each FDE's [start, size) in .eh_frame (the pointer encodings its CIE names). */
function ehFrame(r: R, sec: ElfSec, is64: boolean): { start: bigint; size: number }[] {
  const out: { start: bigint; size: number }[] = [];
  const cieEnc = new Map<number, number>();
  const end = sec.offset + sec.size;
  let o = sec.offset;
  const ptr = (p: number, enc: number): { v: bigint; n: number } => {
    const fmt = enc & 0x0f;
    let v: bigint;
    let n: number;
    switch (fmt) {
      case 0x00:
        v = is64 ? r.u64(p) : BigInt(r.u32(p));
        n = is64 ? 8 : 4;
        break;
      case 0x02:
        v = BigInt(r.u16(p));
        n = 2;
        break;
      case 0x03:
        v = BigInt(r.u32(p));
        n = 4;
        break;
      case 0x04:
        v = r.u64(p);
        n = 8;
        break;
      case 0x0a:
        v = BigInt(r.dv.getInt16(p, r.le));
        n = 2;
        break;
      case 0x0b:
        v = BigInt(r.i32(p));
        n = 4;
        break;
      case 0x0c:
        v = r.dv.getBigInt64(p, r.le);
        n = 8;
        break;
      default:
        throw new Error(`pointer encoding 0x${enc.toString(16)} is not read yet`);
    }
    // pc-relative: from the address of the field itself
    if ((enc & 0x70) === 0x10) v += sec.addr + BigInt(p - sec.offset);
    return { v, n };
  };
  while (o + 4 <= end) {
    let len = r.u32(o);
    if (len === 0) break; // terminator
    let hdr = 4;
    if (len === 0xffffffff) {
      len = Number(r.u64(o + 4));
      hdr = 12;
    }
    const body = o + hdr;
    const next = body + len;
    if (next > end) throw new Error("an entry runs past the section");
    const id = r.u32(body);
    if (id === 0) {
      // CIE: version, augmentation string, code/data alignment, return register, augmentation data
      let p = body + 5;
      const aug = r.cstr(p, next);
      p += aug.length + 1;
      p += uleb(r.b, p).n; // code alignment
      p += uleb(r.b, p).n; // data alignment (sleb; length is what matters)
      p += r.u8(body + 4) === 1 ? 1 : uleb(r.b, p).n; // return address register
      let enc = 0x00;
      if (aug.startsWith("z")) {
        p += uleb(r.b, p).n;
        for (const c of aug.slice(1)) {
          if (c === "R") enc = r.u8(p++);
          else if (c === "P") {
            const penc = r.u8(p++);
            p += ptr(p, penc & 0x0f).n;
          } else if (c === "L") p++;
          else if (c === "S" || c === "B") {
            // no data
          } else break;
        }
      }
      cieEnc.set(o, enc);
    } else {
      const cie = body - id;
      const enc = cieEnc.get(cie) ?? 0x00;
      const start = ptr(body + 4, enc);
      const range = ptr(body + 4 + start.n, enc & 0x0f);
      out.push({ start: start.v, size: Number(range.v) });
    }
    o = next;
  }
  return out;
}

// -------------------------------------------------------------------------------------------- PE

function peSymbols(b: Uint8Array, s: LayoutSlice): SymbolSlice {
  const r = new R(b, true);
  const notes: string[] = [];
  const pe = r.u32(0x3c);
  const opt = pe + 24;
  const plus = r.u16(opt) === 0x20b;
  const machine = r.u16(pe + 4);
  const base = BigInt(s.imageBase ?? "0x0");
  const dirs = opt + (plus ? 112 : 96);
  const ndirs = r.u32(opt + (plus ? 108 : 92));
  const dir = (i: number) =>
    i < ndirs && r.ok(dirs + i * 8, 8)
      ? { rva: r.u32(dirs + i * 8), size: r.u32(dirs + i * 8 + 4) }
      : { rva: 0, size: 0 };
  const secs = s.sections.map((x) => ({
    name: x.name,
    rva: Number(BigInt(x.addr!) - base),
    vsize: x.size,
    raw: x.offset ?? 0,
    rawSize: x.fileSize,
  }));
  const off = (rva: number): number | null => {
    for (const x of secs)
      if (rva >= x.rva && rva < x.rva + Math.max(x.vsize, x.rawSize) && rva - x.rva < x.rawSize)
        return x.raw + (rva - x.rva);
    return null;
  };
  const sectionAt = (rva: number) =>
    secs.find((x) => rva >= x.rva && rva < x.rva + Math.max(x.vsize, x.rawSize))?.name ?? null;
  const symbols: Sym[] = [];
  const procs: Parameters<typeof mergeProcedures>[0] = [];
  // exports
  const ex = dir(0);
  const eo = ex.rva ? off(ex.rva) : null;
  if (eo !== null && r.ok(eo, 40)) {
    const ordBase = r.u32(eo + 16);
    const nfun = r.u32(eo + 20);
    const nnames = r.u32(eo + 24);
    const funs = off(r.u32(eo + 28));
    const names = off(r.u32(eo + 32));
    const ords = off(r.u32(eo + 36));
    const named = new Map<number, string>();
    if (names !== null && ords !== null)
      for (let i = 0; i < Math.min(nnames, 1_000_000); i++) {
        if (!r.ok(names + i * 4, 4) || !r.ok(ords + i * 2, 2)) break;
        const no = off(r.u32(names + i * 4));
        if (no !== null) named.set(r.u16(ords + i * 2), r.cstr(no));
      }
    if (funs !== null)
      for (let i = 0; i < Math.min(nfun, 1_000_000); i++) {
        if (!r.ok(funs + i * 4, 4)) break;
        const rva = r.u32(funs + i * 4);
        if (rva === 0) continue;
        const forwarded = rva >= ex.rva && rva < ex.rva + ex.size;
        const fo = forwarded ? off(rva) : null;
        const sec = sectionAt(rva);
        const code = secs.find((x) => x.name === sec);
        const isCode = s.sections.find((x) => x.name === sec)?.kind === "code";
        symbols.push({
          name: named.get(i) ?? `#${ordBase + i}`,
          addr: forwarded ? null : hex(base + BigInt(rva)),
          size: null,
          kind: forwarded ? "other" : isCode ? "function" : "object",
          bind: "global",
          defined: !forwarded,
          section: forwarded ? null : sec,
          source: "export",
          version: null,
          versionHidden: false,
          library: forwarded && fo !== null ? r.cstr(fo) : null,
        });
        if (!forwarded && isCode && code)
          procs.push({ addr: base + BigInt(rva), size: null, name: named.get(i) ?? null, source: "export" });
      }
  }
  // imports: each function's slot in the import address table
  const ptrSize = plus ? 8 : 4;
  const im = dir(1);
  let io = im.rva ? off(im.rva) : null;
  for (let d = 0; io !== null && d < 4096 && r.ok(io, 20); d++, io += 20) {
    const ilt = r.u32(io);
    const nameRva = r.u32(io + 12);
    const iat = r.u32(io + 16);
    if (!ilt && !nameRva && !iat) break;
    const no = off(nameRva);
    const dll = no !== null ? r.cstr(no) : "";
    const lookup = off(ilt || iat);
    if (lookup === null) continue;
    for (let i = 0; i < 1_000_000; i++) {
      const p = lookup + i * ptrSize;
      if (!r.ok(p, ptrSize)) break;
      const e = plus ? r.u64(p) : BigInt(r.u32(p));
      if (e === 0n) break;
      const byOrdinal = plus ? (e & (1n << 63n)) !== 0n : (e & 0x80000000n) !== 0n;
      let name: string;
      if (byOrdinal) name = `#${Number(e & 0xffffn)}`;
      else {
        const hn = off(Number(e & 0x7fffffffn));
        name = hn !== null ? r.cstr(hn + 2) : "";
      }
      symbols.push({
        name,
        addr: null,
        size: null,
        kind: "function",
        bind: "global",
        defined: false,
        section: null,
        source: "import",
        version: null,
        versionHidden: false,
        library: dll,
      });
    }
  }
  // delay-load imports: 32-byte descriptors; their name table has the same entries as the above
  const dl = dir(13);
  let dio = dl.rva ? off(dl.rva) : null;
  for (let d = 0; dio !== null && d < 4096 && r.ok(dio, 32); d++, dio += 32) {
    const attrs = r.u32(dio);
    const nameRva = r.u32(dio + 4);
    const intRva = r.u32(dio + 16);
    if (!nameRva && !intRva) break;
    // version 1 descriptors hold RVAs (attribute bit 0); older ones hold addresses
    const rvaOf = (x: number) => (attrs & 1 ? x : Number(BigInt(x) - base));
    const no = off(rvaOf(nameRva));
    const dll = no !== null ? r.cstr(no) : "";
    const lookup = off(rvaOf(intRva));
    if (lookup === null) continue;
    for (let i = 0; i < 1_000_000; i++) {
      const q = lookup + i * ptrSize;
      if (!r.ok(q, ptrSize)) break;
      const e = plus ? r.u64(q) : BigInt(r.u32(q));
      if (e === 0n) break;
      const byOrdinal = plus ? (e & (1n << 63n)) !== 0n : (e & 0x80000000n) !== 0n;
      const hn = byOrdinal ? null : off(rvaOf(Number(e & 0x7fffffffn)));
      symbols.push({
        name: byOrdinal ? `#${Number(e & 0xffffn)}` : hn !== null ? r.cstr(hn + 2) : "",
        addr: null,
        size: null,
        kind: "function",
        bind: "global",
        defined: false,
        section: null,
        source: "delay-import",
        version: null,
        versionHidden: false,
        library: dll,
      });
    }
  }
  // .pdata (x64 and Itanium-style 12-byte RUNTIME_FUNCTION entries)
  const pd = dir(3);
  const po = pd.rva ? off(pd.rva) : null;
  if (po !== null && pd.size) {
    if (machine === 0x8664) {
      for (let i = 0; i < Math.floor(pd.size / 12); i++) {
        const p = po + i * 12;
        if (!r.ok(p, 12)) break;
        const begin = r.u32(p);
        const end = r.u32(p + 4);
        if (begin === 0 && end === 0) continue;
        procs.push({ addr: base + BigInt(begin), size: end > begin ? end - begin : null, name: null, source: "pdata" });
      }
    } else notes.push(`.pdata for machine 0x${machine.toString(16)} is not read yet; only exports give procedures`);
  }
  if (!pe || !r.ok(pe, 4)) notes.push("no PE header");
  notes.push("the COFF symbol table, when present, is not read yet");
  return { arch: s.arch, symbols, procedures: mergeProcedures(procs, sectionFinder(s)), notes };
}

// ---------------------------------------------------------------------------------------- Mach-O

function machoSymbols(all: Uint8Array, s: LayoutSlice, size: number): SymbolSlice {
  const b = all.subarray(s.base, s.base + size);
  const magic = new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(0, false);
  const le = magic === 0xcefaedfe || magic === 0xcffaedfe;
  const is64 = magic === 0xcffaedfe || magic === 0xfeedfacf;
  const r = new R(b, le);
  const notes: string[] = [];
  const ncmds = r.u32(16);
  let o = is64 ? 32 : 28;
  const dylibs: string[] = [];
  let symtab: { symoff: number; nsyms: number; stroff: number; strsize: number } | null = null;
  let starts: { off: number; size: number } | null = null;
  for (let i = 0; i < ncmds && r.ok(o, 8); i++) {
    const cmd = r.u32(o);
    const cmdsize = r.u32(o + 4);
    if (cmdsize < 8) break;
    if ([0xc, 0x80000018, 0x8000001f, 0x20, 0x80000023].includes(cmd))
      dylibs.push(r.cstr(o + r.u32(o + 8), o + cmdsize));
    else if (cmd === 0x2)
      symtab = { symoff: r.u32(o + 8), nsyms: r.u32(o + 12), stroff: r.u32(o + 16), strsize: r.u32(o + 20) };
    else if (cmd === 0x26) starts = { off: r.u32(o + 8), size: r.u32(o + 12) };
    o += cmdsize;
  }
  const sects = s.sections; // n_sect is 1-based over every section, in load-command order
  const symbols: Sym[] = [];
  if (symtab) {
    const ent = is64 ? 16 : 12;
    for (let i = 0; i < symtab.nsyms; i++) {
      const p = symtab.symoff + i * ent;
      if (!r.ok(p, ent)) {
        notes.push(`the symbol table is cut after ${i} of ${symtab.nsyms} entries`);
        break;
      }
      const strx = r.u32(p);
      const type = r.u8(p + 4);
      const sect = r.u8(p + 5);
      const desc = r.u16(p + 6);
      const value = is64 ? r.u64(p + 8) : BigInt(r.u32(p + 8));
      if (type & 0xe0) continue; // a debugger (stab) entry
      const t = type & 0x0e;
      const defined = t !== 0x0 || value !== 0n; // N_UNDF with a value is a common symbol
      const sec = t === 0x0e ? sects[sect - 1] : undefined;
      const code = sec ? (sec.flags & 0x800004) !== 0 : false;
      const ord = (desc >> 8) & 0xff;
      symbols.push({
        name: strx < symtab.strsize ? r.cstr(symtab.stroff + strx, symtab.stroff + symtab.strsize) : "",
        addr: defined ? hex(value) : null,
        size: null,
        kind: code ? "function" : t === 0x0e ? "object" : "other",
        bind: type & 0x01 ? (desc & 0x80 ? "weak" : "global") : "local",
        defined,
        section: sec ? `${sec.segment},${sec.name}` : t === 0x02 ? "*ABS*" : null,
        source: "nlist",
        version: null,
        versionHidden: false,
        library: !defined && ord > 0 && ord <= dylibs.length ? dylibs[ord - 1]! : null,
      });
    }
  } else notes.push("no LC_SYMTAB");
  // a procedure lies inside an instruction section: __mh_execute_header names __text as its
  // section but sits at the start of __TEXT, before it
  const textSecs = { ...s, sections: s.sections.filter((x) => (x.flags & 0x800004) !== 0) };
  const inText = sectionFinder(textSecs);
  const procs: Parameters<typeof mergeProcedures>[0] = symbols
    .filter((x) => x.kind === "function" && x.defined && inText(BigInt(x.addr!)) !== null)
    .map((x) => ({ addr: BigInt(x.addr!), size: null, name: x.name, source: "nlist" }));
  if (starts && starts.size > 0) {
    // ULEB deltas from the start of __TEXT
    const text = s.segments.find((g) => g.name === "__TEXT");
    let a = text?.addr ? BigInt(text.addr) : 0n;
    let p = starts.off;
    const end = starts.off + starts.size;
    try {
      while (p < end) {
        const d = uleb(r.b, p);
        p += d.n;
        if (d.v === 0) break;
        a += BigInt(d.v);
        procs.push({ addr: a, size: null, name: null, source: "function-starts" });
      }
    } catch (e) {
      notes.push(`LC_FUNCTION_STARTS: ${(e as Error).message}`);
    }
  }
  return { arch: s.arch, symbols, procedures: mergeProcedures(procs, inText), notes };
}

// ------------------------------------------------------------------------------------------ wasm

function wasmSymbols(b: Uint8Array, s: LayoutSlice): SymbolSlice {
  const notes: string[] = [];
  const symbols: Sym[] = [];
  const name = (p: number): { s: string; n: number } => {
    const l = uleb(b, p);
    return { s: new TextDecoder("utf-8").decode(b.subarray(p + l.n, p + l.n + l.v)), n: l.n + l.v };
  };
  let importedFuncs = 0;
  const exportNames = new Map<number, string>();
  const names = new Map<number, string>();
  const bodies: { offset: number; size: number }[] = [];
  for (const sec of s.sections) {
    let p = sec.offset!;
    const end = p + sec.fileSize;
    try {
      if (sec.type === 2) {
        const count = uleb(b, p);
        p += count.n;
        for (let i = 0; i < count.v && p < end; i++) {
          const mod = name(p);
          p += mod.n;
          const field = name(p);
          p += field.n;
          const kind = b[p++]!;
          if (kind === 0) {
            p += uleb(b, p).n;
            importedFuncs++;
          } else if (kind === 1) {
            p++;
            const f = b[p++]!;
            p += uleb(b, p).n;
            if (f & 1) p += uleb(b, p).n;
          } else if (kind === 2) {
            const f = b[p++]!;
            p += uleb(b, p).n;
            if (f & 1) p += uleb(b, p).n;
          } else if (kind === 3) p += 2;
          else if (kind === 4) {
            p++;
            p += uleb(b, p).n;
          } else throw new Error(`import kind ${kind}`);
          symbols.push({
            name: field.s,
            addr: null,
            size: null,
            kind: kind === 0 ? "function" : kind === 3 ? "object" : "other",
            bind: "global",
            defined: false,
            section: null,
            source: "import",
            version: null,
            versionHidden: false,
            library: mod.s,
          });
        }
      } else if (sec.type === 7) {
        const count = uleb(b, p);
        p += count.n;
        for (let i = 0; i < count.v && p < end; i++) {
          const n = name(p);
          p += n.n;
          const kind = b[p++]!;
          const idx = uleb(b, p);
          p += idx.n;
          if (kind === 0) exportNames.set(idx.v, n.s);
          else
            symbols.push({
              name: n.s,
              addr: null,
              size: null,
              kind: kind === 3 ? "object" : "other",
              bind: "global",
              defined: true,
              section: kind === 3 ? "GLOBAL" : kind === 2 ? "MEMORY" : kind === 1 ? "TABLE" : null,
              source: "export",
              version: null,
              versionHidden: false,
              library: null,
            });
        }
      } else if (sec.type === 10) {
        const count = uleb(b, p);
        p += count.n;
        for (let i = 0; i < count.v && p < end; i++) {
          // a function starts at its size field, as LLVM places wasm function symbols
          const sz = uleb(b, p);
          bodies.push({ offset: p, size: sz.n + sz.v });
          p += sz.n + sz.v;
        }
      } else if (sec.type === 0 && sec.name === "name") {
        const nm = name(p);
        p += nm.n;
        while (p < end) {
          const id = b[p++]!;
          const len = uleb(b, p);
          p += len.n;
          const subEnd = p + len.v;
          if (id === 1) {
            const count = uleb(b, p);
            let q = p + count.n;
            for (let i = 0; i < count.v && q < subEnd; i++) {
              const idx = uleb(b, q);
              q += idx.n;
              const n = name(q);
              q += n.n;
              names.set(idx.v, n.s);
            }
          }
          p = subEnd;
        }
      }
    } catch (e) {
      notes.push(`${sec.name}: ${(e as Error).message}`);
    }
  }
  const procedures: Procedure[] = [];
  bodies.forEach((body, i) => {
    const idx = importedFuncs + i;
    const nm = names.get(idx) ?? exportNames.get(idx) ?? null;
    if (nm !== null)
      symbols.push({
        name: nm,
        addr: hex(body.offset),
        size: body.size,
        kind: "function",
        bind: exportNames.has(idx) ? "global" : "local",
        defined: true,
        section: "CODE",
        source: names.has(idx) ? "wasm-name" : "export",
        version: null,
        versionHidden: false,
        library: null,
      });
    procedures.push({ addr: hex(body.offset), size: body.size, name: nm, sources: ["wasm-code"], section: "CODE" });
  });
  notes.push(
    "wasm addresses are file offsets of each function's entry in the code section (its size field, as LLVM places them); data symbols have no address",
  );
  return { arch: s.arch, symbols, procedures, notes };
}

/** Symbols and procedures of every slice. */
export function symbols(b: Uint8Array, format: string): SymbolSlice[] {
  const slices = layout(b, format);
  switch (format) {
    case "elf":
      return [elfSymbols(b, slices[0]!)];
    case "pe":
      return [peSymbols(b, slices[0]!)];
    case "macho":
    case "macho-fat": {
      const be = new DataView(b.buffer, b.byteOffset, b.byteLength);
      const fat = be.getUint32(0, false) === 0xcafebabe || be.getUint32(0, false) === 0xcafebabf;
      return slices.map((s, i) => {
        const size = fat
          ? be.getUint32(0, false) === 0xcafebabf
            ? Number(be.getBigUint64(8 + i * 32 + 16, false))
            : be.getUint32(8 + i * 20 + 12, false)
          : b.length;
        return s.base + size <= b.length
          ? machoSymbols(b, s, size)
          : { arch: s.arch, symbols: [], procedures: [], notes: s.notes };
      });
    }
    case "wasm":
      return [wasmSymbols(b, slices[0]!)];
    default:
      return [];
  }
}
