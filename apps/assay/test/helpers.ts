import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Kernel } from "@re4exa/core/kernel/kernel";

export function tmp(prefix = "assay-"): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

export class FakeClock {
  t: number;
  constructor(start = 1_800_000_000_000) {
    this.t = start;
  }
  now = (): number => this.t;
  advance(ms: number): void {
    this.t += ms;
  }
}

export function openTemp(clock?: FakeClock): { k: Kernel; dir: string; cleanup: () => void } {
  const t = tmp();
  const k = Kernel.open({ path: join(t.dir, "assay.db"), clock: clock?.now });
  return {
    k,
    dir: t.dir,
    cleanup: () => {
      k.close();
      t.cleanup();
    },
  };
}

/** Deterministic pseudo-random numbers in [0, 1) for reproducible tests. */
export function lcg(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}
