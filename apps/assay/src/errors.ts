// Every failure Assay can report has a stable code here. docs/failure-modes.md is generated from
// this table and test/failure-modes.test.ts checks that each code is raised by at least one test.

export const FAILURE_MODES = {
  store_locked: {
    retryable: false,
    message: "Another Assay process holds this store open",
    fix: "Stop the other `assay serve`, or set ASSAY_HOME to a different directory",
  },
  store_schema_newer: {
    retryable: false,
    message: "The store was written by a newer Assay",
    fix: "Upgrade Assay; downgrading a store is refused",
  },
  lease_expired: {
    retryable: false,
    message: "The attempt's lease expired before this write",
    fix: "None needed: the task is reclaimed and retried by its next attempt",
  },
  stale_attempt: {
    retryable: false,
    message: "A newer attempt owns this task",
    fix: "None needed: only the current attempt may write",
  },
  invalid_lease: {
    retryable: false,
    message: "Lease length must be a positive number of milliseconds",
    fix: "Pass leaseMs > 0",
  },
  task_parked: {
    retryable: false,
    message: "The task crashed too many times and was parked",
    fix: "Inspect the task's attempts, fix the cause, then unpark it",
  },
  effect_interrupted: {
    retryable: false,
    message: "An unsafe effect was interrupted and may have partly run",
    fix: "Check the target, then retry explicitly with a new key",
  },
  receipt_conflict: {
    retryable: false,
    message: "A retry key was reused with a different payload",
    fix: "Use a new retry key for a different request",
  },
  evidence_invalid: {
    retryable: false,
    message: "The claim record does not match the S-2 v1 schema",
    fix: "See docs/claim-format.md",
  },
  evidence_confidence: {
    retryable: false,
    message: "Only the runner may record observed or derived evidence",
    fix: "Agents record analyst-inference; the verifier upgrades claims it can re-run",
  },
  evidence_missing: {
    retryable: false,
    message: "A cited evidence record does not exist or was never delivered",
    fix: "Cite an observation id returned by a probe",
  },
  unknown_conflict: {
    retryable: false,
    message: "The unknown changed since it was read",
    fix: "Read the latest revision and retry",
  },
  budget_exceeded: {
    retryable: false,
    message: "The run's budget is spent",
    fix: "Raise the budget for this case, or stop",
  },
  breaker_open: {
    retryable: false,
    message: "Three worker failures in a row opened the circuit breaker",
    fix: "Inspect the failures; reset the breaker from the session",
  },
  depth_exceeded: {
    retryable: false,
    message: "Workers may not start workers of their own",
    fix: "Ask the coordinator to start the worker",
  },
  prompt_too_large: {
    retryable: false,
    message: "The worker task text is over the prompt budget",
    fix: "Shorten the task or pass a handle to the material",
  },
  approval_denied: {
    retryable: false,
    message: "The person denied this action",
    fix: "Ask the person, or choose an action without effects",
  },
  approval_required: {
    retryable: false,
    message: "This action needs the person's approval",
    fix: "Wait for approval in the Assay window",
  },
  approval_expired: {
    retryable: true,
    message: "Nobody answered the approval request in time",
    fix: "Ask again when the person is at the Assay window, or choose an action without effects",
  },
  tool_not_permitted: {
    retryable: false,
    message: "This tool is not available to this caller",
    fix: "Ask the coordinator to call it, or use `tools/list` to see the tools you may call",
  },
  tool_failed: {
    retryable: true,
    message: "The tool failed unexpectedly",
    fix: "Check the arguments against the tool's schema and retry; report a bug if it persists",
  },
  handle_unknown: {
    retryable: false,
    message: "The handle is unknown, belongs to another case, or was evicted",
    fix: "Re-run the tool that produced it to get a fresh handle",
  },
  path_outside_workspace: {
    retryable: false,
    message: "The path resolves outside the workspace",
    fix: "Use a path inside the workspace",
  },
  probe_unknown: { retryable: false, message: "No probe with that id", fix: "List probes with `assay probe --list`" },
  probe_failed: {
    retryable: true,
    message: "The probe could not finish",
    fix: "See the probe's limitations; retry or use another probe",
  },
  provider_unavailable: {
    retryable: false,
    message: "The agent client is not installed",
    fix: "Install the official CLI, then run `assay doctor`",
  },
  account_signed_out: {
    retryable: false,
    message: "The account is not signed in",
    fix: "Sign in from the Accounts panel; Assay runs the provider's official login",
  },
  provider_error: {
    retryable: true,
    message: "The agent client failed or broke its protocol",
    fix: "See the error detail; check the client with `assay doctor`, then retry the turn",
  },
  credential_refused: {
    retryable: false,
    message: "This credential type is not allowed",
    fix: "Use the provider's official client and sign in there",
  },
  unauthorized: {
    retryable: false,
    message: "Not paired with this Assay server",
    fix: "Open the pairing link printed by `assay serve`",
  },
  bad_request: { retryable: false, message: "The request is malformed", fix: "Check the request against docs/api.md" },
  not_found: { retryable: false, message: "No such object", fix: "Check the id" },
  bundle_tampered: {
    retryable: false,
    message: "The bundle's signature or digests do not verify",
    fix: "Obtain the bundle again from its producer",
  },
} as const;

export type FailureCode = keyof typeof FAILURE_MODES;

export class AssayError extends Error {
  readonly code: FailureCode;
  readonly retryable: boolean;
  readonly detail: Record<string, unknown> | undefined;

  constructor(code: FailureCode, detail?: Record<string, unknown>, message?: string) {
    super(message ?? FAILURE_MODES[code].message);
    this.name = "AssayError";
    this.code = code;
    this.retryable = FAILURE_MODES[code].retryable;
    this.detail = detail;
  }

  toJSON(): Record<string, unknown> {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      fix: FAILURE_MODES[this.code].fix,
      detail: this.detail,
    };
  }
}

export function isAssayError(e: unknown, code?: FailureCode): e is AssayError {
  return e instanceof AssayError && (code === undefined || e.code === code);
}
