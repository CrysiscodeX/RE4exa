// Stable failure codes. Each failure a component can report has a code, a retryable flag, a
// message and a fix. Core owns the engine-agnostic codes below; an app adds its own codes (and may
// reword a core code's fix for its users) with defineFailureModes(), and declares them for the type
// checker by augmenting AppFailureCodes:
//
//   declare module "@re4exa/core/errors" { interface AppFailureCodes { my_code: true } }
//   defineFailureModes({ my_code: { retryable: false, message: "...", fix: "..." } });

export interface FailureMode {
  readonly retryable: boolean;
  readonly message: string;
  readonly fix: string;
}

export const CORE_FAILURE_MODES = {
  store_locked: {
    retryable: false,
    message: "Another process holds this store open",
    fix: "Stop the other process that owns this store, or use a different home directory",
  },
  store_schema_newer: {
    retryable: false,
    message: "The store was written by a newer version",
    fix: "Upgrade; opening a store with an older version is refused (downgrade only through export and import)",
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
    message: "The claim record does not match the claim-record schema",
    fix: "See the claim-format document of the app that wrote it",
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
  approval_denied: {
    retryable: false,
    message: "The person denied this action",
    fix: "Ask the person, or choose an action without effects",
  },
  approval_expired: {
    retryable: true,
    message: "Nobody answered the approval request in time",
    fix: "Ask again when the person can answer, or choose an action without effects",
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
  path_not_found: {
    retryable: false,
    message: "No such path in the workspace",
    fix: "Use one of the suggested paths, or list the folder",
  },
  probe_unknown: { retryable: false, message: "No probe with that id", fix: "List the available probes" },
  probe_failed: {
    retryable: true,
    message: "The probe could not finish",
    fix: "See the probe's limitations; retry or use another probe",
  },
  bad_request: {
    retryable: false,
    message: "The request is malformed",
    fix: "Check the request against the API documentation",
  },
  not_found: { retryable: false, message: "No such object", fix: "Check the id" },
} as const satisfies Record<string, FailureMode>;

export type CoreFailureCode = keyof typeof CORE_FAILURE_MODES;

/** Codes contributed by apps, by interface augmentation (see the header). */
// biome-ignore lint/suspicious/noEmptyInterface: extended by module augmentation in each app
export interface AppFailureCodes {}

export type FailureCode = CoreFailureCode | Extract<keyof AppFailureCodes, string>;

const modes = new Map<string, FailureMode>(Object.entries(CORE_FAILURE_MODES));

/** Register an app's codes, or reword a core code for that app. Later definitions win. */
export function defineFailureModes(table: Record<string, FailureMode>): void {
  for (const [code, mode] of Object.entries(table)) {
    const prev = modes.get(code);
    if (prev && prev.retryable !== mode.retryable)
      throw new Error(`failure mode ${code}: an override may reword it but not change retryable`);
    modes.set(code, Object.freeze({ ...mode }));
  }
}

/** Every registered code: core codes plus whatever the running app defined. */
export function failureModes(): Readonly<Record<string, FailureMode>> {
  return Object.freeze(Object.fromEntries(modes));
}

function modeOf(code: string): FailureMode {
  const m = modes.get(code);
  if (!m) throw new Error(`unregistered failure code: ${code}`);
  return m;
}

export class CoreError extends Error {
  readonly code: FailureCode;
  readonly retryable: boolean;
  readonly detail: Record<string, unknown> | undefined;

  constructor(code: FailureCode, detail?: Record<string, unknown>, message?: string) {
    const m = modeOf(code);
    super(message ?? m.message);
    this.name = "CoreError";
    this.code = code;
    this.retryable = m.retryable;
    this.detail = detail;
  }

  toJSON(): Record<string, unknown> {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      fix: modeOf(this.code).fix,
      detail: this.detail,
    };
  }
}

export function isCoreError(e: unknown, code?: FailureCode): e is CoreError {
  return e instanceof CoreError && (code === undefined || e.code === code);
}
