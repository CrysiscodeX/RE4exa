// The layout of a native binary: its sections and segments with addresses, file offsets, sizes and
// flags, read from the file's own tables (ELF section and program headers, PE section table, Mach-O
// segment commands, WebAssembly section headers). reax's own reader, checked against llvm-readobj
// (bench/oracle/layout.json). Addresses are 64-bit, so they are BigInt inside and hex outside.
import { normalizeArch } from "@re4exa/core/probes/arch";
import { parseElf } from "@re4exa/core/probes/builtin/elf";
import { parseMachO } from "@re4exa/core/probes/builtin/macho";
import { parsePe } from "@re4exa/core/probes/builtin/pe";

export interface Region {
  index: number;
  name: string;
  /** Mach-O: the segment a section belongs to. */
  segment: string | null;
  /** Virtual address (PE: image base plus RVA), or null where the format has none (wasm). */
  addr: string | null;
  /** Bytes in memory. */
  size: number;
  /** Absolute file offset of the first byte, or null when the region has no bytes in the file. */
  offset: number | null;
  /** Bytes in the file. */
  fileSize: number;
  /** "rwx" with dashes, or null where the format records none. */
  perms: string | null;
  /** The format's own type name (SHT_PROGBITS, PT_LOAD, regular, CODE, ...). */
  kind: string;
  /** The raw type number and flags as the format stores them (Mach-O: flags without the type byte). */
  type: number;
  flags: number;
}

export interface LayoutSlice {
  arch: string;
  /** Where the slice starts in the file (non-zero only inside a universal binary). */
  base: number;
  /** PE only. */
  imageBase: string | null;
  /** The entry point's virtual address (ELF e_entry, PE AddressOfEntryPoint, Mach-O LC_MAIN), or
   * null when the file has none (a library, or wasm, whose start is a function index). */
  entry: string | null;
  sections: Region[];
  segments: Region[];
  notes: string[];
}

class Bytes {
  readonly b: Uint8Array;
  readonly le: boolean;
  readonly dv: DataView;
  constructor(b: Uint8Array, le: boolean) {
    this.b = b;
    this.le = le;
    this.dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  }
  has(o: number, n: number): boolean {
    return o >= 0 && n >= 0 && o + n <= this.b.length;
  }
  need(o: number, n: number, what: string): void {
    if (!this.has(o, n)) throw new Error(`${what} runs past the end of the file`);
  }
  u8(o: number) {
    this.need(o, 1, "a field");
    return this.dv.getUint8(o);
  }
  u16(o: number) {
    this.need(o, 2, "a field");
    return this.dv.getUint16(o, this.le);
  }
  u32(o: number) {
    this.need(o, 4, "a field");
    return this.dv.getUint32(o, this.le);
  }
  u64(o: number): bigint {
    this.need(o, 8, "a field");
    return this.dv.getBigUint64(o, this.le);
  }
  /** A NUL-terminated name, decoded as UTF-8 (as the formats' tools print them). */
  cstr(o: number, max: number, end = this.b.length): string {
    let e = o;
    while (e < Math.min(end, o + max, this.b.length) && this.b[e] !== 0) e++;
    return new TextDecoder("utf-8").decode(this.b.subarray(o, e));
  }
}

const hex = (v: bigint | number) => `0x${v.toString(16)}`;

/** The architecture in the spelling inventory.native uses (core's readers name it). A file whose
 * other tables core cannot read still has a layout, so the name is "unknown" with a note. */
function archOf(name: () => string, notes: string[]): string {
  try {
    return normalizeArch(name());
  } catch (e) {
    notes.push(`the architecture is unknown: ${(e as Error).message}`);
    return "unknown";
  }
}
/** A size or offset as a number; one past 2^53 is not a real file quantity, so it is reported. */
function num(v: bigint, what: string, notes: string[]): number {
  if (v > BigInt(Number.MAX_SAFE_INTEGER)) {
    notes.push(`${what} is ${hex(v)}, larger than any file`);
    return Number.MAX_SAFE_INTEGER;
  }
  return Number(v);
}
const rwx = (r: boolean, w: boolean, x: boolean) => `${r ? "r" : "-"}${w ? "w" : "-"}${x ? "x" : "-"}`;

