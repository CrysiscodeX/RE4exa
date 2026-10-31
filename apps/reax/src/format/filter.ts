// --filter-output: keep only the named parts of a result's data. A path is dot-separated keys; on
// an array a key applies to every element (`slices.arch` is each slice's arch), and a number keeps
// that one element (`slices.0.exports`). Several paths, comma-separated, merge into one pruned copy.
// `page` is always kept, so a filtered page can still be continued.

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

function prune(v: Json, segs: string[]): Json | undefined {
  if (segs.length === 0) return v;
  const [h, ...t] = segs as [string, ...string[]];
  if (Array.isArray(v)) {
    if (/^\d+$/.test(h)) {
      const x = Number(h) < v.length ? prune(v[Number(h)]!, t) : undefined;
      return x === undefined ? undefined : [x];
    }
    const xs = v.map((e) => prune(e, segs));
    return xs.some((x) => x !== undefined) ? xs.map((x) => (x === undefined ? null : x)) : undefined;
  }
  if (v === null || typeof v !== "object" || !Object.hasOwn(v, h)) return undefined;
  const x = prune(v[h]!, t);
  return x === undefined ? undefined : { [h]: x };
}

function merge(a: Json | undefined, b: Json): Json {
  if (a === undefined) return b;
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) return a.map((x, i) => merge(x, b[i]!));
  if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
    const out: { [k: string]: Json } = { ...a };
    for (const [k, v] of Object.entries(b)) out[k] = merge(out[k], v);
    return out;
  }
  return b;
}

/** The data with only `paths` kept, and the paths that matched nothing. */
export function filterOutput(data: unknown, paths: string[]): { data: unknown; unmatched: string[] } {
  const v = JSON.parse(JSON.stringify(data ?? null)) as Json;
  let out: Json | undefined;
  const unmatched: string[] = [];
  const all = [...paths];
  if (v && typeof v === "object" && !Array.isArray(v) && "page" in v && !all.includes("page")) all.push("page");
  for (const p of all) {
    const segs = p.split(".").filter((s) => s !== "");
    if (segs.length === 0) continue;
    const x = prune(v, segs);
    if (x === undefined) {
      if (p !== "page" || paths.includes("page")) unmatched.push(p);
      continue;
    }
    out = merge(out, x);
  }
  return { data: out ?? {}, unmatched };
}
