// macho.info: thin Mach-O (32/64-bit, either endianness) and fat/universal binaries; CPU types,
// file type, linked dylibs, LC_ID_DYLIB, LC_RPATH, code signature, encryption, build version,
// exported symbols (the dyld exports trie) and imported symbols (undefined externals in LC_SYMTAB).

import { isCoreError } from "../../errors.ts";
import type { Json } from "../../evidence/jcs.ts";
import { type AssayProbe, cstr, fail, toHex, u8, u32, u64 } from "../util.ts";
import { libFindings, NATIVE_CAP } from "./elf.ts";

const CPU: Record<number, string> = {
  7: "x86",
  16777223: "x86_64",
  12: "arm",
  16777228: "arm64",
  33554444: "arm64_32",
  18: "ppc",
  16777234: "ppc64",
};
const FILETYPE: Record<number, string> = {
  1: "object",
  2: "execute",
  3: "fvmlib",
  4: "core",
  5: "preload",
  6: "dylib",
  7: "dylinker",
  8: "bundle",
  9: "dylib-stub",
  10: "dsym",
  11: "kext-bundle",
  12: "fileset",
};
const DYLIB_CMDS: Record<number, string> = {
  12: "load",
  2147483672: "weak",
  2147483679: "reexport",
  32: "lazy",
  2147483683: "upward",
};
const PLATFORMS: Record<number, string> = {
  1: "macos",
  2: "ios",
  3: "tvos",
  4: "watchos",
  5: "bridgeos",
  6: "maccatalyst",
  7: "ios-simulator",
  11: "visionos",
};

export interface MachOSlice {
  cpu: string;
  bits: 32 | 64;
  endian: "little" | "big";
  filetype: string;
  dylibs: { name: string; kind: string; current: string; compat: string }[];
  id: string | null;
  rpaths: string[];
  codeSignature: boolean;
  encrypted: boolean;
  uuid: string | null;
  platform: string | null;
  minOs: string | null;
  markers: string[];
  /** From the exports trie (LC_DYLD_EXPORTS_TRIE or LC_DYLD_INFO); names without the leading "_"
   * kept as in the binary. complete is false when the trie was cut short by a cap or bad data. */
  exports: { count: number; names: string[]; complete: boolean };
  /** Undefined external symbols in LC_SYMTAB: what the binary takes from its dylibs. */
  imports: { count: number; names: string[]; complete: boolean };
  error?: string;
}

/** Most export or import names kept per slice. */
export const MACHO_NAME_CAP = 100_000;

function uleb(b: Uint8Array, o: number, end: number): { v: number; next: number } {
  let v = 0;
  let shift = 0;
  let p = o;
  while (p < end) {
    const byte = u8(b, p++);
    v += (byte & 0x7f) * 2 ** shift;
    if (!(byte & 0x80)) return { v, next: p };
    shift += 7;
    if (shift > 63) break;
  }
  return fail("Mach-O: bad ULEB128 in the exports trie");
}

/** Walk the exports trie: each node has terminal info, then edges (label, child offset). */
export function readExportsTrie(
  b: Uint8Array,
  start: number,
  size: number,
  cap = MACHO_NAME_CAP,
): MachOSlice["exports"] {
  const end = start + size;
  if (size === 0) return { count: 0, names: [], complete: true };
  if (end > b.length) return { count: 0, names: [], complete: false };
  const names: string[] = [];
  const seen = new Set<number>();
  const stack: { off: number; prefix: string }[] = [{ off: 0, prefix: "" }];
  let complete = true;
  while (stack.length) {
    const { off, prefix } = stack.pop()!;
    if (seen.has(off) || off >= size || prefix.length > 4096) {
      complete = false;
      continue;
    }
    seen.add(off);
    let p = start + off;
    const term = uleb(b, p, end);
    p = term.next;
    if (term.v > 0) {
      if (names.length < cap) names.push(prefix);
      else complete = false;
      p += term.v;
    }
    if (p >= end) continue;
    const children = u8(b, p++);
    for (let i = 0; i < children; i++) {
      let q = p;
      while (q < end && b[q] !== 0) q++;
      if (q >= end) {
        complete = false;
        break;
      }
      const label = new TextDecoder().decode(b.subarray(p, q));
      const child = uleb(b, q + 1, end);
      p = child.next;
      stack.push({ off: child.v, prefix: prefix + label });
    }
  }
  names.sort();
  return { count: names.length, names, complete };
}

