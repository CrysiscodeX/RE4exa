// How the fake CLI agents read the harness's reax.cmd on Windows: the line that runs reax, and the
// REAX_HOME it sets. Shared with test/live.test.ts, which checks the generated reax.cmd against
// both on every platform, so a change to the shim's format fails on macOS and Linux too.
export const REAX_CMD_RUN = /^@"([^"]+)" "([^"]+)" %\*\r?$/m;
export const REAX_CMD_HOME = /^@set "REAX_HOME=([^"]*)"\r?$/m;
