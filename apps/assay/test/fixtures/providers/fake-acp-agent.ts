// A fake ACP agent built with the SDK's agent side, for contract tests of Assay's ACP client.
//
// Environment:
//   FAKE_ACP_LOG           append received requests (and the startup env snapshot) as JSON lines
//   FAKE_ACP_REQUIRE_AUTH  "1": session/new answers auth_required until `authenticate` succeeds
//   FAKE_ACP_NO_AUTH       "1": always auth_required (signed out; authenticate fails)
// Prompt behaviour: "run" asks permission for an execute tool; "slow" waits for session/cancel.

import { appendFileSync } from "node:fs";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";

const log = (entry: unknown): void => {
  const f = process.env.FAKE_ACP_LOG;
  if (f) appendFileSync(f, `${JSON.stringify(entry)}\n`);
};

log({
  kind: "start",
  env: {
    CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR ?? null,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ? "set" : null,
  },
});

let authed = process.env.FAKE_ACP_REQUIRE_AUTH !== "1" && process.env.FAKE_ACP_NO_AUTH !== "1";
let n = 0;
let turns = 0;
const cancelled = new Set<string>();
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const app = acp
  .agent({ name: "fake-acp" })
  .onRequest(acp.methods.agent.initialize, ({ params }) => {
    log({ kind: "initialize", params });
    return {
      protocolVersion: acp.PROTOCOL_VERSION,
      agentCapabilities: { loadSession: true },
      authMethods: [
        { id: "fake-oauth", name: "Fake sign-in", description: "the agent's own sign-in" },
        { id: "fake-terminal", name: "Terminal login", type: "terminal", args: ["login"] },
      ],
      agentInfo: { name: "fake-acp", version: "0.0.1" },
    } as acp.InitializeResponse;
  })
  .onRequest(acp.methods.agent.authenticate, ({ params }) => {
    log({ kind: "authenticate", params });
    if (process.env.FAKE_ACP_NO_AUTH === "1") throw acp.RequestError.authRequired(undefined, "sign-in failed");
    authed = true;
    return {};
  })
  .onRequest(acp.methods.agent.session.new, ({ params }) => {
    log({ kind: "session/new", params });
    if (!authed) throw acp.RequestError.authRequired();
    return { sessionId: `sess_${++n}` };
  })
  .onRequest(acp.methods.agent.session.load, async ({ params, client }) => {
    log({ kind: "session/load", params });
    if (!authed) throw acp.RequestError.authRequired();
    // Replayed history: a client must not treat it as new output.
    await client.notify(acp.methods.client.session.update, {
      sessionId: params.sessionId,
      update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "OLD HISTORY" } },
    });
    return {};
  })
  .onNotification(acp.methods.agent.session.cancel, ({ params }) => {
    log({ kind: "session/cancel", params });
    cancelled.add(params.sessionId);
  })
  .onRequest(acp.methods.agent.session.prompt, async ({ params, client }) => {
    log({ kind: "session/prompt", params });
    const sessionId = params.sessionId;
    turns++;
    const text = params.prompt.map((b) => (b.type === "text" ? b.text : "")).join("\n");
    const update = (u: acp.SessionUpdate): Promise<void> =>
      client.notify(acp.methods.client.session.update, { sessionId, update: u });
    await update({ sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "considering" } });
    if (text.includes("slow")) {
      for (let i = 0; i < 300 && !cancelled.has(sessionId); i++) await sleep(10);
      if (cancelled.has(sessionId)) {
        cancelled.delete(sessionId);
        return { stopReason: "cancelled" };
      }
    }
    if (text.includes("run")) {
      await update({
        sessionUpdate: "tool_call",
        toolCallId: "tc_1",
        title: "Run ls",
        kind: "execute",
        status: "pending",
        rawInput: { command: "ls" },
      });
      const r = await client.request(acp.methods.client.session.requestPermission, {
        sessionId,
        toolCall: { toolCallId: "tc_1", title: "Run ls", kind: "execute", rawInput: { command: "ls" } },
        options: [
          { optionId: "yes", name: "Allow", kind: "allow_once" },
          { optionId: "no", name: "Reject", kind: "reject_once" },
        ],
      });
      log({ kind: "permission-outcome", outcome: r.outcome });
      const allowed = r.outcome.outcome === "selected" && r.outcome.optionId === "yes";
      await update({
        sessionUpdate: "tool_call_update",
        toolCallId: "tc_1",
        status: allowed ? "completed" : "failed",
        content: [{ type: "content", content: { type: "text", text: allowed ? "a.txt b.txt" : "rejected" } }],
      });
    }
    for (const t of ["Hello", " from", " fake ACP."]) {
      await update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: t } });
    }
    await update({
      sessionUpdate: "usage_update",
      used: 100,
      size: 1000,
      cost: { amount: 0.002 * turns, currency: "USD" },
    });
    return { stopReason: "end_turn" };
  });

app.connect(
  acp.ndJsonStream(
    Writable.toWeb(process.stdout) as WritableStream<Uint8Array>,
    Readable.toWeb(process.stdin) as unknown as ReadableStream<Uint8Array>,
  ),
);
process.stdin.on("end", () => process.exit(0));