// ------------------------------------------------------------------------------------------- ELF

const SHT: Record<number, string> = {
  0: "SHT_NULL",
  1: "SHT_PROGBITS",
  2: "SHT_SYMTAB",
  3: "SHT_STRTAB",
  4: "SHT_RELA",
  5: "SHT_HASH",
  6: "SHT_DYNAMIC",
  7: "SHT_NOTE",
  8: "SHT_NOBITS",
  9: "SHT_REL",
  11: "SHT_DYNSYM",
  14: "SHT_INIT_ARRAY",
  15: "SHT_FINI_ARRAY",
  16: "SHT_PREINIT_ARRAY",
  17: "SHT_GROUP",
  18: "SHT_SYMTAB_SHNDX",
  1879048182: "SHT_GNU_HASH",
  1879048189: "SHT_GNU_verdef",
  1879048190: "SHT_GNU_verneed",
  1879048191: "SHT_GNU_versym",
  1879048193: "SHT_PROC_UNWIND",
};
const PT: Record<number, string> = {
  0: "PT_NULL",
  1: "PT_LOAD",
  2: "PT_DYNAMIC",
  3: "PT_INTERP",
  4: "PT_NOTE",
  5: "PT_SHLIB",
  6: "PT_PHDR",
  7: "PT_TLS",
  1685382480: "PT_GNU_EH_FRAME",
  1685382481: "PT_GNU_STACK",
  1685382482: "PT_GNU_RELRO",
  1685382483: "PT_GNU_PROPERTY",
};
const named = (t: Record<number, string>, v: number) => t[v] ?? hex(v);

