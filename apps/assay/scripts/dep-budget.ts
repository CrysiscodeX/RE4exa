// Necessity gate (RQS PUR-3): runtime dependencies are an explicit, reviewed list.
// Adding one means adding it here with a reason; the CI step fails otherwise.
import { readFileSync } from "node:fs";

const ALLOWED: Record<string, string> = {
  "@anthropic-ai/claude-agent-sdk": "official Claude client SDK: delegated sign-in, no API keys held by Assay",
  "@agentclientprotocol/sdk": "Agent Client Protocol: drive any ACP agent with its own sign-in",
  ws: "WebSocket server for the UI (security-sensitive framing; not reimplemented)",
  react: "UI",
  "react-dom": "UI",
  "@xterm/xterm": "terminal view for raw agent streams and official login flows",
};
const MAX_RUNTIME = Object.keys(ALLOWED).length;

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
};
const deps = { ...(pkg.dependencies ?? {}), ...(pkg.optionalDependencies ?? {}) };
const bad = Object.keys(deps).filter((d) => !(d in ALLOWED) && d !== "node-pty");
const unpinned = Object.entries(deps).filter(([, v]) => !/^\d+\.\d+\.\d+$/.test(v));
if (bad.length || unpinned.length || Object.keys(deps).length > MAX_RUNTIME + 1) {
  console.error(`dependency budget failed: not allowed ${JSON.stringify(bad)}, unpinned ${JSON.stringify(unpinned)}`);
  process.exit(1);
}
console.log(`dependency budget ok: ${Object.keys(deps).length} runtime dependencies, all exact-pinned`);
