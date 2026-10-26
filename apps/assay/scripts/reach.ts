// Regenerate or print Assay's docs/reach.json from the core fixture sweeps.
//   node --conditions=source scripts/reach.ts --write
// test/probes-reach.test.ts fails when the committed file is stale.

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { computeReach, serializeReach } from "@re4exa/core/probes/reach";
import { fixtureSet } from "@re4exa/core/testing/gen";

export const REACH_PATH = fileURLToPath(new URL("../docs/reach.json", import.meta.url));

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const table = await computeReach(fixtureSet());
  const text = serializeReach(table);
  if (process.argv.includes("--write")) {
    writeFileSync(REACH_PATH, text);
    process.stdout.write(`wrote ${REACH_PATH} (${table.rows.length} rows)\n`);
  } else process.stdout.write(text);
}