function elfLayout(b: Uint8Array): LayoutSlice {
  const is64 = b[4] === 2;
  const r = new Bytes(b, b[5] !== 2);
  const notes: string[] = [];
  const word = (o: number) => (is64 ? r.u64(o) : BigInt(r.u32(o)));
  const phoff = num(word(is64 ? 32 : 28), "e_phoff", notes);
  const shoff = num(word(is64 ? 40 : 32), "e_shoff", notes);
  const phentsize = r.u16(is64 ? 54 : 42);
  let phnum = r.u16(is64 ? 56 : 44);
  const shentsize = r.u16(is64 ? 58 : 46);
  let shnum = r.u16(is64 ? 60 : 48);
  let shstrndx = r.u16(is64 ? 62 : 50);
  // extended numbering: the real counts live in section 0
  if (shoff > 0 && r.has(shoff, is64 ? 64 : 40)) {
    if (shnum === 0) shnum = num(word(shoff + (is64 ? 32 : 20)), "section count", notes);
    if (shstrndx === 0xffff) shstrndx = r.u32(shoff + (is64 ? 40 : 24));
    if (phnum === 0xffff) phnum = r.u32(shoff + (is64 ? 44 : 28));
  }
  const MAX = 65_536;
  const sections: Region[] = [];
  if (shoff > 0 && shnum > 0) {
    if (shentsize < (is64 ? 64 : 40)) notes.push("section header entries are smaller than the format's");
    else {
      const n = Math.min(shnum, MAX);
      if (n < shnum) notes.push(`${shnum} sections; the first ${MAX} are listed`);
      const raw: { name: number; type: number; flags: bigint; addr: bigint; offset: bigint; size: bigint }[] = [];
      for (let i = 0; i < n; i++) {
        const o = shoff + i * shentsize;
        if (!r.has(o, is64 ? 64 : 40)) {
          notes.push(`the section table is cut after ${i} of ${shnum} entries`);
          break;
        }
        raw.push({
          name: r.u32(o),
          type: r.u32(o + 4),
          flags: word(o + 8),
          addr: word(o + (is64 ? 16 : 12)),
          offset: word(o + (is64 ? 24 : 16)),
          size: word(o + (is64 ? 32 : 20)),
        });
      }
      const strtab = raw[shstrndx];
      raw.forEach((s, i) => {
        let name = "";
        if (strtab && s.name < strtab.size) {
          const base = Number(strtab.offset);
          name = r.cstr(base + s.name, 4096, base + Number(strtab.size));
        }
        const size = num(s.size, `section ${i} size`, notes);
        const nobits = s.type === 8 || s.type === 0;
        const flags = Number(s.flags & 0xffffffffn);
        sections.push({
          index: i,
          name,
          segment: null,
          addr: hex(s.addr),
          size,
          offset: s.type === 8 ? null : num(s.offset, `section ${i} offset`, notes),
          fileSize: nobits ? 0 : size,
          perms: flags & 2 ? rwx(true, (flags & 1) !== 0, (flags & 4) !== 0) : null,
          kind: named(SHT, s.type),
          type: s.type,
          flags,
        });
      });
    }
  } else notes.push("no section headers");
  const segments: Region[] = [];
  if (phoff > 0 && phnum > 0) {
    if (phentsize < (is64 ? 56 : 32)) notes.push("program header entries are smaller than the format's");
    else
      for (let i = 0; i < Math.min(phnum, MAX); i++) {
        const o = phoff + i * phentsize;
        if (!r.has(o, is64 ? 56 : 32)) {
          notes.push(`the program header table is cut after ${i} of ${phnum} entries`);
          break;
        }
        const type = r.u32(o);
        const flags = is64 ? r.u32(o + 4) : r.u32(o + 24);
        const offset = word(o + (is64 ? 8 : 4));
        const vaddr = word(o + (is64 ? 16 : 8));
        const filesz = word(o + (is64 ? 32 : 16));
        const memsz = word(o + (is64 ? 40 : 20));
        const fileSize = num(filesz, `segment ${i} file size`, notes);
        segments.push({
          index: i,
          name: named(PT, type),
          segment: null,
          addr: hex(vaddr),
          size: num(memsz, `segment ${i} size`, notes),
          offset: fileSize > 0 ? num(offset, `segment ${i} offset`, notes) : null,
          fileSize,
          perms: rwx((flags & 4) !== 0, (flags & 2) !== 0, (flags & 1) !== 0),
          kind: named(PT, type),
          type,
          flags,
        });
      }
  }
  const entry = word(24);
  return {
    arch: archOf(() => parseElf(b).machine, notes),
    base: 0,
    imageBase: null,
    entry: entry ? hex(entry) : null,
    sections,
    segments,
    notes,
  };
}

// -------------------------------------------------------------------------------------------- PE

function peLayout(b: Uint8Array): LayoutSlice {
  const r = new Bytes(b, true);
  const notes: string[] = [];
  const pe = r.u32(0x3c);
  r.need(pe, 24, "the PE header");
  const nsec = r.u16(pe + 6);
  const symptr = r.u32(pe + 12);
  const nsyms = r.u32(pe + 16);
  const optSize = r.u16(pe + 20);
  const opt = pe + 24;
  const magic = r.u16(opt);
  const imageBase = magic === 0x20b ? r.u64(opt + 24) : BigInt(r.u32(opt + 28));
  const strtab = symptr ? symptr + nsyms * 18 : 0;
  const sections: Region[] = [];
  const table = opt + optSize;
  for (let i = 0; i < nsec; i++) {
    const o = table + i * 40;
    if (!r.has(o, 40)) {
      notes.push(`the section table is cut after ${i} of ${nsec} entries`);
      break;
    }
    let name = r.cstr(o, 8);
    // a long name lives in the COFF string table: "/<decimal offset>"
    if (/^\/\d+$/.test(name) && strtab && r.has(strtab + Number(name.slice(1)), 1))
      name = r.cstr(strtab + Number(name.slice(1)), 4096);
    const vsize = r.u32(o + 8);
    const rva = r.u32(o + 12);
    const rawSize = r.u32(o + 16);
    const rawPtr = r.u32(o + 20);
    const ch = r.u32(o + 36);
    sections.push({
      index: i + 1,
      name,
      segment: null,
      addr: hex(imageBase + BigInt(rva)),
      size: vsize,
      offset: rawSize > 0 ? rawPtr : null,
      fileSize: rawSize,
      perms: rwx((ch & 0x40000000) !== 0, (ch & 0x80000000) !== 0, (ch & 0x20000000) !== 0),
      kind: ch & 0x20 ? "code" : ch & 0x40 ? "initialized-data" : ch & 0x80 ? "uninitialized-data" : "other",
      type: 0,
      flags: ch,
    });
  }
  return {
    arch: archOf(() => parsePe(b).machine, notes),
    base: 0,
    imageBase: hex(imageBase),
    entry: r.u32(opt + 16) ? hex(imageBase + BigInt(r.u32(opt + 16))) : null,
    sections,
    segments: [],
    notes,
  };
}