/** Undefined external symbols from LC_SYMTAB (nlist entries with N_UNDF and N_EXT, not stabs). */
function readUndefinedSymbols(
  b: Uint8Array,
  cmd: number,
  le: boolean,
  is64: boolean,
  cap = MACHO_NAME_CAP,
): MachOSlice["imports"] {
  const symoff = u32(b, cmd + 8, le);
  const nsyms = u32(b, cmd + 12, le);
  const stroff = u32(b, cmd + 16, le);
  const strsize = u32(b, cmd + 20, le);
  const step = is64 ? 16 : 12;
  if (symoff + nsyms * step > b.length || stroff + strsize > b.length) return { count: 0, names: [], complete: false };
  const names: string[] = [];
  let complete = true;
  for (let i = 0; i < nsyms; i++) {
    const e = symoff + i * step;
    const type = u8(b, e + 4);
    if (type & 0xe0 || (type & 0x0e) !== 0 || !(type & 0x01)) continue;
    const strx = u32(b, e, le);
    if (strx >= strsize) {
      complete = false;
      continue;
    }
    if (names.length >= cap) {
      complete = false;
      break;
    }
    names.push(cstr(b, stroff + strx, 4096, stroff + strsize));
  }
  names.sort();
  return { count: names.length, names, complete };
}

export interface MachOInfo {
  fat: boolean;
  slices: MachOSlice[];
}

function ver(v: number): string {
  return `${Math.floor(v / 65536)}.${(v >> 8) & 0xff}.${v & 0xff}`;
}

export function parseThin(b: Uint8Array): MachOSlice {
  const m = u32(b, 0, false);
  let le: boolean;
  let is64: boolean;
  if (m === 0xfeedface) [le, is64] = [false, false];
  else if (m === 0xcefaedfe) [le, is64] = [true, false];
  else if (m === 0xfeedfacf) [le, is64] = [false, true];
  else if (m === 0xcffaedfe) [le, is64] = [true, true];
  else return fail("not a Mach-O file");
  const cputype = u32(b, 4, le);
  const filetype = u32(b, 12, le);
  const ncmds = u32(b, 16, le);
  const sizeofcmds = u32(b, 20, le);
  const hdr = is64 ? 32 : 28;
  const end = hdr + sizeofcmds;
  if (end > b.length) fail("Mach-O: load commands past end");
  const out: MachOSlice = {
    cpu: CPU[cputype] ?? `0x${cputype.toString(16)}`,
    bits: is64 ? 64 : 32,
    endian: le ? "little" : "big",
    filetype: FILETYPE[filetype] ?? `${filetype}`,
    dylibs: [],
    id: null,
    rpaths: [],
    codeSignature: false,
    encrypted: false,
    uuid: null,
    platform: null,
    minOs: null,
    markers: [],
    exports: { count: 0, names: [], complete: true },
    imports: { count: 0, names: [], complete: true },
  };
  const markers = new Set<string>();
  let o = hdr;
  for (let i = 0; i < Math.min(ncmds, 8192); i++) {
    if (o + 8 > end) fail("Mach-O: load command past sizeofcmds");
    const cmd = u32(b, o, le);
    const size = u32(b, o + 4, le);
    if (size < 8 || o + size > end) fail("Mach-O: bad load command size", { cmd, size });
    const str = (rel: number) => cstr(b, o + u32(b, o + rel, le), 4096, o + size);
    const kind = DYLIB_CMDS[cmd];
    if (kind) {
      out.dylibs.push({ name: str(8), kind, current: ver(u32(b, o + 16, le)), compat: ver(u32(b, o + 20, le)) });
    } else if (cmd === 0xd) out.id = str(8);
    else if (cmd === 0x8000001c) out.rpaths.push(str(8));
    else if (cmd === 0x1d) out.codeSignature = true;
    else if (cmd === 0x21 || cmd === 0x2c) out.encrypted = u32(b, o + 16, le) !== 0;
    else if (cmd === 0x1b) out.uuid = toHex(b.subarray(o + 8, o + 24));
    else if (cmd === 0x80000033) out.exports = readExportsTrie(b, u32(b, o + 8, le), u32(b, o + 12, le));
    else if ((cmd === 0x22 || cmd === 0x80000022) && u32(b, o + 44, le) > 0)
      out.exports = readExportsTrie(b, u32(b, o + 40, le), u32(b, o + 44, le));
    else if (cmd === 0x2) out.imports = readUndefinedSymbols(b, o, le, is64);
    else if (cmd === 0x32) {
      out.platform = PLATFORMS[u32(b, o + 8, le)] ?? `${u32(b, o + 8, le)}`;
      out.minOs = ver(u32(b, o + 12, le));
    } else if (cmd === 0x24 || cmd === 0x25) {
      out.platform = cmd === 0x24 ? "macos" : "ios";
      out.minOs = ver(u32(b, o + 8, le));
    } else if (cmd === 0x19 || cmd === 0x1) {
      const nsects = u32(b, o + (cmd === 0x19 ? 64 : 48), le);
      const first = o + (cmd === 0x19 ? 72 : 56);
      const step = cmd === 0x19 ? 80 : 68;
      for (let s = 0; s < Math.min(nsects, 512); s++) {
        const so = first + s * step;
        if (so + 16 > o + size) break;
        const name = cstr(b, so, 16, so + 16);
        if (name === "__go_buildinfo") markers.add("go-buildinfo");
        if (name.startsWith("__swift5_")) markers.add("swift");
        if (name === ".dep-v0") markers.add("rust-cargo-auditable");
      }
    }
    o += size;
  }
  out.markers = [...markers].sort();
  return out;
}

