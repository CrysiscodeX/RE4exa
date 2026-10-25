// Deterministic generators for minimal but valid binaries and archives: ELF64 with a dynamic
// section, PE32+ with import and export directories, Mach-O thin (32/64, both endiannesses) and
// fat, stored zip, ustar, stored-deflate gzip, ASAR, WebAssembly, npm tarballs, plus tiny samples
// of identified-only formats. Same inputs give the same bytes on every host and Node version.

import { crc32 } from "node:zlib";

const enc = new TextEncoder();

export function concat(parts: Uint8Array[]): Uint8Array {
  const n = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function align(n: number, a: number): number {
  return Math.ceil(n / a) * a;
}

class W {
  buf: Uint8Array;
  dv: DataView;
  le: boolean;
  constructor(size: number, le = true) {
    this.buf = new Uint8Array(size);
    this.dv = new DataView(this.buf.buffer);
    this.le = le;
  }
  u8(o: number, v: number): void {
    this.dv.setUint8(o, v);
  }
  u16(o: number, v: number): void {
    this.dv.setUint16(o, v, this.le);
  }
  u32(o: number, v: number): void {
    this.dv.setUint32(o, v >>> 0, this.le);
  }
  u64(o: number, v: number): void {
    this.dv.setBigUint64(o, BigInt(v), this.le);
  }
  bytes(o: number, b: Uint8Array): void {
    this.buf.set(b, o);
  }
  str(o: number, s: string): void {
    this.buf.set(enc.encode(s), o);
  }
}

// ---------------------------------------------------------------------------------- ELF ----

export interface ElfOptions {
  needed?: string[];
  interp?: string | null;
  exports?: string[];
  imports?: string[];
  soname?: string | null;
  runpath?: string | null;
  extraSections?: string[];
}

export function makeElf64(o: ElfOptions = {}): Uint8Array {
  const needed = o.needed ?? ["libc.so.6"];
  const interp = o.interp === undefined ? "/lib64/ld-linux-x86-64.so.2" : o.interp;
  const exportsList = o.exports ?? ["assay_entry"];
  const importsList = o.imports ?? ["puts"];
  const extra = o.extraSections ?? [];
  // .dynstr
  const strs: string[] = [];
  const strOff = new Map<string, number>();
  let dynstrLen = 1;
  const addStr = (s: string) => {
    if (!strOff.has(s)) {
      strOff.set(s, dynstrLen);
      strs.push(s);
      dynstrLen += enc.encode(s).length + 1;
    }
    return strOff.get(s)!;
  };
  for (const n of needed) addStr(n);
  if (o.soname) addStr(o.soname);
  if (o.runpath) addStr(o.runpath);
  for (const s of [...importsList, ...exportsList]) addStr(s);
  const shnames = ["", ".interp", ".dynstr", ".dynsym", ".text", ".dynamic", ".shstrtab", ...extra];
  const shOff: number[] = [];
  let shstrLen = 0;
  for (const n of shnames) {
    shOff.push(shstrLen);
    shstrLen += n.length + 1;
  }
  const phnum = interp ? 3 : 2;
  const phoff = 64;
  let off = phoff + phnum * 56;
  const interpOff = align(off, 8);
  const interpLen = interp ? interp.length + 1 : 0;
  off = interpOff + interpLen;
  const dynstrOff = align(off, 8);
  off = dynstrOff + dynstrLen;
  const nsyms = 1 + importsList.length + exportsList.length;
  const dynsymOff = align(off, 8);
  off = dynsymOff + nsyms * 24;
  const textOff = align(off, 16);
  off = textOff + 16;
  const dynEntries = needed.length + (o.soname ? 1 : 0) + (o.runpath ? 1 : 0) + 5;
  const dynamicOff = align(off, 8);
  off = dynamicOff + dynEntries * 16;
  const extraOff = off;
  off += extra.length * 16;
  const shstrOff = off;
  off += shstrLen;
  const shoff = align(off, 8);
  const shnum = shnames.length;
  const total = shoff + shnum * 64;
  const w = new W(total);
  // header
  w.bytes(0, Uint8Array.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0]));
  w.u16(16, 3); // ET_DYN
  w.u16(18, 62); // x86-64
  w.u32(20, 1);
  w.u64(24, textOff);
  w.u64(32, phoff);
  w.u64(40, shoff);
  w.u16(52, 64);
  w.u16(54, 56);
  w.u16(56, phnum);
  w.u16(58, 64);
  w.u16(60, shnum);
  w.u16(62, 6);
  // program headers: LOAD, [INTERP], DYNAMIC
  const ph = (i: number, type: number, flags: number, offset: number, size: number, alignTo: number) => {
    const p = phoff + i * 56;
    w.u32(p, type);
    w.u32(p + 4, flags);
    w.u64(p + 8, offset);
    w.u64(p + 16, offset);
    w.u64(p + 24, offset);
    w.u64(p + 32, size);
    w.u64(p + 40, size);
    w.u64(p + 48, alignTo);
  };
  let pi = 0;
  ph(pi++, 1, 5, 0, total, 0x1000);
  if (interp) ph(pi++, 3, 4, interpOff, interpLen, 1);
  ph(pi++, 2, 6, dynamicOff, dynEntries * 16, 8);
  if (interp) w.str(interpOff, interp);
  for (const s of strs) w.str(dynstrOff + strOff.get(s)!, s);
  // dynsym: null, imports (undefined), exports (defined in .text = section 4)
  let si = 1;
  for (const s of importsList) {
    const p = dynsymOff + si++ * 24;
    w.u32(p, strOff.get(s)!);
    w.u8(p + 4, 0x12);
  }
  for (const s of exportsList) {
    const p = dynsymOff + si++ * 24;
    w.u32(p, strOff.get(s)!);
    w.u8(p + 4, 0x12);
    w.u16(p + 6, 4);
    w.u64(p + 8, textOff);
    w.u64(p + 16, 1);
  }
  w.u8(textOff, 0xc3);
  let di = 0;
  const dyn = (tag: number, val: number) => {
    w.u64(dynamicOff + di * 16, tag);
    w.u64(dynamicOff + di * 16 + 8, val);
    di++;
  };
  for (const n of needed) dyn(1, strOff.get(n)!);
  if (o.soname) dyn(14, strOff.get(o.soname)!);
  if (o.runpath) dyn(29, strOff.get(o.runpath)!);
  dyn(5, dynstrOff);
  dyn(6, dynsymOff);
  dyn(10, dynstrLen);
  dyn(11, 24);
  dyn(0, 0);
  for (let i = 0; i < extra.length; i++) w.str(extraOff + i * 16, "\xffGo buildinf:");
  for (let i = 0; i < shnames.length; i++) w.str(shstrOff + shOff[i]!, shnames[i]!);
  const sh = (
    i: number,
    type: number,
    flags: number,
    offset: number,
    size: number,
    link = 0,
    info = 0,
    entsize = 0,
  ) => {
    const p = shoff + i * 64;
    w.u32(p, shOff[i]!);
    w.u32(p + 4, type);
    w.u64(p + 8, flags);
    w.u64(p + 16, flags & 2 ? offset : 0);
    w.u64(p + 24, offset);
    w.u64(p + 32, size);
    w.u32(p + 40, link);
    w.u32(p + 44, info);
    w.u64(p + 48, 8);
    w.u64(p + 56, entsize);
  };
  sh(1, 1, 2, interpOff, interpLen);
  sh(2, 3, 2, dynstrOff, dynstrLen);
  sh(3, 11, 2, dynsymOff, nsyms * 24, 2, 1, 24);
  sh(4, 1, 6, textOff, 16);
  sh(5, 6, 3, dynamicOff, dynEntries * 16, 2, 0, 16);
  sh(6, 3, 0, shstrOff, shstrLen);
  for (let i = 0; i < extra.length; i++) sh(7 + i, 1, 2, extraOff + i * 16, 16);
  return w.buf;
}