// ---------------------------------------------------------------------------------------- Mach-O

const MACHO_SECTION_TYPE: Record<number, string> = {
  0: "regular",
  1: "zerofill",
  2: "cstring_literals",
  3: "4byte_literals",
  4: "8byte_literals",
  5: "literal_pointers",
  6: "non_lazy_symbol_pointers",
  7: "lazy_symbol_pointers",
  8: "symbol_stubs",
  9: "mod_init_func_pointers",
  10: "mod_term_func_pointers",
  11: "coalesced",
  12: "gb_zerofill",
  13: "interposing",
  14: "16byte_literals",
  15: "dtrace_dof",
  16: "lazy_dylib_symbol_pointers",
  17: "thread_local_regular",
  18: "thread_local_zerofill",
  19: "thread_local_variables",
  20: "thread_local_variable_pointers",
  21: "thread_local_init_function_pointers",
  22: "init_func_offsets",
};

function prot(p: number): string {
  return rwx((p & 1) !== 0, (p & 2) !== 0, (p & 4) !== 0);
}

function machoThin(all: Uint8Array, base: number, size: number, arch: string): LayoutSlice {
  const b = all.subarray(base, base + size);
  const magic = new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(0, false);
  const le = magic === 0xcefaedfe || magic === 0xcffaedfe;
  const is64 = magic === 0xcffaedfe || magic === 0xfeedfacf;
  const r = new Bytes(b, le);
  const notes: string[] = [];
  const ncmds = r.u32(16);
  let o = is64 ? 32 : 28;
  const sections: Region[] = [];
  const segments: Region[] = [];
  let entryoff: bigint | null = null;
  const end = Math.min(b.length, o + r.u32(20));
  for (let i = 0; i < ncmds; i++) {
    if (!r.has(o, 8) || o + 8 > end) {
      notes.push(`the load commands are cut after ${i} of ${ncmds}`);
      break;
    }
    const cmd = r.u32(o);
    const cmdsize = r.u32(o + 4);
    if (cmdsize < 8) {
      notes.push(`load command ${i} has size ${cmdsize}`);
      break;
    }
    if (cmd === 0x80000028 && r.has(o + 8, 8)) entryoff = r.u64(o + 8); // LC_MAIN
    if (cmd === 0x19 || cmd === 0x1) {
      const s64 = cmd === 0x19;
      const w = (p: number) => (s64 ? r.u64(p) : BigInt(r.u32(p)));
      const segname = r.cstr(o + 8, 16);
      const vmaddr = w(o + 24);
      const vmsize = w(o + (s64 ? 32 : 28));
      const fileoff = w(o + (s64 ? 40 : 32));
      const filesize = w(o + (s64 ? 48 : 36));
      const maxprot = r.u32(o + (s64 ? 56 : 40));
      const initprot = r.u32(o + (s64 ? 60 : 44));
      const nsects = r.u32(o + (s64 ? 64 : 48));
      const flags = r.u32(o + (s64 ? 68 : 52));
      const fileSize = num(filesize, `segment ${segname} file size`, notes);
      segments.push({
        index: segments.length,
        name: segname,
        segment: null,
        addr: hex(vmaddr),
        size: num(vmsize, `segment ${segname} size`, notes),
        offset: fileSize > 0 ? base + num(fileoff, `segment ${segname} offset`, notes) : null,
        fileSize,
        perms: prot(initprot),
        kind: s64 ? "LC_SEGMENT_64" : "LC_SEGMENT",
        type: maxprot,
        flags,
      });
      const secSize = s64 ? 80 : 68;
      let so = o + (s64 ? 72 : 56);
      for (let k = 0; k < nsects; k++, so += secSize) {
        if (!r.has(so, secSize) || so + secSize > o + cmdsize) {
          notes.push(`segment ${segname} lists ${nsects} sections; its command holds ${k}`);
          break;
        }
        const addr = w(so + 32);
        const ssize = num(w(so + (s64 ? 40 : 36)), "section size", notes);
        const off = r.u32(so + (s64 ? 48 : 40));
        const sflags = r.u32(so + (s64 ? 64 : 56));
        const type = sflags & 0xff;
        const zerofill = type === 1 || type === 12 || type === 18;
        sections.push({
          index: sections.length,
          name: r.cstr(so, 16),
          segment: r.cstr(so + 16, 16),
          addr: hex(addr),
          size: ssize,
          offset: zerofill ? null : base + off,
          fileSize: zerofill ? 0 : ssize,
          perms: prot(initprot),
          kind: MACHO_SECTION_TYPE[type] ?? hex(type),
          type,
          flags: sflags >>> 8,
        });
      }
    }
    o += cmdsize;
  }
  // LC_MAIN's entry is an offset in the slice; the segment that maps it gives its address
  let entry: string | null = null;
  if (entryoff !== null)
    for (const g of segments) {
      const at = BigInt(base) + entryoff;
      if (g.offset !== null && g.addr !== null && at >= BigInt(g.offset) && at < BigInt(g.offset + g.fileSize))
        entry = hex(BigInt(g.addr) + (at - BigInt(g.offset)));
    }
  return { arch, base, imageBase: null, entry, sections, segments, notes };
}

