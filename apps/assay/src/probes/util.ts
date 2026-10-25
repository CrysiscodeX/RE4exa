// Bounds-checked byte readers and small helpers shared by the built-in probes. Every reader fails
// with AssayError("probe_failed") instead of a RangeError, so a parser fed hostile bytes reports a
// reason and never throws a raw exception.

import type { ProbeDef } from "../contracts.ts";
import { AssayError } from "../errors.ts";
import type { Json } from "../evidence/jcs.ts";
import type { Confidence } from "../evidence/record.ts";

/** A built-in probe: the shared ProbeDef plus how the engine records and sweeps it. */
export interface AssayProbe extends ProbeDef {
  confidence: Confidence;
  /** "root": run on the sweep subject; "each": run on every file the sweep walks (and on a file root). */
  sweep: ("root" | "each")[];
  /** The result depends on the file name (extension), so the name joins the ProbeKey profile. */
  nameSensitive?: boolean;
  /** "approval": the person must approve each run (router rows whose tool downloads or executes code). */
  consent?: "none" | "approval";
}

export type JsonObject = { [k: string]: Json };

export function fail(reason: string, detail: Record<string, unknown> = {}): never {
  throw new AssayError("probe_failed", { reason, ...detail }, `probe failed: ${reason}`);
}

function check(b: Uint8Array, o: number, n: number): void {
  if (!Number.isSafeInteger(o) || o < 0 || n < 0 || o + n > b.length) fail("read past end", { offset: o, length: n });
}

export function u8(b: Uint8Array, o: number): number {
  check(b, o, 1);
  return b[o]!;
}

export function u16(b: Uint8Array, o: number, le = true): number {
  check(b, o, 2);
  return le ? b[o]! | (b[o + 1]! << 8) : (b[o]! << 8) | b[o + 1]!;
}

export function u32(b: Uint8Array, o: number, le = true): number {
  check(b, o, 4);
  return le
    ? b[o]! + b[o + 1]! * 0x100 + b[o + 2]! * 0x10000 + b[o + 3]! * 0x1000000
    : b[o]! * 0x1000000 + b[o + 1]! * 0x10000 + b[o + 2]! * 0x100 + b[o + 3]!;
}

/** 64-bit read as {hi, lo}; callers decide what a large value means. */
export function u64parts(b: Uint8Array, o: number, le = true): { hi: number; lo: number } {
  return le ? { lo: u32(b, o, true), hi: u32(b, o + 4, true) } : { hi: u32(b, o, false), lo: u32(b, o + 4, false) };
}

/** 64-bit read that fails above 2^53 (offsets and sizes in real files never get there). */
export function u64(b: Uint8Array, o: number, le = true): number {
  const { hi, lo } = u64parts(b, o, le);
  if (hi > 0x1fffff) fail("64-bit value too large", { offset: o });
  return hi * 0x100000000 + lo;
}

export function slice(b: Uint8Array, o: number, n: number): Uint8Array {
  check(b, o, n);
  return b.subarray(o, o + n);
}

const utf8Decoder = new TextDecoder("utf-8");

export function utf8(b: Uint8Array): string {
  return utf8Decoder.decode(b);
}

/** NUL-terminated string starting at `o`, at most `max` bytes, never past `end`. */
export function cstr(b: Uint8Array, o: number, max = 4096, end = b.length): string {
  const lim = Math.min(b.length, end, o + max);
  if (!Number.isSafeInteger(o) || o < 0 || o >= lim) fail("string offset out of range", { offset: o });
  let e = o;
  while (e < lim && b[e] !== 0) e++;
  return utf8(b.subarray(o, e));
}

export function asciiAt(b: Uint8Array, o: number, s: string): boolean {
  if (o < 0 || o + s.length > b.length) return false;
  for (let i = 0; i < s.length; i++) if (b[o + i] !== s.charCodeAt(i)) return false;
  return true;
}

export function bytesAt(b: Uint8Array, o: number, sig: number[]): boolean {
  if (o < 0 || o + sig.length > b.length) return false;
  for (let i = 0; i < sig.length; i++) if (b[o + i] !== sig[i]) return false;
  return true;
}

export function toHex(b: Uint8Array): string {
  return Buffer.from(b.buffer, b.byteOffset, b.byteLength).toString("hex");
}

export function isObject(v: unknown): v is JsonObject {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function params(p: Json): JsonObject {
  return isObject(p) ? p : {};
}

export function numParam(p: JsonObject, name: string, def: number, min: number, max: number): number {
  const v = p[name];
  if (v === undefined || v === null) return def;
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max)
    fail(`param ${name} must be an integer in [${min}, ${max}]`);
  return v;
}

export function strParam(p: JsonObject, name: string, maxLen = 4096): string | undefined {
  const v = p[name];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string" || v.length > maxLen) fail(`param ${name} must be a string of at most ${maxLen} chars`);
  return v;
}

export function basenameOf(p: string): string {
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] ?? p;
}

export function extOf(p: string): string {
  const b = basenameOf(p).toLowerCase();
  if (b.endsWith(".tar.gz")) return ".tar.gz";
  const i = b.lastIndexOf(".");
  return i > 0 ? b.slice(i) : "";
}

/** Pack a value into the Json type (drops undefined, maps non-finite numbers to null). */
export function json(v: unknown): Json {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" || typeof v === "boolean") return v;
  if (Array.isArray(v)) return v.map(json);
  if (typeof v === "object") {
    const o: JsonObject = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (x !== undefined) o[k] = json(x);
    return o;
  }
  return null;
}

/** Sort and deduplicate. */
export function uniq(xs: string[]): string[] {
  return [...new Set(xs)].sort();
}
