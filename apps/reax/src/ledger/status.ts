// Status is computed, never written by hand. Inputs: the ledger rows and the JUnit reports of the
// CI lanes that ran. A lane is named "<platform>[-suffix]" (linux, darwin, win32, linux-engines).
//
//   covered (fixed, for a limitation)  every platform the row names has a lane in this run, and on
//                                      each of them a [+key] test and a [-key] test passed
//   regressed                          any test tagged with the key failed, on any lane
//   partial                            some tagged test passed, but the rule above is not met
//   planned                            no tagged test ran (skipped, todo and missing lanes count
//                                      as not run)
//   wont                               a reviewed decision with a reason
//
// A row that names an operation is covered only when docs/operations.md documents it.
// A deferred row (D-30, D-33) follows the same rule over every platform it lists, deferred ones
// included: it is never covered while a deferred platform is missing. When its only missing
// platforms are deferred ones it is partial, with the reason "tested, partial (missing: win32;
// deferred by D-30 until RX-SBX/windows-engines)". A failing test on any lane, a deferred one
// included, still makes it regressed. If a deferred platform passes too, the row is covered and
// carries a note to remove the deferral.

import { type Case, tagsOf } from "./junit.ts";
import type { Deferral, LimitationRow, ParityRow, Platform } from "./schema.ts";

export type Computed = "planned" | "partial" | "covered" | "fixed" | "regressed" | "wont";

export interface Lane {
  name: string;
  platform: Platform;
  cases: Case[];
}

export function laneOf(name: string, cases: Case[]): Lane {
  const platform = name.split("-")[0] as Platform;
  if (!["linux", "darwin", "win32"].includes(platform))
    throw new Error(`lane "${name}" must start with linux, darwin or win32`);
  return { name, platform, cases };
}

export interface RowStatus {
  key: string;
  status: Computed;
  why: string;
  phase: number | null;
  /** Platforms the row lists without a passing [+key] and [-key] test (no lane counts as missing). */
  missing: Platform[];
  /** The row's deferral, copied. */
  deferred?: Deferral;
  /** Advice that is not a failure (a deferred platform that now passes). */
  note?: string;
}

interface Tally {
  pos: Set<string>;
  neg: Set<string>;
  failed: string[];
}

function tally(lanes: Lane[]): Map<string, Map<string, Tally>> {
  const by = new Map<string, Map<string, Tally>>();
  for (const lane of lanes)
    for (const c of lane.cases)
      for (const t of tagsOf(c.name)) {
        const perLane = by.get(t.key) ?? new Map<string, Tally>();
        by.set(t.key, perLane);
        const x = perLane.get(lane.name) ?? { pos: new Set(), neg: new Set(), failed: [] };
        perLane.set(lane.name, x);
        if (c.outcome === "fail") x.failed.push(c.name);
        else if (c.outcome === "pass") (t.polarity === "+" ? x.pos : x.neg).add(c.name);
      }
  return by;
}

export function computeStatus(
  rows: (LimitationRow | ParityRow)[],
  lanes: Lane[],
  documented: (operation: string) => boolean,
): { rows: RowStatus[]; unknownTags: string[] } {
  const t = tally(lanes);
  const keys = new Set(rows.map((r) => ("id" in r ? r.id : r.key)));
  const unknownTags = [...t.keys()].filter((k) => !keys.has(k)).sort();
  const out: RowStatus[] = [];
  for (const r of rows) {
    const key = "id" in r ? r.id : r.key;
    const isLimit = "id" in r;
    const done: Computed = isLimit ? "fixed" : "covered";
    const d = r.deferred;
    const base = { key, phase: r.phase, ...(d ? { deferred: d } : {}) };
    if (r.wont) {
      out.push({ ...base, status: "wont", why: `wont: ${r.wont.reason} (${r.wont.reviewer})`, missing: [] });
      continue;
    }
    const perLane = t.get(key);
    if (!perLane) {
      out.push({ ...base, status: "planned", why: "no tagged test ran", missing: [...r.platforms] });
      continue;
    }
    // every lane, deferred platforms included
    const failures = [...perLane.values()].flatMap((x) => x.failed);
    const reasons: string[] = [];
    const missing: Platform[] = [];
    // every platform the row lists, deferred ones included
    for (const p of r.platforms) {
      const ls = lanes.filter((l) => l.platform === p);
      if (!ls.length) {
        reasons.push(`${p}: no lane in this run`);
        missing.push(p);
        continue;
      }
      const pos = ls.some((l) => (perLane.get(l.name)?.pos.size ?? 0) > 0);
      const neg = ls.some((l) => (perLane.get(l.name)?.neg.size ?? 0) > 0);
      if (!pos) reasons.push(`${p}: no passing [+${key}] test`);
      if (!neg) reasons.push(`${p}: no passing [-${key}] test`);
      if (!pos || !neg) missing.push(p);
    }
    if (failures.length) {
      out.push({ ...base, status: "regressed", why: `failed: ${failures.slice(0, 3).join("; ")}`, missing });
      continue;
    }
    const op = "reax" in r ? r.reax.operation : null;
    const undocumented = !!op && !documented(op);
    if (undocumented) reasons.push(`operation ${op} is not in docs/operations.md`);
    const anyPass = [...perLane.values()].some((x) => x.pos.size + x.neg.size > 0);
    if (!reasons.length) {
      const note = d ? `deferred platform now passes: remove the deferral (${d.decision})` : undefined;
      out.push({
        ...base,
        status: done,
        why: `all required lanes passed + and - tests${note ? `; ${note}` : ""}`,
        missing,
        ...(note ? { note } : {}),
      });
    } else {
      const onlyDeferred = !!d && !undocumented && missing.every((p) => d.platforms.includes(p));
      const why =
        onlyDeferred && anyPass
          ? `tested, partial (missing: ${missing.join(", ")}; deferred by ${d.decision} until ${d.until})`
          : reasons.join("; ");
      out.push({ ...base, status: anyPass ? "partial" : "planned", why, missing });
    }
  }
  return { rows: out, unknownTags };
}

/** Rows a phase gate requires: phase set and at or below the gate. */
export function gateFailures(statuses: RowStatus[], gatePhase: number): RowStatus[] {
  return statuses.filter(
    (s) => s.phase !== null && s.phase <= gatePhase && !["covered", "fixed", "wont"].includes(s.status),
  );
}
