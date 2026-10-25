import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Options, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { isAssayError } from "../src/errors.ts";
import {
  type ClaudeQuery,
  type ClaudeQueryFn,
  claudeCanUseTool,
  claudeEnv,
  createClaudeAdapter,
  parseClaudeAuthStatus,
} from "../src/providers/claude.ts";
import { ofType, sessionOpts, textOf } from "./fixtures/providers/session.ts";

type Turn = (
  text: string,
  n: number,
  ctl: { options: Options; interrupted: () => boolean },
) => AsyncIterable<unknown> | unknown[];

function fakeQuery(turn: Turn, seen: { options?: Options; closed?: boolean } = {}): ClaudeQueryFn {
  return ({ prompt, options }) => {
    seen.options = options;
    let interrupted = false;
    async function* gen(): AsyncGenerator<unknown> {
      yield {
        type: "system",
        subtype: "init",
        session_id: "sess-claude-1",
        model: "claude-test-1",
        tools: [],
        mcp_servers: [],
      };
      let n = 0;
      for await (const m of prompt as AsyncIterable<SDKUserMessage>) {
        n++;
        interrupted = false;
        const text = m.message.content as string;
        for await (const msg of turn(text, n, { options, interrupted: () => interrupted })) yield msg;
      }
    }
    const it = gen();
    const q: ClaudeQuery = {
      [Symbol.asyncIterator]: () => it as never,
      interrupt: async () => {
        interrupted = true;
      },
      close: () => {
        seen.closed = true;
        void it.return(undefined);
      },
    };
    return q;
  };
}

const result = (o: Record<string, unknown>) => ({
  type: "result",
  subtype: "success",
  is_error: false,
  result: "",
  stop_reason: "end_turn",
  total_cost_usd: 0,
  usage: { input_tokens: 0, output_tokens: 0 },
  modelUsage: {},
  session_id: "sess-claude-1",
  ...o,
});

const streamText = (id: string, parts: string[]) => [
  { type: "stream_event", parent_tool_use_id: null, event: { type: "message_start", message: { id } } },
  {
    type: "stream_event",
    parent_tool_use_id: null,
    event: { type: "content_block_start", content_block: { type: "text" } },
  },
  ...parts.map((t) => ({
    type: "stream_event",
    parent_tool_use_id: null,
    event: { type: "content_block_delta", delta: { type: "text_delta", text: t } },
  })),
];

