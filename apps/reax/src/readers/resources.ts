// PE resources: the type / name / language tree under the resource directory, and the contents
// of the ones agents ask about: version information (fixed file info and every StringFileInfo
// value), string tables and the side-by-side manifest. Checked against llvm-readobj
// --coff-resources (the tree) and pefile (the decoded version information and strings).
import type { LayoutSlice } from "./layout.ts";

export interface Resource {
  type: string;
  typeId: number | null;
  name: string;
  nameId: number | null;
  language: number;
  rva: number;
  size: number;
  codepage: number;
  /** File offset of the data, or null when its RVA maps to no file bytes. */
  offset: number | null;
}

export interface VersionInfo {
  fileVersion: string;
  productVersion: string;
  fileFlags: number;
  fileOs: number;
  fileType: number;
  /** "040904b0" -> { CompanyName: "...", ... } */
  strings: Record<string, Record<string, string>>;
  translations: string[];
}

export interface ResourceSet {
  resources: Resource[];
  version: VersionInfo | null;
  strings: { id: number; language: number; text: string }[];
  manifest: string | null;
  notes: string[];
}

const TYPES: Record<number, string> = {
  1: "CURSOR",
  2: "BITMAP",
  3: "ICON",
  4: "MENU",
  5: "DIALOG",
  6: "STRINGTABLE",
  7: "FONTDIR",
  8: "FONT",
  9: "ACCELERATOR",
  10: "RCDATA",
  11: "MESSAGETABLE",
  12: "GROUP_CURSOR",
  14: "GROUP_ICON",
  16: "VERSIONINFO",
  17: "DLGINCLUDE",
  19: "PLUGPLAY",
  20: "VXD",
  21: "ANICURSOR",
  22: "ANIICON",
  23: "HTML",
  24: "MANIFEST",
};

const utf16 = new TextDecoder("utf-16le");

export function peResources(b: Uint8Array, s: LayoutSlice): ResourceSet {
  const d = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const out: ResourceSet = { resources: [], version: null, strings: [], manifest: null, notes: [] };
  const ok = (o: number, n: number) => o >= 0 && o + n <= b.length;
  const base = BigInt(s.imageBase ?? "0x0");
  const off = (rva: number): number | null => {
    for (const x of s.sections) {
      if (x.addr === null || x.offset === null) continue;
      const start = Number(BigInt(x.addr) - base);
      if (rva >= start && rva < start + x.fileSize) return x.offset + (rva - start);
    }
    return null;
  };
  const pe = d.getUint32(0x3c, true);
  const opt = pe + 24;
  const plus = d.getUint16(opt, true) === 0x20b;
  const dirs = opt + (plus ? 112 : 96);
  if (d.getUint32(opt + (plus ? 108 : 92), true) <= 2) return out;
  const rsrcRva = d.getUint32(dirs + 16, true);
  if (!rsrcRva) return out;
  const root = off(rsrcRva);
  if (root === null) {
    out.notes.push("the resource directory maps to no bytes in the file");
    return out;
  }
  const seen = new Set<number>();
  const label = (raw: number): { name: string; id: number | null } => {
    if (raw & 0x80000000) {
      const o = root + (raw & 0x7fffffff);
      if (!ok(o, 2)) return { name: "", id: null };
      const len = d.getUint16(o, true);
      return { name: ok(o + 2, len * 2) ? utf16.decode(b.subarray(o + 2, o + 2 + len * 2)) : "", id: null };
    }
    return { name: String(raw), id: raw };
  };
  const entries = (dirOff: number): { label: number; child: number; isDir: boolean }[] => {
    if (seen.has(dirOff) || !ok(dirOff, 16)) {
      out.notes.push(`a resource directory at ${dirOff} is repeated or cut`);
      return [];
    }
    seen.add(dirOff);
    const n = d.getUint16(dirOff + 12, true) + d.getUint16(dirOff + 14, true);
    const list: { label: number; child: number; isDir: boolean }[] = [];
    for (let i = 0; i < Math.min(n, 65_536); i++) {
      const e = dirOff + 16 + i * 8;
      if (!ok(e, 8)) break;
      const to = d.getUint32(e + 4, true);
      list.push({ label: d.getUint32(e, true), child: root + (to & 0x7fffffff), isDir: (to & 0x80000000) !== 0 });
    }
    return list;
  };
  for (const t of entries(root)) {
    if (!t.isDir) continue;
    const tl = label(t.label);
    const type = tl.id !== null ? (TYPES[tl.id] ?? `#${tl.id}`) : tl.name;
    for (const n of entries(t.child)) {
      if (!n.isDir) continue;
      const nl = label(n.label);
      for (const l of entries(n.child)) {
        if (l.isDir || !ok(l.child, 16)) continue;
        const rva = d.getUint32(l.child, true);
        const size = d.getUint32(l.child + 4, true);
        out.resources.push({
          type,
          typeId: tl.id,
          name: nl.name,
          nameId: nl.id,
          language: l.label & 0xffff,
          rva,
          size,
          codepage: d.getUint32(l.child + 8, true),
          offset: off(rva),
        });
      }
    }
    if (out.resources.length > 100_000) {
      out.notes.push("more than 100000 resources; the rest are not listed");
      break;
    }
  }
  for (const r of out.resources) {
    if (r.offset === null || !ok(r.offset, r.size)) continue;
    const data = b.subarray(r.offset, r.offset + r.size);
    try {
      if (r.typeId === 16 && !out.version) out.version = versionInfo(data);
      else if (r.typeId === 6 && r.nameId !== null) out.strings.push(...stringTable(data, r.nameId, r.language));
      else if (r.typeId === 24 && out.manifest === null)
        out.manifest = new TextDecoder("utf-8").decode(data.subarray(0, 64 * 1024));
    } catch (e) {
      out.notes.push(`${r.type} ${r.name}: ${(e as Error).message}`);
    }
  }
  return out;
}