export function parseMachO(b: Uint8Array): MachOInfo {
  const m = u32(b, 0, false);
  if (m !== 0xcafebabe && m !== 0xcafebabf) return { fat: false, slices: [parseThin(b)] };
  const fat64 = m === 0xcafebabf;
  const n = u32(b, 4, false);
  if (n === 0 || n > 64) fail("Mach-O fat: implausible architecture count", { n });
  const slices: MachOSlice[] = [];
  for (let i = 0; i < n; i++) {
    const o = 8 + i * (fat64 ? 32 : 20);
    const off = fat64 ? u64(b, o + 8, false) : u32(b, o + 8, false);
    const size = fat64 ? u64(b, o + 16, false) : u32(b, o + 12, false);
    const cpu = u32(b, o, false);
    if (off + size > b.length || size < 28) {
      slices.push({ ...emptySlice(cpu), error: "slice runs past the end of the file" });
      continue;
    }
    try {
      slices.push(parseThin(b.subarray(off, off + size)));
    } catch (e) {
      if (!isCoreError(e)) throw e;
      slices.push({ ...emptySlice(cpu), error: String(e.detail?.reason ?? e.message) });
    }
  }
  return { fat: true, slices };
}

function emptySlice(cpu: number): MachOSlice {
  return {
    cpu: CPU[cpu] ?? `0x${cpu.toString(16)}`,
    bits: cpu & 0x01000000 ? 64 : 32,
    endian: "little",
    filetype: "unknown",
    dylibs: [],
    id: null,
    rpaths: [],
    codeSignature: false,
    encrypted: false,
    uuid: null,
    platform: null,
    minOs: null,
    markers: [],
    exports: { count: 0, names: [], complete: false },
    imports: { count: 0, names: [], complete: false },
  };
}

export const machoInfo: AssayProbe = {
  id: "macho.info",
  version: "2",
  predicate: "macho.info",
  summary: "Mach-O CPU types (thin and fat), file type, LC_LOAD_DYLIB/LC_ID_DYLIB, LC_RPATH, code signature",
  appliesTo: (i) => i.format === "macho" || i.format === "macho-fat",
  platforms: ["linux", "darwin", "win32"],
  cost: "cheap",
  confidence: "observed",
  sweep: ["each"],
  async run(ctx) {
    const b = await ctx.read(undefined, NATIVE_CAP);
    const info = parseMachO(b);
    const broken = info.slices.filter((s) => s.error);
    return {
      result: info as unknown as Json,
      findings: libFindings(info.slices.flatMap((s) => s.dylibs.map((d) => d.name))),
      limitations: [
        "the code signature is detected, not validated",
        "dlopen at run time is not in the load commands",
        ...broken.map((s) => `slice ${s.cpu}: ${s.error}`),
      ],
    };
  },
};
