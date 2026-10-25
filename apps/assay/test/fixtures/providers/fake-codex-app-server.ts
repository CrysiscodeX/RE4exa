// A protocol fake for `codex app-server`: the JSON-RPC subset Assay's Codex adapter uses, one JSON
// object per line on stdio. Run as `node fake-codex-app-server.ts app-server`.
//
// Environment:
//   FAKE_CODEX_LOG      append every received message (and the startup env snapshot) as JSON lines
//   FAKE_CODEX_ACCOUNT  "chatgpt" (default) | "apikey" | "none" (signed out: thread/start fails)

import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

type Msg = {
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: unknown;
};

const log = (entry: unknown): void => {
  const f = process.env.FAKE_CODEX_LOG;
  if (f) appendFileSync(f, `${JSON.stringify(entry)}\n`);
};
const write = (m: Msg): void => {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...m })}\n`);
};
const notify = (method: string, params: Record<string, unknown>): void => write({ method, params });

if (process.argv[2] !== "app-server") {
  process.stderr.write("usage: fake-codex-app-server app-server\n");
  process.exit(2);
}

log({
  kind: "start",
  argv: process.argv.slice(2),
  env: {
    CODEX_HOME: process.env.CODEX_HOME ?? null,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY ? "set" : null,
    CODEX_API_KEY: process.env.CODEX_API_KEY ? "set" : null,
  },
  cwd: process.cwd(),
});

const account = process.env.FAKE_CODEX_ACCOUNT ?? "chatgpt";
let nextServerId = 1000;
const waiting = new Map<number, (result: unknown) => void>();
let turnN = 0;
let threadId: string | null = null;
const interrupted = new Set<string>();
let totals = { input: 0, output: 0 };

const ask = (method: string, params: Record<string, unknown>): Promise<unknown> => {
  const id = nextServerId++;
  write({ id, method, params });
  return new Promise((resolve) => waiting.set(id, resolve));
};
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function runTurn(turnId: string, text: string): Promise<void> {
  const tid = threadId!;
  notify("turn/started", { threadId: tid, turn: { id: turnId, status: "inProgress", items: [], error: null } });
  if (text.includes("slow")) {
    for (let i = 0; i < 200 && !interrupted.has(turnId); i++) await sleep(10);
    if (interrupted.has(turnId)) {
      notify("turn/completed", { threadId: tid, turn: { id: turnId, status: "interrupted", items: [], error: null } });
      return;
    }
  }
  notify("item/reasoning/summaryTextDelta", {
    threadId: tid,
    turnId,
    itemId: "r1",
    delta: "thinking about it",
    summaryIndex: 0,
  });
  if (text.includes("run")) {
    const r = (await ask("item/commandExecution/requestApproval", {
      kind: "command",
      threadId: tid,
      turnId,
      itemId: "cmd_1",
      startedAtMs: Date.now(),
      environmentId: null,
      command: "ls -la",
      cwd: process.cwd(),
      reason: "list the directory",
    })) as { decision?: unknown };
    const accepted = r?.decision === "accept";
    const item = {
      type: "commandExecution",
      id: "cmd_1",
      command: "ls -la",
      cwd: process.cwd(),
      status: "inProgress",
      exitCode: null,
      aggregatedOutput: null,
    };
    notify("item/started", { threadId: tid, turnId, item, startedAtMs: Date.now() });
    notify("item/completed", {
      threadId: tid,
      turnId,
      item: accepted
        ? { ...item, status: "completed", exitCode: 0, aggregatedOutput: "file-a\nfile-b\n" }
        : { ...item, status: "declined" },
      completedAtMs: Date.now(),
    });
  }
  if (text.includes("patch")) {
    const r = (await ask("item/fileChange/requestApproval", {
      threadId: tid,
      turnId,
      itemId: "fc_1",
      startedAtMs: Date.now(),
      reason: "edit a file",
    })) as {
      decision?: unknown;
    };
    log({ kind: "patch-decision", decision: r?.decision ?? null });
  }
  if (text.includes("tool")) {
    const item = {
      type: "mcpToolCall",
      id: "mcp_1",
      server: "assay",
      tool: "assay_sweep",
      status: "inProgress",
      arguments: { path: "." },
      result: null,
      error: null,
    };
    notify("item/started", { threadId: tid, turnId, item, startedAtMs: Date.now() });
    notify("item/completed", {
      threadId: tid,
      turnId,
      item: {
        ...item,
        status: "completed",
        result: { content: [{ type: "text", text: "3 findings" }], structuredContent: null, _meta: null },
      },
      completedAtMs: Date.now(),
    });
  }
  if (text.includes("fail")) {
    notify("error", {
      threadId: tid,
      turnId,
      willRetry: false,
      error: { message: "upstream refused", codexErrorInfo: null, additionalDetails: null },
    });
    notify("turn/completed", {
      threadId: tid,
      turn: { id: turnId, status: "failed", items: [], error: { message: "upstream refused" } },
    });
    return;
  }
  for (const d of ["Hello", " from", " fake codex."]) {
    notify("item/agentMessage/delta", { threadId: tid, turnId, itemId: "msg_1", delta: d });
    await sleep(1);
  }
  notify("item/completed", {
    threadId: tid,
    turnId,
    item: { type: "agentMessage", id: "msg_1", text: "Hello from fake codex." },
    completedAtMs: Date.now(),
  });
  totals = { input: totals.input + 120, output: totals.output + 30 };
  const b = {
    totalTokens: totals.input + totals.output,
    inputTokens: totals.input,
    cachedInputTokens: 0,
    cacheWriteInputTokens: 0,
    outputTokens: totals.output,
    reasoningOutputTokens: 0,
  };
  notify("thread/tokenUsage/updated", {
    threadId: tid,
    turnId,
    tokenUsage: { total: b, last: b, modelContextWindow: 200000 },
  });
  notify("turn/completed", { threadId: tid, turn: { id: turnId, status: "completed", items: [], error: null } });
}

function handle(m: Msg): void {
  log({ kind: "recv", msg: m });
  if (m.method === undefined && m.id !== undefined) {
    const w = waiting.get(Number(m.id));
    if (w) {
      waiting.delete(Number(m.id));
      w(m.result);
    }
    return;
  }
  if (m.id === undefined) return; // notifications such as "initialized"
  const id = m.id;
  const p = m.params ?? {};
  switch (m.method) {
    case "initialize":
      write({
        id,
        result: {
          userAgent: "fake-codex/0.0.1",
          codexHome: process.env.CODEX_HOME ?? "",
          platformFamily: "unix",
          platformOs: "linux",
        },
      });
      return;
    case "account/read":
      write({
        id,
        result:
          account === "none"
            ? { account: null, requiresOpenaiAuth: true }
            : account === "apikey"
              ? { account: { type: "apiKey" }, requiresOpenaiAuth: true }
              : {
                  account: { type: "chatgpt", email: "person@example.com", planType: "plus" },
                  requiresOpenaiAuth: true,
                },
      });
      return;
    case "thread/start":
    case "thread/resume":
      if (account === "none") {
        write({ id, error: { code: -32000, message: "Not logged in. Run `codex login`." } });
        return;
      }
      threadId = m.method === "thread/resume" ? String(p.threadId) : "thr_fake_1";
      write({
        id,
        result: {
          thread: { id: threadId, cwd: p.cwd ?? process.cwd() },
          model: p.model ?? "gpt-fake",
          modelProvider: "openai",
        },
      });
      return;
    case "turn/start": {
      const turnId = `turn_${++turnN}`;
      const input = (p.input as { type: string; text?: string }[] | undefined) ?? [];
      write({ id, result: { turn: { id: turnId, status: "inProgress", items: [], error: null } } });
      void runTurn(turnId, input.map((x) => x.text ?? "").join("\n"));
      return;
    }
    case "turn/interrupt":
      interrupted.add(String(p.turnId));
      write({ id, result: {} });
      return;
    default:
      write({ id, error: { code: -32601, message: `method not found: ${m.method}` } });
  }
}

createInterface({ input: process.stdin }).on("line", (line) => {
  if (!line.trim()) return;
  handle(JSON.parse(line) as Msg);
});
process.stdin.on("end", () => process.exit(0));
