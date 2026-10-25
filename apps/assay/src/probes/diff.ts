// Re-assay: pair the findings of two sweeps (or two versions of a subject) by FindingKey.

import type { Finding } from "../evidence/record.ts";

export interface FindingDiff<F extends Finding = Finding> {
  added: F[];
  removed: F[];
  unchanged: { before: F; after: F }[];
}

function byKey<F extends Finding>(fs: F[]): Map<string, F> {
  const m = new Map<string, F>();
  for (const f of fs) if (!m.has(f.key)) m.set(f.key, f);
  return m;
}

/** Findings present only after (added), only before (removed), or in both (unchanged), each once per key. */
export function diffFindings<F extends Finding>(before: F[], after: F[]): FindingDiff<F> {
  const b = byKey(before);
  const a = byKey(after);
  const order = (x: F, y: F) =>
    x.class < y.class ? -1 : x.class > y.class ? 1 : x.label < y.label ? -1 : x.label > y.label ? 1 : 0;
  const added = [...a.values()].filter((f) => !b.has(f.key)).sort(order);
  const removed = [...b.values()].filter((f) => !a.has(f.key)).sort(order);
  const unchanged = [...a.values()]
    .filter((f) => b.has(f.key))
    .sort(order)
    .map((after) => ({ before: b.get(after.key)!, after }));
  return { added, removed, unchanged };
}