// ---------------------------------------------------------------------------------- PE ----

export interface PeOptions {
  imports?: Record<string, string[]>;
  exports?: string[];
  dllName?: string;
  timestamp?: number;
  subsystem?: number;
  dll?: boolean;
  clr?: boolean;
}

export function makePe64(o: PeOptions = {}): Uint8Array {
  const imports = o.imports ?? { "KERNEL32.dll": ["ExitProcess"] };
  const exportsList = [...(o.exports ?? [])].sort();
  const ts = o.timestamp ?? 0x5f000000;
  const dlls = Object.keys(imports);
  const hasExp = exportsList.length > 0;
  const nsec = hasExp ? 3 : 2;
  // .idata layout (rva base 0x2000)
  const base = 0x2000;
  let p = (dlls.length + 1) * 20;
  const ilt: number[] = [];
  const iat: number[] = [];
  for (const d of dlls) {
    ilt.push(p);
    p += (imports[d]!.length + 1) * 8;
  }
  for (const d of dlls) {
    iat.push(p);
    p += (imports[d]!.length + 1) * 8;
  }
  const hint = new Map<string, number>();
  for (const d of dlls)
    for (const f of imports[d]!) {
      if (hint.has(`${d}!${f}`)) continue;
      hint.set(`${d}!${f}`, p);
      p = align(p + 2 + f.length + 1, 2);
    }
  const nameAt: number[] = [];
  for (const d of dlls) {
    nameAt.push(p);
    p += d.length + 1;
  }
  const idataSize = align(p, 0x200);
  // .edata layout (rva base 0x3000)
  const ebase = 0x3000;
  const dllName = o.dllName ?? "assay.dll";
  let q = 40;
  const eat = q;
  q += exportsList.length * 4;
  const enames = q;
  q += exportsList.length * 4;
  const eords = q;
  q += exportsList.length * 2;
  const edll = q;
  q += dllName.length + 1;
  const estr: number[] = [];
  for (const e of exportsList) {
    estr.push(q);
    q += e.length + 1;
  }
  const edataSize = hasExp ? align(q, 0x200) : 0;
  const idataRaw = 0x400;
  const edataRaw = idataRaw + idataSize;
  const total = 0x400 + idataSize + edataSize;
  const w = new W(total);
  w.str(0, "MZ");
  w.u32(0x3c, 0x40);
  w.str(0x40, "PE\0\0");
  const c = 0x44;
  w.u16(c, 0x8664);
  w.u16(c + 2, nsec);
  w.u32(c + 4, ts);
  w.u16(c + 16, 240);
  w.u16(c + 18, o.dll ? 0x2022 : 0x0022);
  const opt = c + 20;
  w.u16(opt, 0x20b);
  w.u8(opt + 2, 14);
  w.u32(opt + 4, 0x200);
  w.u32(opt + 16, 0x1000);
  w.u32(opt + 20, 0x1000);
  w.u64(opt + 24, 0x140000000);
  w.u32(opt + 32, 0x1000);
  w.u32(opt + 36, 0x200);
  w.u16(opt + 40, 6);
  w.u16(opt + 48, 6);
  w.u32(opt + 56, 0x1000 * (nsec + 1));
  w.u32(opt + 60, 0x200);
  w.u16(opt + 68, o.subsystem ?? 3);
  w.u16(opt + 70, 0x8160);
  w.u64(opt + 72, 0x100000);
  w.u64(opt + 80, 0x1000);
  w.u64(opt + 88, 0x100000);
  w.u64(opt + 96, 0x1000);
  w.u32(opt + 108, 16);
  const dd = opt + 112;
  if (hasExp) {
    w.u32(dd, ebase);
    w.u32(dd + 4, q);
  }
  w.u32(dd + 8, base);
  w.u32(dd + 12, (dlls.length + 1) * 20);
  w.u32(dd + 12 * 8, base + iat[0]!);
  w.u32(dd + 12 * 8 + 4, p - iat[0]!);
  if (o.clr) {
    w.u32(dd + 14 * 8, 0x1000);
    w.u32(dd + 14 * 8 + 4, 72);
  }
  const sec = (i: number, name: string, va: number, size: number, raw: number, chars: number) => {
    const s = opt + 240 + i * 40;
    w.str(s, name);
    w.u32(s + 8, size);
    w.u32(s + 12, va);
    w.u32(s + 16, size);
    w.u32(s + 20, raw);
    w.u32(s + 36, chars);
  };
  sec(0, ".text", 0x1000, 0x200, 0x200, 0x60000020);
  sec(1, ".idata", base, idataSize, idataRaw, 0xc0000040);
  if (hasExp) sec(2, ".edata", ebase, edataSize, edataRaw, 0x40000040);
  w.u8(0x200, 0xc3);
  const r = idataRaw;
  dlls.forEach((d, i) => {
    const desc = r + i * 20;
    w.u32(desc, base + ilt[i]!);
    w.u32(desc + 12, base + nameAt[i]!);
    w.u32(desc + 16, base + iat[i]!);
    imports[d]!.forEach((f, k) => {
      const h = base + hint.get(`${d}!${f}`)!;
      w.u64(r + ilt[i]! + k * 8, h);
      w.u64(r + iat[i]! + k * 8, h);
    });
    w.str(r + nameAt[i]!, d);
  });
  for (const [k, at] of hint) w.str(r + at + 2, k.split("!")[1]!);
  if (hasExp) {
    const e = edataRaw;
    w.u32(e + 4, ts);
    w.u32(e + 12, ebase + edll);
    w.u32(e + 16, 1);
    w.u32(e + 20, exportsList.length);
    w.u32(e + 24, exportsList.length);
    w.u32(e + 28, ebase + eat);
    w.u32(e + 32, ebase + enames);
    w.u32(e + 36, ebase + eords);
    exportsList.forEach((name, i) => {
      w.u32(e + eat + i * 4, 0x1000);
      w.u32(e + enames + i * 4, ebase + estr[i]!);
      w.u16(e + eords + i * 2, i);
      w.str(e + estr[i]!, name);
    });
    w.str(e + edll, dllName);
  }
  return w.buf;
}

