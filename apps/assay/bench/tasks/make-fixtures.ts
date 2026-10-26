// Writes Assay's committed copy of the benchmark corpus (from @re4exa/core/testing/bench-tasks):
// fixtures into bench/tasks/fixtures/ and task files bench/tasks/<id>.json.
//   node --conditions=source bench/tasks/make-fixtures.ts            write fixtures and task files
//   node --conditions=source bench/tasks/make-fixtures.ts <outDir>   write fixtures under <outDir>

import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeCorpus } from "@re4exa/core/testing/bench-tasks";

const HERE = dirname(fileURLToPath(import.meta.url));
const out = process.argv[2] ? resolve(process.argv[2]) : join(HERE, "fixtures");
const written = writeCorpus(out, process.argv[2] ? undefined : HERE);
process.stdout.write(`wrote ${written.length} fixture files to ${out}\n`);