/** A string table block: 16 counted UTF-16 strings, ids (block - 1) * 16 + i. */
function stringTable(data: Uint8Array, block: number, language: number) {
  const d = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const out: { id: number; language: number; text: string }[] = [];
  let o = 0;
  for (let i = 0; i < 16 && o + 2 <= data.length; i++) {
    const len = d.getUint16(o, true);
    o += 2;
    if (len) out.push({ id: (block - 1) * 16 + i, language, text: utf16.decode(data.subarray(o, o + len * 2)) });
    o += len * 2;
  }
  return out;
}

/** VS_VERSIONINFO: a tree of { wLength, wValueLength, wType, szKey, padding, value, children }. */
function versionInfo(data: Uint8Array): VersionInfo {
  const d = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const align = (o: number) => (o + 3) & ~3;
  const node = (o: number) => {
    const length = d.getUint16(o, true);
    const valueLength = d.getUint16(o + 2, true);
    const type = d.getUint16(o + 4, true);
    let k = o + 6;
    let key = "";
    while (k + 2 <= o + length && d.getUint16(k, true) !== 0) {
      key += String.fromCharCode(d.getUint16(k, true));
      k += 2;
    }
    const valueAt = align(k + 2);
    // wValueLength counts words for text values (wType 1), bytes for binary ones
    const valueBytes = type === 1 ? valueLength * 2 : valueLength;
    return { o, length, type, key, valueAt, valueBytes, childAt: align(valueAt + valueBytes), end: o + length };
  };
  const children = (n: ReturnType<typeof node>) => {
    const list: ReturnType<typeof node>[] = [];
    for (let c = n.childAt; c + 6 <= n.end && c + 6 <= data.length; ) {
      const ch = node(c);
      if (ch.length === 0) break;
      list.push(ch);
      c = align(c + ch.length);
    }
    return list;
  };
  const rootNode = node(0);
  if (rootNode.key !== "VS_VERSION_INFO") throw new Error("not a VS_VERSION_INFO block");
  const ffi = rootNode.valueAt;
  const ver = (hi: number, lo: number) => `${hi >>> 16}.${hi & 0xffff}.${lo >>> 16}.${lo & 0xffff}`;
  const info: VersionInfo = {
    fileVersion: ver(d.getUint32(ffi + 8, true), d.getUint32(ffi + 12, true)),
    productVersion: ver(d.getUint32(ffi + 16, true), d.getUint32(ffi + 20, true)),
    fileFlags: d.getUint32(ffi + 28, true) & d.getUint32(ffi + 24, true),
    fileOs: d.getUint32(ffi + 32, true),
    fileType: d.getUint32(ffi + 36, true),
    strings: {},
    translations: [],
  };
  for (const c of children(rootNode)) {
    if (c.key === "StringFileInfo")
      for (const table of children(c)) {
        const t: Record<string, string> = {};
        for (const v of children(table)) {
          let text = utf16.decode(data.subarray(v.valueAt, v.valueAt + v.valueBytes));
          text = text.replace(/\0+$/, "");
          t[v.key] = text;
        }
        info.strings[table.key] = t;
      }
    else if (c.key === "VarFileInfo")
      for (const v of children(c))
        if (v.key === "Translation")
          for (let o = v.valueAt; o + 4 <= v.valueAt + v.valueBytes; o += 4)
            info.translations.push(
              `${d.getUint16(o, true).toString(16).padStart(4, "0")}${d
                .getUint16(o + 2, true)
                .toString(16)
                .padStart(4, "0")}`,
            );
  }
  return info;
}