// -------------------------------------------------------------------------------- Mach-O ----

export interface MachOOptions {
  bits?: 32 | 64;
  le?: boolean;
  cpu?: "x86_64" | "arm64" | "x86" | "ppc";
  filetype?: number;
  dylibs?: string[];
  weak?: string[];
  rpaths?: string[];
  id?: string | null;
  codeSignature?: boolean;
  sections?: string[];
}

const CPUS = { x86_64: [0x01000007, 3], arm64: [0x0100000c, 0], x86: [7, 3], ppc: [18, 0] } as const;

export function makeMachO(o: MachOOptions = {}): Uint8Array {
  const bits = o.bits ?? 64;
  const le = o.le ?? true;
  const [cputype, sub] = CPUS[o.cpu ?? (bits === 64 ? "x86_64" : "x86")];
  const dylibs = o.dylibs ?? ["/usr/lib/libSystem.B.dylib"];
  const weak = o.weak ?? [];
  const rpaths = o.rpaths ?? [];
  const sections = o.sections ?? ["__text"];
  const cmds: { cmd: number; size: number; fill: (w: W, at: number) => void }[] = [];
  const pad = bits === 64 ? 8 : 4;
  if (bits === 64) {
    const size = 72 + sections.length * 80;
    cmds.push({
      cmd: 0x19,
      size,
      fill: (w, at) => {
        w.str(at + 8, "__TEXT");
        w.u32(at + 64, sections.length);
        sections.forEach((s, i) => {
          w.str(at + 72 + i * 80, s);
          w.str(at + 72 + i * 80 + 16, "__TEXT");
        });
      },
    });
  }
  const dylibCmd = (cmd: number, name: string, cur: number) => {
    cmds.push({
      cmd,
      size: align(24 + name.length + 1, pad),
      fill: (w, at) => {
        w.u32(at + 8, 24);
        w.u32(at + 12, 2);
        w.u32(at + 16, cur);
        w.u32(at + 20, 0x10000);
        w.str(at + 24, name);
      },
    });
  };
  if (o.id) dylibCmd(0xd, o.id, 0x10203);
  for (const d of dylibs) dylibCmd(0xc, d, 0x5140000);
  for (const d of weak) dylibCmd(0x80000018, d, 0x10000);
  for (const r of rpaths)
    cmds.push({
      cmd: 0x8000001c,
      size: align(12 + r.length + 1, pad),
      fill: (w, at) => {
        w.u32(at + 8, 12);
        w.str(at + 12, r);
      },
    });
  cmds.push({
    cmd: 0x1b,
    size: 24,
    fill: (w, at) => {
      for (let i = 0; i < 16; i++) w.u8(at + 8 + i, (i * 17 + 3) & 0xff);
    },
  });
  cmds.push({
    cmd: 0x32,
    size: 24,
    fill: (w, at) => {
      w.u32(at + 8, 1);
      w.u32(at + 12, 0x000b0000);
      w.u32(at + 16, 0x000e0000);
    },
  });
  const hdr = bits === 64 ? 32 : 28;
  const sizeofcmds = cmds.reduce((a, c) => a + c.size, 0) + (o.codeSignature ? 16 : 0);
  const sigOff = align(hdr + sizeofcmds, 16);
  const total = o.codeSignature ? sigOff + 16 : align(hdr + sizeofcmds + 16, 16);
  const w = new W(total, le);
  w.u32(0, bits === 64 ? 0xfeedfacf : 0xfeedface);
  w.u32(4, cputype);
  w.u32(8, sub);
  w.u32(12, o.filetype ?? (o.id ? 6 : 2));
  w.u32(16, cmds.length + (o.codeSignature ? 1 : 0));
  w.u32(20, sizeofcmds);
  w.u32(24, 0x00200085);
  let at = hdr;
  for (const c of cmds) {
    w.u32(at, c.cmd);
    w.u32(at + 4, c.size);
    c.fill(w, at);
    at += c.size;
  }
  if (o.codeSignature) {
    w.u32(at, 0x1d);
    w.u32(at + 4, 16);
    w.u32(at + 8, sigOff);
    w.u32(at + 12, 16);
    const be = new W(16, false);
    be.u32(0, 0xfade0cc0);
    be.u32(4, 16);
    w.bytes(sigOff, be.buf);
  }
  return w.buf;
}

