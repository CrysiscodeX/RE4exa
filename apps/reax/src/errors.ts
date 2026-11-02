// reax's own failure codes, added to core's table (core errors.ts explains the mechanism).
import { defineFailureModes } from "@re4exa/core/errors";

declare module "@re4exa/core/errors" {
  interface AppFailureCodes {
    target_too_large: true;
    operation_unknown: true;
    result_too_large: true;
    sandbox_unavailable: true;
    engine_unavailable: true;
    engine_failed: true;
    engine_timeout: true;
    engine_cancelled: true;
    engine_output_invalid: true;
  }
}

export const REAX_FAILURE_MODES = defineFailureModes({
  target_too_large: {
    retryable: false,
    message: "The target is larger than this operation reads",
    fix: "Use an operation that pages through the file, or raise the limit in configuration",
  },
  result_too_large: {
    retryable: false,
    message: "The result is larger than the response budget and this operation cannot page it",
    fix: "Narrow the request (a smaller range or a filter), or raise the budget in configuration",
  },
  operation_unknown: {
    retryable: false,
    message: "There is no operation with this name",
    fix: "List the operations with `session describe`, or see docs/operations.md",
  },
  sandbox_unavailable: {
    retryable: false,
    message: "This work must run in a sandbox, and no sandbox can be enforced on this machine",
    fix: "Run it on macOS (sandbox-exec) or on Linux with Landlock ABI 4 or later (kernel 6.7+) and python3; nothing was started",
  },
  engine_unavailable: {
    retryable: false,
    message: "The engine this work needs is not installed, or its version is too old",
    fix: "Install it with the line in detail.remediation (reax never installs anything itself), or point reax at it (for LLVM, REAX_LLVM_BIN)",
  },
  engine_failed: {
    retryable: false,
    message: "The engine exited with an error",
    fix: "Read detail.stderr (the engine's own message, from the target: untrusted); the target may not be a format this engine reads",
  },
  engine_timeout: {
    retryable: true,
    message: "The engine did not finish before the deadline, and the run was stopped",
    fix: "Retry with a longer timeout, or a smaller target",
  },
  engine_cancelled: {
    retryable: true,
    message: "The engine run was cancelled by its caller",
    fix: "Start it again if the result is still wanted",
  },
  engine_output_invalid: {
    retryable: false,
    message: "The engine's output could not be read as the expected format",
    fix: "Check the engine's version (detail.version); report the excerpt in detail.excerpt (untrusted) if it is a supported one",
  },
});
