// Killing what can be found of a sandboxed child's tree on POSIX (reax does it; core only kills
// the root by its handle). A descendant that left the group (setsid, or spawned detached) is
// outside the group kill, so it is found by parent pid; one whose parent already exited is not
// found (ADR 0006's known limit). The caller (index.ts) calls killDescendants and then
// killGroup at the deadline or an abort only while the root is unreaped (Node has seen no exit
// for it, so its pid cannot have been reused), and calls killGroup again in the same turn as the
// root's exit event.
// TREE is the object index.ts calls through, so a test can count the calls.
// Host tool: ps, run by absolute path as `ps -A -o pid=,ppid=`. -A is POSIX's "every process" on
// both procps-ng (Linux) and BSD ps (macOS); `-a` is not used because procps-ng's -a leaves out
// session leaders, and a setsid grandchild is one. One code path on both systems, rather than a
// second (/proc) reader on Linux.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const PS = ["/bin/ps", "/usr/bin/ps"].find((p) => existsSync(p)) ?? null;
const PS_MAX_BYTES = 16 * 1024 * 1024;
const MAX_PROCS = 1_000_000;
const PASSES = 3;

/** Every descendant of root, by parent pid, from one ps snapshot; [] when ps is unavailable. */
export function descendants(root: number): number[] {
  if (!PS || process.platform === "win32") return [];
  const r = spawnSync(PS, ["-A", "-o", "pid=,ppid="], { encoding: "utf8", timeout: 10_000, maxBuffer: PS_MAX_BYTES });
  if (r.status !== 0 || typeof r.stdout !== "string") return [];
  const kids = new Map<number, number[]>();
  const lines = r.stdout.split("\n");
  for (let i = 0; i < lines.length && i < MAX_PROCS; i++) {
    const m = /^\s*(\d+)\s+(\d+)\s*$/.exec(lines[i]!);
    if (!m) continue;
    const pid = Number(m[1]);
    const ppid = Number(m[2]);
    kids.set(ppid, [...(kids.get(ppid) ?? []), pid]);
  }
  const out: number[] = [];
  const seen = new Set<number>([root]);
  const queue = [root];
  while (queue.length && out.length < MAX_PROCS) {
    for (const k of kids.get(queue.shift()!) ?? [])
      if (!seen.has(k)) {
        seen.add(k);
        out.push(k);
        queue.push(k);
      }
  }
  return out;
}

const kill = (pid: number) => {
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    /* already gone (ESRCH) */
  }
};

/** SIGKILL every descendant of root listed in a ps snapshot, taking a new snapshot while new ones
 * appear (a few passes); a descendant whose parent already exited is not listed. The caller
 * must know root is unreaped; pids 0 and 1 are refused. */
export function killDescendants(root: number): number {
  if (!(root > 1)) return 0;
  let n = 0;
  for (let pass = 0; pass < PASSES; pass++) {
    const found = descendants(root);
    if (!found.length) break;
    for (const p of found) kill(p);
    n += found.length;
  }
  return n;
}

/** SIGKILL the process group led by pid; a group that is already empty is fine; pids 0 and 1 are
 * refused. */
export function killGroup(pid: number): void {
  if (process.platform === "win32" || !(pid > 1)) return;
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    /* no such group (ESRCH) */
  }
}

/** The tree operations index.ts uses, called through this object (a test seam for counting).
 * killGroupAtExit is killGroup as called from the root's exit event, kept apart so a test can tell
 * the exit-turn kill from the deadline one. */
export const TREE = { killDescendants, killGroup, killGroupAtExit: killGroup };
