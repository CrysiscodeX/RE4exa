// YAML output: block style, read the same by YAML 1.2 and YAML 1.1 parsers. Every string that a
// parser could take for something else (a number, a boolean in either version, null, a date, a key,
// a comment, a flow collection) is written double-quoted with JSON escapes, which YAML accepts as-is.

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

/** Plain (unquoted) only for strings no YAML 1.1 or 1.2 resolver reads as another type. */
const SAFE_PLAIN = /^[A-Za-z][A-Za-z0-9_./@+-]*$/;
const RESERVED = /^(?:y|n|yes|no|true|false|on|off|null|nan|inf|infinity)$/i;

/** Characters YAML 1.1 does not allow in a stream even inside quotes (DEL, the C1 controls, and the
 * two non-characters) or reads as a line break there (NEL, U+2028, U+2029), escaped so PyYAML and
 * other 1.1 readers read the document as written. */
const NON_PRINTABLE = /[\u007f-\u009f\u2028\u2029\ufffe\uffff]/g;

function str(s: string): string {
  if (SAFE_PLAIN.test(s) && !RESERVED.test(s)) return s;
  return JSON.stringify(s).replace(NON_PRINTABLE, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

/** JSON's spelling, except that an exponent form gets a decimal point (1e+100 becomes 1.0e+100):
 * YAML 1.1's float pattern requires one, and without it 1.1 readers take the number as a string. */
function num(n: number): string {
  const s = JSON.stringify(n);
  const e = s.search(/e/i);
  return e >= 0 && !s.slice(0, e).includes(".") ? `${s.slice(0, e)}.0${s.slice(e)}` : s;
}

function scalar(v: null | boolean | number | string): string {
  if (v === null) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return Number.isFinite(v) ? num(v) : "null";
  return str(v);
}

const isPrimitive = (v: unknown): v is null | boolean | number | string =>
  v === null || ["boolean", "number", "string"].includes(typeof v);

function lines(v: Json, indent: number): string[] {
  const pad = " ".repeat(indent);
  if (Array.isArray(v)) {
    if (v.length === 0) return [`${pad}[]`];
    const out: string[] = [];
    for (const it of v) {
      if (isPrimitive(it)) out.push(`${pad}- ${scalar(it)}`);
      else if (Array.isArray(it) ? it.length === 0 : Object.keys(it).length === 0)
        out.push(`${pad}- ${Array.isArray(it) ? "[]" : "{}"}`);
      else {
        const inner = lines(it, indent + 2);
        inner[0] = `${pad}- ${inner[0]!.slice(indent + 2)}`;
        out.push(...inner);
      }
    }
    return out;
  }
  if (isPrimitive(v)) return [`${pad}${scalar(v)}`];
  const keys = Object.keys(v);
  if (keys.length === 0) return [`${pad}{}`];
  const out: string[] = [];
  for (const k of keys) {
    const x = v[k]!;
    if (isPrimitive(x)) out.push(`${pad}${str(k)}: ${scalar(x)}`);
    else if (Array.isArray(x) ? x.length === 0 : Object.keys(x).length === 0)
      out.push(`${pad}${str(k)}: ${Array.isArray(x) ? "[]" : "{}"}`);
    else out.push(`${pad}${str(k)}:`, ...lines(x, indent + 2));
  }
  return out;
}

/** Encodes a JSON value as a YAML document. */
export function toYaml(value: unknown): string {
  const v = JSON.parse(JSON.stringify(value ?? null)) as Json;
  return lines(v, 0).join("\n");
}
