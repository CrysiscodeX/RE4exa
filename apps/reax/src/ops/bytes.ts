// read.strings, read.bytes and search.bytes: the byte-level view of any file, streamed through a
// fixed window so the file's size does not set the memory used.
//
// Strings follow the definition `strings -a` (GNU binutils) and `llvm-strings` share, so their
// output is the answer key: a run of at least `min` printable ASCII characters (0x20-0x7e, or a
// tab). For UTF-16LE each character is two bytes with a zero high byte, as GNU's `strings -e l`
// reads them. After a run ends (or a candidate falls short) the scan resumes one byte past the
// start of the character that stopped it, so UTF-16 strings are found at odd offsets too.
import { statSync } from "node:fs";
import { CoreError } from "@re4exa/core/errors";
import "../errors.ts";
import { ForwardReader, readRange, target } from "./file.ts";
import { PAGE_INPUT, type Page } from "./page.ts";
import type { JsonSchema, Operation, OpResult } from "./types.ts";

const ALL = ["linux", "darwin", "win32"] as const;
const PATH: JsonSchema = { type: "string", description: "File path inside the workspace", maxLength: 4096 };

/** Longest string text kept for matching; a longer string's length is still counted exactly. */
export const STRING_HOLD = 65_536;
/** Largest file the scans read (they stream, so this bounds time, not memory). */
export const SCAN_CAP = 2 * 1024 * 1024 * 1024;

export type StringEncoding = "ascii" | "utf16le";

export interface StringHit {
  offset: number;
  encoding: StringEncoding;
  /** Characters in the whole run, even when `text` is cut. */
  length: number;
  text: string;
}

const graphic = (c: number) => c === 9 || (c >= 0x20 && c <= 0x7e);

/** Every string in the file, in offset order, for one encoding. */
export function* scanStrings(r: ForwardReader, encoding: StringEncoding, min: number): Generator<StringHit> {
  const unit = encoding === "ascii" ? 1 : 2;
  // the character at p, or -1 at the end; a UTF-16 unit with a non-zero high byte is never printable
  const ch = (p: number): number => {
    if (p + unit > r.size) return -1;
    const lo = r.byte(p);
    return unit === 1 || r.byte(p + 1) === 0 ? lo : 0x100;
  };
  let p = 0;
  for (;;) {
    const start = p;
    let text = "";
    let short = false;
    for (let i = 0; i < min; i++) {
      const c = ch(p);
      if (c < 0) return;
      if (!graphic(c)) {
        p += 1;
        short = true;
        break;
      }
      text += String.fromCharCode(c);
      p += unit;
    }
    if (short) continue;
    let length = min;
    for (;;) {
      const c = ch(p);
      if (c < 0) break;
      if (!graphic(c)) {
        p += 1;
        break;
      }
      if (text.length < STRING_HOLD) text += String.fromCharCode(c);
      length++;
      p += unit;
    }
    yield { offset: start, encoding, length, text };
  }
}

/** Two offset-ordered streams as one (ASCII first at the same offset). */
function* mergeByOffset(a: Iterator<StringHit>, b: Iterator<StringHit>): Generator<StringHit> {
  let x = a.next();
  let y = b.next();
  while (!x.done || !y.done) {
    if (y.done || (!x.done && x.value.offset <= y.value.offset)) {
      yield x.value as StringHit;
      x = a.next();
    } else {
      yield y.value;
      y = b.next();
    }
  }
}

/** One page of a stream: the rows in [offset, offset+limit) and the total, holding only the page. */
export function pageStream<T>(it: Iterable<T>, args: Record<string, unknown>): { items: T[]; page: Page } {
  const offset = (args.offset as number | undefined) ?? 0;
  const limit = (args.limit as number | undefined) ?? 200;
  const items: T[] = [];
  let total = 0;
  for (const x of it) {
    if (total >= offset && total < offset + limit) items.push(x);
    total++;
  }
  const end = offset + items.length;
  return { items, page: { offset, limit, total, next: end < total ? end : null } };
}

