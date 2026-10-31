// reax's own failure codes, added to core's table (core errors.ts explains the mechanism).
import { defineFailureModes } from "@re4exa/core/errors";

declare module "@re4exa/core/errors" {
  interface AppFailureCodes {
    target_too_large: true;
    operation_unknown: true;
    result_too_large: true;
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
});
