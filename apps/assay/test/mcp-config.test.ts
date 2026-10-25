import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { isAssayError } from "../src/errors.ts";
import { CAPABILITIES_PATH, capabilitiesJson, capabilityStatement } from "../src/mcp/capabilities.ts";
import {
  acpMcpServers,
  assertOnlyAssay,
  claudeMcpArgs,
  claudeMcpConfig,
  claudeToolNames,
  codexConfigArgs,
  stdioMcpConfig,
  stdioProxyCommand,
  writeMcpConfigFile,
} from "../src/mcp/config.ts";
import { TOOL_SPECS } from "../src/mcp/tools.ts";
import { stubEngine } from "./fixtures/tripwire/_support/stub-engine.ts";
import { openTemp } from "./helpers.ts";

test("claude config names only the assay HTTP server with a bearer header", () => {
  const cfg = claudeMcpConfig("http://127.0.0.1:4000/mcp", "tok");
  assert.deepEqual(cfg, {
    mcpServers: { assay: { type: "http", url: "http://127.0.0.1:4000/mcp", headers: { Authorization: "Bearer tok" } } },
  });
  assertOnlyAssay(cfg);
  assert.deepEqual(claudeMcpArgs("/p.json", "enforced"), ["--mcp-config", "/p.json", "--strict-mcp-config"]);
  assert.deepEqual(claudeMcpArgs("/p.json", "open"), ["--mcp-config", "/p.json"]);
  assert.deepEqual(claudeToolNames([{ name: "assay_probe" }]), ["mcp__assay__assay_probe"]);
});

test("stdio configs for Codex and ACP run the proxy; enforced mode refuses any other server", () => {
  const proxy = stdioProxyCommand("http://127.0.0.1:4000/mcp", "tok", { tokenInEnv: true });
  const cfg = stdioMcpConfig(proxy);
  assert.equal(cfg.mcpServers.assay.type, "stdio");
  assert.equal(cfg.mcpServers.assay.command, process.execPath);
  assert.deepEqual(cfg.mcpServers.assay.env, { ASSAY_MCP_TOKEN: "tok" });
  assertOnlyAssay(cfg);
  const codex = codexConfigArgs(proxy);
  assert.equal(codex.filter((x) => x === "-c").length, 3);
  assert.match(codex[1]!, /^mcp_servers\.assay\.command="/);
  const acp = acpMcpServers(proxy);
  assert.equal(acp.length, 1);
  assert.equal(acp[0]!.name, "assay");
  assertOnlyAssay({ mcpServers: acp });
  for (const bad of [
    { mcpServers: { assay: {}, other: {} } },
    { mcpServers: { other: {} } },
    { mcpServers: [] },
    {},
    null,
  ])
    assert.throws(
      () => assertOnlyAssay(bad),
      (e) => isAssayError(e, "bad_request"),
    );
});

test("config file is written owner-only", () => {
  const dir = mkdtempSync(join(tmpdir(), "assay-cfg-"));
  try {
    const p = writeMcpConfigFile(dir, claudeMcpConfig("http://x", "t"));
    assert.equal(JSON.parse(readFileSync(p, "utf8")).mcpServers.assay.headers.Authorization, "Bearer t");
    if (process.platform !== "win32") assert.equal(statSync(p).mode & 0o777, 0o600);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("docs/capabilities.json is current (run `node src/mcp/capabilities.ts --write`)", () => {
  assert.equal(readFileSync(CAPABILITIES_PATH, "utf8"), capabilitiesJson(), "docs/capabilities.json is stale");
});

test("capability statement lists every tool with effect, schema, limits and cost; probes when an engine is given", () => {
  const cap = capabilityStatement() as {
    tools: { name: string; effect: string; limits: { resultTextBytes: number } }[];
    probes: unknown[];
  };
  assert.deepEqual(
    cap.tools.map((t) => t.name),
    TOOL_SPECS.map((t) => t.name),
  );
  for (const t of cap.tools) assert.equal(t.limits.resultTextBytes, 8192);
  assert.deepEqual(cap.probes, []);
  const { k, cleanup } = openTemp();
  try {
    const withEngine = capabilityStatement({ engine: stubEngine(k, tmpdir()), verifier: true }) as {
      probes: { id: string }[];
      tools: { name: string }[];
    };
    assert.deepEqual(
      withEngine.probes.map((p) => p.id),
      ["file.identify", "file.strings"],
    );
    assert.ok(withEngine.tools.some((t) => t.name === "assay_verify"));
  } finally {
    cleanup();
  }
});
