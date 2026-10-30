// reax's operations as core probes, so Assay (or any app on @re4exa/core) can give its agent
// reax's facts as stored, citable evidence. Each read-only operation that takes just a path
// becomes probe `reax.<operation>`: the core probe engine resolves and guards the path, keys the
// run by its inputs, stores the result, and marks it as target-derived. Claims made from it are
// re-checked by the core verifier with its own readers, not with reax's.
import { basename, dirname } from "node:path";
import type { ProbeDef } from "@re4exa/core/contracts";
import type { Json } from "@re4exa/core/evidence/jcs";
import { OPERATIONS, runOperation } from "./registry.ts";
import type { Operation } from "./types.ts";

/** reax's version, recorded in every probe version so stored evidence is re-made when reax changes. */
export const REAX_VERSION = "0.0.2";

/** Formats each operation applies to; an operation not listed applies to every file. */
const APPLIES: Record<string, string[]> = {
  "inventory.native": ["elf", "pe", "macho", "macho-fat", "wasm"],
};

const COST: Record<Operation["cost"], ProbeDef["cost"]> = { cheap: "cheap", medium: "medium", deep: "heavy" };

/** Operations that fit the probe contract: read-only, a single file path in, nothing else required. */
export function probeable(op: Operation): boolean {
  const required = op.input.required ?? [];
  return op.effect === "read" && required.length === 1 && required[0] === "path";
}

/** A probe with the confidence its evidence carries: reax reads the file's own bytes, so what it
 * reports is observed, like core's built-in readers (the engine's default for plug-ins is derived). */
export type ReaxProbe = ProbeDef & { confidence: "observed" };

export function reaxProbes(): ReaxProbe[] {
  return OPERATIONS.filter(probeable).map((op) => ({
    id: `reax.${op.name}`,
    confidence: "observed" as const,
    version: `${REAX_VERSION}`,
    predicate: `reax.${op.name}`,
    summary: `reax ${op.name}: ${op.summary}`,
    appliesTo: (i) => i.kind === "file" && (APPLIES[op.name]?.includes(i.format) ?? true),
    platforms: op.platforms,
    cost: COST[op.cost],
    async run(ctx) {
      // The engine has already resolved and guarded the subject; reax reads it in its own
      // directory, so reax's workspace check sees the same file.
      const params = (
        ctx.params && typeof ctx.params === "object" && !Array.isArray(ctx.params) ? ctx.params : {}
      ) as Record<string, unknown>;
      const r = await runOperation(
        op.name,
        { ...params, path: basename(ctx.subject.abs) },
        { workspace: dirname(ctx.subject.abs) },
      );
      return {
        result: r.data as Json,
        coverage: {
          status: r.coverage,
          examined: 1,
          skipped: r.limitations.map((l) => ({ what: op.name, reason: l })),
          unresolved: 0,
          unclaimed: 0,
        },
        limitations: r.limitations,
      };
    },
  }));
}
