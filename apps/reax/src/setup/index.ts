// reax setup, doctor and uninstall (ADR 0012): one client so far, Claude Code. Internal API for the
// CLI, not registered operations (as for `reax daemon`).
export { CLIENT, defaultEntry, inspect, type SetupOptions, setup, uninstall } from "./claude-code.ts";
export { doctor, reaxVersion } from "./doctor.ts";
export { homeFrom, reaxHomeFrom } from "./home.ts";

export const CLIENTS = ["claude-code"] as const;
