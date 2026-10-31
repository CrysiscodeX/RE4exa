// TOON (Token-Oriented Object Notation): JSON's data model with fewer tokens, for model-facing
// output. Objects are `key: value` lines, indented two spaces per level. A primitive array is one
// line, `key[N]: a,b,c`. An array of objects that share the same primitive fields is a table:
// `key[N]{f1,f2}:` and then one comma-separated row per item. Anything else is a list of `- item`
// lines. Strings are quoted only when they would otherwise read as something else.

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

const INDENT = "  ";

function isPrimitive(v: unknown): v is null | boolean | number | string {
  return v === null || typeof v === "boolean" || typeof v === "number" || typeof v === "string";
}

/** A finite number in plain decimal (no exponent); NaN and Infinity have no JSON value: null. */
function num(n: number): string {
  if (!Number.isFinite(n)) return "null";
  if (Object.is(n, -0)) return "0";
  const s = String(n);
  if (!/e/i.test(s)) return s;
  // expand an exponent so a reader that expects decimal digits gets them
  const [mant, expS] = s.toLowerCase().split("e") as [string, string];
  const exp = Number(expS);
  const neg = mant.startsWith("-");
  const [int, frac = ""] = mant.replace("-", "").split(".") as [string, string?];
  const digits = int + frac;
  const point = int.length + exp;
  let out: string;
  if (point <= 0) out = `0.${"0".repeat(-point)}${digits}`;
  else if (point >= digits.length) out = digits + "0".repeat(point - digits.length);
  else out = `${digits.slice(0, point)}.${digits.slice(point)}`;
  out = out.replace(/^0+(?=\d)/, "");
  if (out.includes(".")) out = out.replace(/0+$/, "").replace(/\.$/, "");
  return (neg ? "-" : "") + out;
}

const NUMERIC = /^[+-]?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i;
const LEADING_ZERO = /^0\d/;

/** A string needs quotes when, unquoted, it would read as another value or break the line. */
function needsQuotes(s: string, delim: string): boolean {
  if (s === "") return true;
  if (s !== s.trim()) return true;
  if (s === "true" || s === "false" || s === "null") return true;
  if (NUMERIC.test(s) || LEADING_ZERO.test(s)) return true;
  if (s.startsWith("-") || s.startsWith("#")) return true;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters force quoting
  if (/[:"\\[\]{}\n\r\t\u0000-\u001f\u007f]/.test(s)) return true;
  if (s.includes(delim)) return true;
  return false;
}

function quote(s: string): string {
  let out = '"';
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (ch === '"') out += '\\"';
    else if (ch === "\\") out += "\\\\";
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (c < 0x20 || c === 0x7f) out += `\\u${c.toString(16).padStart(4, "0")}`;
    else out += ch;
  }
  return `${out}"`;
}

function scalar(v: null | boolean | number | string, delim = ","): string {
  if (v === null) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return num(v);
  return needsQuotes(v, delim) ? quote(v) : v;
}

function key(k: string): string {
  return /^[A-Za-z_][A-Za-z0-9_.]*$/.test(k) ? k : quote(k);
}

/** The shared field list when every item is an object of primitives with the same keys, in order. */
function tableFields(items: Json[]): string[] | null {
  if (items.length === 0) return null;
  let fields: string[] | null = null;
  for (const it of items) {
    if (it === null || typeof it !== "object" || Array.isArray(it)) return null;
    const ks = Object.keys(it);
    if (ks.length === 0) return null;
    if (!ks.every((k) => isPrimitive((it as Record<string, Json>)[k]))) return null;
    if (fields === null) fields = ks;
    else if (fields.length !== ks.length || !fields.every((f, i) => ks[i] === f)) return null;
  }
  return fields;
}

/** `table` is false for an array that is itself a list item: TOON allows a keyless table header
 * only at the document root, so such an array lists its objects instead. */
function arrayLines(head: string, arr: Json[], depth: number, table = true): string[] {
  const pad = INDENT.repeat(depth);
  if (arr.length === 0) return [`${pad}${head}[0]:`];
  if (arr.every(isPrimitive)) return [`${pad}${head}[${arr.length}]: ${arr.map((v) => scalar(v)).join(",")}`];
  const fields = table ? tableFields(arr) : null;
  if (fields) {
    const rows = arr.map(
      (it) =>
        `${pad}${INDENT}${fields.map((f) => scalar((it as Record<string, Json>)[f] as null | boolean | number | string)).join(",")}`,
    );
    return [`${pad}${head}[${arr.length}]{${fields.map(key).join(",")}}:`, ...rows];
  }
  const out = [`${pad}${head}[${arr.length}]:`];
  for (const it of arr) out.push(...itemLines(it, depth + 1));
  return out;
}

/** One `- ` list item at `depth`. */
function itemLines(v: Json, depth: number): string[] {
  const pad = INDENT.repeat(depth);
  if (isPrimitive(v)) return [`${pad}- ${scalar(v)}`];
  if (Array.isArray(v)) {
    const lines = arrayLines("", v, depth, false);
    lines[0] = `${pad}- ${lines[0]!.slice(pad.length)}`;
    return lines;
  }
  const keys = Object.keys(v);
  if (keys.length === 0) return [`${pad}-`];
  // the object's fields sit one level deeper than the hyphen; the first one shares its line
  const lines = objectLines(v, depth + 1);
  lines[0] = `${pad}- ${lines[0]!.slice(INDENT.repeat(depth + 1).length)}`;
  return lines;
}

function objectLines(o: { [k: string]: Json }, depth: number): string[] {
  const pad = INDENT.repeat(depth);
  const out: string[] = [];
  for (const [k, v] of Object.entries(o)) {
    if (v === undefined) continue;
    if (isPrimitive(v)) out.push(`${pad}${key(k)}: ${scalar(v)}`);
    else if (Array.isArray(v)) out.push(...arrayLines(key(k), v, depth));
    else if (Object.keys(v).length === 0) out.push(`${pad}${key(k)}:`);
    else out.push(`${pad}${key(k)}:`, ...objectLines(v, depth + 1));
  }
  return out;
}

/** Encodes a JSON value (anything JSON.stringify accepts) as TOON. */
export function toToon(value: unknown): string {
  const v = JSON.parse(JSON.stringify(value ?? null)) as Json;
  if (isPrimitive(v)) return scalar(v);
  if (Array.isArray(v)) return arrayLines("", v, 0).join("\n");
  return objectLines(v, 0).join("\n");
}