describe("claude adapter: SDK message mapping", () => {
  it("streams text deltas, maps tools, records the session id and reports per-turn usage deltas", async () => {
    const seen: { options?: Options } = {};
    const q = fakeQuery(
      (_text, n) => [
        {
          type: "stream_event",
          parent_tool_use_id: null,
          event: { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "hmm" } },
        },
        ...streamText(`m${n}a`, ["Hel", "lo"]),
        {
          type: "assistant",
          parent_tool_use_id: null,
          message: {
            id: `m${n}a`,
            model: "claude-test-1",
            content: [
              { type: "text", text: "Hello" },
              { type: "tool_use", id: `tu${n}`, name: "mcp__assay__assay_sweep", input: { path: "." } },
            ],
          },
        },
        {
          type: "user",
          parent_tool_use_id: null,
          message: {
            role: "user",
            content: [{ type: "tool_result", tool_use_id: `tu${n}`, content: [{ type: "text", text: "3 findings" }] }],
          },
        },
        {
          type: "assistant",
          parent_tool_use_id: null,
          message: { id: `m${n}b`, content: [{ type: "text", text: "Done." }] },
        },
        result({
          result: "Hello\n\nDone.",
          total_cost_usd: 0.01 * n,
          modelUsage: {
            "claude-test-1": {
              inputTokens: 100 * n,
              outputTokens: 10 * n,
              cacheReadInputTokens: 5 * n,
              cacheCreationInputTokens: 0,
            },
          },
        }),
      ],
      seen,
    );
    const adapter = createClaudeAdapter({ query: q });
    const r = sessionOpts({ account: { id: "a1", provider: "claude", label: "Claude", home: null } });
    const s = await adapter.start(r.opts);
    const out = await s.send("sweep .");
    assert.equal(out.text, "Hello\n\nDone.");
    assert.equal(out.stopReason, "end_turn");
    assert.equal(s.providerSessionId, "sess-claude-1");
    assert.equal(textOf(r.events), "Hello\n\nDone.", "streamed deltas, then the unstreamed second message once");
    assert.deepEqual(ofType(r.events, "thinking"), [{ type: "thinking", text: "hmm" }]);
    assert.deepEqual(ofType(r.events, "tool-call"), [
      { type: "tool-call", id: "tu1", name: "mcp__assay__assay_sweep", input: { path: "." } },
    ]);
    assert.deepEqual(ofType(r.events, "tool-result"), [
      { type: "tool-result", id: "tu1", name: "mcp__assay__assay_sweep", ok: true, summary: "3 findings" },
    ]);
    const u1 = ofType(r.events, "usage");
    assert.deepEqual(u1, [
      { type: "usage", inputTokens: 105, outputTokens: 10, costUsd: 0.01, model: "claude-test-1" },
    ]);

    await s.send("again");
    const u2 = ofType(r.events, "usage")[1]!;
    assert.equal(u2.inputTokens, 105, "cumulative modelUsage is differenced per turn");
    assert.equal(u2.outputTokens, 10);
    assert.ok(Math.abs((u2.costUsd ?? 0) - 0.01) < 1e-9, "cumulative total_cost_usd is differenced per turn");
    assert.equal(ofType(r.events, "status").at(-1)?.state, "idle");
    await s.close();
  });

  it("passes enforced-mode options: no built-ins, only Assay's MCP server, strict config, resume, budget", async () => {
    const seen: { options?: Options } = {};
    const adapter = createClaudeAdapter({ query: fakeQuery(() => [result({ result: "ok" })], seen) });
    const r = sessionOpts({
      account: { id: "a1", provider: "claude", label: "Claude", home: null },
      model: "claude-sonnet-x",
      resume: "sess-old",
      maxBudgetUsd: 0.05,
      systemPrompt: "ASSAY RULES",
    });
    const s = await adapter.start(r.opts);
    await s.send("hi");
    const o = seen.options!;
    assert.deepEqual(o.tools, []);
    assert.equal(o.strictMcpConfig, true);
    assert.deepEqual(o.settingSources, ["user"]);
    assert.deepEqual(Object.keys(o.mcpServers ?? {}), ["assay"]);
    assert.deepEqual(o.mcpServers?.assay, {
      type: "http",
      url: r.opts.mcp.url,
      headers: { Authorization: "Bearer tok_test" },
    });
    assert.deepEqual(o.systemPrompt, { type: "preset", preset: "claude_code", append: "ASSAY RULES" });
    assert.equal(o.resume, "sess-old");
    assert.equal(o.maxBudgetUsd, 0.05);
    assert.equal(o.model, "claude-sonnet-x");
    assert.equal(o.cwd, r.opts.cwd);
    assert.equal(o.includePartialMessages, true);
    assert.equal(o.permissionMode, "default");
    assert.equal(typeof o.canUseTool, "function");
    await s.close();
  });

  it("open mode keeps built-ins and project settings", async () => {
    const seen: { options?: Options } = {};
    const adapter = createClaudeAdapter({ query: fakeQuery(() => [result({})], seen) });
    const s = await adapter.start(
      sessionOpts({ mode: "open", account: { id: "a", provider: "claude", label: "c", home: null } }).opts,
    );
    await s.send("x");
    assert.equal(seen.options?.tools, undefined);
    assert.equal(seen.options?.strictMcpConfig, undefined);
    assert.equal(seen.options?.settingSources, undefined);
    await s.close();
  });

  it("canUseTool: Assay tools pass, enforced refuses built-ins, open asks the person for non-read tools", async () => {
    const sig = { signal: new AbortController().signal, toolUseID: "tu_1", requestId: "req_1" };
    const enforced = sessionOpts({ mode: "enforced" });
    const ce = claudeCanUseTool(enforced.opts);
    assert.equal((await ce("mcp__assay__assay_read_file", { path: "a" }, sig))?.behavior, "allow");
    assert.equal((await ce("Bash", { command: "ls" }, sig))?.behavior, "deny");
    assert.equal(enforced.approvals.length, 0);

    const open = sessionOpts({ mode: "open", allow: (t) => t === "Bash" });
    const co = claudeCanUseTool(open.opts);
    assert.equal((await co("Read", { file_path: "/x" }, sig))?.behavior, "allow");
    assert.equal(open.approvals.length, 0, "read-only tools do not ask");
    const bash = await co("Bash", { command: "ls" }, { ...sig, title: "Claude wants to run ls" });
    assert.equal(bash?.behavior, "allow");
    assert.deepEqual(open.approvals[0], { tool: "Bash", input: { command: "ls" }, reason: "Claude wants to run ls" });
    const write = await co("Write", { file_path: "/x", content: "y" }, sig);
    assert.equal(write?.behavior, "deny");
    assert.equal(open.approvals.length, 2);
  });

  it("the canUseTool given to the SDK routes through opts.approve", async () => {
    const r = sessionOpts({
      mode: "open",
      account: { id: "a", provider: "claude", label: "c", home: null },
      allow: false,
    });
    const adapter = createClaudeAdapter({
      query: fakeQuery(async function* (_t, _n, ctl) {
        const d = await ctl.options.canUseTool!(
          "Edit",
          { file_path: "x" },
          {
            signal: new AbortController().signal,
            toolUseID: "tu_e",
            requestId: "req_e",
          },
        );
        yield {
          type: "assistant",
          parent_tool_use_id: null,
          message: { id: "m", content: [{ type: "text", text: d?.behavior }] },
        };
        yield result({ result: d?.behavior });
      }),
    });
    const s = await adapter.start(r.opts);
    assert.equal((await s.send("edit")).text, "deny");
    assert.equal(r.approvals[0]?.tool, "Edit");
    await s.close();
  });

  it("interrupt uses the SDK's interrupt and the turn ends", async () => {
    const adapter = createClaudeAdapter({
      query: fakeQuery(async function* (_t, _n, ctl) {
        yield* streamText("m1", ["working"]);
        while (!ctl.interrupted()) await new Promise((r) => setTimeout(r, 5));
        yield result({ subtype: "error_during_execution", is_error: true, errors: ["interrupted by user"] });
      }),
    });
    const r = sessionOpts({ account: { id: "a", provider: "claude", label: "c", home: null } });
    const s = await adapter.start(r.opts);
    const p = s.send("long task");
    await new Promise((res) => setTimeout(res, 20));
    await s.interrupt();
    const out = await p;
    assert.equal(out.stopReason, "error_during_execution");
    assert.ok(ofType(r.events, "error").some((e) => e.message.includes("interrupted")));
    await s.close();
  });

  it("an assistant authentication error and a budget stop are reported as errors", async () => {
    const adapter = createClaudeAdapter({
      query: fakeQuery((_t, n) =>
        n === 1
          ? [
              {
                type: "assistant",
                parent_tool_use_id: null,
                error: "authentication_failed",
                message: { id: "e", content: [] },
              },
              result({ subtype: "error_during_execution", is_error: true, errors: ["Not logged in"] }),
            ]
          : [result({ subtype: "error_max_budget_usd", is_error: true, errors: [], total_cost_usd: 0.06 })],
      ),
    });
    const r = sessionOpts({ account: { id: "a", provider: "claude", label: "c", home: null } });
    const s = await adapter.start(r.opts);
    await s.send("one");
    assert.ok(ofType(r.events, "error").some((e) => e.code === "account_signed_out"));
    const out = await s.send("two");
    assert.equal(out.stopReason, "error_max_budget_usd");
    assert.ok(ofType(r.events, "error").some((e) => e.code === "claude:error_max_budget_usd"));
    await s.close();
  });

  it("a client that dies mid-turn rejects send with provider_error", async () => {
    const adapter = createClaudeAdapter({
      query: fakeQuery(async function* () {
        yield* streamText("m", ["partial"]);
        throw new Error("CLI crashed");
      }),
    });
    const r = sessionOpts({ account: { id: "a", provider: "claude", label: "c", home: null } });
    const s = await adapter.start(r.opts);
    await assert.rejects(s.send("x"), (e: unknown) => isAssayError(e, "provider_error"));
    assert.ok(ofType(r.events, "error").some((e) => e.code === "provider_error"));
    await assert.rejects(s.send("y"), (e: unknown) => isAssayError(e));
    await s.close();
  });

  it("refuses a second send while a turn runs", async () => {
    const adapter = createClaudeAdapter({
      query: fakeQuery(async function* (_t, _n, ctl) {
        while (!ctl.interrupted()) await new Promise((r) => setTimeout(r, 5));
        yield result({});
      }),
    });
    const s = await adapter.start(
      sessionOpts({ account: { id: "a", provider: "claude", label: "c", home: null } }).opts,
    );
    const p = s.send("a");
    await assert.rejects(s.send("b"), (e: unknown) => isAssayError(e, "bad_request"));
    await s.interrupt();
    await p;
    await s.close();
  });
});

