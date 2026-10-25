import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  AccountRef,
  AgentSession,
  ProviderAdapter,
  ProviderId,
  SessionOptions,
  ToolDef,
} from "../src/contracts.ts";
import { isAssayError } from "../src/errors.ts";
import { caseClaims, recordClaim } from "../src/evidence/store.ts";
import type { Kernel } from "../src/kernel/kernel.ts";
import { Orchestrator } from "../src/orchestrator/orchestrator.ts";
import type { ServerPush } from "../src/server/api-types.ts";
import { openTemp } from "./helpers.ts";

interface Script {
  /** Called on each send; may call tools via the provided invoker. */
  turn(
    text: string,
    opts: SessionOptions,
    call: (name: string, args: Record<string, unknown>) => Promise<unknown>,
  ): Promise<string>;
}

function stubProvider(
  id: ProviderId,
  script: Script,
  tools: () => Map<string, ToolDef>,
  caseOf: (token: string) => { caseId: string; caller: string },
): ProviderAdapter {
  return {
    id,
    detect: async () => ({ id, installed: true, version: "test", program: null, enforcement: "enforced", notes: [] }),
    status: async () => ({ signedIn: true, method: "test", detail: {} }),
    loginCommand: () => ({ program: "true", args: [], env: {} }),
    start: async (opts): Promise<AgentSession> => {
      const who = caseOf(opts.mcp.token);
      const call = async (name: string, args: Record<string, unknown>) => {
        const t = tools().get(name);
        if (!t) throw new Error(`no tool ${name}`);
        if (t.coordinatorOnly && who.caller !== "coordinator") throw new Error("coordinator only");
        return t.handler(
          {
            caseId: who.caseId,
            caller: who.caller,
            workspace: "/w",
            approve: async () => undefined,
            signal: new AbortController().signal,
          },
          args as never,
        );
      };
      return {
        providerSessionId: `sess-${who.caller}`,
        send: async (text) => {
          opts.onEvent({ type: "status", state: "working" });
          const out = await script.turn(text, opts, call);
          opts.onEvent({ type: "usage", inputTokens: 100, outputTokens: 20, costUsd: 0.002, model: "stub" });
          opts.onEvent({ type: "text", text: out });
          return { text: out, stopReason: "end_turn" };
        },
        interrupt: async () => undefined,
        close: async () => undefined,
      };
    },
  };
}

function setup(script: Script, k?: Kernel) {
  const t = k ? null : openTemp();
  const kernel = k ?? t!.k;
  const tokens = new Map<string, { caseId: string; caller: string }>();
  const pushes: ServerPush[] = [];
  let toolMap = new Map<string, ToolDef>();
  const account: AccountRef = { id: "acct-1", provider: "fake", label: "stub", home: null };
  const providers = new Map<ProviderId, ProviderAdapter>();
  const orch = new Orchestrator({
    kernel,
    providers,
    account: (id) => (id === account.id ? account : undefined),
    mcp: {
      url: "http://127.0.0.1:0/mcp",
      issue: (caseId, caller) => {
        const tok = `tok-${caller}-${tokens.size}`;
        tokens.set(tok, { caseId, caller });
        return tok;
      },
      revoke: (tok) => void tokens.delete(tok),
      stdioProxy: () => ({ program: "node", args: [] }),
    },
    approve: async () => undefined,
    verifier: {
      verifyCase: async (caseId) => {
        for (const c of caseClaims(kernel, caseId))
          if (c.verdict === null) kernel.run("UPDATE claims SET verdict='verified' WHERE id=?", c.id);
      },
      parseClaimBlocks: () => [],
    },
    home: "/tmp/assay-home-test",
    emit: (p) => void pushes.push(p),
  });
  toolMap = new Map(orch.tools().map((x) => [x.name, x]));
  providers.set(
    "fake",
    stubProvider(
      "fake",
      script,
      () => toolMap,
      (tok) => tokens.get(tok)!,
    ),
  );
  return { k: kernel, orch, pushes, tokens, cleanup: () => t?.cleanup() };
}

const settle = async (orch: Orchestrator, caseId: string) => {
  for (let i = 0; i < 200; i++) {
    if (orch.caseActivity(caseId) !== "working") return;
    await new Promise((r) => setTimeout(r, 10));
  }
};

test("coordinator spawns two workers that run in parallel, report done, and are released", async () => {
  const s = setup({
    turn: async (text, opts, call) => {
      if (opts.systemPrompt.includes("You are worker")) {
        await new Promise((r) => setTimeout(r, 50));
        const who = text.includes("alpha") ? "alpha" : "beta";
        await call("assay_worker_done", { summary: `${who} finished` });
        return `${who} done`;
      }
      await call("assay_spawn_worker", { task: "look at alpha", retryId: "r1" });
      await call("assay_spawn_worker", { task: "look at alpha", retryId: "r1" }); // retry: same worker
      await call("assay_spawn_worker", { task: "look at beta" });
      const r = (await call("assay_check_workers", { wait: 5 })) as { text: string };
      return `workers: ${r.text}`;
    },
  });
  const c = s.k.createCase({ title: "parallel" });
  const t0 = Date.now();
  await s.orch.sendMessage(c.id, { text: "go", provider: "fake", accountId: "acct-1" });
  await settle(s.orch, c.id);
  for (let i = 0; i < 100 && s.orch.workers(c.id).some((w) => w.result === null); i++)
    await new Promise((r) => setTimeout(r, 20));
  const workers = s.orch.workers(c.id);
  assert.equal(workers.length, 2, "the retried spawn reused the first worker");
  assert.deepEqual(workers.map((w) => w.result).sort(), ["alpha finished", "beta finished"]);
  assert.ok(Date.now() - t0 < 2000);
  await s.orch.checkWorkers(c.id);
  for (const w of workers) await s.orch.releaseWorker(c.id, w.id);
  assert.ok(s.orch.workers(c.id).every((w) => w.liveness === "exited"));
  assert.ok(s.pushes.some((p) => p.type === "worker"));
  assert.ok(s.orch.timeline(c.id).some((e) => e.kind === "assistant"));
  assert.equal(s.orch.usage("account_id")[0]!.turns >= 3, true);
  s.cleanup();
});

