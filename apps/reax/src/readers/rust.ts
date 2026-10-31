// Rust binaries: the dependency list cargo-auditable embeds (a zlib-compressed JSON document in a
// section named .dep-v0: ELF and PE sections, the Mach-O section __DATA,.dep-v0 in each slice, a
// wasm custom section) and the marks the Rust toolchain leaves in any Rust binary, such as the
// rustc commit in the /rustc/<commit>/ paths of the standard library's panic locations, so a
// binary built without cargo-auditable is still known to be Rust. Checked against the RustSec
// project's rust-audit-info (scripts/oracle-rust.ts, bench/oracle/rust.json).
//
// Every step is bounded, and a damaged section gives what could be read plus a note, never an
// exception: the inflate stops at RUST_INFLATE_CAP, the package and edge lists at their caps, and
// the marker scan reads only read-only data sections, at most RUST_MARKER_CAP bytes in all.
import { constants, inflateSync } from "node:zlib";
import type { LayoutSlice, Region } from "./layout.ts";

/** Most bytes the .dep-v0 document may inflate to (cargo-auditable's own reader allows 8 MiB). */
export const RUST_INFLATE_CAP = 8 * 1024 * 1024;
/** Most packages read from one document. */
export const RUST_PACKAGE_CAP = 65_536;
/** Most dependency edges read from one document. */
export const RUST_EDGE_CAP = 1_048_576;
/** Most dependencies one package lists in a result (all are counted in the edges), so one package
 * always fits a page within the response budget. */
export const RUST_LISTED_DEPS_CAP = 4096;
/** Most bytes of read-only data the marker scan reads in one slice. */
export const RUST_MARKER_CAP = 8 * 1024 * 1024;
/** Most /rustc/ occurrences examined for a commit hash in one slice. */
const RUSTC_HITS = 1024;

export interface RustCaps {
  inflate: number;
  packages: number;
  edges: number;
  markers: number;
}
export const RUST_CAPS: RustCaps = {
  inflate: RUST_INFLATE_CAP,
  packages: RUST_PACKAGE_CAP,
  edges: RUST_EDGE_CAP,
  markers: RUST_MARKER_CAP,
};

export interface RustPackage {
  index: number;
  name: string;
  version: string;
  /** "crates.io", "local", "git", "registry" or another source cargo-auditable names. */
  source: string;
  /** "runtime" or "build" (cargo-auditable omits the field for runtime). */
  kind: string;
  features: string[];
  root: boolean;
  /** Indices of the packages this one depends on. */
  dependencies: number[];
  /** The same edges, as "name version". */
  dependsOn: string[];
}

export interface RustDeps {
  /** The section the document was read from and where it is. */
  section: { name: string; offset: number; size: number };
  /** The document's format version, or null when it could not be read. */
  format: number | null;
  packages: RustPackage[];
  edges: number;
  /** What was cut or damaged; empty when the document was read whole. */
  notes: string[];
}

export interface RustMarkers {
  /** The rustc commit hash from a /rustc/<40 hex>/ path, or null. */
  rustc: string | null;
  /** ELF .comment's "rustc version ..." line, or null. */
  rustcVersion: string | null;
  /** Each kind of Rust evidence found. */
  markers: string[];
  /** The sections the scan read and how many bytes; complete is false when the cap cut it. */
  scope: { sections: string[]; bytes: number; complete: boolean };
}

const latin1 = new TextDecoder("latin1");
const utf8 = new TextDecoder("utf-8");

