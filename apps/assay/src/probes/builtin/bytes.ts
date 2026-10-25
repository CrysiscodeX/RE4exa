// Byte-level probes: file.hash, file.strings, file.contains.

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import type { Json } from "../../evidence/jcs.ts";
import { type AssayProbe, fail, numParam, params, strParam } from "../util.ts";

const ALL = ["linux", "darwin", "win32"] as ("linux" | "darwin" | "win32")[];

export const fileHash: AssayProbe = {
  id: "file.hash",
  version: "1",
  predicate: "file.hash",
  summary: "sha256, sha1 and size of the file's bytes (streamed)",
  appliesTo: (i) => i.kind === "file",
  platforms: ALL,
  cost: "cheap",
  confidence: "observed",
  sweep: ["root"],
  async run(ctx) {
    if (ctx.subject.kind !== "file") fail("file.hash needs a file");
    const s256 = createHash("sha256");
    const s1 = createHash("sha1");
    let size = 0;
    await new Promise<void>((resolve, reject) => {
      const st = createReadStream(ctx.subject.abs, { signal: ctx.signal });
      st.on("data", (c) => {
        const b = c as Buffer;
        s256.update(b);
        s1.update(b);
        size += b.length;
      });
      st.on("error", reject);
      st.on("end", () => resolve());
    });
    return { result: { sha256: s256.digest("hex"), sha1: s1.digest("hex"), size } };
  },
};

/** Bytes scanned by file.strings and file.contains. */
export const SCAN_CAP = 64 * 1024 * 1024;

function printable(c: number): boolean {
  return (c >= 0x20 && c <= 0x7e) || c === 9;
}

export function extractStrings(
  b: Uint8Array,
  min: number,
  limit: number,
  re: RegExp | null,
): { strings: { offset: number; value: string }[]; total: number; matched: number; truncated: boolean } {
  const out: { offset: number; value: string }[] = [];
  let total = 0;
  let matched = 0;
  let start = -1;
  const flush = (end: number) => {
    if (start >= 0 && end - start >= min) {
      total++;
      const value = Buffer.from(b.buffer, b.byteOffset + start, Math.min(end - start, 512)).toString("latin1");
      if (!re || re.test(value)) {
        matched++;
        if (out.length < limit) out.push({ offset: start, value });
      }
    }
    start = -1;
  };
  for (let i = 0; i < b.length; i++) {
    if (printable(b[i]!)) {
      if (start < 0) start = i;
    } else flush(i);
  }
  flush(b.length);
  return { strings: out, total, matched, truncated: matched > out.length };
}

export const fileStrings: AssayProbe = {
  id: "file.strings",
  version: "1",
  predicate: "file.strings",
  summary: "Printable ASCII runs of at least `min` bytes, optionally filtered by `pattern` (capped)",
  appliesTo: (i) => i.kind === "file",
  platforms: ALL,
  cost: "medium",
  confidence: "observed",
  sweep: [],
  async run(ctx) {
    const p = params(ctx.params);
    const min = numParam(p, "min", 6, 2, 256);
    const limit = numParam(p, "limit", 500, 1, 5000);
    const pattern = strParam(p, "pattern", 200);
    let re: RegExp | null = null;
    if (pattern !== undefined) {
      // Bound matching time: nested quantifiers are the classic catastrophic-backtracking shape.
      if (/\([^)]*[+*}][^)]*\)\s*[+*{]/.test(pattern)) fail("param pattern rejected: nested quantifier");
      try {
        re = new RegExp(pattern);
      } catch {
        fail("param pattern is not a valid regular expression");
      }
    }
    const b = await ctx.read(undefined, SCAN_CAP + 1);
    const scanned = b.subarray(0, Math.min(b.length, SCAN_CAP));
    const r = extractStrings(scanned, min, limit, re);
    const clipped = b.length > SCAN_CAP;
    const skipped = clipped ? [{ what: `bytes after ${SCAN_CAP}`, reason: "size cap" }] : [];
    return {
      result: r as unknown as Json,
      coverage: {
        status: clipped ? "partial" : "complete",
        examined: scanned.length,
        skipped,
        unresolved: 0,
        unclaimed: 0,
      },
      limitations: [
        "ASCII only; UTF-16 strings are not extracted",
        ...(r.truncated ? [`only the first ${limit} matching strings are listed`] : []),
      ],
    };
  },
};

