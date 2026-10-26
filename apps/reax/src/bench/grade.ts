// The benchmark grader. One function for every arm: it reads the answer's final ```claims block,
// normalises vocabulary, and scores each claim against the task's oracle. Prose outside the block
// is never graded, so no arm gains from wording that happens to contain a right answer.
//
//   hit          a correct claim for a positive oracle item (or an explicit "none" where the
//                oracle says none)
//   wrong        a claim of a refuted fact, a value outside a complete set, or a second value
//                for a single-valued fact; each distinct wrong claim counts once
//   label error  a hit whose label is not one the oracle allows (default: observed)
//   unscored     a claim about a predicate or subject the oracle does not cover; not penalised
//   accuracy     (hits - wrong) / positive items; it can be negative

import type { Claim, OracleItem, Task } from "./types.ts";

const PREDICATE_ALIASES: Record<string, string> = {
  format: "file.format",
  "file.type": "file.format",
  arch: "native.arch",
  architecture: "native.arch",
  "native.architecture": "native.arch",
  bits: "native.bits",
  links: "native.links",
  needed: "native.links",
  imports: "native.links",
  "native.imports": "native.links",
  "native.needed": "native.links",
  interpreter: "native.interpreter",
  exports: "native.exports",
  symtab: "native.symtab",
  dwarf: "debug.dwarf",
  comp_dir: "debug.comp_dir",
  "cpp.functions": "cpp.function",
  strings: "strings.contains",
};
const SINGLE = new Set([
  "file.format",
  "native.bits",
  "native.interpreter",
  "native.symtab",
  "debug.dwarf",
  "debug.comp_dir",
]);
const FORMAT: Record<string, string> = {
  "mach-o": "macho",
  "mach-o 64-bit": "macho",
  "mach-o fat": "macho-fat",
  "fat mach-o": "macho-fat",
  "mach-o universal": "macho-fat",
  "universal mach-o": "macho-fat",
  universal: "macho-fat",
  fat: "macho-fat",
  coff: "pe",
  "pe32+": "pe",
  pe32: "pe",
  "portable executable": "pe",
  webassembly: "wasm",
  elf64: "elf",
  elf32: "elf",
};
const ARCH: Record<string, string> = {
  amd64: "x86_64",
  "x86-64": "x86_64",
  x64: "x86_64",
  arm64: "aarch64",
  "arm64-v8a": "aarch64",
};
const NONE = new Set(["none", "null", "", "n/a", "no", "absent"]);
const BOOL: Record<string, string> = {
  yes: "true",
  present: "true",
  true: "true",
  no: "false",
  absent: "false",
  false: "false",
  none: "false",
};

export function normPredicate(p: string): string {
  const k = p.trim().toLowerCase();
  return PREDICATE_ALIASES[k] ?? k;
}

export function normSubject(s: string): string {
  return s.trim().split(/[\\/]/).pop() ?? "";
}

/** Canonical value, or null for "none". */
export function normValue(predicate: string, v: unknown): string | null {
  if (v === null || v === undefined) return null;
  let s = String(v).trim();
  const lower = s.toLowerCase();
  switch (predicate) {
    case "file.format":
      return NONE.has(lower) ? null : (FORMAT[lower] ?? lower);
    case "native.arch":
      return NONE.has(lower) ? null : (ARCH[lower] ?? lower);
    case "native.bits":
      return lower.replace(/-?bits?$/, "").replace(/-$/, "");
    case "native.symtab":
    case "debug.dwarf":
      return BOOL[lower] ?? lower;
    case "native.links":
      return NONE.has(lower) ? null : lower;
    case "native.exports":
      if (NONE.has(lower)) return null;
      return s.startsWith("_reax_") ? s.slice(1) : s;
    case "cpp.function":
      // Compare the qualified name; parameter spelling differs between demanglers.
      s = s.replace(/\s+/g, "");
      return s.includes("(") ? s.slice(0, s.indexOf("(")) : s;
    case "debug.comp_dir":
      return s.replace(/\/+$/, "");
    default:
      return NONE.has(lower) && predicate !== "strings.contains" ? null : s;
  }
}

