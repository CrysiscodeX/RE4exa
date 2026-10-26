// file.identify: magic bytes first, the file name only where the bytes are shared by several
// formats (zip family, JavaScript vs TypeScript text, package.json).

import { lstatSync } from "node:fs";
import { join } from "node:path";
import { constants, gunzipSync } from "node:zlib";
import type { Json } from "../../evidence/jcs.ts";
import { type AssayProbe, asciiAt, basenameOf, bytesAt, extOf, type JsonObject, u16, u32 } from "../util.ts";

export interface Ident {
  format: string;
  families: string[];
  mime: string;
  details: JsonObject;
}

/** Bytes file.identify reads from the start of a file. */
export const IDENTIFY_HEAD = 256 * 1024;

const FAMILIES: Record<string, string[]> = {
  jar: ["jar", "zip"],
  apk: ["apk", "zip"],
  vsix: ["vsix", "zip"],
  crx: ["crx", "zip"],
  "macho-fat": ["macho-fat", "macho"],
  "npm-tgz": ["npm-tgz", "tar.gz", "gzip"],
  "tar.gz": ["tar.gz", "gzip"],
  "package-json": ["package-json", "json", "text"],
  json: ["json", "text"],
  javascript: ["javascript", "text"],
  typescript: ["typescript", "text"],
  "npm-package": ["npm-package", "directory"],
  plist: ["plist"],
};

export function familiesOf(format: string): string[] {
  return FAMILIES[format] ?? [format];
}

const MIME: Record<string, string> = {
  elf: "application/x-elf",
  pe: "application/vnd.microsoft.portable-executable",
  macho: "application/x-mach-binary",
  "macho-fat": "application/x-mach-binary",
  zip: "application/zip",
  jar: "application/java-archive",
  apk: "application/vnd.android.package-archive",
  vsix: "application/zip",
  crx: "application/x-chrome-extension",
  asar: "application/x-asar",
  gzip: "application/gzip",
  "tar.gz": "application/gzip",
  "npm-tgz": "application/gzip",
  tar: "application/x-tar",
  wasm: "application/wasm",
  sqlite: "application/vnd.sqlite3",
  pdf: "application/pdf",
  png: "image/png",
  jpeg: "image/jpeg",
  json: "application/json",
  "package-json": "application/json",
  javascript: "text/javascript",
  typescript: "text/typescript",
  script: "text/x-script",
  text: "text/plain",
  "hermes-bytecode": "application/x-hermes-bytecode",
  "java-class": "application/java-vm",
  plist: "application/x-plist",
  pcap: "application/vnd.tcpdump.pcap",
  pcapng: "application/x-pcapng",
};

const ZIP_EXT: Record<string, string> = {
  ".jar": "jar",
  ".war": "jar",
  ".apk": "apk",
  ".vsix": "vsix",
  ".crx": "crx",
};
const JS_EXT = new Set([".js", ".mjs", ".cjs", ".jsx"]);
const TS_EXT = new Set([".ts", ".mts", ".cts", ".tsx"]);
const JS_INTERPRETERS = new Set(["node", "nodejs", "deno", "bun"]);

function mk(format: string, details: JsonObject = {}): Ident {
  return { format, families: familiesOf(format), mime: MIME[format] ?? "application/octet-stream", details };
}

const strictUtf8 = new TextDecoder("utf-8", { fatal: true });

/** Text when the head has no NUL, decodes as UTF-8 (allowing a cut final character) and has few control bytes. */
function looksText(head: Uint8Array): boolean {
  if (head.length === 0) return true;
  let ctl = 0;
  for (let i = 0; i < head.length; i++) {
    const c = head[i]!;
    if (c === 0) return false;
    if (c < 0x20 && c !== 9 && c !== 10 && c !== 13 && c !== 12 && c !== 27) ctl++;
  }
  if (ctl / head.length > 0.02) return false;
  for (let cut = 0; cut <= 3 && cut < head.length; cut++) {
    try {
      strictUtf8.decode(head.subarray(0, head.length - cut));
      return true;
    } catch {
      // try a shorter prefix: the head may end inside a multi-byte character
    }
  }
  return false;
}

