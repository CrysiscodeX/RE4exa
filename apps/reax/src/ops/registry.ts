// Every operation reax has, in one list. Generators (scripts/gen.ts) and the runner read only this.
import { CoreError } from "@re4exa/core/errors";
import "../errors.ts";
import { readBytes, readStrings, searchBytesOp } from "./bytes.ts";
import { inventoryGo, inventoryNotes } from "./formats.ts";
import { inventorySegments, readAddress, readEntropy } from "./layout.ts";
import { identifyFile, inventoryNative } from "./native.ts";
import type { Page } from "./page.ts";
import { checkInput } from "./schema.ts";
import { inventoryOverview, inventoryProcedures, inventorySymbols, readSymbol } from "./symbols.ts";
import type { OpContext, Operation, OpResult } from "./types.ts";

export const OPERATIONS: readonly Operation[] = [
  identifyFile,
  inventoryNative,
  inventoryOverview,
  inventorySegments,
  inventorySymbols,
  inventoryProcedures,
  inventoryNotes,
  inventoryGo,
  readStrings,
  readBytes,
  searchBytesOp,
  readAddress,
  readSymbol,
  readEntropy,
];

const byName = new Map<string, Operation>();
for (const op of OPERATIONS) {
  if (byName.has(op.name)) throw new Error(`operation ${op.name} is registered twice`);
  byName.set(op.name, op);
}

export function operation(name: string): Operation {
  const op = byName.get(name);
  if (!op) throw new CoreError("operation_unknown", { operation: name });
  return op;
}

/** Most text returned for one call; the rest goes behind a handle (WP-3). Error text stays
 * under 8k characters too, below the point where clients cut it. */
export const TEXT_CAP = 8000;

/** Most bytes one result's data may take as JSON (rea row C35: refuse early, with a continuation,
 * rather than send something a client cannot take). */
export const RESPONSE_BUDGET = 1024 * 1024;

const size = (v: unknown) => Buffer.byteLength(JSON.stringify(v) ?? "");

/** A paged result over the budget keeps the longest prefix of its page that fits, and page.next
 * continues after it; any other result over the budget is refused. */
function fitPage(name: string, r: OpResult, budget: number): OpResult {
  if (size(r.data) <= budget) return r;
  const d = r.data as { items?: unknown[]; page?: Page } | null;
  if (!d || !Array.isArray(d.items) || !d.page)
    throw new CoreError("result_too_large", { operation: name, bytes: size(r.data), budget });
  let lo = 0;
  let hi = d.items.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (size({ ...d, items: d.items.slice(0, mid) }) <= budget) lo = mid;
    else hi = mid - 1;
  }
  if (lo === 0) throw new CoreError("result_too_large", { operation: name, bytes: size(r.data), budget });
  const page: Page = { ...d.page, limit: lo, next: d.page.offset + lo < d.page.total ? d.page.offset + lo : null };
  return {
    ...r,
    data: { ...d, items: d.items.slice(0, lo), page },
    limitations: [
      ...r.limitations,
      `page shortened to ${lo} rows to fit the ${budget}-byte response budget; continue at offset ${page.next}`,
    ],
  };
}

/** What every result goes through before it leaves reax: the data within the response budget
 * (paged results shortened, others refused) and the text within TEXT_CAP. */
export function applyBudget(name: string, r: OpResult, budget = RESPONSE_BUDGET): OpResult {
  const fitted = fitPage(name, r, budget);
  if (fitted.text.length <= TEXT_CAP) return fitted;
  return {
    ...fitted,
    text: `${fitted.text.slice(0, TEXT_CAP)}\n[text cut at ${TEXT_CAP} characters; the full result is in data]`,
  };
}

export async function runOperation(
  name: string,
  args: unknown,
  ctx: OpContext,
  opts: { budget?: number } = {},
): Promise<OpResult & { operation: string }> {
  const op = operation(name);
  const checked = checkInput(name, op.input, args);
  return { ...applyBudget(name, await op.run(ctx, checked), opts.budget ?? RESPONSE_BUDGET), operation: name };
}
