// Every operation reax has, in one list. Generators (scripts/gen.ts) and the runner read only this.
import { CoreError } from "@re4exa/core/errors";
import "../errors.ts";
import { identifyFile, inventoryNative } from "./native.ts";
import { checkInput } from "./schema.ts";
import type { OpContext, Operation, OpResult } from "./types.ts";

export const OPERATIONS: readonly Operation[] = [identifyFile, inventoryNative];

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

export async function runOperation(
  name: string,
  args: unknown,
  ctx: OpContext,
): Promise<OpResult & { operation: string }> {
  const op = operation(name);
  const checked = checkInput(name, op.input, args);
  const r = await op.run(ctx, checked);
  if (r.text.length <= TEXT_CAP) return { ...r, operation: name };
  return {
    ...r,
    operation: name,
    text: `${r.text.slice(0, TEXT_CAP)}\n[text cut at ${TEXT_CAP} characters; the full result is in data]`,
    coverage: r.coverage,
  };
}
