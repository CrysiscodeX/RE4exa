// Load every ledger row from docs/ledger, validate it, refuse a key that appears twice, and refuse a
// deferral whose lifting row does not exist.

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
  // a deferral names the row whose item would lift it: that row must exist (D-33)
  for (const row of [...limitations.map((x) => x.row), ...parity.map((x) => x.row)])
    if (row.deferred && !seen.has(row.deferred.until))
      throw new Error(
        `ledger row ${"id" in row ? row.id : row.key}: deferred.until names ${row.deferred.until}, which no ledger row has`,
      );
  return { limitations, parity };
}
