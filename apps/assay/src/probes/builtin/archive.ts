// archive.list: zip (central directory, zip64, prefixed/self-extracting), tar (ustar, GNU long
// names, pax), gzip-wrapped tar (npm tarballs) and Electron ASAR headers. Listing only: nothing is
// extracted to disk. Entry names that would escape an extraction directory are findings.

import { gunzipSync, inflateRawSync } from "node:zlib";
import type { Json } from "../../evidence/jcs.ts";
import { type Finding, findingKey } from "../../evidence/record.ts";
import {
  type AssayProbe,
  asciiAt,
  bytesAt,
  cstr,
  fail,
  isObject,
  numParam,
  params,
  u16,
  u32,
  u64,
  utf8,
} from "../util.ts";
import { familiesOf } from "./identify.ts";

export interface ArchiveEntry {
  name: string;
  size: number;
  type: "file" | "dir" | "symlink" | "hardlink" | "other";
  compressedSize?: number;
  method?: number;
  linkTarget?: string;
  unpacked?: boolean;
  /** Offset of the entry's data in the (decompressed) archive bytes; not part of the result. */
  dataOffset?: number;
}

export interface ArchiveListing {
  container: "zip" | "tar" | "tar.gz" | "asar" | "gzip";
  entries: ArchiveEntry[];
  total: number;
  truncated: boolean;
  notes: string[];
  /** Bytes before the zip data (CRX header, self-extractor stub). */
  prefixBytes?: number;
}

/** Bytes of an archive read into memory; larger archives are reported, not parsed. */
export const ARCHIVE_CAP = 256 * 1024 * 1024;
/** Decompressed size limit for gzip (bomb guard). */
export const GUNZIP_CAP = 256 * 1024 * 1024;

// ---------------------------------------------------------------------------------- zip ----

function findEocd(b: Uint8Array): number {
  const lo = Math.max(0, b.length - 22 - 0xffff);
  for (let i = b.length - 22; i >= lo; i--)
    if (b[i] === 0x50 && b[i + 1] === 0x4b && b[i + 2] === 5 && b[i + 3] === 6) return i;
  return -1;
}

/** The data of a small stored or deflated entry (symlink targets), or null. */
function zipSmallData(b: Uint8Array, local: number, method: number, csize: number, usize: number): string | null {
  if (usize > 4096 || csize > 4096 || !bytesAt(b, local, [0x50, 0x4b, 3, 4])) return null;
  const start = local + 30 + u16(b, local + 26) + u16(b, local + 28);
  const data = b.subarray(start, start + csize);
  if (data.length !== csize) return null;
  if (method === 0) return utf8(data);
  if (method !== 8) return null;
  try {
    return utf8(inflateRawSync(data, { maxOutputLength: 4096 }));
  } catch {
    return null;
  }
}

export function parseZip(b: Uint8Array, max = 5000): ArchiveListing {
  const eocd = findEocd(b);
  if (eocd < 0) fail("zip: end of central directory not found");
  let total = u16(b, eocd + 10);
  let cdSize = u32(b, eocd + 12);
  let cdOffset = u32(b, eocd + 16);
  let cdEnd = eocd;
  const notes: string[] = [];
  if (total === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    const loc = eocd - 20;
    if (loc >= 0 && bytesAt(b, loc, [0x50, 0x4b, 6, 7])) {
      const z = u64(b, loc + 8);
      if (bytesAt(b, z, [0x50, 0x4b, 6, 6])) {
        total = u64(b, z + 32);
        cdSize = u64(b, z + 40);
        cdOffset = u64(b, z + 48);
        cdEnd = z;
        notes.push("zip64");
      } else fail("zip64 end of central directory not found");
    }
  }
  const actualStart = cdEnd - cdSize;
  if (actualStart < 0) fail("zip: central directory size exceeds the file");
  const prefix = actualStart - cdOffset;
  if (prefix < 0) fail("zip: central directory offset points past its end");
  if (prefix > 0) notes.push(`${prefix} bytes before the zip data`);
  const entries: ArchiveEntry[] = [];
  let p = actualStart;
  let seen = 0;
  while (seen < total && p < cdEnd) {
    if (!bytesAt(b, p, [0x50, 0x4b, 1, 2])) fail("zip: bad central directory entry", { offset: p });
    const flags = u16(b, p + 8);
    const method = u16(b, p + 10);
    let csize = u32(b, p + 20);
    let usize = u32(b, p + 24);
    const nlen = u16(b, p + 28);
    const xlen = u16(b, p + 30);
    const clen = u16(b, p + 32);
    const madeBy = u16(b, p + 4) >> 8;
    const ext = u32(b, p + 38);
    const nameBytes = b.subarray(p + 46, p + 46 + nlen);
    if (nameBytes.length !== nlen) fail("zip: entry name past end", { offset: p });
    const name = flags & 0x800 ? utf8(nameBytes) : Buffer.from(nameBytes).toString("latin1");
    if (usize === 0xffffffff || csize === 0xffffffff) {
      let x = p + 46 + nlen;
      const xe = x + xlen;
      while (x + 4 <= xe) {
        const id = u16(b, x);
        const sz = u16(b, x + 2);
        if (id === 1) {
          let q = x + 4;
          if (usize === 0xffffffff && q + 8 <= x + 4 + sz) {
            usize = u64(b, q);
            q += 8;
          }
          if (csize === 0xffffffff && q + 8 <= x + 4 + sz) csize = u64(b, q);
          break;
        }
        x += 4 + sz;
      }
    }
    const mode = ext >>> 16;
    const type: ArchiveEntry["type"] = name.endsWith("/")
      ? "dir"
      : madeBy === 3 && (mode & 0o170000) === 0o120000
        ? "symlink"
        : "file";
    if (entries.length < max) {
      const e: ArchiveEntry = { name, size: usize, compressedSize: csize, method, type };
      if (type === "symlink") {
        const target = zipSmallData(b, u32(b, p + 42) + prefix, method, csize, usize);
        if (target !== null) e.linkTarget = target;
      }
      entries.push(e);
    }
    seen++;
    p += 46 + nlen + xlen + clen;
  }
  if (seen < total) notes.push(`central directory ended after ${seen} of ${total} entries`);
  return {
    container: "zip",
    entries,
    total: seen,
    truncated: seen > entries.length || seen < total,
    notes,
    prefixBytes: prefix,
  };
}

