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

/**
 * The skip reason for a LearnHarness test, or false when it runs (D-24). Every one needs GitHub
 * (ASSAY_LEARNHARNESS=1; CI's check job sets it) and is never run on Windows. The sweep test's
 * expectations are Linux's, so it runs on Linux only; the others also run on macOS.
 */
export function learnharnessSkip(test: "sweep" | "other", platform = process.platform): string | false {
  if (process.env.ASSAY_LEARNHARNESS !== "1") return "needs GitHub: set ASSAY_LEARNHARNESS=1 (the CI check job does)";
  if (platform === "win32")
    return "not run on Windows: never run there (cause unknown); CI's check job runs it on Linux";
  if (test === "sweep" && platform !== "linux")
    return platform === "darwin"
      ? "sweep expectations are Linux-specific: on darwin plutil is available, so entitlements.mac.plist is 'available; not run', not 'unsupported format'/'tool missing'; CI's check job runs it on Linux"
      : `sweep expectations are Linux-specific: not run on ${platform}; CI's check job runs it on Linux`;
  return false;
}
