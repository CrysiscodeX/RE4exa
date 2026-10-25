import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { isAssayError } from "../src/errors.ts";
import { CODEX_PROTOCOL_COMMIT, codexEnv, createCodexAdapter } from "../src/providers/codex.ts";
import { FAKE_CODEX, NODE_ARGS, ofType, sessionOpts, textOf } from "./fixtures/providers/session.ts";
import { tmp } from "./helpers.ts";

const acct = (home: string | null) => ({ id: "acct_codex", provider: "codex" as const, label: "Codex", home });

function adapter(env: NodeJS.ProcessEnv) {
  return createCodexAdapter({
    program: process.execPath,
    prefixArgs: [...NODE_ARGS, FAKE_CODEX],
    env,
    requestTimeoutMs: 10_000,
  });
}

function readLog(
  path: string,
): { kind: string; msg?: { method?: string; params?: Record<string, unknown> }; env?: Record<string, unknown> }[] {
  return readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
}

describe("codex adapter against the app-server protocol fake", () => {
  let t: ReturnType<typeof tmp>;
  let n = 0;
  const logPath = (): string => join(t.dir, `log-${++n}.jsonl`);
  before(() => {
    t = tmp("assay-codex-");
  });
  after(() => t.cleanup());

  it("records the protocol commit it was written against", () => {
    assert.match(CODEX_PROTOCOL_COMMIT, /^[0-9a-f]{40}$/);
  });

  it("initialize, thread/start with read-only sandbox, on-request approvals and the stdio MCP proxy", async () => {
    const log = logPath();
    const a = adapter({ ...process.env, FAKE_CODEX_LOG: log });
    const r = sessionOpts({ account: acct(null), model: "gpt-x", systemPrompt: "RULES" });
    const s = await a.start(r.opts);
    assert.equal(s.providerSessionId, "thr_fake_1");
    const out = await s.send("hello");
    assert.equal(out.text, "Hello from fake codex.");
    assert.equal(out.stopReason, "completed");
    assert.equal(textOf(r.events), "Hello from fake codex.");
    assert.deepEqual(ofType(r.events, "usage"), [
      { type: "usage", inputTokens: 120, outputTokens: 30, costUsd: null, model: "gpt-x" },
    ]);
    assert.ok(ofType(r.events, "thinking").length > 0);
    await s.close();

    const msgs = readLog(log)
      .filter((e) => e.kind === "recv")
      .map((e) => e.msg!);
    assert.deepEqual(
      msgs.map((m) => m.method),
      ["initialize", "initialized", "thread/start", "turn/start"],
    );
    const init = msgs[0]!.params as { clientInfo: { name: string }; capabilities: { experimentalApi: boolean } };
    assert.equal(init.clientInfo.name, "assay", "Assay presents as itself");
    const ts = msgs[2]!.params as Record<string, unknown>;
    assert.equal(ts.sandbox, "read-only");
    assert.equal(ts.approvalPolicy, "on-request");
    assert.equal(ts.developerInstructions, "RULES");
    assert.equal(ts.model, "gpt-x");
    assert.deepEqual((ts.config as { mcp_servers: unknown }).mcp_servers, {
      assay: { command: "assay", args: ["mcp-proxy", "--token", "tok_test"], default_tools_approval_mode: "approve" },
    });
    const turn = msgs[3]!.params as { threadId: string; input: unknown[] };
    assert.equal(turn.threadId, "thr_fake_1");
    assert.deepEqual(turn.input, [{ type: "text", text: "hello", text_elements: [] }]);
  });

  it("exec approval requests go to opts.approve; accept and decline map to the protocol decisions", async () => {
    const a = adapter(process.env);
    const yes = sessionOpts({ account: acct(null), allow: true });
    const s = await a.start(yes.opts);
    await s.send("please run and use a tool");
    assert.deepEqual(yes.approvals, [
      { tool: "shell", input: { command: "ls -la", cwd: yes.opts.cwd }, reason: "list the directory" },
    ]);
    const results = ofType(yes.events, "tool-result");
    assert.deepEqual(
      results.map((x) => [x.name, x.ok]),
      [
        ["shell", true],
        ["assay_sweep", true],
      ],
    );
    assert.ok(ofType(yes.events, "status").some((e) => e.state === "blocked"));
    // second turn: usage is the delta of the cumulative totals
    await s.send("again");
    assert.deepEqual(
      ofType(yes.events, "usage").map((u) => u.inputTokens),
      [120, 120],
    );
    await s.close();

    const no = sessionOpts({ account: acct(null), allow: false });
    const s2 = await a.start(no.opts);
    await s2.send("run it");
    const shell = ofType(no.events, "tool-result").find((x) => x.name === "shell");
    assert.equal(shell?.ok, false);
    assert.match(shell?.summary ?? "", /declined/);
    await s2.close();
  });

  it("patch approvals are answered with decline when the person refuses", async () => {
    const log = logPath();
    const a = adapter({ ...process.env, FAKE_CODEX_LOG: log });
    const r = sessionOpts({ account: acct(null), allow: false });
    const s = await a.start(r.opts);
    await s.send("patch something");
    await s.close();
    assert.equal(r.approvals[0]?.tool, "apply_patch");
    assert.deepEqual(
      readLog(log).find((e) => e.kind === "patch-decision"),
      { kind: "patch-decision", decision: "decline" },
    );
  });

  it("interrupt sends turn/interrupt and the turn ends as interrupted", async () => {
    const a = adapter(process.env);
    const r = sessionOpts({ account: acct(null) });
    const s = await a.start(r.opts);
    const p = s.send("slow work");
    await new Promise((res) => setTimeout(res, 100));
    await s.interrupt();
    const out = await p;
    assert.equal(out.stopReason, "interrupted");
    await s.close();
  });

  it("a failed turn reports an error and resolves with stopReason failed", async () => {
    const a = adapter(process.env);
    const r = sessionOpts({ account: acct(null) });
    const s = await a.start(r.opts);
    const out = await s.send("fail now");
    assert.equal(out.stopReason, "failed");
    assert.ok(ofType(r.events, "error").some((e) => e.message === "upstream refused"));
    assert.equal(ofType(r.events, "status").at(-1)?.state, "error");
    await s.close();
  });

  it("resume uses thread/resume with the earlier thread id", async () => {
    const log = logPath();
    const a = adapter({ ...process.env, FAKE_CODEX_LOG: log });
    const s = await a.start(sessionOpts({ account: acct(null), resume: "thr_old_9" }).opts);
    assert.equal(s.providerSessionId, "thr_old_9");
    await s.close();
    const resume = readLog(log).find((e) => e.msg?.method === "thread/resume");
    assert.equal(resume?.msg?.params?.threadId, "thr_old_9");
  });

  it("status: account/read without a token refresh; signed out when there is no account", async () => {
    const log = logPath();
    const signedIn = await adapter({ ...process.env, FAKE_CODEX_LOG: log }).status(acct(null));
    assert.deepEqual(signedIn, {
      signedIn: true,
      method: "chatgpt",
      detail: { type: "chatgpt", email: "person@example.com", planType: "plus" },
    });
    const read = readLog(log).find((e) => e.msg?.method === "account/read");
    assert.deepEqual(read?.msg?.params, { refreshToken: false });
    const out = await adapter({ ...process.env, FAKE_CODEX_ACCOUNT: "none" }).status(acct(null));
    assert.equal(out.signedIn, false);
    const key = await adapter({ ...process.env, FAKE_CODEX_ACCOUNT: "apikey" }).status(acct(null));
    assert.equal(key.method, "apiKey");
  });

  it("starting a signed-out account fails with account_signed_out", async () => {
    const a = adapter({ ...process.env, FAKE_CODEX_ACCOUNT: "none" });
    await assert.rejects(a.start(sessionOpts({ account: acct(null) }).opts), (e: unknown) =>
      isAssayError(e, "account_signed_out"),
    );
  });

  it("a separate home sets CODEX_HOME and strips ambient API keys; the default account keeps them", async () => {
    const home = join(t.dir, "codex-home");
    const ambient = { ...process.env, OPENAI_API_KEY: "sk-ambient", CODEX_API_KEY: "ck" };
    const log = logPath();
    const s = await adapter({ ...ambient, FAKE_CODEX_LOG: log }).start(sessionOpts({ account: acct(home) }).opts);
    await s.close();
    assert.deepEqual(readLog(log)[0]?.env, { CODEX_HOME: home, OPENAI_API_KEY: null, CODEX_API_KEY: null });

    const log2 = logPath();
    const s2 = await adapter({ ...ambient, FAKE_CODEX_LOG: log2 }).start(sessionOpts({ account: acct(null) }).opts);
    await s2.close();
    assert.deepEqual(readLog(log2)[0]?.env, {
      CODEX_HOME: process.env.CODEX_HOME ?? null,
      OPENAI_API_KEY: "set",
      CODEX_API_KEY: "set",
    });

    assert.equal(codexEnv(acct(null), { OPENAI_API_KEY: "x" }).OPENAI_API_KEY, "x");
    const login = adapter(ambient).loginCommand(acct(home));
    assert.deepEqual(login.args.slice(-1), ["login"]);
    assert.equal(login.env.CODEX_HOME, home);
    assert.equal(login.env.OPENAI_API_KEY, undefined);
  });

  it("a client that exits mid-turn rejects with provider_error", async () => {
    const a = createCodexAdapter({
      program: process.execPath,
      prefixArgs: [
        "-e",
        "process.stdin.on('data', d => { if (String(d).includes('turn/start')) process.exit(3); const m = JSON.parse(String(d).split('\\n')[0]); if (m.id) process.stdout.write(JSON.stringify({id: m.id, result: {thread: {id: 't'}}}) + '\\n'); })",
      ],
      env: process.env,
      requestTimeoutMs: 5000,
    });
    const r = sessionOpts({ account: acct(null) });
    const s = await a.start(r.opts);
    await assert.rejects(s.send("x"), (e: unknown) => isAssayError(e, "provider_error"));
    await s.close();
  });

  it("detect reports partial enforcement with a note; a missing CLI is not installed", async () => {
    const info = await createCodexAdapter({ env: { PATH: "/nonexistent" } }).detect();
    assert.equal(info.installed, false);
    assert.equal(info.enforcement, "partial");
    assert.ok(info.notes.some((x) => /shell/.test(x)));
    await assert.rejects(
      createCodexAdapter({ env: { PATH: "/nonexistent" } }).start(sessionOpts({ account: acct(null) }).opts),
      (e: unknown) => isAssayError(e, "provider_unavailable"),
    );
  });
});