function asciiLower(b: Buffer): Buffer {
  const out = Buffer.from(b);
  for (let i = 0; i < out.length; i++) {
    const c = out[i]!;
    if (c >= 65 && c <= 90) out[i] = c + 32;
  }
  return out;
}

export function parseNeedle(p: Record<string, Json>): Uint8Array {
  const text = strParam(p, "text", 4096);
  const hex = strParam(p, "hex", 8192);
  if ((text === undefined) === (hex === undefined)) fail("give exactly one of params text or hex");
  if (text !== undefined) {
    if (text.length === 0) fail("param text is empty");
    return new TextEncoder().encode(text);
  }
  const h = hex!.replace(/\s+/g, "").toLowerCase();
  if (h.length === 0 || h.length % 2 !== 0 || !/^[0-9a-f]+$/.test(h))
    fail("param hex must be an even number of hex digits");
  return Uint8Array.from(Buffer.from(h, "hex"));
}

export const fileContains: AssayProbe = {
  id: "file.contains",
  version: "1",
  predicate: "file.contains",
  summary: "Whether the file contains `text` (UTF-8) or `hex` bytes, anywhere or at `offset` (ignoreCase: ASCII)",
  appliesTo: (i) => i.kind === "file",
  platforms: ALL,
  cost: "cheap",
  confidence: "observed",
  sweep: [],
  async run(ctx) {
    const p = params(ctx.params);
    let needle: Uint8Array = parseNeedle(p);
    const offset = p.offset === undefined || p.offset === null ? null : numParam(p, "offset", 0, 0, SCAN_CAP);
    if (offset !== null) {
      const b = await ctx.read(undefined, offset + needle.length);
      const at = b.subarray(offset, offset + needle.length);
      const found = at.length === needle.length && Buffer.from(at).equals(Buffer.from(needle));
      return {
        result: { found, offsets: found ? [offset] : [], count: found ? 1 : 0, needleLength: needle.length },
        coverage: { status: "complete", examined: 1, skipped: [], unresolved: 0, unclaimed: 0 },
        locator: { offset },
      };
    }
    const ignoreCase = p.ignoreCase === true;
    if (p.ignoreCase !== undefined && typeof p.ignoreCase !== "boolean") fail("param ignoreCase must be a boolean");
    const raw = Buffer.from(await ctx.read(undefined, SCAN_CAP + 1));
    const clipped = raw.length > SCAN_CAP;
    let hay: Buffer = clipped ? raw.subarray(0, SCAN_CAP) : raw;
    if (ignoreCase) {
      hay = asciiLower(hay);
      needle = asciiLower(Buffer.from(needle));
    }
    const offsets: number[] = [];
    let count = 0;
    let at = hay.indexOf(needle);
    while (at >= 0) {
      count++;
      if (offsets.length < 32) offsets.push(at);
      at = hay.indexOf(needle, at + 1);
    }
    const found = count > 0;
    const out: { found: boolean; offsets: number[]; count: number; needleLength: number } = {
      found,
      offsets,
      count,
      needleLength: needle.length,
    };
    return {
      result: out,
      coverage: {
        status: clipped && !found ? "partial" : "complete",
        examined: hay.length,
        skipped: clipped && !found ? [{ what: `bytes after ${SCAN_CAP}`, reason: "size cap" }] : [],
        unresolved: 0,
        unclaimed: 0,
      },
      ...(found ? { locator: { offset: offsets[0]! } } : {}),
    };
  },
};