describe("claude adapter: accounts", () => {
  const ambient = {
    PATH: "/usr/bin",
    HOME: "/home/p",
    ANTHROPIC_API_KEY: "k1",
    ANTHROPIC_AUTH_TOKEN: "k2",
    CLAUDE_CODE_OAUTH_TOKEN: "k3",
    ANTHROPIC_OAUTH_TOKEN: "k4",
  };

  it("a separate home sets CLAUDE_CONFIG_DIR and strips ambient key variables", () => {
    const env = claudeEnv({ id: "a", provider: "claude", label: "work", home: "/assay/accounts/a" }, ambient);
    assert.equal(env.CLAUDE_CONFIG_DIR, "/assay/accounts/a");
    for (const k of ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_OAUTH_TOKEN"])
      assert.equal(env[k], undefined, k);
    assert.equal(env.PATH, "/usr/bin");
  });

  it("the default account passes the environment through unchanged", () => {
    const env = claudeEnv({ id: "a", provider: "claude", label: "me", home: null }, ambient);
    for (const [k, v] of Object.entries(ambient)) assert.equal(env[k], v, k);
    assert.equal(env.CLAUDE_CONFIG_DIR, undefined);
  });

  it("status runs the official `claude auth status --json` with the account's env", async () => {
    const calls: { program: string; args: string[]; env: Record<string, string> }[] = [];
    const adapter = createClaudeAdapter({
      program: "/opt/bin/claude",
      env: ambient,
      run: async (spec) => {
        calls.push(spec);
        return {
          code: 0,
          stdout: JSON.stringify({
            loggedIn: true,
            authMethod: "claude.ai",
            apiProvider: "firstParty",
            email: "p@example.com",
            accessToken: "secret",
          }),
          stderr: "",
          timedOut: false,
        };
      },
    });
    const st = await adapter.status({ id: "a", provider: "claude", label: "w", home: "/h" });
    assert.equal(st.signedIn, true);
    assert.equal(st.method, "claude.ai");
    assert.equal(st.detail.accessToken, undefined, "only allow-listed fields are kept");
    assert.equal(st.detail.email, "p@example.com");
    assert.deepEqual(calls[0]?.args, ["auth", "status", "--json"]);
    assert.equal(calls[0]?.program, "/opt/bin/claude");
    assert.equal(calls[0]?.env.CLAUDE_CONFIG_DIR, "/h");
    assert.equal(calls[0]?.env.ANTHROPIC_API_KEY, undefined);
    const login = adapter.loginCommand({ id: "a", provider: "claude", label: "w", home: "/h" });
    assert.deepEqual([login.program, ...login.args], ["/opt/bin/claude", "auth", "login"]);
    assert.equal(login.env.CLAUDE_CONFIG_DIR, "/h");
    assert.equal(login.env.CLAUDE_CODE_OAUTH_TOKEN, undefined);
  });

  it("parses signed-out and unparseable status output", () => {
    assert.deepEqual(parseClaudeAuthStatus('{"loggedIn": false, "authMethod": "none"}', "", 1, false), {
      signedIn: false,
      method: null,
      detail: { authMethod: "none" },
    });
    const bad = parseClaudeAuthStatus("", "boom", 2, false);
    assert.equal(bad.signedIn, false);
    assert.equal(bad.detail.error, "boom");
    assert.equal(parseClaudeAuthStatus("", "", null, true).detail.error, "claude auth status timed out");
  });

  it("status without the CLI reports provider_unavailable; detect reports not installed", async () => {
    const adapter = createClaudeAdapter({ env: { PATH: "/nonexistent" } });
    await assert.rejects(adapter.status({ id: "a", provider: "claude", label: "x", home: null }), (e: unknown) =>
      isAssayError(e, "provider_unavailable"),
    );
    const info = await adapter.detect();
    assert.equal(info.installed, false);
    assert.equal(info.enforcement, "enforced");
  });
});
