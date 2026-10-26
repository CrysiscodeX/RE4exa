// Seed (or refresh) the limitation register and the parity ledger from docs/profiles and the rea
// catalog snapshot. Idempotent; keeps triage fields; marks rows the profiles no longer contain as
// orphaned instead of deleting them.
//   npm run seed            write docs/ledger/{limitations,parity}/*.jsonl
//   npm run seed -- --check fail when the committed files differ from a fresh seed
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readJsonl, writeJsonl } from "../src/ledger/io.ts";
import type { LimitationRow, ParityRow } from "../src/ledger/schema.ts";
import { validateLimitation, validateParity } from "../src/ledger/schema.ts";
import {
  donorLimitations,
  leanreaLimitations,
  leanreaParity,
  merge,
  OWNED,
  type PhaseMap,
  reaLimitations,
  reaParity,
} from "../src/ledger/seed.ts";

const REAX = join(import.meta.dirname, "..");
const ROOT = join(REAX, "..", "..");
const LEDGER = join(REAX, "docs", "ledger");
const check = process.argv.includes("--check");
const phases = JSON.parse(readFileSync(join(LEDGER, "phase-map.json"), "utf8")) as PhaseMap;

const plan: { file: string; fresh: LimitationRow[] | ParityRow[]; kind: "limitation" | "parity" }[] = [
  { file: join(LEDGER, "limitations", "rea.jsonl"), fresh: reaLimitations(ROOT), kind: "limitation" },
  { file: join(LEDGER, "limitations", "leanrea.jsonl"), fresh: leanreaLimitations(ROOT), kind: "limitation" },
  { file: join(LEDGER, "limitations", "donors.jsonl"), fresh: donorLimitations(ROOT), kind: "limitation" },
  { file: join(LEDGER, "parity", "rea.jsonl"), fresh: reaParity(ROOT, phases), kind: "parity" },
  { file: join(LEDGER, "parity", "leanrea.jsonl"), fresh: leanreaParity(ROOT, phases), kind: "parity" },
];

let stale = 0;
for (const p of plan) {
  const seeded = new Set(p.fresh.map((r) => r.source?.file).filter((f): f is string => !!f));
  const keyOf = (r: LimitationRow | ParityRow) => ("id" in r ? r.id : r.key);
  const existing = readJsonl<LimitationRow | ParityRow>(p.file);
  const merged =
    p.kind === "limitation"
      ? merge(existing as LimitationRow[], p.fresh as LimitationRow[], (r) => r.id, OWNED.limitation, seeded)
      : merge(existing as ParityRow[], p.fresh as ParityRow[], (r) => r.key, OWNED.parity, seeded);
  for (const r of merged)
    p.kind === "limitation" ? validateLimitation(r as LimitationRow) : validateParity(r as ParityRow);
  const rel = p.file.slice(REAX.length + 1);
  if (check) {
    const before = JSON.stringify([...existing].sort((a, b) => (keyOf(a) < keyOf(b) ? -1 : 1)));
    const after = JSON.stringify([...merged].sort((a, b) => (keyOf(a) < keyOf(b) ? -1 : 1)));
    if (before !== after) {
      console.error(`stale: ${rel} (run npm run seed)`);
      stale++;
    }
  } else {
    writeJsonl(p.file, merged as (LimitationRow | ParityRow)[], keyOf);
    const orphans = merged.filter((r) => r.orphaned).length;
    console.log(`${rel}: ${merged.length} rows${orphans ? `, ${orphans} orphaned` : ""}`);
  }
}
if (stale) process.exit(1);
