// RFC 8785 JSON Canonicalization Scheme: object keys sorted by UTF-16 code units, ECMAScript
// number serialisation, no whitespace. Used for every hash Assay computes.

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

export function canonicalize(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) throw new TypeError("canonical JSON cannot hold NaN or Infinity");
      return JSON.stringify(value === 0 ? 0 : value);
    case "string":
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) return `[${value.map((v) => canonicalize(v === undefined ? null : v)).join(",")}]`;
      const obj = value as Record<string, unknown>;
      const keys = Object.keys(obj)
        .filter((k) => obj[k] !== undefined)
        .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`).join(",")}}`;
    }
    default:
      throw new TypeError(`canonical JSON cannot hold ${typeof value}`);
  }
}
