#!/usr/bin/env node
// E1: REA's MCP contract measured on the wire: catalog size, hint distribution,
// catalog identity, and the shape of an error reply.
// usage: REA_PACKAGE_DIR=... node e1-contract.mjs <out.json>

import { writeFileSync } from "node:fs";
import { openRea } from "./rea-mcp.mjs";

const out = process.argv[2];
const bytes = (v) => (v === undefined ? 0 : Buffer.byteLength(JSON.stringify(v)));

async function catalog(env) {
  const rea = await openRea({ env });
  try {
    const started = performance.now();
    let cursor; const tools = [];
    do { const page = await rea.client.listTools(cursor ? { cursor } : {}); tools.push(...page.tools); cursor = page.nextCursor; } while (cursor);
    const listMs = Math.round(performance.now() - started);
    const sum = (f) => tools.reduce((a, t) => a + f(t), 0);
    const hints = {};
    for (const t of tools) for (const [k, v] of Object.entries(t.annotations ?? {})) if (typeof v === "boolean") (hints[k] ??= { true: 0, false: 0 })[v]++;
    const biggest = [...tools].sort((a, b) => bytes(b) - bytes(a)).slice(0, 5).map((t) => ({ name: t.name, bytes: bytes(t), output_schema_bytes: bytes(t.outputSchema) }));
    return {
      rea, tools, summary: {
        tool_count: tools.length,
        list_ms: listMs,
        total_bytes: bytes({ tools }),
        input_schema_bytes: sum((t) => bytes(t.inputSchema)),
        output_schema_bytes: sum((t) => bytes(t.outputSchema)),
        description_bytes: sum((t) => Buffer.byteLength(t.description ?? "")),
        tools_with_output_schema: tools.filter((t) => t.outputSchema).length,
        annotation_hints: hints,
        largest_tools: biggest,
      },
    };
  } catch (e) { await rea.close(); throw e; }
}

const result = {};
const full = await catalog({});
result.catalog_full = full.summary;
try {
  const session = await full.rea.call("binary_session", {});
  const r = session.result ?? session;
  result.binary_session = {
    top_level_keys: Object.keys(r),
    catalog_identity: r.server_identity?.catalog ?? null,
    tool_availability_group_count: r.tool_availability?.groups?.length ?? null,
    analysis_provider_binding: r.analysis_provider_binding ?? null,
    provider_candidates: (r.analysis_provider_candidates ?? []).map((c) => ({ id: c.provider_id ?? c.id, status: c.status ?? c.availability?.status, reason: c.rejections?.[0]?.code ?? c.reason ?? null })),
  };
  // Error contract: an invalid argument to a validated tool.
  const bad = await full.rea.callRaw("inspect_go_binary", { path: "relative/not-absolute" });
  result.error_reply = {
    isError: bad.isError ?? false,
    has_structuredContent: bad.structuredContent !== undefined,
    content_types: (bad.content ?? []).map((c) => c.type),
    diagnostic: (() => { try { return JSON.parse(bad.content?.[0]?.text ?? "{}").error; } catch { return bad.content?.[0]?.text?.slice(0, 500); } })(),
  };
  const missing = await full.rea.callRaw("inspect_go_binary", { path: "/nonexistent/file" });
  result.error_reply_missing_file = (() => { try { return JSON.parse(missing.content?.[0]?.text ?? "{}").error; } catch { return missing.content?.[0]?.text?.slice(0, 500); } })();
} finally { await full.rea.close(); }

const compact = await catalog({ REA_MCP_INPUT_SCHEMA_PROFILE: "compact", REA_MCP_OUTPUT_SCHEMA_PROFILE: "off" });
await compact.rea.close();
result.catalog_compact_no_output_schema = compact.summary;
result.estimated_tokens_note = "tokens estimated as bytes/4 (rough; not a model tokenizer)";
result.estimated_tokens = { full: Math.round(result.catalog_full.total_bytes / 4), compact: Math.round(result.catalog_compact_no_output_schema.total_bytes / 4) };

writeFileSync(out, JSON.stringify(result, null, 1));
console.log(JSON.stringify(result, null, 1));