function scanTarget(ctx: Parameters<Operation["run"]>[0], path: unknown) {
  const t = target(ctx, path);
  const r = new ForwardReader(t.abs);
  if (r.size > SCAN_CAP) {
    r.close();
    throw new CoreError("target_too_large", { size: r.size, limit: SCAN_CAP });
  }
  return { t, r };
}

export const readStrings: Operation = {
  tool: "read",
  name: "read.strings",
  summary:
    "Printable strings in any file (ASCII and UTF-16LE, at any offset), with their file offsets; optionally only those containing a search text. Pages with offset and limit.",
  input: {
    type: "object",
    properties: {
      path: PATH,
      encoding: { type: "string", enum: ["all", "ascii", "utf16le"], default: "all", description: "Which encodings" },
      min: { type: "integer", minimum: 1, maximum: 1024, default: 4, description: "Shortest string, in characters" },
      search: { type: "string", maxLength: 1024, description: "Keep only strings containing this text" },
      ignore_case: { type: "boolean", default: false, description: "Match search without regard to ASCII case" },
      max_text: {
        type: "integer",
        minimum: 16,
        maximum: STRING_HOLD,
        default: 1024,
        description: "Longest text returned per string; length still counts the whole string",
      },
      ...PAGE_INPUT,
    },
    required: ["path"],
    additionalProperties: false,
  },
  effect: "read",
  cost: "medium",
  untrusted: true,
  platforms: [...ALL],
  examples: [
    {
      title: "Strings that name the library's functions",
      workspace: "fixtures",
      args: { path: "lib-x86_64-linux-gnu.2.28-s.so", search: "reax_a", encoding: "ascii" },
      expect: { page: { total: 2 }, items: [{ text: "reax_add" }, { text: "reax_apply" }] },
    },
  ],
  covers: ["rea.tool/list_strings", "rea.tool/search_strings"],
  async run(ctx, args): Promise<OpResult> {
    const { t, r } = scanTarget(ctx, args.path);
    // each encoding scans with its own window, so neither scan makes the other refill
    const r2 = args.encoding === "all" ? new ForwardReader(t.abs) : null;
    try {
      const enc = args.encoding as "all" | StringEncoding;
      const min = args.min as number;
      const maxText = args.max_text as number;
      const it =
        enc === "all"
          ? mergeByOffset(scanStrings(r, "ascii", min), scanStrings(r2!, "utf16le", min))
          : scanStrings(r, enc, min);
      const search = args.search as string | undefined;
      const fold = args.ignore_case === true;
      const needle = search === undefined ? null : fold ? search.toLowerCase() : search;
      let longUnsearched = 0;
      const matches = function* () {
        for (const s of it) {
          if (s.length > STRING_HOLD) longUnsearched++;
          if (needle !== null && !(fold ? s.text.toLowerCase() : s.text).includes(needle)) continue;
          yield s;
        }
      };
      const p = pageStream(matches(), args);
      const items = p.items.map((s) =>
        s.text.length > maxText ? { ...s, text: s.text.slice(0, maxText), cut: true } : s,
      );
      const limitations: string[] = [];
      if (needle !== null && longUnsearched)
        limitations.push(
          `${longUnsearched} strings are longer than ${STRING_HOLD} characters; search read the first ${STRING_HOLD} of each`,
        );
      if (unmatchable(search))
        limitations.push("search matches printable ASCII only; strings hold no other characters");
      const lines = items.map((s) => `${s.offset}\t${s.encoding === "ascii" ? "a" : "u"}\t${s.text}`);
      return {
        data: { file: t.rel, size: r.size, encoding: enc, min, items, page: p.page },
        text: [
          `${t.rel}: ${p.page.total} strings${search !== undefined ? ` containing ${JSON.stringify(search)}` : ""}; rows ${p.page.offset}-${p.page.offset + items.length}${p.page.next !== null ? `, next offset ${p.page.next}` : ""}`,
          ...lines,
        ].join("\n"),
        coverage: needle !== null && longUnsearched ? "partial" : "complete",
        limitations,
      };
    } finally {
      r.close();
      r2?.close();
    }
  },
};

