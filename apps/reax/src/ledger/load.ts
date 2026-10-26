// Load every ledger row from docs/ledger, validate it, and refuse a key that appears twice.

import { join } from "node:path";
import { readDir } from "./io.ts";
import { type LimitationRow, type ParityRow, validateLimitation, validateParity } from "./schema.ts";

export interface Ledger {
  limitations: { file: string; row: LimitationRow }[];
  parity: { file: string; row: ParityRow }[];
}

export function loadLedger(ledgerDir: string): Ledger {
  const limitations = readDir<LimitationRow>(join(ledgerDir, "limitations"));
  const parity = readDir<ParityRow>(join(ledgerDir, "parity"));
  const seen = new Map<string, string>();
  const claim = (key: string, file: string) => {
    const prev = seen.get(key);
    if (prev) throw new Error(`ledger key ${key} is in both ${prev} and ${file}`);
    seen.set(key, file);
  };
  for (const { file, row } of limitations) {
    validateLimitation(row);
    claim(row.id, `limitations/${file}`);
  }
  for (const { file, row } of parity) {
    validateParity(row);
    claim(row.key, `parity/${file}`);
  }
  return { limitations, parity };
}