test("depth 1, prompt budget, and the breaker after three failed workers", async () => {
  let fail = true;
  const s = setup({
    turn: async (_text, opts) => {
      if (opts.systemPrompt.includes("You are worker") && fail) throw new Error("worker crashed");
      return "ok";
    },
  });
  const c = s.k.createCase({ title: "safety" });
  s.k.updateCase(c.id, { meta: { settings: { provider: "fake", accountId: "acct-1" } } });
  await assert.rejects(s.orch.spawnWorker(c.id, { task: "x" }, "task_worker1"), (e) =>
    isAssayError(e, "depth_exceeded"),
  );
  await assert.rejects(s.orch.spawnWorker(c.id, { task: "x".repeat(9000) }), (e) =>
    isAssayError(e, "prompt_too_large"),
  );
  for (let i = 0; i < 3; i++) {
    await s.orch.spawnWorker(c.id, { task: `job ${i}` });
    for (let j = 0; j < 100 && s.orch.workers(c.id).filter((w) => w.status === "error").length < i + 1; j++)
      await new Promise((r) => setTimeout(r, 10));
  }
  await assert.rejects(s.orch.spawnWorker(c.id, { task: "job 4" }), (e) => isAssayError(e, "breaker_open"));
  fail = false;
  s.cleanup();
});

test("after a crash, interrupted turns are reported (never re-sent) and live workers become unverifiable", async () => {
  const t = openTemp();
  const c = t.k.createCase({ title: "crash" });
  // simulate a previous process: a running turn and a running worker task with live leases
  t.k.spawnTask({ queue: "turns", kind: "turn", caseId: c.id, maxAttempts: 1 });
  t.k.claimTask("turns", "dead", 3_600_000);
  t.k.spawnTask({
    queue: "workers",
    kind: "worker",
    caseId: c.id,
    params: {
      title: "w",
      task: "t",
      provider: "fake",
      accountId: "acct-1",
      worktree: null,
      repo: null,
      providerSessionId: "s1",
      result: null,
      released: false,
    },
  });
  t.k.claimTask("workers", "dead", 3_600_000);
  const s = setup({ turn: async () => "ok" }, t.k);
  const r = s.orch.recover();
  assert.deepEqual(r, { turnsInterrupted: 1, workersUnverifiable: 1 });
  assert.ok(s.orch.timeline(c.id).some((e) => e.kind === "error" && e.text.includes("interrupted")));
  assert.equal(s.orch.workers(c.id)[0]!.liveness, "unverifiable");
  t.cleanup();
});

test("budgets stop new turns; estimates are honest without history", async () => {
  const s = setup({ turn: async () => "ok" });
  const c = s.k.createCase({ title: "budget" });
  const est = s.orch.estimate(c.id, { text: "hello", provider: "fake", accountId: "acct-1" });
  assert.match(est.basis, /no cost history/);
  await s.orch.sendMessage(c.id, { text: "one", provider: "fake", accountId: "acct-1", budgetUsd: 0.003 });
  await settle(s.orch, c.id);
  await s.orch.sendMessage(c.id, { text: "two", provider: "fake", accountId: "acct-1" });
  await settle(s.orch, c.id);
  for (let i = 0; i < 3; i++)
    s.k.recordUsage({ provider: "fake", accountId: "acct-1", inputTokens: 1000, outputTokens: 10, costUsd: 0.01 });
  assert.ok(s.orch.estimate(c.id, { text: "three", provider: "fake", accountId: "acct-1" }).usdHigh > 0);
  s.k.spend(`case:${c.id}`, { usd: 1 });
  await assert.rejects(s.orch.sendMessage(c.id, { text: "three", provider: "fake", accountId: "acct-1" }), (e) =>
    isAssayError(e, "budget_exceeded"),
  );
  await assert.rejects(s.orch.sendMessage(c.id, { text: " ", provider: "fake", accountId: "acct-1" }), (e) =>
    isAssayError(e, "bad_request"),
  );
  s.cleanup();
});

test("second opinion starts a worker that checks another worker's seen claims", async () => {
  const s = setup({
    turn: async (text, opts) => (opts.systemPrompt.includes("You are worker") ? `checked: ${text.length}` : "ok"),
  });
  const c = s.k.createCase({ title: "2nd" });
  s.k.updateCase(c.id, { meta: { settings: { provider: "fake", accountId: "acct-1" } } });
  const w = await s.orch.spawnWorker(c.id, { task: "first look" });
  recordClaim(s.k, c.id, `fake:acct-1:${w.id}`, {
    text: "it has a postinstall script",
    label: "seen",
    predicate: "pkg.has-install-script",
  });
  const second = await s.orch.secondOpinion(c.id, { workerId: w.id, provider: "fake", accountId: "acct-1" });
  assert.match(second.task, /postinstall/);
  await assert.rejects(
    s.orch.secondOpinion(c.id, { workerId: second.id, provider: "fake", accountId: "acct-1" }),
    (e) => isAssayError(e, "bad_request"),
  );
  s.cleanup();
});
