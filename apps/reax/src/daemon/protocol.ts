// The daemon's wire protocol, version 1: UTF-8 JSON, one frame per line ("\n").
//   client: {"type":"hello","protocol":1,"token":"..."}
//   daemon: {"type":"hello","ok":true,"protocol":1,"instance":"..."}  or an error frame, then close
//   client: {"id":n,"method":"ping"|"status"|"shutdown"}
//   client: {"id":n,"method":"job.submit"|"job.status"|"job.list"|"job.wait"|"job.result"|"job.cancel",
//            "params":{...}}   (additive, still version 1; ADR 0008, D-28)
//   daemon: {"id":n,"ok":true,"result":...} | {"id":n,"ok":false,"error":{code,message,retryable,fix}}
//           (job.* errors also carry the failure's detail; job.wait replies may arrive out of order,
//           so clients match replies by id)
// Limits: a frame is at most MAX_FRAME bytes; at most MAX_CONNECTIONS at once (the next one gets a
// {"type":"hello","ok":false,"error":{code:"daemon_busy",...}} frame and is closed); a connection
// that has not sent a valid hello within HELLO_TIMEOUT_MS is closed.
import { CoreError, type FailureCode } from "@re4exa/core/errors";
import "../errors.ts";

export const PROTOCOL_VERSION = 1;
export const MAX_FRAME = 64 * 1024;
export const MAX_CONNECTIONS = 32;
export const HELLO_TIMEOUT_MS = 2000;
export const JOB_METHODS = ["job.submit", "job.status", "job.list", "job.wait", "job.result", "job.cancel"] as const;
export const METHODS = ["ping", "status", "shutdown", ...JOB_METHODS] as const;
export type JobMethod = (typeof JOB_METHODS)[number];
export type Method = (typeof METHODS)[number];

/** Splits a byte stream into lines. A line (or an unterminated tail) over MAX_FRAME is an error. */
export class FrameReader {
  #parts: Buffer[] = [];
  #size = 0;

  /** The complete frames in this chunk; throws bad_request once the pending frame is too large. */
  push(chunk: Buffer): string[] {
    const out: string[] = [];
    let from = 0;
    for (let nl = chunk.indexOf(10, from); nl >= 0; nl = chunk.indexOf(10, from)) {
      const piece = chunk.subarray(from, nl);
      if (this.#size + piece.length > MAX_FRAME) throw tooLarge();
      this.#parts.push(piece);
      out.push(Buffer.concat(this.#parts).toString("utf8"));
      this.#parts = [];
      this.#size = 0;
      from = nl + 1;
    }
    const rest = chunk.subarray(from);
    if (this.#size + rest.length > MAX_FRAME) throw tooLarge();
    if (rest.length) {
      this.#parts.push(rest);
      this.#size += rest.length;
    }
    return out;
  }
}

const tooLarge = () => new CoreError("bad_request", { why: `a frame is at most ${MAX_FRAME} bytes` });

/** One frame as a JSON object; bad_request for anything else. */
export function parseFrame(line: string): Record<string, unknown> {
  let v: unknown;
  try {
    v = JSON.parse(line);
  } catch {
    throw new CoreError("bad_request", { why: "a frame is one JSON object per line" });
  }
  if (typeof v !== "object" || v === null || Array.isArray(v))
    throw new CoreError("bad_request", { why: "a frame is one JSON object per line" });
  return v as Record<string, unknown>;
}

export const encode = (frame: unknown) => `${JSON.stringify(frame)}\n`;

/** A job method's params: an object (absent counts as {}) with only the allowed keys; bad_request
 * otherwise. */
export function params(frame: Record<string, unknown>, allowed: readonly string[]): Record<string, unknown> {
  const p = frame.params ?? {};
  if (typeof p !== "object" || p === null || Array.isArray(p))
    throw new CoreError("bad_request", { field: "params", why: "an object" });
  for (const k of Object.keys(p))
    if (!allowed.includes(k)) throw new CoreError("bad_request", { field: `params.${k.slice(0, 64)}`, why: "unknown" });
  return p as Record<string, unknown>;
}

/** The wire form of a failure: code, message, retryable and fix (from the failure table). */
export function errorBody(e: CoreError | FailureCode): Record<string, unknown> {
  const err = typeof e === "string" ? new CoreError(e) : e;
  const { code, message, retryable, fix } = err.toJSON() as Record<string, unknown>;
  return { code, message, retryable, fix };
}