/** The .dep-v0 section of a slice, with its bytes (fewer when it runs past the file's end). */
export function depSection(
  b: Uint8Array,
  s: LayoutSlice,
  format: string,
): { region: Region; bytes: Uint8Array; offset: number; size: number; notes: string[] } | null {
  const region = s.sections.find(
    (x) =>
      x.name === ".dep-v0" &&
      (format === "wasm" ? x.kind === "CUSTOM" : true) &&
      (format === "macho" || format === "macho-fat" ? x.segment === "__DATA" : true),
  );
  if (!region) return null;
  const notes: string[] = [];
  if (region.offset === null)
    return {
      region,
      bytes: new Uint8Array(0),
      offset: 0,
      size: 0,
      notes: ["the .dep-v0 section has no bytes in the file"],
    };
  let offset = region.offset;
  // PE pads raw data to the file alignment; the virtual size is the section's own
  let size = format === "pe" && region.size > 0 ? Math.min(region.size, region.fileSize) : region.fileSize;
  if (format === "wasm") {
    // a custom section's payload starts with its name
    const l = leb(b, offset);
    if (!l)
      return {
        region,
        bytes: new Uint8Array(0),
        offset,
        size: 0,
        notes: ["the .dep-v0 custom section has no readable name"],
      };
    offset += l.n + l.v;
    size -= l.n + l.v;
  }
  if (offset > b.length) {
    notes.push(`the .dep-v0 section starts at ${offset}, past the end of the file (${b.length} bytes)`);
    return { region, bytes: new Uint8Array(0), offset, size, notes };
  }
  if (offset + size > b.length)
    notes.push(`the .dep-v0 section runs past the end of the file (${offset + size} > ${b.length} bytes)`);
  return { region, bytes: b.subarray(offset, Math.min(b.length, offset + size)), offset, size, notes };
}

function leb(b: Uint8Array, o: number): { v: number; n: number } | null {
  let v = 0;
  for (let i = 0; i < 5 && o + i < b.length; i++) {
    const x = b[o + i]!;
    v += (x & 0x7f) * 2 ** (7 * i);
    if ((x & 0x80) === 0) return { v, n: i + 1 };
  }
  return null;
}

/** The inflated document, at most `cap` bytes; a stream that is cut gives what precedes the cut. */
export function inflateDeps(z: Uint8Array, cap: number): { text: Uint8Array | null; notes: string[] } {
  try {
    return { text: inflateSync(z, { maxOutputLength: cap }), notes: [] };
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ERR_BUFFER_TOO_LARGE" || err instanceof RangeError)
      return { text: null, notes: [`the .dep-v0 data inflates past the ${cap}-byte cap; its packages are not read`] };
    // a stream cut short: keep what inflates before the cut (still bounded by the cap)
    if (err.code === "Z_BUF_ERROR") {
      try {
        const text = inflateSync(z, { maxOutputLength: cap, finishFlush: constants.Z_SYNC_FLUSH });
        return { text, notes: ["the .dep-v0 zlib stream is cut short; only the data before the cut is read"] };
      } catch {
        // fall through
      }
    }
    return { text: null, notes: [`the .dep-v0 data is not a valid zlib stream (${err.code ?? err.message})`] };
  }
}

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

/** The end of the JSON value starting at `o` (one past it), or -1 when the text ends first. */
function valueEnd(t: string, o: number): number {
  let depth = 0;
  let inStr = false;
  for (let i = o; i < t.length; i++) {
    const c = t.charCodeAt(i);
    if (inStr) {
      if (c === 0x5c) i++;
      else if (c === 0x22) inStr = false;
      continue;
    }
    if (c === 0x22) inStr = true;
    else if (c === 0x7b || c === 0x5b) depth++;
    else if (c === 0x7d || c === 0x5d) {
      depth--;
      if (depth === 0) return i + 1;
      if (depth < 0) return -1;
    }
  }
  return -1;
}

/** The objects of the "packages" array of a document JSON.parse refused, up to the first that
 * does not read whole (a cut or damaged document keeps the packages before the damage). */
