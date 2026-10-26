// A small checker for the subset of JSON Schema operations use for their inputs. Errors name the
// operation and the field, and the same mistake gives the same code everywhere (rea row A8.2).

import { CoreError } from "@re4exa/core/errors";
import type { JsonSchema } from "./types.ts";

export function checkInput(op: string, schema: JsonSchema, value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new CoreError("bad_request", { operation: op, field: "(arguments)", why: "an object" });
  const out: Record<string, unknown> = {};
  const props = schema.properties ?? {};
  const v = value as Record<string, unknown>;
  for (const k of Object.keys(v))
    if (!Object.hasOwn(props, k))
      throw new CoreError("bad_request", { operation: op, field: k, why: "not an argument of this operation" });
  for (const r of schema.required ?? [])
    if (v[r] === undefined) throw new CoreError("bad_request", { operation: op, field: r, why: "required" });
  for (const [k, s] of Object.entries(props)) {
    const x = v[k] ?? s.default;
    if (x === undefined) continue;
    check(op, k, s, x);
    out[k] = x;
  }
  return out;
}

function check(op: string, field: string, s: JsonSchema, x: unknown): void {
  const bad = (why: string): never => {
    throw new CoreError("bad_request", { operation: op, field, why });
  };
  switch (s.type) {
    case "string":
      if (typeof x !== "string") bad("a string");
      if (s.maxLength !== undefined && (x as string).length > s.maxLength) bad(`at most ${s.maxLength} characters`);
      break;
    case "integer":
      if (!Number.isInteger(x)) bad("an integer");
      break;
    case "number":
      if (typeof x !== "number" || !Number.isFinite(x)) bad("a finite number");
      break;
    case "boolean":
      if (typeof x !== "boolean") bad("true or false");
      break;
    case "array":
      if (!Array.isArray(x)) bad("an array");
      for (const item of x as unknown[]) if (s.items) check(op, `${field}[]`, s.items, item);
      break;
    default:
      break;
  }
  if (s.enum && !s.enum.includes(x as string | number)) bad(`one of ${s.enum.join(", ")}`);
  if (typeof x === "number") {
    if (s.minimum !== undefined && x < s.minimum) bad(`at least ${s.minimum}`);
    if (s.maximum !== undefined && x > s.maximum) bad(`at most ${s.maximum}`);
  }
}