function machoLayout(b: Uint8Array): LayoutSlice[] {
  let info: { slices: { cpu: string }[] } = { slices: [] };
  try {
    info = parseMachO(b);
  } catch {
    // each slice still gets its layout; its architecture is then unknown
  }
  const be = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const magic = be.getUint32(0, false);
  if (magic === 0xcafebabe || magic === 0xcafebabf) {
    const fat64 = magic === 0xcafebabf;
    const n = be.getUint32(4, false);
    const out: LayoutSlice[] = [];
    for (let i = 0; i < n; i++) {
      const e = 8 + i * (fat64 ? 32 : 20);
      const offset = fat64 ? Number(be.getBigUint64(e + 8, false)) : be.getUint32(e + 8, false);
      const size = fat64 ? Number(be.getBigUint64(e + 16, false)) : be.getUint32(e + 12, false);
      const arch = normalizeArch(info.slices[i]?.cpu ?? "unknown");
      if (offset + size > b.length) {
        out.push({
          arch,
          base: offset,
          imageBase: null,
          entry: null,
          sections: [],
          segments: [],
          notes: ["the slice runs past the end of the file"],
        });
        continue;
      }
      out.push(machoThin(b, offset, size, arch));
    }
    return out;
  }
  return [machoThin(b, 0, b.length, normalizeArch(info.slices[0]?.cpu ?? "unknown"))];
}

// ------------------------------------------------------------------------------------------ wasm

const WASM_SECTION = [
  "CUSTOM",
  "TYPE",
  "IMPORT",
  "FUNCTION",
  "TABLE",
  "MEMORY",
  "GLOBAL",
  "EXPORT",
  "START",
  "ELEM",
  "CODE",
  "DATA",
  "DATACOUNT",
  "TAG",
];