export function makeFat(slices: { cpu: keyof typeof CPUS; bytes: Uint8Array }[]): Uint8Array {
  const alignPow = 12;
  let off = align(8 + slices.length * 20, 1 << alignPow);
  const placed = slices.map((s) => {
    const at = off;
    off = align(off + s.bytes.length, 1 << alignPow);
    return { ...s, at };
  });
  const total = placed.length ? placed[placed.length - 1]!.at + placed[placed.length - 1]!.bytes.length : 8;
  const w = new W(total, false);
  w.u32(0, 0xcafebabe);
  w.u32(4, slices.length);
  placed.forEach((s, i) => {
    const [cpu, sub] = CPUS[s.cpu];
    const e = 8 + i * 20;
    w.u32(e, cpu);
    w.u32(e + 4, sub);
    w.u32(e + 8, s.at);
    w.u32(e + 12, s.bytes.length);
    w.u32(e + 16, alignPow);
    w.bytes(s.at, s.bytes);
  });
  return w.buf;
}

// ------------------------------------------------------------------------------ archives ----

export interface ArchiveFile {
  name: string;
  data?: Uint8Array | string;
  dir?: boolean;
  symlink?: string;
}

function bytesOf(d: Uint8Array | string | undefined): Uint8Array {
  return d === undefined ? new Uint8Array(0) : typeof d === "string" ? enc.encode(d) : d;
}

