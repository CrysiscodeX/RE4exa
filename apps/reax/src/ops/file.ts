// Reading a workspace file: the path guard every operation uses, a bounded head read, and a
// forward reader that streams a file of any size through a fixed window.
import { closeSync, openSync, readSync, statSync } from "node:fs";
import { CoreError } from "@re4exa/core/errors";
import { resolveInWorkspace } from "@re4exa/core/mcp/paths";
import { NATIVE_CAP } from "@re4exa/core/probes/builtin/elf";
import "../errors.ts";
import type { OpContext } from "./types.ts";

/** The file `path` names inside the workspace (symlinks out of it are refused); never a directory. */
export function target(ctx: OpContext, path: unknown): { abs: string; rel: string } {
  const r = resolveInWorkspace(ctx.workspace, String(path), { mustExist: true });
  if (!statSync(r.abs).isFile()) throw new CoreError("bad_request", { field: "path", why: "a file, not a directory" });
  return r;
}

/** The first `max` bytes; a file over NATIVE_CAP is refused when the whole file is asked for. */
export function readHead(abs: string, max: number): { bytes: Uint8Array; size: number } {
  const size = statSync(abs).size;
  if (size > max && max === NATIVE_CAP) throw new CoreError("target_too_large", { size, limit: max });
  return { bytes: readRange(abs, 0, Math.min(size, max)), size };
}

/** `length` bytes from `at` (fewer at the end of the file). */
export function readRange(abs: string, at: number, length: number): Uint8Array {
  const fd = openSync(abs, "r");
  try {
    const bytes = new Uint8Array(length);
    let off = 0;
    while (off < length) {
      const n = readSync(fd, bytes, off, length - off, at + off);
      if (n === 0) break;
      off += n;
    }
    return bytes.subarray(0, off);
  } finally {
    closeSync(fd);
  }
}

const WINDOW = 1 << 20;

/** Byte-at-a-time access for a scan that only moves forward (or back within the current window),
 * holding one window of the file in memory. */
export class ForwardReader {
  readonly size: number;
  #fd: number;
  #buf = new Uint8Array(WINDOW);
  #start = 0;
  #end = 0;

  constructor(abs: string) {
    this.size = statSync(abs).size;
    this.#fd = openSync(abs, "r");
  }

  /** The byte at `pos`, or -1 past the end. */
  byte(pos: number): number {
    if (pos >= this.size || pos < 0) return -1;
    if (pos < this.#start || pos >= this.#end) this.#fill(pos);
    return this.#buf[pos - this.#start]!;
  }

  #fill(pos: number): void {
    // keep a little behind `pos` so a step back of a few bytes does not refill
    const start = Math.max(0, pos - 64);
    let off = 0;
    while (off < WINDOW) {
      const n = readSync(this.#fd, this.#buf, off, WINDOW - off, start + off);
      if (n === 0) break;
      off += n;
    }
    this.#start = start;
    this.#end = start + off;
  }

  close(): void {
    closeSync(this.#fd);
  }
}
