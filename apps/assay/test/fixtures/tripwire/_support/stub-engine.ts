// A small ProbeEngine for tests of the MCP layer (the real one lives in src/probes/engine.ts).
// Probes: file.identify (size and digest) and file.strings (printable runs of >= 4 bytes).

import { readFileSync, statSync } from "node:fs";
import type { ProbeDef, ProbeEngine, SweepReport } from "../../../../src/contracts.ts";
import { AssayError } from "../../../../src/errors.ts";
import type { Json } from "@re4exa/core/evidence/jcs";
import { type ClaimRecord, makeRecord, probeKey, subjectDigest } from "@re4exa/core/evidence/record";
import { evidenceByProbeKey, putEvidence } from "@re4exa/core/evidence/store";
import type { Kernel } from "@re4exa/core/kernel/kernel";
import { resolveInWorkspace } from "@re4exa/core/mcp/paths";

function strings(buf: Uint8Array, min = 4): string[] {
  const out: string[] = [];
  let cur = "";
  for (const b of buf) {
    if (b >= 32 && b < 127) cur += String.fromCharCode(b);
    else {
      if (cur.length >= min) out.push(cur);
      cur = "";
    }
  }
  if (cur.length >= min) out.push(cur);
  return out;
}

const DEFS: ProbeDef[] = [
  {
    id: "file.identify",
    version: "1",
    predicate: "file.identify",
    summary: "size and digest",
    appliesTo: () => true,
    platforms: ["linux", "darwin", "win32"],
    cost: "cheap",
    run: async () => ({ result: null }),
  },
  {
    id: "file.strings",
    version: "1",
    predicate: "file.strings",
    summary: "printable strings",
    appliesTo: (i) => i.kind === "file",
    platforms: ["linux", "darwin", "win32"],
    cost: "cheap",
    run: async () => ({ result: null }),
  },
];

export function stubEngine(kernel: Kernel, workspace: string): ProbeEngine & { runs: number } {
  const engine = {
    runs: 0,
    list: () => DEFS,
    async run(input: { caseId: string | null; probeId: string; path: string; params?: Json; producerId?: string }) {
      engine.runs++;
      const def = DEFS.find((d) => d.id === input.probeId);
      if (!def) throw new AssayError("probe_unknown", { probe: input.probeId });
      const { abs, rel } = resolveInWorkspace(workspace, input.path);
      const bytes = readFileSync(abs);
      const digest = subjectDigest(bytes);
      const params = input.params ?? {};
      const pk = probeKey({ id: def.id, version: def.version }, params, digest);
      const prior = evidenceByProbeKey(kernel, pk);
      if (prior) return putEvidence(kernel, input.caseId, prior);
      const result: Json =
        def.id === "file.strings" ? { strings: strings(bytes) } : { size: statSync(abs).size, digest };
      const rec: ClaimRecord = makeRecord(
        {
          probe: { id: def.id, version: def.version },
          probe_key: pk,
          predicate: def.predicate,
          subject: { digest },
          params,
          result,
          confidence: "observed",
          producer: { kind: "runner", id: "stub" },
          locator: { path: rel },
        },
        kernel.now(),
      );
      return putEvidence(kernel, input.caseId, rec);
    },
    async sweep(input: { caseId: string | null; path: string }): Promise<SweepReport> {
      const r = await engine.run({ caseId: input.caseId, probeId: "file.identify", path: input.path });
      return {
        subject: input.path,
        evidence: [r.observation_id],
        findings: [],
        questions: [],
        notExamined: [],
        elapsedMs: 1,
      };
    },
  };
  return engine;
}
