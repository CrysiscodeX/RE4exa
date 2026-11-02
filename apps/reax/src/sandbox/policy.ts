// What a sandboxed child may do, and what came back. ADR 0006 (docs/decisions/0006-sandbox.md).

/** Which backend ran the child; "none" means the policy was not enforced. */
export type Enforcement = "sandbox-exec" | "landlock" | "none";

export interface SandboxPolicy {
  /** The only directory the child may write beneath (it must exist). Reads are not restricted. */
  scratch: string;
  /** No network: the only value in this version. */
  network: false;
  /** Refuse with sandbox_unavailable, before anything starts, when the policy cannot be enforced. */
  required: boolean;
}

export interface SandboxResult {
  code: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  /** The deadline passed before the run ended. If the root was still running, it, its process group
   * and the descendants found in a ps snapshot were SIGKILLed. A descendant that escaped (ADR
   * 0006's known limit) may still be running, and a root that had already exited keeps its own
   * exit code. */
  timedOut: boolean;
  /** stdout or stderr was longer than the cap and was cut. */
  outputTruncated: boolean;
  enforcement: Enforcement;
}

/** What the machine offers. landlock-no-net enforces writes but not network (Landlock ABI below 4). */
export interface SandboxBackend {
  name: "sandbox-exec" | "landlock" | "landlock-no-net" | "none";
  /** The Landlock ABI, on Linux. */
  abi?: number;
  /** Why the backend is what it is, for the error and the test report. */
  why: string;
}