/** A search text with characters no string can hold (so it can never match). */
function unmatchable(s: string | undefined): boolean {
  return s !== undefined && [...s].some((c) => !graphic(c.codePointAt(0)!));
}

export const BYTES_MAX = 65_536;

function hexdump(bytes: Uint8Array, at: number): string {
  const out: string[] = [];
  for (let i = 0; i < bytes.length; i += 16) {
    const row = bytes.subarray(i, i + 16);
    const hex = [...row].map((b) => b.toString(16).padStart(2, "0")).join(" ");
    const asc = [...row].map((b) => (b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : ".")).join("");
    out.push(`${(at + i).toString(16).padStart(8, "0")}  ${hex.padEnd(47)}  |${asc}|`);
  }
  return out.join("\n");
}

export const readBytes: Operation = {
  tool: "read",
  name: "read.bytes",
  summary: "A slice of any file: `length` bytes from file offset `at`, as hex and a hexdump.",
  input: {
    type: "object",
    properties: {
      path: PATH,
      at: { type: "integer", minimum: 0, default: 0, description: "File offset of the first byte" },
      length: { type: "integer", minimum: 1, maximum: BYTES_MAX, default: 256, description: "Bytes to read" },
    },
    required: ["path"],
    additionalProperties: false,
  },
  effect: "read",
  cost: "cheap",
  untrusted: true,
  platforms: [...ALL],
  examples: [
    {
      title: "An ELF file's magic number",
      workspace: "fixtures",
      args: { path: "hello-x86_64-linux-gnu.2.28-s", at: 0, length: 4 },
      expect: { at: 0, length: 4, hex: "7f454c46" },
    },
  ],
  covers: ["rea.tool/read_bytes", "leanrea/LEAN-C07"],
  async run(ctx, args): Promise<OpResult> {
    const t = target(ctx, args.path);
    const at = args.at as number;
    const want = args.length as number;
    const total = statSync(t.abs).size;
    if (at > total)
      throw new CoreError("bad_request", { field: "at", why: `past the end of the file (${total} bytes)` });
    const bytes = readRange(t.abs, at, Math.min(want, total - at));
    const short = bytes.length < want;
    return {
      data: { file: t.rel, size: total, at, length: bytes.length, hex: Buffer.from(bytes).toString("hex") },
      text: `${t.rel}: ${bytes.length} bytes at ${at} (0x${at.toString(16)}) of ${total}${short ? "; the file ends here" : ""}\n${hexdump(bytes, at)}`,
      coverage: "complete",
      limitations: short ? [`the file ends after ${bytes.length} of the ${want} bytes asked for`] : [],
    };
  },
};

/** A byte pattern: each position matches one value, either of two (ASCII case), or any (-1). */
interface Pattern {
  a: Int16Array;
  b: Int16Array;
}