function leb(b: Uint8Array, o: number): { v: number; n: number } {
  let v = 0;
  let shift = 0;
  for (let i = 0; i < 5; i++) {
    if (o + i >= b.length) throw new Error("a section size runs past the end of the file");
    const x = b[o + i]!;
    v += (x & 0x7f) * 2 ** shift;
    if ((x & 0x80) === 0) return { v, n: i + 1 };
    shift += 7;
  }
  throw new Error("a section size is longer than 5 bytes");
}

function wasmLayout(b: Uint8Array): LayoutSlice {
  const notes: string[] = [];
  const sections: Region[] = [];
  let o = 8;
  while (o < b.length) {
    const id = b[o]!;
    let size: { v: number; n: number };
    try {
      size = leb(b, o + 1);
    } catch (e) {
      notes.push((e as Error).message);
      break;
    }
    const payload = o + 1 + size.n;
    if (payload + size.v > b.length) {
      notes.push(`section ${sections.length} runs past the end of the file`);
      break;
    }
    let name = WASM_SECTION[id] ?? hex(id);
    if (id === 0) {
      try {
        const l = leb(b, payload);
        name = new TextDecoder("utf-8", { fatal: false }).decode(b.subarray(payload + l.n, payload + l.n + l.v));
      } catch {
        notes.push(`custom section ${sections.length} has no readable name`);
      }
    }
    sections.push({
      index: sections.length,
      name,
      segment: null,
      addr: null,
      size: size.v,
      offset: payload,
      fileSize: size.v,
      perms: null,
      kind: WASM_SECTION[id] ?? hex(id),
      type: id,
      flags: 0,
    });
    o = payload + size.v;
  }
  return { arch: "wasm32", base: 0, imageBase: null, entry: null, sections, segments: [], notes };
}

export const LAYOUT_FORMATS = ["elf", "pe", "macho", "macho-fat", "wasm"] as const;

/** Every slice's layout; a format reax does not lay out is the caller's to refuse. */
export function layout(b: Uint8Array, format: string): LayoutSlice[] {
  switch (format) {
    case "elf":
      return [elfLayout(b)];
    case "pe":
      return [peLayout(b)];
    case "macho":
    case "macho-fat":
      return machoLayout(b);
    case "wasm":
      return [wasmLayout(b)];
    default:
      return [];
  }
}

/** The file offset an address maps to, through the regions that load bytes from the file. */
export function addressToOffset(
  s: LayoutSlice,
  addr: bigint,
): { offset: number | null; region: Region | null; section: Region | null } {
  const loads = s.segments.length
    ? s.segments.filter((g) => g.kind === "PT_LOAD" || g.kind.startsWith("LC_SEGMENT"))
    : s.sections;
  const section = s.sections.find((x) => x.addr !== null && x.size > 0 && within(addr, x.addr, x.size)) ?? null;
  for (const g of loads) {
    if (g.addr === null || !within(addr, g.addr, g.size)) continue;
    const delta = Number(addr - BigInt(g.addr));
    return { offset: g.offset !== null && delta < g.fileSize ? g.offset + delta : null, region: g, section };
  }
  return { offset: null, region: null, section };
}

/** The address a file offset is loaded at, through the same regions. */
export function offsetToAddress(
  s: LayoutSlice,
  offset: number,
): { addr: string | null; region: Region | null; section: Region | null } {
  const loads = s.segments.length
    ? s.segments.filter((g) => g.kind === "PT_LOAD" || g.kind.startsWith("LC_SEGMENT"))
    : s.sections;
  const section =
    s.sections.find((x) => x.offset !== null && offset >= x.offset && offset < x.offset + x.fileSize) ?? null;
  for (const g of loads) {
    if (g.offset === null || g.addr === null || offset < g.offset || offset >= g.offset + g.fileSize) continue;
    return { addr: hex(BigInt(g.addr) + BigInt(offset - g.offset)), region: g, section };
  }
  return { addr: null, region: null, section };
}

function within(addr: bigint, start: string, size: number): boolean {
  const s = BigInt(start);
  return addr >= s && addr < s + BigInt(size);
}