export function makeZip(files: ArchiveFile[]): Uint8Array {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let off = 0;
  for (const f of files) {
    const name = enc.encode(f.dir && !f.name.endsWith("/") ? `${f.name}/` : f.name);
    const data = f.symlink !== undefined ? enc.encode(f.symlink) : bytesOf(f.data);
    const crc = crc32(data);
    const l = new W(30 + name.length + data.length);
    l.u32(0, 0x04034b50);
    l.u16(4, 20);
    l.u16(6, 0x800);
    l.u16(12, 0x21);
    l.u32(14, crc);
    l.u32(18, data.length);
    l.u32(22, data.length);
    l.u16(26, name.length);
    l.bytes(30, name);
    l.bytes(30 + name.length, data);
    const c = new W(46 + name.length);
    c.u32(0, 0x02014b50);
    c.u16(4, 0x031e);
    c.u16(6, 20);
    c.u16(8, 0x800);
    c.u16(14, 0x21);
    c.u32(16, crc);
    c.u32(20, data.length);
    c.u32(24, data.length);
    c.u16(28, name.length);
    const mode = f.dir ? 0o40755 : f.symlink !== undefined ? 0o120777 : 0o100644;
    c.u32(38, ((mode << 16) >>> 0) | (f.dir ? 0x10 : 0));
    c.u32(42, off);
    c.bytes(46, name);
    locals.push(l.buf);
    centrals.push(c.buf);
    off += l.buf.length;
  }
  const cd = concat(centrals);
  const e = new W(22);
  e.u32(0, 0x06054b50);
  e.u16(8, files.length);
  e.u16(10, files.length);
  e.u32(12, cd.length);
  e.u32(16, off);
  return concat([...locals, cd, e.buf]);
}

function octalField(w: W, at: number, len: number, v: number): void {
  w.str(at, `${v.toString(8).padStart(len - 1, "0")}\0`);
}

export function makeTar(files: ArchiveFile[]): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const f of files) {
    const data = bytesOf(f.data);
    const h = new W(512);
    let name = f.name;
    let prefix = "";
    if (enc.encode(name).length > 100) {
      const cut = name.lastIndexOf("/", 155);
      prefix = name.slice(0, cut);
      name = name.slice(cut + 1);
    }
    h.str(0, name);
    octalField(h, 100, 8, f.dir ? 0o755 : 0o644);
    octalField(h, 108, 8, 0);
    octalField(h, 116, 8, 0);
    octalField(h, 124, 12, f.dir || f.symlink !== undefined ? 0 : data.length);
    octalField(h, 136, 12, 0);
    h.str(148, "        ");
    h.str(156, f.dir ? "5" : f.symlink !== undefined ? "2" : "0");
    if (f.symlink !== undefined) h.str(157, f.symlink);
    h.str(257, "ustar\0");
    h.str(263, "00");
    h.str(265, "root");
    h.str(297, "root");
    if (prefix) h.str(345, prefix);
    let sum = 0;
    for (const b of h.buf) sum += b;
    h.str(148, `${sum.toString(8).padStart(6, "0")}\0 `);
    parts.push(h.buf);
    if (!f.dir && f.symlink === undefined && data.length > 0) {
      const body = new Uint8Array(align(data.length, 512));
      body.set(data);
      parts.push(body);
    }
  }
  parts.push(new Uint8Array(1024));
  return concat(parts);
}

