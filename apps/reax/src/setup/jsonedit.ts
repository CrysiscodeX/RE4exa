// Strict reading of a client's JSON configuration, and writing it back with one top-level edit.
// A file is accepted only when JSON.parse reads it to exactly the values its text holds: no
// duplicate keys (JSON.parse keeps the last silently), no number whose re-serialisation differs from
// its source text (2^64, 1e400, -0, 0.1000...0555), no byte-order mark, valid UTF-8, an object at
// the top. Anything else is refused with a reason and the file is left alone (ADR 0012).

/** The most setup reads of a configuration file; past it, too_large before any parsing. */
export const MAX_CONFIG_BYTES = 16 * 1024 * 1024;

export type MalformedReason =
  | "syntax"
  | "duplicate_key"
  | "number_precision"
  | "not_object"
  | "servers_not_object"
  | "too_large"
  | "symlink"
  | "not_file";

export type JsonObject = Record<string, unknown>;

/** How the file was laid out, so the rewrite keeps it: indent (0 = one line), line ending, final newline. */
export interface Layout {
  indent: string;
  eol: "\n" | "\r\n";
  finalNewline: boolean;
}

export const NEW_FILE_LAYOUT: Layout = { indent: "  ", eol: "\n", finalNewline: true };

export type Parsed = { ok: true; value: JsonObject; layout: Layout } | { ok: false; reason: MalformedReason };

/** The first duplicate key in already-valid JSON text, or null. An explicit stack, no recursion. */
export function duplicateKey(text: string): string | null {
  const stack: { keys: Set<string> | null; expectKey: boolean }[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      const top = stack.at(-1);
      if (top?.keys && top.expectKey) {
        const key = JSON.parse(text.slice(i, j + 1)) as string;
        if (top.keys.has(key)) return key;
        top.keys.add(key);
        top.expectKey = false;
      }
      i = j;
    } else if (c === "{") stack.push({ keys: new Set(), expectKey: true });
    else if (c === "[") stack.push({ keys: null, expectKey: false });
    else if (c === "}" || c === "]") stack.pop();
    else if (c === ",") {
      const top = stack.at(-1);
      if (top?.keys) top.expectKey = true;
    }
  }
  return null;
}

function layoutOf(text: string): Layout {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const m = /^\{[ \t]*\r?\n([ \t]+)\S/.exec(text);
  return { indent: m ? m[1]! : "", eol, finalNewline: /\n$/.test(text) };
}

/** Reads `bytes` strictly (see the file comment). */
export function parseConfig(bytes: Uint8Array): Parsed {
  if (bytes.length > MAX_CONFIG_BYTES) return { ok: false, reason: "too_large" };
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return { ok: false, reason: "syntax" };
  }
  // a BOM is refused, not stripped: JSON.parse would refuse it too (ADR 0012)
  if (text.charCodeAt(0) === 0xfeff) return { ok: false, reason: "syntax" };
  let precise = true;
  let value: unknown;
  try {
    value = JSON.parse(text, function (this: unknown, _k: string, v: unknown, ctx?: { source?: string }) {
      if (typeof v === "number" && (!Number.isFinite(v) || String(v) !== ctx?.source)) precise = false;
      return v;
    });
  } catch {
    return { ok: false, reason: "syntax" };
  }
  if (duplicateKey(text) !== null) return { ok: false, reason: "duplicate_key" };
  if (!precise) return { ok: false, reason: "number_precision" };
  if (value === null || typeof value !== "object" || Array.isArray(value)) return { ok: false, reason: "not_object" };
  const servers = (value as JsonObject).mcpServers;
  if (Object.hasOwn(value, "mcpServers") && (servers === null || typeof servers !== "object" || Array.isArray(servers)))
    return { ok: false, reason: "servers_not_object" };
  return { ok: true, value: value as JsonObject, layout: layoutOf(text) };
}

/** The value written back in the file's own layout. */
export function serialise(value: JsonObject, layout: Layout): string {
  let s = layout.indent ? JSON.stringify(value, null, layout.indent) : JSON.stringify(value);
  // JSON.stringify escapes every newline inside strings, so each "\n" here is a line break
  if (layout.eol === "\r\n") s = s.replaceAll("\n", "\r\n");
  return layout.finalNewline ? s + layout.eol : s;
}

/** Deep equality of JSON values (key order ignored). */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => Object.hasOwn(b, k) && jsonEqual((a as JsonObject)[k], (b as JsonObject)[k]));
}

/** A plain object holding `key: value` defined as data (a "__proto__" key stays a key). */
export function setKey(o: JsonObject, key: string, value: unknown): void {
  Object.defineProperty(o, key, { value, enumerable: true, writable: true, configurable: true });
}
