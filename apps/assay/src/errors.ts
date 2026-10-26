// Assay's failure codes: the engine-agnostic codes come from @re4exa/core/errors; Assay adds its
// own (providers, accounts, workers, pairing, bundles) and words a few core codes for its users.
// docs/failure-modes.md is generated from FAILURE_MODES and test/failure-modes.test.ts checks that
// each Assay code is raised by at least one test.

import { CoreError, defineFailureModes, type FailureCode, failureModes, isCoreError } from "@re4exa/core/errors";

declare module "@re4exa/core/errors" {
  interface AppFailureCodes {
    breaker_open: true;
    depth_exceeded: true;
    prompt_too_large: true;
    tool_not_permitted: true;
    tool_failed: true;
    provider_unavailable: true;
    account_signed_out: true;
    provider_error: true;
    unauthorized: true;
    bundle_tampered: true;
  }
}

/** Codes only Assay raises. */
export const ASSAY_FAILURE_MODES = {
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
  unauthorized: {
    retryable: false,
    message: "Not paired with this Assay server",
    fix: "Open the pairing link printed by `assay serve`",
  },
  bundle_tampered: {
    retryable: false,
    message: "The bundle's signature or digests do not verify",
    fix: "Obtain the bundle again from its producer",
  },
} as const;

defineFailureModes(ASSAY_FAILURE_MODES);
// Core codes reworded for Assay's users (same codes, same retryable flags).
defineFailureModes({
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
  approval_expired: {
    retryable: true,
    message: "Nobody answered the approval request in time",
    fix: "Ask again when the person is at the Assay window, or choose an action without effects",
  },
  path_not_found: {
    retryable: false,
    message: "No such path in the workspace",
    fix: "Use one of the suggested paths, or list the folder with assay_probe dir.inventory",
  },
  probe_unknown: { retryable: false, message: "No probe with that id", fix: "List probes with `assay probe --list`" },
  evidence_invalid: {
    retryable: false,
    message: "The claim record does not match the S-2 v1 schema",
    fix: "See docs/claim-format.md",
  },
  bad_request: { retryable: false, message: "The request is malformed", fix: "Check the request against docs/api.md" },
});

/** Every code Assay can report: core codes plus Assay's own. */
export const FAILURE_MODES = failureModes();

export type { FailureCode };
export { CoreError as AssayError, isCoreError as isAssayError };