function tarHeaderAt(b: Uint8Array): boolean {
  return asciiAt(b, 257, "ustar");
}

/** Peek into a gzip stream: inflate at most the first 4 KiB of input, tolerating truncation. */
function peekGzip(b: Uint8Array): Uint8Array | null {
  try {
    return gunzipSync(b.subarray(0, 4096), { finishFlush: constants.Z_SYNC_FLUSH, maxOutputLength: 8 * 1024 * 1024 });
  } catch {
    return null;
  }
}

function tarFirstName(b: Uint8Array): string {
  let e = 0;
  while (e < 100 && e < b.length && b[e] !== 0) e++;
  return new TextDecoder().decode(b.subarray(0, e));
}

function machoKind(m: number): { bits: number; endian: string } | null {
  switch (m) {
    case 0xfeedface:
      return { bits: 32, endian: "big" };
    case 0xcefaedfe:
      return { bits: 32, endian: "little" };
    case 0xfeedfacf:
      return { bits: 64, endian: "big" };
    case 0xcffaedfe:
      return { bits: 64, endian: "little" };
    default:
      return null;
  }
}

/** Identify bytes. `head` is the start of the file (whole file when size <= head length). Never throws. */
export function identifyBytes(head: Uint8Array, name: string, size: number): Ident {
  const ext = extOf(name);
  const base = basenameOf(name).toLowerCase();
  const whole = head.length >= size;
  if (size === 0) return mk("empty");
  if (bytesAt(head, 0, [0x7f, 0x45, 0x4c, 0x46])) {
    const cls = head[4] === 2 ? 64 : head[4] === 1 ? 32 : 0;
    return mk("elf", { bits: cls, endian: head[5] === 2 ? "big" : "little" });
  }
  if (asciiAt(head, 0, "MZ")) {
    if (head.length >= 0x40) {
      const lfanew = u32(head, 0x3c);
      if (lfanew + 4 <= head.length && asciiAt(head, lfanew, "PE\0\0")) return mk("pe");
    }
    return mk("unknown", { note: "MZ header without a PE signature (DOS executable or truncated)" });
  }
  if (head.length >= 8) {
    const be = u32(head, 0, false);
    const mk1 = machoKind(be);
    if (mk1) return mk("macho", { bits: mk1.bits, endian: mk1.endian });
    if (be === 0xcafebabe || be === 0xcafebabf) {
      const n = u32(head, 4, false);
      // Java class files share 0xCAFEBABE; their next word is a class-file version (>= 45).
      if (be === 0xcafebabe && n >= 20) return mk("java-class", { major: u16(head, 6, false) });
      return mk("macho-fat", { arches: n, fat64: be === 0xcafebabf });
    }
  }
  if (
    bytesAt(head, 0, [0x50, 0x4b]) &&
    (bytesAt(head, 2, [3, 4]) || bytesAt(head, 2, [5, 6]) || bytesAt(head, 2, [7, 8]))
  )
    return mk(ZIP_EXT[ext] ?? "zip");
  if (asciiAt(head, 0, "Cr24")) return mk("crx");
  if (head.length >= 24 && u32(head, 0) === 4 && asciiAt(head, 16, '{"files"')) return mk("asar");
  if (bytesAt(head, 0, [0x1f, 0x8b])) {
    const inner = peekGzip(head);
    if (inner && tarHeaderAt(inner)) {
      const first = tarFirstName(inner);
      if (first.startsWith("package/") || (ext === ".tgz" && first === "package"))
        return mk("npm-tgz", { firstEntry: first });
      return mk("tar.gz", { firstEntry: first });
    }
    return mk("gzip");
  }
  if (tarHeaderAt(head)) return mk("tar", { firstEntry: tarFirstName(head) });
  if (bytesAt(head, 0, [0, 0x61, 0x73, 0x6d])) {
    const v = head.length >= 8 ? u32(head, 4) : 0;
    return mk("wasm", { version: v, component: v !== 1 });
  }
  if (asciiAt(head, 0, "SQLite format 3\0")) return mk("sqlite");
  if (asciiAt(head, 0, "%PDF-")) return mk("pdf");
  if (bytesAt(head, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return mk("png");
  if (bytesAt(head, 0, [0xff, 0xd8, 0xff])) return mk("jpeg");
  if (bytesAt(head, 0, [0xc6, 0x1f, 0xbc, 0x03])) return mk("hermes-bytecode");
  if (asciiAt(head, 0, "bplist00")) return mk("plist", { encoding: "binary" });
  if (head.length >= 4) {
    const m = u32(head, 0, false);
    if (m === 0xa1b2c3d4 || m === 0xd4c3b2a1 || m === 0xa1b23c4d || m === 0x4d3cb2a1) return mk("pcap");
    if (m === 0x0a0d0d0a) return mk("pcapng");
  }
  if (!looksText(head)) return mk("unknown");
  const text = new TextDecoder().decode(head.subarray(0, Math.min(head.length, 4096)));
  if (text.startsWith("#!")) {
    const line = text.slice(2, text.indexOf("\n") === -1 ? undefined : text.indexOf("\n")).trim();
    const words = line.split(/\s+/);
    let interp = basenameOf(words[0] ?? "");
    if (interp === "env") interp = words.find((w, i) => i > 0 && !w.startsWith("-")) ?? "env";
    const isJs = JS_INTERPRETERS.has(interp);
    const id = mk("script", { interpreter: interp });
    if (isJs) id.families = ["script", "javascript", "text"];
    return id;
  }
  if (JS_EXT.has(ext)) return mk("javascript");
  if (TS_EXT.has(ext)) return mk("typescript");
  const trimmed = text.trimStart();
  if (trimmed.startsWith("<?xml") && /<plist[\s>]|<!DOCTYPE plist/.test(text)) return mk("plist", { encoding: "xml" });
  if (ext === ".json" || trimmed.startsWith("{") || trimmed.startsWith("[")) {
    let parsed: unknown;
    let ok = false;
    if (whole) {
      try {
        parsed = JSON.parse(new TextDecoder().decode(head));
        ok = true;
      } catch {
        ok = false;
      }
    }
    if (ok && base === "package.json" && typeof parsed === "object" && parsed !== null && !Array.isArray(parsed))
      return mk("package-json");
    if (ok) return mk("json");
    if (!whole && ext === ".json") return mk("json", { note: "larger than the identification window; not parsed" });
  }
  return mk("text");
}

function hasPackageJson(dir: string): boolean {
  try {
    return lstatSync(join(dir, "package.json")).isFile();
  } catch {
    return false;
  }
}

export function identifyDirectory(abs: string): Ident {
  return hasPackageJson(abs) ? mk("npm-package") : mk("directory");
}

export const fileIdentify: AssayProbe = {
  id: "file.identify",
  version: "1",
  predicate: "file.identify",
  summary: "Identify the format from magic bytes (and the extension where formats share bytes)",
  appliesTo: () => true,
  platforms: ["linux", "darwin", "win32"],
  cost: "cheap",
  confidence: "observed",
  sweep: ["root", "each"],
  nameSensitive: true,
  async run(ctx) {
    if (ctx.subject.kind === "directory") {
      const id = identifyDirectory(ctx.subject.abs);
      return { result: id as unknown as Json };
    }
    const head = await ctx.read(undefined, IDENTIFY_HEAD);
    const id = identifyBytes(head, ctx.subject.path, ctx.subject.size);
    return { result: id as unknown as Json };
  },
};