export interface Parsed {
  claims: Claim[];
  error: string | null;
}

/** The last ```claims block of an answer. A missing or malformed block gives no claims. */
export function parseClaims(answer: string): Parsed {
  const blocks = [...answer.matchAll(/```claims[^\n]*\n([\s\S]*?)```/g)];
  if (!blocks.length) return { claims: [], error: "no claims block" };
  let raw: unknown;
  try {
    raw = JSON.parse(blocks[blocks.length - 1]![1]!);
  } catch (e) {
    return { claims: [], error: `claims block is not JSON: ${(e as Error).message}` };
  }
  if (!Array.isArray(raw)) return { claims: [], error: "claims block is not an array" };
  const claims: Claim[] = [];
  for (const c of raw) {
    if (!c || typeof c !== "object") continue;
    const o = c as Record<string, unknown>;
    if (typeof o.predicate !== "string" || typeof o.subject !== "string") continue;
    const predicate = normPredicate(o.predicate);
    claims.push({
      predicate,
      subject: normSubject(o.subject),
      value: normValue(predicate, o.value),
      label: typeof o.label === "string" ? o.label.trim().toLowerCase() : "unknown",
    });
  }
  return { claims, error: null };
}

export interface Grade {
  positives: number;
  hits: number;
  wrong: number;
  labelErrors: number;
  unscored: number;
  claims: number;
  accuracy: number;
  parseError: string | null;
  detail: { claim: string; verdict: "hit" | "wrong" | "unscored" | "duplicate"; why?: string }[];
}

const key = (p: string, s: string) => `${p}\u0000${s}`;

export function grade(task: Task, answer: string): Grade {
  const { claims, error } = parseClaims(answer);
  const items = task.oracle.map((o) => ({ ...o, value: normValue(o.predicate, o.value) }));
  const byKey = new Map<string, OracleItem[]>();
  for (const o of items) byKey.set(key(o.predicate, o.subject), [...(byKey.get(key(o.predicate, o.subject)) ?? []), o]);
  const positives = items.filter((o) => o.expect).length;
  const hitItems = new Set<OracleItem>();
  const seen = new Set<string>();
  const detail: Grade["detail"] = [];
  let wrong = 0;
  let labelErrors = 0;
  let unscored = 0;
  for (const c of claims) {
    const id = `${c.predicate} ${c.subject} = ${c.value ?? "none"}`;
    if (seen.has(id)) {
      detail.push({ claim: id, verdict: "duplicate" });
      continue;
    }
    seen.add(id);
    const group = byKey.get(key(c.predicate, c.subject));
    if (!group) {
      unscored++;
      detail.push({ claim: id, verdict: "unscored" });
      continue;
    }
    const refuted = group.find((o) => !o.expect && o.value === c.value);
    if (refuted) {
      wrong++;
      detail.push({ claim: id, verdict: "wrong", why: "refuted fact" });
      continue;
    }
    const match = group.find((o) => o.expect && o.value === c.value);
    if (match) {
      hitItems.add(match);
      const allowed = match.labels ?? ["observed"];
      if (!allowed.includes(c.label)) labelErrors++;
      detail.push({ claim: id, verdict: "hit" });
      continue;
    }
    const closed = group.some((o) => o.expect && (o.complete || SINGLE.has(o.predicate) || o.value === null));
    if (closed) {
      wrong++;
      detail.push({ claim: id, verdict: "wrong", why: "not the observed value" });
    } else {
      unscored++;
      detail.push({ claim: id, verdict: "unscored" });
    }
  }
  const hits = hitItems.size;
  return {
    positives,
    hits,
    wrong,
    labelErrors,
    unscored,
    claims: claims.length,
    accuracy: positives ? (hits - wrong) / positives : 0,
    parseError: error,
    detail,
  };
}
