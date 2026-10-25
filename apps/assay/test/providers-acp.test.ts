import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { isAssayError } from "../src/errors.ts";
import { acpEnv, createAcpAdapter, DEFAULT_ACP_AGENTS, pickAcpAgent } from "../src/providers/acp.ts";
import { FAKE_ACP, NODE_ARGS, ofType, sessionOpts, textOf } from "./fixtures/providers/session.ts";
import { tmp } from "./helpers.ts";

const acct = (home: string | null = null, label = "fake agent") => ({
  id: "acct_acp",
  provider: "acp" as const,
  label,
  home,
});

function adapter(env: NodeJS.ProcessEnv) {
  return createAcpAdapter({
    agents: {
      fake: {
        program: process.execPath,
        args: [...NODE_ARGS, FAKE_ACP],
        homeEnv: "CLAUDE_CONFIG_DIR",
        stripEnv: ["ANTHROPIC_API_KEY"],
        login: { program: "fake-login", args: ["--now"] },
      },
    },
    env,
    requestTimeoutMs: 10_000,
  });
}

type LogEntry = { kind: string; params?: Record<string, unknown>; env?: Record<string, unknown>; outcome?: unknown };
const readLog = (p: string): LogEntry[] =>
  readFileSync(p, "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as LogEntry);

describe("acp adapter against a fake ACP agent (SDK agent side)", () => {
  let t: ReturnType<typeof tmp>;
  let n = 0;
  const logPath = (): string => join(t.dir, `acp-${++n}.jsonl`);
  before(() => {
    t = tmp("assay-acp-");
  });
  after(() => t.cleanup());

  it("initializes without fs or terminal capabilities and passes only Assay's stdio proxy", async () => {
    const log = logPath();
    const r = sessionOpts({ account: acct() });
    const s = await adapter({ ...process.env, FAKE_ACP_LOG: log }).start(r.opts);
    assert.equal(s.providerSessionId, "sess_1");
    const out = await s.send("hello");
    assert.deepEqual(out, { text: "Hello from fake ACP.", stopReason: "end_turn" });
    assert.equal(textOf(r.events), "Hello from fake ACP.");
    assert.deepEqual(ofType(r.events, "thinking"), [{ type: "thinking", text: "considering" }]);
    const usage = ofType(r.events, "usage");
    assert.equal(usage.length, 1);
    assert.equal(usage[0]?.costUsd, 0.002);
    await s.close();

    const entries = readLog(log);
    const init = entries.find((e) => e.kind === "initialize")!.params as {
      clientCapabilities: { fs?: { readTextFile?: boolean; writeTextFile?: boolean }; terminal?: boolean };
      clientInfo: { name: string };
    };
    assert.notEqual(init.clientCapabilities.fs?.readTextFile, true);
    assert.notEqual(init.clientCapabilities.fs?.writeTextFile, true);
    assert.notEqual(init.clientCapabilities.terminal, true);
    assert.equal(init.clientInfo.name, "assay");
    const sn = entries.find((e) => e.kind === "session/new")!.params as { cwd: string; mcpServers: unknown[] };
    assert.equal(sn.cwd, r.opts.cwd);
    assert.deepEqual(sn.mcpServers, [
      { name: "assay", command: "assay", args: ["mcp-proxy", "--token", "tok_test"], env: [] },
    ]);
  });

  it("permission requests go to opts.approve and pick the allow or reject option", async () => {
    const log = logPath();
    const yes = sessionOpts({ account: acct(), allow: true });
    const s = await adapter({ ...process.env, FAKE_ACP_LOG: log }).start(yes.opts);
    await s.send("please run ls");
    assert.equal(yes.approvals[0]?.tool, "Run ls");
    assert.deepEqual(yes.approvals[0]?.input, { command: "ls" });
    assert.deepEqual(ofType(yes.events, "tool-call")[0], {
      type: "tool-call",
      id: "tc_1",
      name: "Run ls",
      input: { command: "ls" },
    });
    assert.deepEqual(ofType(yes.events, "tool-result")[0], {
      type: "tool-result",
      id: "tc_1",
      name: "Run ls",
      ok: true,
      summary: "a.txt b.txt",
    });
    await s.close();

    const no = sessionOpts({ account: acct(), allow: false });
    const s2 = await adapter({ ...process.env, FAKE_ACP_LOG: log }).start(no.opts);
    await s2.send("run it");
    assert.equal(ofType(no.events, "tool-result")[0]?.ok, false);
    await s2.close();
    const outcomes = readLog(log)
      .filter((e) => e.kind === "permission-outcome")
      .map((e) => e.outcome);
    assert.deepEqual(outcomes, [
      { outcome: "selected", optionId: "yes" },
      { outcome: "selected", optionId: "no" },
    ]);
  });

  it("authenticates with the agent's own advertised (non-terminal) method when the agent requires it", async () => {
    const log = logPath();
    const s = await adapter({ ...process.env, FAKE_ACP_LOG: log, FAKE_ACP_REQUIRE_AUTH: "1" }).start(
      sessionOpts({ account: acct() }).opts,
    );
    assert.ok(s.providerSessionId);
    await s.close();
    const auth = readLog(log).filter((e) => e.kind === "authenticate");
    assert.deepEqual(
      auth.map((e) => e.params?.methodId),
      ["fake-oauth"],
    );
  });

  it("an agent that stays signed out fails start with account_signed_out; status says signed out", async () => {
    const env = { ...process.env, FAKE_ACP_NO_AUTH: "1" };
    await assert.rejects(adapter(env).start(sessionOpts({ account: acct() }).opts), (e: unknown) =>
      isAssayError(e, "account_signed_out"),
    );
    const st = await adapter(env).status(acct());
    assert.equal(st.signedIn, false);
    assert.deepEqual(st.detail.authMethods, ["fake-oauth", "fake-terminal"]);
    const ok = await adapter(process.env).status(acct());
    assert.equal(ok.signedIn, true);
    assert.equal(ok.detail.agentName, "fake-acp");
  });

  it("cancel sends session/cancel and the prompt ends cancelled", async () => {
    const r = sessionOpts({ account: acct() });
    const s = await adapter(process.env).start(r.opts);
    const p = s.send("slow please");
    await new Promise((res) => setTimeout(res, 100));
    await s.interrupt();
    const out = await p;
    assert.equal(out.stopReason, "cancelled");
    await s.close();
  });

  it("resume uses session/load and does not replay old history as new output", async () => {
    const log = logPath();
    const r = sessionOpts({ account: acct(), resume: "sess_old" });
    const s = await adapter({ ...process.env, FAKE_ACP_LOG: log }).start(r.opts);
    assert.equal(s.providerSessionId, "sess_old");
    assert.equal(textOf(r.events), "");
    await s.send("hi");
    assert.equal(textOf(r.events), "Hello from fake ACP.");
    await s.close();
    assert.equal(readLog(log).find((e) => e.kind === "session/load")?.params?.sessionId, "sess_old");
  });

  it("a separate home sets the agent's home variable and strips its key variables", async () => {
    const home = join(t.dir, "acp-home");
    const log = logPath();
    const s = await adapter({ ...process.env, FAKE_ACP_LOG: log, ANTHROPIC_API_KEY: "k" }).start(
      sessionOpts({ account: acct(home) }).opts,
    );
    await s.close();
    assert.deepEqual(readLog(log)[0]?.env, { CLAUDE_CONFIG_DIR: home, ANTHROPIC_API_KEY: null });
    const log2 = logPath();
    const s2 = await adapter({ ...process.env, FAKE_ACP_LOG: log2, ANTHROPIC_API_KEY: "k" }).start(
      sessionOpts({ account: acct(null) }).opts,
    );
    await s2.close();
    assert.equal(readLog(log2)[0]?.env?.ANTHROPIC_API_KEY, "set");
    const login = adapter(process.env).loginCommand(acct(home));
    assert.deepEqual([login.program, ...login.args], ["fake-login", "--now"]);
    assert.equal(login.env.CLAUDE_CONFIG_DIR, home);
  });

  it("picks the agent named in the account label, else the default", () => {
    assert.equal(pickAcpAgent(DEFAULT_ACP_AGENTS, "Gemini (work)").name, "gemini");
    assert.equal(pickAcpAgent(DEFAULT_ACP_AGENTS, "my claude-code-acp").name, "claude-code-acp");
    assert.equal(pickAcpAgent(DEFAULT_ACP_AGENTS, "whatever", "claude-code-acp").name, "claude-code-acp");
    assert.throws(
      () => pickAcpAgent({}, "x"),
      (e: unknown) => isAssayError(e, "provider_unavailable"),
    );
    const env = acpEnv(DEFAULT_ACP_AGENTS.gemini!, acct("/h", "gemini"), { GEMINI_API_KEY: "g", PATH: "/bin" });
    assert.equal(env.GEMINI_API_KEY, undefined);
  });

  it("detect and start report a missing agent", async () => {
    const a = createAcpAdapter({
      agents: { nope: { program: "definitely-not-installed-acp", args: [] } },
      env: { PATH: "/nonexistent" },
    });
    const info = await a.detect();
    assert.equal(info.installed, false);
    assert.equal(info.enforcement, "partial");
    await assert.rejects(a.start(sessionOpts({ account: acct() }).opts), (e: unknown) =>
      isAssayError(e, "provider_unavailable"),
    );
  });
});