/** gzip with stored (uncompressed) deflate blocks: byte-identical everywhere. */
export function gzipStored(data: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [Uint8Array.from([0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 0, 0xff])];
  let o = 0;
  do {
    const n = Math.min(65535, data.length - o);
    const final = o + n >= data.length;
    const h = new W(5);
    h.u8(0, final ? 1 : 0);
    h.u16(1, n);
    h.u16(3, ~n & 0xffff);
    parts.push(h.buf, data.subarray(o, o + n));
    o += n;
  } while (o < data.length);
  const t = new W(8);
  t.u32(0, crc32(data));
  t.u32(4, data.length);
  parts.push(t.buf);
  return concat(parts);
}

export type AsarTree = { [name: string]: AsarTree | string | Uint8Array | { unpacked: number } };

export function makeAsar(tree: AsarTree): Uint8Array {
  const blobs: Uint8Array[] = [];
  let off = 0;
  const walk = (t: AsarTree): unknown => {
    const files: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(t)) {
      if (typeof v === "string" || v instanceof Uint8Array) {
        const b = bytesOf(v);
        files[k] = { size: b.length, offset: String(off) };
        blobs.push(b);
        off += b.length;
      } else if ("unpacked" in v && typeof v.unpacked === "number") files[k] = { size: v.unpacked, unpacked: true };
      else files[k] = walk(v as AsarTree);
    }
    return { files };
  };
  const json = enc.encode(JSON.stringify(walk(tree)));
  const payloadLen = align(4 + json.length, 4);
  const w = new W(16 + payloadLen - 4);
  w.u32(0, 4);
  w.u32(4, payloadLen + 4);
  w.u32(8, payloadLen);
  w.u32(12, json.length);
  w.bytes(16, json);
  return concat([w.buf, ...blobs]);
}

export function makeNpmTgz(pkg: Record<string, unknown>, files: Record<string, string | Uint8Array> = {}): Uint8Array {
  const entries: ArchiveFile[] = [{ name: "package/package.json", data: JSON.stringify(pkg, null, 2) }];
  for (const [k, v] of Object.entries(files)) entries.push({ name: `package/${k}`, data: v });
  return gzipStored(makeTar(entries));
}

// --------------------------------------------------------------------------------- wasm ----

function leb(n: number): number[] {
  const out: number[] = [];
  do {
    let b = n & 0x7f;
    n = Math.floor(n / 128);
    if (n > 0) b |= 0x80;
    out.push(b);
  } while (n > 0);
  return out;
}

function wname(s: string): number[] {
  const b = [...enc.encode(s)];
  return [...leb(b.length), ...b];
}

function section(id: number, payload: number[]): number[] {
  return [id, ...leb(payload.length), ...payload];
}

export function makeWasm(o: { imports?: { module: string; name: string }[]; exports?: string[] } = {}): Uint8Array {
  const imports = o.imports ?? [{ module: "env", name: "log" }];
  const exportsList = o.exports ?? ["run"];
  const out: number[] = [0, 0x61, 0x73, 0x6d, 1, 0, 0, 0];
  out.push(...section(1, [1, 0x60, 0, 0]));
  out.push(
    ...section(2, [...leb(imports.length), ...imports.flatMap((i) => [...wname(i.module), ...wname(i.name), 0, 0])]),
  );
  out.push(...section(3, [1, 0]));
  out.push(...section(5, [1, 0, 1]));
  const exp: number[] = [...leb(exportsList.length + 1)];
  for (const e of exportsList) exp.push(...wname(e), 0, ...leb(imports.length));
  exp.push(...wname("memory"), 2, 0);
  out.push(...section(7, exp));
  out.push(...section(10, [1, 2, 0, 0x0b]));
  out.push(...section(0, [...wname("producers"), 0]));
  return Uint8Array.from(out);
}

// -------------------------------------------------------------------- identified-only ----

function pngChunk(type: string, data: number[]): number[] {
  const td = Uint8Array.from([...enc.encode(type), ...data]);
  const w = new W(8);
  w.dv.setUint32(0, data.length, false);
  w.dv.setUint32(4, crc32(td), false);
  return [...w.buf.subarray(0, 4), ...td, ...w.buf.subarray(4, 8)];
}