function salvage(t: string, max: number): { format: number | null; packages: Json[] } {
  const f = /"format"\s*:\s*(\d+)/.exec(t);
  const out: Json[] = [];
  const m = /"packages"\s*:\s*\[/.exec(t);
  if (m) {
    let o = m.index + m[0].length;
    while (out.length < max) {
      while (o < t.length && /[\s,]/.test(t[o]!)) o++;
      if (t[o] !== "{") break;
      const e = valueEnd(t, o);
      if (e < 0) break;
      try {
        out.push(JSON.parse(t.slice(o, e)) as Json);
      } catch {
        break;
      }
      o = e;
    }
  }
  return { format: f ? Number(f[1]) : null, packages: out };
}

const str = (v: Json | undefined, d: string) => (typeof v === "string" ? v : d);

/** The packages and edges of an inflated document, every list bounded by `caps`. */
export function parseDeps(text: Uint8Array, caps: RustCaps = RUST_CAPS): Omit<RustDeps, "section"> {
  const notes: string[] = [];
  const t = utf8.decode(text);
  let format: number | null = null;
  let raw: Json[] = [];
  try {
    const doc = JSON.parse(t) as Json;
    if (doc === null || typeof doc !== "object" || Array.isArray(doc)) throw new Error("not an object");
    format = typeof doc.format === "number" ? doc.format : null;
    if (!Array.isArray(doc.packages)) notes.push("the .dep-v0 document has no packages list");
    else raw = doc.packages;
  } catch (e) {
    const s = salvage(t, caps.packages + 1);
    format = s.format;
    raw = s.packages;
    notes.push(
      `the .dep-v0 document is not valid JSON (${(e as Error).message.slice(0, 120)}); ${raw.length} packages read before the damage`,
    );
  }
  if (format === null) notes.push("the .dep-v0 document has no format version");
  if (raw.length > caps.packages) {
    notes.push(`the .dep-v0 document lists ${raw.length} packages; only the first ${caps.packages} are read`);
    raw = raw.slice(0, caps.packages);
  }
  const packages: RustPackage[] = [];
  let edges = 0;
  let outOfRange = 0;
  let edgeCut = false;
  for (let i = 0; i < raw.length; i++) {
    const p = raw[i];
    if (p === null || typeof p !== "object" || Array.isArray(p)) {
      notes.push(`package ${i} is not an object; the packages after it are not read`);
      break;
    }
    const deps: number[] = [];
    for (const d of Array.isArray(p.dependencies) ? p.dependencies : []) {
      if (edges >= caps.edges) {
        edgeCut = true;
        break;
      }
      if (typeof d !== "number" || !Number.isInteger(d) || d < 0 || d >= raw.length) {
        outOfRange++;
        continue;
      }
      deps.push(d);
      edges++;
    }
    packages.push({
      index: i,
      name: str(p.name, ""),
      version: str(p.version, ""),
      source: typeof p.source === "string" ? p.source : p.source === undefined ? "" : JSON.stringify(p.source),
      kind: str(p.kind, "runtime"),
      features: Array.isArray(p.features) ? p.features.filter((x): x is string => typeof x === "string") : [],
      root: p.root === true,
      dependencies: deps,
      dependsOn: [],
    });
  }
  for (const p of packages)
    p.dependsOn = p.dependencies.map((d) => (packages[d] ? `${packages[d].name} ${packages[d].version}` : `#${d}`));
  if (outOfRange)
    notes.push(`${outOfRange} dependency indices are out of range (not a package of the list); they are left out`);
  if (edgeCut) notes.push(`the dependency edges pass the ${caps.edges}-edge cap; the rest are not read`);
  return { format, packages, edges, notes };
}

/** The .dep-v0 data of one slice, or null when it has none. Never throws on damage. */
export function rustDeps(b: Uint8Array, s: LayoutSlice, format: string, caps: RustCaps = RUST_CAPS): RustDeps | null {
  const sec = depSection(b, s, format);
  if (!sec) return null;
  const section = {
    name: sec.region.segment ? `${sec.region.segment},${sec.region.name}` : sec.region.name,
    offset: sec.offset,
    size: sec.size,
  };
  const inf = inflateDeps(sec.bytes, caps.inflate);
  if (!inf.text) return { section, format: null, packages: [], edges: 0, notes: [...sec.notes, ...inf.notes] };
  const d = parseDeps(inf.text, caps);
  return { section, ...d, notes: [...sec.notes, ...inf.notes, ...d.notes] };
}

/** The read-only data sections where the toolchain's strings live, by format. */
function markerSections(s: LayoutSlice, format: string): Region[] {
  return s.sections.filter((x) => {
    if (x.offset === null || x.fileSize === 0) return false;
    if (format === "elf") return x.name.startsWith(".rodata") || x.name === ".comment" || x.name === ".rustc";
    if (format === "pe") return x.name === ".rdata";
    if (format === "macho" || format === "macho-fat")
      return x.segment === "__TEXT" && (x.name === "__const" || x.name === "__cstring");
    if (format === "wasm") return x.kind === "DATA" || (x.kind === "CUSTOM" && x.name === "producers");
    return false;
  });
}

const RUSTC = Buffer.from("/rustc/", "latin1");
const HEX = /^[0-9a-f]{40}\/$/;
const PLAIN: [string, string][] = [
  ["/rust/deps/", "standard library dependency paths (/rust/deps/)"],
  ["RUST_BACKTRACE", "the RUST_BACKTRACE variable of the panic handler"],
  // libcore's own panic message, kept when paths are remapped or trimmed (e.g. sharp's MinGW libvips, which bundles librsvg, and resvg-js's MSVC build)
  ["called `Option::unwrap()` on a `None` value", "libcore's Option::unwrap panic message"],
];

/** Rust evidence in a slice, from section names and a capped scan of its read-only data. */
export function rustMarkers(b: Uint8Array, s: LayoutSlice, format: string, cap = RUST_MARKER_CAP): RustMarkers {
  const markers: string[] = [];
  const add = (m: string) => {
    if (!markers.includes(m)) markers.push(m);
  };
  if (s.sections.some((x) => x.name === ".dep-v0")) add("a .dep-v0 section (cargo-auditable)");
  if (format === "elf" && s.sections.some((x) => x.name === ".rustc")) add("a .rustc section (Rust library metadata)");
  let rustc: string | null = null;
  let rustcVersion: string | null = null;
  const scope = { sections: [] as string[], bytes: 0, complete: true };
  const buf = Buffer.from(b.buffer, b.byteOffset, b.byteLength);
  for (const x of markerSections(s, format)) {
    const start = x.offset!;
    const want = Math.min(x.fileSize, Math.max(0, b.length - start));
    const room = cap - scope.bytes;
    if (room <= 0) {
      scope.complete = false;
      break;
    }
    const n = Math.min(want, room);
    if (n < want) scope.complete = false;
    const end = start + n;
    scope.sections.push(x.segment ? `${x.segment},${x.name}` : x.name);
    scope.bytes += n;
    let hits = 0;
    for (let at = buf.indexOf(RUSTC, start); rustc === null && at >= 0 && at < end && hits < RUSTC_HITS; hits++) {
      const h = latin1.decode(b.subarray(at + 7, Math.min(end, at + 48)));
      if (HEX.test(h)) rustc = h.slice(0, 40);
      at = buf.indexOf(RUSTC, at + 1);
    }
    for (const [p, m] of PLAIN) {
      const at = buf.indexOf(p, start, "latin1");
      if (at >= 0 && at + p.length <= end) add(m);
    }
    if (format === "elf" && x.name === ".comment") {
      const at = buf.indexOf("rustc version ", start, "latin1");
      if (at >= 0 && at < end) {
        let e = at;
        while (e < end && e - at < 256 && b[e] !== 0) e++;
        rustcVersion = latin1.decode(b.subarray(at, e));
        add("rustc's version in .comment");
      }
    }
    if (format === "wasm" && x.name === "producers" && buf.subarray(start, end).includes("rustc", 0, "latin1"))
      add("rustc in the producers section");
  }
  if (rustc) add("the rustc commit in /rustc/<commit>/ paths");
  return { rustc, rustcVersion, markers, scope };
}