// ---------------------------------------------------------------------------------- tar ----

function octal(b: Uint8Array, o: number, n: number): number {
  if (o + n > b.length) fail("tar: header past end");
  if (b[o]! & 0x80) {
    // base-256 (GNU) for large values
    let v = 0;
    for (let i = 1; i < n; i++) v = v * 256 + b[o + i]!;
    if (!Number.isSafeInteger(v)) fail("tar: size too large");
    return v;
  }
  let s = "";
  for (let i = 0; i < n; i++) {
    const c = b[o + i]!;
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  s = s.trim();
  if (s === "") return 0;
  if (!/^[0-7]+$/.test(s)) fail("tar: bad octal field", { offset: o });
  return Number.parseInt(s, 8);
}

function zeroBlock(b: Uint8Array, o: number): boolean {
  for (let i = o; i < o + 512 && i < b.length; i++) if (b[i] !== 0) return false;
  return true;
}

function headerChecksumOk(b: Uint8Array, o: number): boolean {
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : b[o + i]!;
  let stored: number;
  try {
    stored = octal(b, o + 148, 8);
  } catch {
    return false;
  }
  return sum === stored;
}

function parsePax(data: Uint8Array): Record<string, string> {
  const out: Record<string, string> = {};
  const s = utf8(data);
  let i = 0;
  let guard = 0;
  while (i < s.length && guard++ < 1000) {
    const sp = s.indexOf(" ", i);
    if (sp < 0) break;
    const len = Number.parseInt(s.slice(i, sp), 10);
    if (!Number.isFinite(len) || len <= 0) break;
    const rec = s.slice(sp + 1, i + len - 1);
    const eq = rec.indexOf("=");
    if (eq > 0) out[rec.slice(0, eq)] = rec.slice(eq + 1);
    i += len;
  }
  return out;
}

export function parseTar(b: Uint8Array, max = 5000, container: "tar" | "tar.gz" = "tar"): ArchiveListing {
  const entries: ArchiveEntry[] = [];
  const notes: string[] = [];
  let p = 0;
  let total = 0;
  let longName: string | null = null;
  let longLink: string | null = null;
  let pax: Record<string, string> = {};
  let truncated = false;
  let guard = 0;
  while (p + 512 <= b.length) {
    if (guard++ > 1_000_000) fail("tar: too many headers");
    if (zeroBlock(b, p)) break;
    if (!headerChecksumOk(b, p)) {
      if (p === 0) fail("tar: bad header checksum");
      notes.push(`bad header checksum at offset ${p}; listing stops there`);
      truncated = true;
      break;
    }
    const size = octal(b, p + 124, 12);
    const flag = String.fromCharCode(b[p + 156]!);
    const dataOffset = p + 512;
    const next = dataOffset + Math.ceil(size / 512) * 512;
    if (dataOffset + size > b.length) {
      notes.push(`entry at offset ${p} runs past the end of the archive`);
      truncated = true;
    }
    if (flag === "L" || flag === "K" || flag === "x") {
      const data = b.subarray(dataOffset, Math.min(b.length, dataOffset + Math.min(size, 1 << 20)));
      if (flag === "L") longName = cstr(data, 0, data.length);
      else if (flag === "K") longLink = cstr(data, 0, data.length);
      else pax = parsePax(data);
      p = next;
      continue;
    }
    if (flag === "g") {
      p = next;
      continue;
    }
    let name = cstr(b, p, 100, p + 100);
    if (asciiAt(b, p + 257, "ustar")) {
      const prefix = b[p + 345] === 0 ? "" : cstr(b, p + 345, 155, p + 500);
      if (prefix) name = `${prefix}/${name}`;
    }
    if (longName !== null) name = longName;
    if (pax.path !== undefined) name = pax.path;
    let link = b[p + 157] === 0 ? "" : cstr(b, p + 157, 100, p + 257);
    if (longLink !== null) link = longLink;
    if (pax.linkpath !== undefined) link = pax.linkpath;
    const realSize = pax.size !== undefined && /^\d+$/.test(pax.size) ? Number(pax.size) : size;
    const type: ArchiveEntry["type"] =
      flag === "0" || flag === "\0" || flag === "7"
        ? "file"
        : flag === "5"
          ? "dir"
          : flag === "2"
            ? "symlink"
            : flag === "1"
              ? "hardlink"
              : "other";
    total++;
    if (entries.length < max) {
      const e: ArchiveEntry = { name, size: realSize, type, dataOffset };
      if (link) e.linkTarget = link;
      entries.push(e);
    }
    longName = null;
    longLink = null;
    pax = {};
    if (truncated) break;
    p = next;
  }
  return { container, entries, total, truncated: truncated || total > entries.length, notes };
}

export function gunzipBounded(b: Uint8Array, cap = GUNZIP_CAP): Uint8Array {
  try {
    return gunzipSync(b, { maxOutputLength: cap });
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ERR_BUFFER_TOO_LARGE") fail(`gzip: decompressed size over ${cap} bytes`);
    return fail(`gzip: ${err.code ?? "invalid data"}`);
  }
}

export function tarEntryData(tar: Uint8Array, e: ArchiveEntry, max: number): Uint8Array {
  if (e.dataOffset === undefined) fail("entry has no data offset");
  return tar.subarray(e.dataOffset, Math.min(tar.length, e.dataOffset + Math.min(e.size, max)));
}

// --------------------------------------------------------------------------------- asar ----

export function parseAsar(b: Uint8Array, max = 5000): ArchiveListing {
  if (u32(b, 0) !== 4) fail("asar: bad header pickle");
  const headerSize = u32(b, 4);
  const strLen = u32(b, 12);
  if (strLen > b.length - 16 || strLen > 64 * 1024 * 1024) fail("asar: header length past end");
  let header: unknown;
  try {
    header = JSON.parse(utf8(b.subarray(16, 16 + strLen)));
  } catch {
    fail("asar: header is not valid JSON");
  }
  if (!isObject(header) || !isObject(header.files)) fail("asar: header has no files tree");
  const base = 8 + headerSize;
  const entries: ArchiveEntry[] = [];
  const notes: string[] = [];
  let total = 0;
  const stack: { prefix: string; node: Record<string, Json>; depth: number }[] = [
    { prefix: "", node: header.files as Record<string, Json>, depth: 0 },
  ];
  while (stack.length > 0) {
    const { prefix, node, depth } = stack.pop()!;
    const dirs: { prefix: string; node: Record<string, Json>; depth: number }[] = [];
    for (const k of Object.keys(node).sort()) {
      const v = node[k];
      const name = prefix ? `${prefix}/${k}` : k;
      if (!isObject(v)) {
        notes.push(`malformed entry ${name}`);
        continue;
      }
      total++;
      if (isObject(v.files)) {
        if (entries.length < max) entries.push({ name: `${name}/`, size: 0, type: "dir" });
        if (depth >= 64) notes.push(`nesting below ${name} not listed (depth limit)`);
        else dirs.push({ prefix: name, node: v.files as Record<string, Json>, depth: depth + 1 });
      } else if (typeof v.link === "string") {
        if (entries.length < max) entries.push({ name, size: 0, type: "symlink", linkTarget: v.link });
      } else {
        const size = typeof v.size === "number" && v.size >= 0 ? v.size : 0;
        const off = typeof v.offset === "string" && /^\d+$/.test(v.offset) ? Number(v.offset) : null;
        const e: ArchiveEntry = { name, size, type: "file" };
        if (v.unpacked === true) e.unpacked = true;
        else if (off !== null) e.dataOffset = base + off;
        if (entries.length < max) entries.push(e);
      }
      if (total > 1_000_000) fail("asar: too many entries");
    }
    for (const d of dirs.reverse()) stack.push(d);
  }
  return { container: "asar", entries, total, truncated: total > entries.length, notes };
}

// ------------------------------------------------------------------------------ dispatch ----

/** Why an entry name would escape the extraction directory, or null. */
export function zipSlip(name: string): string | null {
  if (name.includes("\0")) return "NUL byte in name";
  const n = name.replace(/\\/g, "/");
  if (n.startsWith("/")) return "absolute path";
  if (/^[A-Za-z]:/.test(n)) return "drive-letter path";
  let depth = 0;
  for (const seg of n.split("/")) {
    if (seg === "..") depth--;
    else if (seg !== "." && seg !== "") depth++;
    if (depth < 0) return "parent-directory traversal";
  }
  return null;
}

export function listArchive(b: Uint8Array, max = 5000): ArchiveListing {
  if (bytesAt(b, 0, [0x1f, 0x8b])) {
    const inner = gunzipBounded(b);
    if (asciiAt(inner, 257, "ustar") || (inner.length >= 512 && headerChecksumOk(inner, 0)))
      return parseTar(inner, max, "tar.gz");
    return {
      container: "gzip",
      entries: [{ name: "(gzip member)", size: inner.length, type: "file" }],
      total: 1,
      truncated: false,
      notes: ["single gzip stream, not a tar archive"],
    };
  }
  if (b.length >= 24 && u32(b, 0) === 4 && asciiAt(b, 16, '{"files"')) return parseAsar(b, max);
  if (asciiAt(b, 257, "ustar")) return parseTar(b, max);
  if (findEocd(b) >= 0) return parseZip(b, max);
  return fail("not a supported archive (zip, tar, tar.gz, asar)");
}

const ARCHIVE_FAMILIES = new Set(["zip", "tar", "tar.gz", "asar"]);
const ALL = ["linux", "darwin", "win32"] as ("linux" | "darwin" | "win32")[];

export const archiveList: AssayProbe = {
  id: "archive.list",
  version: "1",
  predicate: "archive.list",
  summary: "List archive entries (zip, tar, tar.gz/npm tarball, ASAR); flags names that escape the extraction dir",
  appliesTo: (i) => i.kind === "file" && familiesOf(i.format).some((f) => ARCHIVE_FAMILIES.has(f)),
  platforms: ALL,
  cost: "cheap",
  confidence: "observed",
  sweep: ["each"],
  async run(ctx) {
    const p = params(ctx.params);
    const max = numParam(p, "max", 5000, 1, 100_000);
    if (ctx.subject.size > ARCHIVE_CAP) fail(`archive larger than ${ARCHIVE_CAP} bytes; not parsed`);
    const b = await ctx.read(undefined, ARCHIVE_CAP);
    const l = listArchive(b, max);
    const findings: Finding[] = [];
    const slips: { name: string; reason: string }[] = [];
    for (const e of l.entries) {
      const why = zipSlip(e.name) ?? (e.type === "symlink" && e.linkTarget ? linkEscape(e.name, e.linkTarget) : null);
      if (why) {
        slips.push({ name: e.name, reason: why });
        findings.push({
          key: findingKey("archive.zip-slip", { name: e.name }),
          class: "archive.zip-slip",
          label: `${e.name}: ${why}`,
        });
      }
    }
    const entries = l.entries.map((e) => {
      const o: Record<string, Json> = { name: e.name, size: e.size, type: e.type };
      if (e.compressedSize !== undefined) o.compressedSize = e.compressedSize;
      if (e.method !== undefined) o.method = e.method;
      if (e.linkTarget !== undefined) o.linkTarget = e.linkTarget;
      if (e.unpacked) o.unpacked = true;
      return o;
    });
    const skipped = l.truncated
      ? [{ what: `${Math.max(0, l.total - l.entries.length)} entries`, reason: l.notes.join("; ") || "entry cap" }]
      : [];
    return {
      result: {
        container: l.container,
        entries,
        total: l.total,
        truncated: l.truncated,
        notes: l.notes,
        zipSlip: slips,
        prefixBytes: l.prefixBytes ?? 0,
      },
      coverage: {
        status: l.truncated ? "partial" : "complete",
        examined: l.entries.length,
        skipped,
        unresolved: 0,
        unclaimed: 0,
      },
      findings,
      limitations: l.container === "zip" ? ["names and sizes come from the central directory, not local headers"] : [],
    };
  },
};

function linkEscape(name: string, target: string): string | null {
  if (target.startsWith("/") || /^[A-Za-z]:/.test(target)) return "symlink to an absolute path";
  const dir = name.split("/").slice(0, -1).join("/");
  return zipSlip(dir ? `${dir}/${target}` : target) ? "symlink escapes the extraction directory" : null;
}