export const SAMPLES = {
  sqlite: () =>
    concat([
      enc.encode("SQLite format 3\0"),
      Uint8Array.from([0x10, 0, 1, 1, 0, 0x40, 0x20, 0x20]),
      new Uint8Array(488),
    ]),
  pdf: () => enc.encode("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n"),
  png: () =>
    Uint8Array.from([
      0x89,
      0x50,
      0x4e,
      0x47,
      0x0d,
      0x0a,
      0x1a,
      0x0a,
      ...pngChunk("IHDR", [0, 0, 0, 1, 0, 0, 0, 1, 8, 0, 0, 0, 0]),
      ...pngChunk("IEND", []),
    ]),
  jpeg: () =>
    Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]),
  hermes: () =>
    concat([Uint8Array.from([0xc6, 0x1f, 0xbc, 0x03, 0xc1, 0x03, 0x19, 0x1f, 96, 0, 0, 0]), new Uint8Array(52)]),
  plist: () => concat([enc.encode("bplist00"), Uint8Array.from([0xd0, 8, 0, 0, 0, 0, 0, 0, 1, 1])]),
  pcap: () =>
    Uint8Array.from([0xd4, 0xc3, 0xb2, 0xa1, 2, 0, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff, 0, 0, 1, 0, 0, 0]),
  javaClass: () => Uint8Array.from([0xca, 0xfe, 0xba, 0xbe, 0, 0, 0, 0x34, 0, 0x10, 0, 0, 0, 0, 0, 0]),
  unknown: () => {
    const b = new Uint8Array(256);
    let s = 7;
    for (let i = 0; i < b.length; i++) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      b[i] = s & 0xff;
    }
    b[0] = 0x00;
    b[1] = 0x01;
    b[2] = 0xfe;
    return b;
  },
};

// ------------------------------------------------------------------------- fixture set ----

export interface Fixture {
  name: string;
  /** Expected identification. */
  format: string;
  /** Workspace-relative subject path. */
  subject: string;
  files: { rel: string; bytes: Uint8Array }[];
  /** Probes that must run cleanly on it in a sweep (besides file.identify). */
  probes: string[];
}

const t = (s: string) => enc.encode(s);

export const APP_JS = `import fs from "node:fs";
import { helper } from "./lib/helper.js";
export * from "./reexport.js";
const cfg = require("./config.json");
const w = new Worker(new URL("./worker.js", import.meta.url));
// import("./commented-out.js") must not count
const s = "require('./in-a-string.js')";
fetch("https://api.example.com/v1/items");
export async function load() { return import("./lazy.js"); }
`;

