// The engine adapter contract (ENG): what every engine provider (LLVM first; later others) offers.
// A provider finds its engine without installing anything, reports what it found (real path,
// version, SHA-256 of the binary, the sandbox label discovery ran under), and runs the engine on a
// target through runSandboxed with required: true by default. A provider whose engine reads targets
// (LLVM) sets alwaysRequired, so its runs never leave the sandbox whatever the caller asks (D-22);
// only a contract-test engine may honour a per-call required: false. Failures are
// typed CoreErrors: engine_unavailable, engine_failed, engine_timeout, engine_cancelled,
// engine_output_invalid, and sandbox_unavailable passed through unchanged.
import type { Enforcement } from "../sandbox/policy.ts";

/** What discovery found. A found engine is identified by its real path and the digest of its bytes. */
export type Availability =
  | {
      available: true;
      /** The resolved real path of the engine binary (symlinks followed). */
      path: string;
      /** The version the engine reports, e.g. "18.1.8". */
      version: string;
      /** SHA-256 of the file at `path`, hashed in this process (nothing run for it). */
      sha256: string;
      /** The sandbox label the version query ran under (discovery uses required: false). */
      enforcement: Enforcement;
    }
  | {
      available: false;
      /** Why not: not found where looked, or too old. */
      reason: string;
      /** How to get it: a per-platform install line for the user to run. reax installs nothing. */
      remediation: string;
    };

export interface EngineRunOptions {
  /** The run's deadline; the sandbox default (60 s) if omitted. */
  timeoutMs?: number;
  /** Cancels the run; it then fails with engine_cancelled. */
  signal?: AbortSignal;
  /** An existing directory: the only place the engine may write. */
  scratch: string;
  /** Refuse with sandbox_unavailable where no sandbox is enforced. Defaults to true (D-22). */
  required?: boolean;
  /** Cap on stdout and on stderr each; longer output gives a partial result. */
  maxOutputBytes?: number;
  /** Test seam (passed to runSandboxed): act as if no sandbox were available. It can only weaken. */
  forceBackend?: "none";
}

/** A successful run. A cut output is never presented as complete. */
export interface EngineResult<T> {
  data: T;
  coverage: "complete" | "partial";
  limitations: string[];
  /** The sandbox the run went through. */
  enforcement: Enforcement;
  /** The engine that ran (discovery's record). */
  engine: { id: string; path: string; version: string; sha256: string };
}

export interface EngineProvider<Req = unknown, Out = unknown> {
  id: string;
  /** The operations this provider can serve (internal names; COD exposes them later). */
  operations: readonly string[];
  /** How heavy one run is, for later scheduling. */
  resourceClass: "light" | "heavy";
  /** Find the engine; cached per provider instance. Never installs anything. */
  discover(): Promise<Availability>;
  /** Run the engine on a request inside the sandbox. */
  run(req: Req, opts: EngineRunOptions): Promise<EngineResult<Out>>;
}
