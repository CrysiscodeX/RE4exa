// Machine-readable capability statement: what Assay's MCP server offers, what each tool may do to
// the world (its effect), its limits, and the effect policy. `node src/mcp/capabilities.ts --write`
// regenerates docs/capabilities.json; test/mcp-config.test.ts fails when the committed file is stale.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ProbeEngine } from "../contracts.ts";
import type { Json } from "../evidence/jcs.ts";
import { DETECTOR_VERSION } from "../policy/redact.ts";
import { PROTOCOL_VERSION, SUPPORTED_PROTOCOL_VERSIONS } from "./server.ts";
import { LIMITS, TOOL_SPECS, type ToolSpec, VERIFY_SPEC } from "./tools.ts";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
export const CAPABILITIES_PATH = resolve(ROOT, "docs", "capabilities.json");

function version(): string {
  return (JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8")) as { version: string }).version;
}

function tool(spec: ToolSpec): Json {
  return {
    name: spec.name,
    effect: spec.effect,
    coordinatorOnly: spec.coordinatorOnly ?? false,
    untrustedOutput: [
      "assay_probe",
      "assay_sweep",
      "assay_get_evidence",
      "assay_read_file",
      "assay_search",
      "assay_exec",
      "assay_fetch",
      "assay_verify",
    ].includes(spec.name),
    description: spec.description,
    inputSchema: spec.inputSchema,
    limits: { resultTextBytes: LIMITS.resultTextBytes, ...(spec.limits ?? {}) },
    costHint: spec.costHint,
  };
}

export function capabilityStatement(opts: { engine?: ProbeEngine; verifier?: boolean } = {}): Json {
  const specs = opts.verifier ? [...TOOL_SPECS, VERIFY_SPEC] : TOOL_SPECS;
  return {
    name: "assay",
    version: version(),
    mcp: {
      protocolVersion: PROTOCOL_VERSION,
      supported: [...SUPPORTED_PROTOCOL_VERSIONS],
      transport: "streamable-http (json only); stdio via proxy",
    },
    tools: specs.map(tool),
    probes: opts.engine
      ? opts.engine
          .list()
          .map((p) => ({ id: p.id, version: p.version, predicate: p.predicate, cost: p.cost, platforms: p.platforms }))
      : [],
    limits: { ...LIMITS },
    redaction: { detectorVersion: DETECTOR_VERSION },
    effects: {
      none: "allow",
      read: "allow",
      spawn: "allow (the orchestrator enforces depth and budget)",
      write:
        "approve; an auto-approve rule for the tool in the case skips the prompt until the caller reads untrusted content",
      exec: "approve; same auto-rule semantics as write",
      network: "approve; same auto-rule semantics as write",
      publish: "approve; same auto-rule semantics as write",
      tainted:
        "after a caller reads untrusted content, auto-approve rules stop applying unless the rule sets evenWhenTainted",
      deny: "a deny rule for the tool, or an unknown effect",
      modes:
        "enforced and open apply the same rules to Assay tools; open mode leaves the client's built-in tools outside Assay's policy",
    },
  };
}

export function capabilitiesJson(opts: { engine?: ProbeEngine; verifier?: boolean } = {}): string {
  return `${JSON.stringify(capabilityStatement(opts), null, 2)}\n`;
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes("--write")) {
    writeFileSync(CAPABILITIES_PATH, capabilitiesJson());
    process.stdout.write(`wrote ${CAPABILITIES_PATH}\n`);
  } else process.stdout.write(capabilitiesJson());
}
