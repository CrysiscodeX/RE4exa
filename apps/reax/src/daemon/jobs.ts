// The daemon's job.* methods (ADR 0008; additive to protocol version 1, D-28): the wire side of the
// scheduler. Each connection is one owner: closing it cancels the jobs it submitted and ends its
// waits, nothing else. Any authenticated connection may query or cancel any job (same-user trust,
// SR-9). Every method is reached only after a valid hello (server.ts).
//   job.submit {operation, args?, workspace, timeoutMs?} -> {job, state, position}
//   job.status {job}               -> JobInfo
//   job.list   {}                  -> {jobs: JobInfo[] by seq, counts, limits}
//   job.wait   {job, timeoutMs?}   -> JobInfo & {done} (done: false at the timeout; not an error)
//   job.result {job}               -> {job, result} | the job's own error
//   job.cancel {job}               -> {job, state, cancelled}
import { CoreError, isCoreError } from "@re4exa/core/errors";
import "../errors.ts";
import { errorRecord, type Scheduler } from "../sched/scheduler.ts";
import { type JobMethod, params } from "./protocol.ts";

/** The longest job id accepted (a UUID is 36 characters). */
const MAX_ID = 64;

function jobId(p: Record<string, unknown>): string {
  if (typeof p.job !== "string" || p.job.length === 0 || p.job.length > MAX_ID)
    throw new CoreError("bad_request", { field: "job", why: `a job id (at most ${MAX_ID} characters)` });
  return p.job;
}

/** Run one job method for connection `conn`: its result, a promise of it (job.wait), or a thrown
 * CoreError. */
export function jobCall(
  sched: Scheduler,
  conn: string,
  method: JobMethod,
  frame: Record<string, unknown>,
): unknown | Promise<unknown> {
  switch (method) {
    case "job.submit": {
      const p = params(frame, ["operation", "args", "workspace", "timeoutMs"]);
      if (typeof p.operation !== "string" || p.operation.length > 256)
        throw new CoreError("bad_request", { field: "operation", why: "an operation name" });
      if (p.args !== undefined && (typeof p.args !== "object" || p.args === null || Array.isArray(p.args)))
        throw new CoreError("bad_request", { field: "args", why: "an object" });
      if (typeof p.workspace !== "string" || p.workspace.length > 4096)
        throw new CoreError("bad_request", { field: "workspace", why: "an absolute path to a directory" });
      if (p.timeoutMs !== undefined && typeof p.timeoutMs !== "number")
        throw new CoreError("bad_request", { field: "timeoutMs", why: "a whole number of ms" });
      return sched.submit(conn, {
        operation: p.operation,
        args: p.args ?? {},
        workspace: p.workspace,
        ...(p.timeoutMs !== undefined ? { timeoutMs: p.timeoutMs as number } : {}),
      });
    }
    case "job.status":
      return sched.status(jobId(params(frame, ["job"])));
    case "job.list":
      params(frame, []);
      return { ...sched.list(), limits: sched.limits };
    case "job.wait": {
      const p = params(frame, ["job", "timeoutMs"]);
      const ms = p.timeoutMs ?? sched.limits.maxWaitMs;
      if (typeof ms !== "number") throw new CoreError("bad_request", { field: "timeoutMs", why: "a number of ms" });
      return sched.wait(conn, jobId(p), ms);
    }
    case "job.result":
      return sched.result(jobId(params(frame, ["job"])));
    case "job.cancel":
      return sched.cancel(jobId(params(frame, ["job"])), "client");
  }
}

/** A job method's error on the wire: the failure table's fields plus the failure's detail. */
export function jobError(e: unknown): Record<string, unknown> {
  const err = isCoreError(e)
    ? e
    : new CoreError("job_failed", { excerpt: String((e as Error)?.message ?? e).slice(0, 200) });
  const { code, message, retryable, fix, detail } = errorRecord(err);
  return { code, message, retryable, fix, detail };
}