export function parsePattern(args: Record<string, unknown>): Pattern {
  const hex = args.hex as string | undefined;
  const text = args.text as string | undefined;
  if ((hex === undefined) === (text === undefined))
    throw new CoreError("bad_request", { field: "hex", why: "exactly one of hex or text" });
  const a: number[] = [];
  const b: number[] = [];
  if (hex !== undefined) {
    if (args.ignore_case === true)
      throw new CoreError("bad_request", { field: "ignore_case", why: "applies to text, not hex" });
    const tokens = hex.replace(/\s+/g, "").match(/../g) ?? [];
    if (hex.replace(/\s+/g, "").length % 2 !== 0 || tokens.length === 0)
      throw new CoreError("bad_request", { field: "hex", why: "pairs of hex digits or ??" });
    for (const tk of tokens) {
      if (tk === "??") {
        a.push(-1);
        b.push(-1);
      } else if (/^[0-9a-fA-F]{2}$/.test(tk)) {
        a.push(Number.parseInt(tk, 16));
        b.push(Number.parseInt(tk, 16));
      } else throw new CoreError("bad_request", { field: "hex", why: `not a hex byte or ??: ${tk}` });
    }
    if (a.every((x) => x === -1))
      throw new CoreError("bad_request", { field: "hex", why: "at least one byte that is not ??" });
  } else {
    const bytes = Buffer.from(text!, "utf8");
    if (bytes.length === 0) throw new CoreError("bad_request", { field: "text", why: "not empty" });
    for (const x of bytes) {
      const lower = x >= 0x41 && x <= 0x5a ? x + 32 : x;
      const upper = x >= 0x61 && x <= 0x7a ? x - 32 : x;
      a.push(args.ignore_case === true ? lower : x);
      b.push(args.ignore_case === true ? upper : x);
    }
  }
  if (a.length > 256)
    throw new CoreError("bad_request", { field: hex !== undefined ? "hex" : "text", why: "at most 256 bytes" });
  return { a: Int16Array.from(a), b: Int16Array.from(b) };
}

/** Every offset where the pattern matches, overlapping matches included, in order. */
export function* searchBytes(r: ForwardReader, pat: Pattern): Generator<number> {
  const m = pat.a.length;
  // anchor on the first position that is not a wildcard
  let k = 0;
  while (pat.a[k] === -1) k++;
  const ka = pat.a[k]!;
  const kb = pat.b[k]!;
  for (let p = 0; p + m <= r.size; p++) {
    const c = r.byte(p + k);
    if (c !== ka && c !== kb) continue;
    let ok = true;
    for (let i = 0; i < m; i++) {
      const want = pat.a[i]!;
      if (want === -1) continue;
      const x = r.byte(p + i);
      if (x !== want && x !== pat.b[i]) {
        ok = false;
        break;
      }
    }
    if (ok) yield p;
  }
}

export const searchBytesOp: Operation = {
  tool: "read",
  name: "search.bytes",
  summary:
    "Every file offset where a byte pattern occurs (hex with ?? wildcards, or text with optional ASCII case folding), overlapping matches included. Pages with offset and limit.",
  input: {
    type: "object",
    properties: {
      path: PATH,
      hex: { type: "string", maxLength: 1024, description: 'Bytes as hex pairs, ?? for any byte, e.g. "48 8b ?? 24"' },
      text: { type: "string", maxLength: 256, description: "Bytes as UTF-8 text" },
      ignore_case: { type: "boolean", default: false, description: "With text: match ASCII letters in either case" },
      ...PAGE_INPUT,
    },
    required: ["path"],
    additionalProperties: false,
  },
  effect: "read",
  cost: "medium",
  untrusted: false,
  platforms: [...ALL],
  examples: [
    {
      title: "Where a Windows executable's PE header starts",
      workspace: "fixtures",
      args: { path: "hello-x86_64-windows-gnu-s.exe", hex: "50 45 00 00 64 86" },
      expect: { items: [120], page: { total: 1 } },
    },
  ],
  covers: ["rea.tool/search_bytes"],
  async run(ctx, args): Promise<OpResult> {
    const pat = parsePattern(args);
    const { t, r } = scanTarget(ctx, args.path);
    try {
      const p = pageStream(searchBytes(r, pat), args);
      return {
        data: { file: t.rel, size: r.size, length: pat.a.length, items: p.items, page: p.page },
        text: `${t.rel}: ${p.page.total} matches of ${pat.a.length} bytes${p.items.length ? `; at ${p.items.map((o) => `${o} (0x${o.toString(16)})`).join(", ")}` : ""}${p.page.next !== null ? `; next offset ${p.page.next}` : ""}`,
        coverage: "complete",
        limitations: [],
      };
    } finally {
      r.close();
    }
  },
};