export function fixtureSet(): Fixture[] {
  const crxPrefix = concat([t("Cr24"), Uint8Array.from([3, 0, 0, 0, 4, 0, 0, 0, 1, 2, 3, 4])]);
  const zipFiles: ArchiveFile[] = [
    { name: "readme.txt", data: "hello\n" },
    { name: "lib/", dir: true },
    { name: "lib/a.js", data: "export {}\n" },
  ];
  const thin64 = makeMachO({
    dylibs: ["/usr/lib/libSystem.B.dylib", "@rpath/libfoo.dylib"],
    rpaths: ["@executable_path/../Frameworks"],
    codeSignature: true,
  });
  const arm = makeMachO({ cpu: "arm64", dylibs: ["/usr/lib/libSystem.B.dylib", "/usr/lib/libc++.1.dylib"] });
  const f = (name: string, format: string, subject: string, bytes: Uint8Array, probes: string[]): Fixture => ({
    name,
    format,
    subject,
    files: [{ rel: subject, bytes }],
    probes,
  });
  return [
    f(
      "elf",
      "elf",
      "bin/tiny.so",
      makeElf64({
        needed: ["libssl.so.3", "libc.so.6"],
        exports: ["assay_entry", "assay_init"],
        soname: "libtiny.so.1",
      }),
      ["elf.info"],
    ),
    f(
      "pe",
      "pe",
      "bin/tool.exe",
      makePe64({ imports: { "KERNEL32.dll": ["CreateFileW", "ReadFile"], "WS2_32.dll": ["connect"] } }),
      ["pe.info"],
    ),
    f("pe-dll", "pe", "bin/lib.dll", makePe64({ dll: true, exports: ["AssayInit", "AssayRun"], dllName: "lib.dll" }), [
      "pe.info",
    ]),
    f("macho", "macho", "bin/tool", thin64, ["macho.info"]),
    f(
      "macho-fat",
      "macho-fat",
      "bin/universal",
      makeFat([
        { cpu: "x86_64", bytes: thin64 },
        { cpu: "arm64", bytes: arm },
      ]),
      ["macho.info"],
    ),
    f("wasm", "wasm", "web/mod.wasm", makeWasm(), ["wasm.info"]),
    f("zip", "zip", "dist/bundle.zip", makeZip([...zipFiles, { name: "../evil.sh", data: "#!/bin/sh\n" }]), [
      "archive.list",
    ]),
    f("jar", "jar", "dist/app.jar", makeZip([{ name: "META-INF/MANIFEST.MF", data: "Manifest-Version: 1.0\n" }]), [
      "archive.list",
    ]),
    f(
      "apk",
      "apk",
      "dist/app.apk",
      makeZip([
        { name: "AndroidManifest.xml", data: "<manifest/>" },
        { name: "classes.dex", data: "dex\n035\0" },
      ]),
      ["archive.list"],
    ),
    f("vsix", "vsix", "dist/ext.vsix", makeZip([{ name: "extension.vsixmanifest", data: "<x/>" }]), ["archive.list"]),
    f("crx", "crx", "dist/ext.crx", concat([crxPrefix, makeZip([{ name: "manifest.json", data: "{}" }])]), [
      "archive.list",
    ]),
    f(
      "tar",
      "tar",
      "dist/files.tar",
      makeTar([
        { name: "a.txt", data: "a\n" },
        { name: "d", dir: true },
        { name: "d/b.txt", data: "b\n" },
      ]),
      ["archive.list"],
    ),
    f("tar.gz", "tar.gz", "dist/files.tar.gz", gzipStored(makeTar([{ name: "src/a.txt", data: "a\n" }])), [
      "archive.list",
    ]),
    f(
      "npm-tgz",
      "npm-tgz",
      "dist/pkg-1.0.0.tgz",
      makeNpmTgz(
        {
          name: "pkg",
          version: "1.0.0",
          scripts: { postinstall: "node setup.js" },
          dependencies: { leftpad: "^1.0.0" },
        },
        { "setup.js": "console.log(1)\n" },
      ),
      ["archive.list", "pkg.manifest", "pkg.native-addons"],
    ),
    f(
      "asar",
      "asar",
      "app/app.asar",
      makeAsar({
        "package.json": '{"name":"app","main":"main.js"}',
        "main.js": 'require("electron")\n',
        lib: { "x.js": "1\n" },
      }),
      ["archive.list"],
    ),
    f("gzip", "gzip", "logs/notes.txt.gz", gzipStored(t("just text\n".repeat(20))), []),
    f("sqlite", "sqlite", "data/app.db", SAMPLES.sqlite(), []),
    f("pdf", "pdf", "docs/doc.pdf", SAMPLES.pdf(), []),
    f("png", "png", "img/a.png", SAMPLES.png(), []),
    f("jpeg", "jpeg", "img/a.jpg", SAMPLES.jpeg(), []),
    f("hermes-bytecode", "hermes-bytecode", "rn/index.android.bundle", SAMPLES.hermes(), []),
    f("plist", "plist", "mac/Info.plist", SAMPLES.plist(), []),
    f("pcap", "pcap", "net/cap.pcap", SAMPLES.pcap(), []),
    f("java-class", "java-class", "java/Main.class", SAMPLES.javaClass(), []),
    f("unknown", "unknown", "misc/blob.bin", SAMPLES.unknown(), []),
    f("script", "script", "bin/run", t('#!/usr/bin/env node\nconst x = require("./x.js");\n'), [
      "js.imports",
      "js.endpoints",
      "code.obfuscation",
    ]),
    f("javascript", "javascript", "src/app.js", t(APP_JS), ["js.imports", "js.endpoints", "code.obfuscation"]),
    f(
      "typescript",
      "typescript",
      "src/mod.ts",
      t('import type { A } from "./types.ts";\nexport const x: number = 1;\n'),
      ["js.imports", "js.endpoints", "code.obfuscation"],
    ),
    f("json", "json", "conf/data.json", t('{"endpoint":"https://cfg.example.org/x"}\n'), ["js.endpoints"]),
    f(
      "package-json",
      "package-json",
      "pj/package.json",
      t('{"name":"pj","version":"0.0.1","dependencies":{"a":"1"}}\n'),
      ["pkg.manifest", "js.endpoints"],
    ),
    f("text", "text", "docs/README.txt", t("plain words\n"), []),
    {
      name: "npm-package",
      format: "npm-package",
      subject: "pkgdir",
      files: [
        {
          rel: "pkgdir/package.json",
          bytes: t('{"name":"native-thing","version":"2.0.0","gypfile":true,"dependencies":{"node-gyp-build":"^4"}}'),
        },
        { rel: "pkgdir/binding.gyp", bytes: t('{"targets":[{"target_name":"addon","sources":["addon.cc"]}]}') },
        { rel: "pkgdir/index.js", bytes: t('module.exports = require("node-gyp-build")(__dirname);\n') },
        {
          rel: "pkgdir/build/Release/addon.node",
          bytes: makeElf64({ needed: ["libuv.so.1", "libc.so.6"], interp: null }),
        },
      ],
      probes: ["dir.inventory", "pkg.native-addons", "pkg.manifest", "js.imports", "elf.info"],
    },
    {
      name: "directory",
      format: "directory",
      subject: "plain",
      files: [
        { rel: "plain/a.txt", bytes: t("a\n") },
        { rel: "plain/sub/b.js", bytes: t('import "./c.js";\n') },
      ],
      probes: ["dir.inventory", "pkg.native-addons", "js.imports"],
    },
  ];
}
