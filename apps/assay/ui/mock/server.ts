// Mock Assay server for UI development and the UI smoke test. Serves the docs/api.md routes with canned
// data, pushes simulated activity over a hand-rolled WebSocket, and serves ui/dist when it is built.
//
//   node ui/mock/server.ts --port 5179 [--pair-code CODE] [--speed 1] [--no-first-run]

import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentEvent, ProviderId } from "../../src/contracts.ts";
import type {
  AccountView,
  ApprovalView,
  CaseDetail,
  ClaimView,
  CostEstimate,
  EvidenceView,
  SendMessageRequest,
  ServerPush,
  TimelineEntry,
  UsageRow,
  WorkerView,
} from "../../src/server/api-types.ts";
import { createDb, digest, emptyCounts, makeRecord, obsId, pendingApproval, recount, SWEEP_C1 } from "./data.ts";
import { acceptWebSocket, type WsConn } from "./ws.ts";

type Json = unknown;

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

const PORT = Number(arg("port") ?? 5179);
const SPEED = Number(arg("speed") ?? 1);
const PAIR_CODE = arg("pair-code") ?? randomBytes(6).toString("hex");
const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(arg("dist") ?? join(HERE, "..", "dist"));
const SESSION = randomBytes(16).toString("hex");

const db = createDb(!process.argv.includes("--no-first-run"));
let pairUsed = false;
const pairExpires = Date.now() + 5 * 60_000;
const tickets = new Map<string, number>();
const conns = new Set<WsConn>();
const approvalWaiters = new Map<string, (decision: "approve" | "deny") => void>();
const turns = new Map<string, AbortController>();
let idCounter = 100;

// ---------------------------------------------------------------------------------------------
// Push helpers
// ---------------------------------------------------------------------------------------------

function broadcast(p: ServerPush): void {
  const text = JSON.stringify(p);
  for (const c of conns) c.send(text);
}

function caseOf(id: string): CaseDetail | undefined {
  return db.cases.get(id);
}

function pushCase(d: CaseDetail): void {
  recount(d);
  const i = db.app.cases.findIndex((c) => c.id === d.summary.id);
  if (i >= 0) db.app.cases[i] = d.summary;
  else db.app.cases.push(d.summary);
  broadcast({ type: "case", summary: d.summary });
}

function nextSeq(d: CaseDetail): number {
  return d.timeline.reduce((m, e) => Math.max(m, e.seq), 0) + 1;
}

function addEntry(
  d: CaseDetail,
  kind: TimelineEntry["kind"],
  text: string,
  data?: unknown,
  workerId: string | null = null,
): TimelineEntry {
  const e: TimelineEntry = { seq: nextSeq(d), at: Date.now(), kind, workerId, text };
  if (data !== undefined) e.data = data;
  d.timeline.push(e);
  broadcast({ type: "timeline", caseId: d.summary.id, entry: e });
  return e;
}

function agent(d: CaseDetail, workerId: string | null, event: AgentEvent): void {
  broadcast({ type: "agent", caseId: d.summary.id, workerId, event });
}

function setActivity(d: CaseDetail, activity: CaseDetail["summary"]["activity"]): void {
  d.summary.activity = activity;
  pushCase(d);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((res, rej) => {
    if (signal?.aborted) return rej(new Error("aborted"));
    const t = setTimeout(res, ms * SPEED);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        rej(new Error("aborted"));
      },
      { once: true },
    );
  });
}

async function stream(d: CaseDetail, workerId: string | null, text: string, signal: AbortSignal): Promise<void> {
  const parts = text.match(/\S+\s*|\s+/g) ?? [text];
  for (let i = 0; i < parts.length; i += 2) {
    agent(d, workerId, { type: "text-delta", text: parts.slice(i, i + 2).join("") });
    await sleep(45, signal);
  }
  agent(d, workerId, { type: "text", text });
  addEntry(d, "assistant", text, undefined, workerId);
}

function pushWorker(d: CaseDetail, w: WorkerView): void {
  const i = d.workers.findIndex((x) => x.id === w.id);
  if (i >= 0) d.workers[i] = w;
  else d.workers.push(w);
  broadcast({ type: "worker", worker: w });
  pushCase(d);
}

function addEvidence(d: CaseDetail, e: EvidenceView, result: Json): void {
  d.evidence.push(e);
  db.records.set(e.observationId, makeRecord(e, result));
  broadcast({ type: "evidence", caseId: d.summary.id, evidence: e });
}

function addClaim(d: CaseDetail, c: ClaimView): void {
  d.claims.push(c);
  broadcast({ type: "claim", claim: c });
}

function bumpUsage(accountId: string, provider: string, cost: number, inTok: number, outTok: number): void {
  let row = db.usage.find((r) => r.key === accountId);
  if (!row) {
    row = { key: accountId, provider, turns: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, resent: 0 };
    db.usage.push(row);
  }
  row.turns += 1;
  row.inputTokens += inTok;
  row.outputTokens += outTok;
  row.costUsd += cost;
  broadcast({ type: "usage", rows: db.usage });
}

// ---------------------------------------------------------------------------------------------
// Simulated activity
// ---------------------------------------------------------------------------------------------

function newWorker(d: CaseDetail, title: string, task: string, provider: ProviderId, accountId: string): WorkerView {
  return {
    id: `w_${++idCounter}`,
    caseId: d.summary.id,
    title,
    task,
    provider,
    accountId,
    status: "starting",
    liveness: "live",
    worktree: `.assay/worktrees/${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    startedAt: Date.now(),
    endedAt: null,
    result: null,
    costUsd: 0,
  };
}

async function runWorker(
  d: CaseDetail,
  w: WorkerView,
  steps: { tool: string; input: Json; summary: string }[],
  answer: string,
  finalLiveness: WorkerView["liveness"],
  signal: AbortSignal,
): Promise<void> {
  addEntry(d, "worker", `Started worker “${w.title}”`, { workerId: w.id, event: "spawned" });
  addEntry(d, "user", w.task, undefined, w.id);
  pushWorker(d, w);
  await sleep(300, signal);
  pushWorker(d, { ...w, status: "working" });
  agent(d, w.id, { type: "status", state: "working" });
  for (const [i, s] of steps.entries()) {
    const id = `${w.id}_tc${i}`;
    agent(d, w.id, { type: "tool-call", id, name: s.tool, input: s.input as never });
    addEntry(d, "tool-call", s.tool, { id, name: s.tool, input: s.input }, w.id);
    await sleep(500, signal);
    agent(d, w.id, { type: "tool-result", id, name: s.tool, ok: true, summary: s.summary });
    addEntry(d, "tool-result", s.summary, { id, name: s.tool, ok: true, summary: s.summary }, w.id);
  }
  await stream(d, w.id, answer, signal);
  const cost = w.provider === "codex" ? 0.031 : 0.054;
  agent(d, w.id, { type: "usage", inputTokens: 9100, outputTokens: 820, costUsd: cost, model: null });
  bumpUsage(w.accountId, w.provider, cost, 9100, 820);
  agent(d, w.id, { type: "status", state: "done" });
  const done: WorkerView = {
    ...w,
    status: "done",
    liveness: finalLiveness,
    endedAt: Date.now(),
    result: answer.split("\n")[0] ?? answer,
    costUsd: cost,
  };
  pushWorker(d, done);
  addEntry(d, "worker", `Worker “${w.title}” finished`, { workerId: w.id, event: "done", result: done.result });
}

async function runTurn(d: CaseDetail, req: SendMessageRequest): Promise<void> {
  const ac = new AbortController();
  turns.get(d.summary.id)?.abort();
  turns.set(d.summary.id, ac);
  const { signal } = ac;
  const n = ++idCounter;
  try {
    addEntry(d, "user", req.text);
    setActivity(d, "starting");
    agent(d, null, { type: "status", state: "starting" });
    await sleep(250, signal);
    setActivity(d, "working");
    agent(d, null, { type: "status", state: "working" });
    await stream(
      d,
      null,
      "I'll split this across two workers: one diffs the exported symbols against **2.4.0**, the other reads the build scripts for network access. Meanwhile I need to list the archive with `tar`.",
      signal,
    );
    const wa = newWorker(
      d,
      "Diff exported symbols",
      "Diff the dynamic symbols of lib/libfoo.so.2 against libfoo 2.4.0",
      "claude",
      "acc-claude-default",
    );
    const wb = newWorker(
      d,
      "Audit build scripts",
      "Check configure and Makefile.in for network access during the build",
      "codex",
      "acc-codex-work",
    );
    const workers = Promise.all([
      runWorker(
        d,
        wa,
        [
          {
            tool: "assay_probe",
            input: { probe: "elf.symbols", path: "lib/libfoo.so.2" },
            summary: "412 dynamic symbols",
          },
          {
            tool: "assay_probe",
            input: { probe: "elf.symbols", path: "ref/libfoo-2.4.0.so.2" },
            summary: "409 dynamic symbols",
          },
        ],
        "3 symbols were added (foo_ctx_set_alpn, foo_ctx_get_alpn, foo_version_ex) and none removed.\nThe ABI is backward compatible.",
        "exited",
        signal,
      ),
      runWorker(
        d,
        wb,
        [{ tool: "assay_read", input: { path: "configure", max: 65536 }, summary: "read 61 KB (untrusted)" }],
        "configure calls `curl` only when --with-fetch is passed; the default build does not touch the network.",
        "unverifiable",
        signal,
      ),
    ]);
    await sleep(900, signal);
    const apr: ApprovalView = pendingApproval(d.summary.id, n);
    d.approvals.push(apr);
    broadcast({ type: "approval", approval: apr });
    addEntry(d, "approval", `Approval needed: ${apr.action}`, { approvalId: apr.id });
    setActivity(d, "blocked");
    agent(d, null, { type: "status", state: "blocked", detail: "waiting for approval" });
    const decision = await new Promise<"approve" | "deny">((res, rej) => {
      approvalWaiters.set(apr.id, res);
      signal.addEventListener("abort", () => rej(new Error("aborted")), { once: true });
    });
    setActivity(d, "working");
    if (decision === "approve") {
      const id = `tc_${n}`;
      agent(d, null, { type: "tool-call", id, name: "assay_exec", input: apr.detail as never });
      addEntry(d, "tool-call", "assay_exec", { id, name: "assay_exec", input: apr.detail });
      await sleep(400, signal);
      agent(d, null, { type: "tool-result", id, name: "assay_exec", ok: true, summary: "exit 0, 12 lines" });
      addEntry(d, "tool-result", "exit 0, 12 lines", { id, name: "assay_exec", ok: true, summary: "exit 0, 12 lines" });
    } else {
      addEntry(d, "system", `Denied: ${apr.action}. Continuing without it.`);
    }
    await workers;
    const final = await finalAnswer(d, signal);
    const evA: EvidenceView = {
      observationId: obsId(n * 10 + 1),
      predicate: "elf.symbols",
      probe: "elf.symbols",
      subject: digest(n * 10 + 1),
      path: "lib/libfoo.so.2",
      confidence: "observed",
      producer: "probe:elf.symbols",
      summary: "412 dynamic symbols; +3 vs 2.4.0",
      coverage: "complete",
      createdAt: Date.now(),
    };
    const evB: EvidenceView = {
      observationId: obsId(n * 10 + 2),
      predicate: "elf.dynamic",
      probe: "elf.dynamic",
      subject: digest(n * 10 + 2),
      path: "bin/foo-cli",
      confidence: "observed",
      producer: "probe:elf.dynamic",
      summary: "dynamically linked; NEEDED libfoo.so.2, libc.so.6",
      coverage: "complete",
      createdAt: Date.now(),
    };
    addEvidence(d, evA, { added: ["foo_ctx_set_alpn", "foo_ctx_get_alpn", "foo_version_ex"], removed: [] });
    addEvidence(d, evB, { interp: "/lib64/ld-linux-x86-64.so.2", needed: ["libfoo.so.2", "libc.so.6"] });
    const claims: ClaimView[] = [
      {
        id: `clm_${n}a`,
        caseId: d.summary.id,
        author: "coordinator",
        text: "libfoo 2.4.1 adds 3 exported symbols and removes none",
        label: "seen",
        predicate: "elf.symbols",
        verdict: "verified",
        reason: "elf.symbols re-run on both versions gives +3/−0",
        observationId: evA.observationId,
        eventSeq: final.seq,
      },
      {
        id: `clm_${n}b`,
        caseId: d.summary.id,
        author: "coordinator",
        text: "bin/foo-cli is statically linked",
        label: "seen",
        predicate: "elf.dynamic",
        verdict: "refuted",
        reason: "elf.dynamic shows a PT_INTERP and two NEEDED entries",
        observationId: evB.observationId,
        eventSeq: final.seq,
      },
      {
        id: `clm_${n}c`,
        caseId: d.summary.id,
        author: wb.id,
        text: "The default build does not access the network",
        label: "inferred",
        predicate: null,
        verdict: "unverifiable",
        reason: "no model-free probe can prove the absence of network access in a shell script",
        observationId: null,
        eventSeq: final.seq,
      },
    ];
    for (const c of claims) addClaim(d, c);
    d.unknowns.push({
      id: `unk_${n}`,
      rev: 1,
      question: "Does --with-fetch get enabled by any distro packaging?",
      status: "open",
      origin: wb.id,
      answer: null,
      evidence: [],
    });
    broadcast({ type: "unknown", caseId: d.summary.id, unknown: d.unknowns[d.unknowns.length - 1]! });
    addEntry(d, "verification", "3 claims checked: 1 verified, 1 refuted, 1 unverifiable", {
      checked: 3,
      verified: 1,
      refuted: 1,
      unverifiable: 1,
      claimIds: claims.map((c) => c.id),
    });
    const cost = 0.0712;
    agent(d, null, {
      type: "usage",
      inputTokens: 24_000,
      outputTokens: 1_900,
      costUsd: cost,
      model: req.model ?? null,
    });
    bumpUsage(req.accountId, req.provider, cost, 24_000, 1_900);
    agent(d, null, { type: "status", state: "idle" });
    setActivity(d, "idle");
  } catch (err) {
    if ((err as Error).message !== "aborted") throw err;
    addEntry(d, "system", "Interrupted by you. Workers were stopped; their partial results are kept.");
    for (const w of d.workers)
      if (w.status === "working" || w.status === "starting")
        pushWorker(d, { ...w, status: "idle", liveness: "exited", endedAt: Date.now() });
    agent(d, null, { type: "status", state: "idle", detail: "interrupted" });
    setActivity(d, "idle");
  } finally {
    if (turns.get(d.summary.id) === ac) turns.delete(d.summary.id);
  }
}

function finalAnswer(d: CaseDetail, signal: AbortSignal): Promise<TimelineEntry> {
  const text = [
    "Both workers are done. Summary:",
    "",
    "1. libfoo 2.4.1 adds 3 exported symbols and removes none.",
    "2. bin/foo-cli is statically linked.",
    "3. The default build does not access the network.",
    "",
    "Each statement was sent to the verifier; see the chips below.",
  ].join("\n");
  return stream(d, null, text, signal).then(() => d.timeline[d.timeline.length - 1]!);
}

async function runSmallWorker(d: CaseDetail, w: WorkerView): Promise<void> {
  const ac = new AbortController();
  await runWorker(
    d,
    w,
    [
      {
        tool: "assay_probe",
        input: { probe: "file.identify", path: "dist/libfoo-2.4.1.tar.gz" },
        summary: "gzip tar, 12 entries",
      },
    ],
    `Independent check of “${w.task}”: I agree with the original result.`,
    "exited",
    ac.signal,
  );
}

// ---------------------------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------------------------

class HttpError extends Error {
  status: number;
  code: string;
  fix: string | null;
  constructor(status: number, code: string, message: string, fix: string | null = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.fix = fix;
  }
}

function send(res: ServerResponse, status: number, body: Json, headers: Record<string, string> = {}): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  if (chunks.length === 0) return {};
  try {
    const v = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    throw new HttpError(400, "bad_request", "Body is not valid JSON");
  }
}

function authed(req: IncomingMessage): boolean {
  const cookie = req.headers.cookie ?? "";
  return cookie.split(/;\s*/).some((c) => c === `assay_session=${SESSION}`);
}

function hostOk(req: IncomingMessage): boolean {
  const host = req.headers.host ?? "";
  return /^(127\.0\.0\.1|localhost):\d+$/.test(host);
}

function needCase(id: string): CaseDetail {
  const d = caseOf(id);
  if (!d) throw new HttpError(404, "not_found", `No case ${id}`);
  return d;
}

function str(v: unknown, name: string): string {
  if (typeof v !== "string" || v === "") throw new HttpError(400, "bad_request", `${name} is required`);
  return v;
}

function usageBy(by: string): UsageRow[] {
  if (by === "provider") {
    const m = new Map<string, UsageRow>();
    for (const r of db.usage) {
      const t = m.get(r.provider) ?? {
        ...r,
        key: r.provider,
        turns: 0,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        resent: 0,
      };
      t.turns += r.turns;
      t.inputTokens += r.inputTokens;
      t.outputTokens += r.outputTokens;
      t.costUsd += r.costUsd;
      t.resent += r.resent;
      m.set(r.provider, t);
    }
    return [...m.values()];
  }
  if (by === "case_id")
    return [
      {
        key: "c1",
        provider: "mixed",
        turns: 20,
        inputTokens: 246_442,
        outputTokens: 31_188,
        costUsd: 1.0554,
        resent: 2,
      },
    ];
  if (by === "worker_id") {
    const rows: UsageRow[] = [];
    for (const d of db.cases.values())
      for (const w of d.workers)
        rows.push({
          key: w.id,
          provider: w.provider,
          turns: 1,
          inputTokens: 9100,
          outputTokens: 820,
          costUsd: w.costUsd,
          resent: 0,
        });
    return rows;
  }
  return db.usage;
}

function loginScript(a: AccountView): void {
  const lines = [
    `\x1b[2m$ ${a.provider === "codex" ? "codex login" : "claude /login"}${a.home ? `  (home: ${a.home})` : ""}\x1b[0m\r\n`,
    "Opening your browser to sign in…\r\n",
    "If the browser did not open, visit:\r\n",
    "  https://example.invalid/oauth/device?code=QXZT-7781\r\n",
    "\r\nPaste the code shown after sign-in, then press Enter: ",
  ];
  let i = 0;
  const tick = () => {
    const chunk = lines[i++];
    if (chunk === undefined) return;
    broadcast({ type: "login-output", accountId: a.id, chunk, done: false });
    setTimeout(tick, 150 * SPEED);
  };
  tick();
}

const loginBuffers = new Map<string, string>();

function exportFile(d: CaseDetail, format: string): { body: string; type: string; name: string } {
  const base = d.summary.title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  switch (format) {
    case "s2":
      return {
        body: [...db.records.values()].map((r) => JSON.stringify(r)).join("\n"),
        type: "application/x-ndjson",
        name: `${base}.s2.jsonl`,
      };
    case "sarif":
      return {
        body: JSON.stringify(
          { version: "2.1.0", runs: [{ tool: { driver: { name: "assay" } }, results: [] }] },
          null,
          2,
        ),
        type: "application/sarif+json",
        name: `${base}.sarif`,
      };
    case "cyclonedx":
      return {
        body: JSON.stringify({ bomFormat: "CycloneDX", specVersion: "1.6", components: [] }, null, 2),
        type: "application/vnd.cyclonedx+json",
        name: `${base}.cdx.json`,
      };
    case "md":
      return {
        body: `# ${d.summary.title}\n\n${d.claims.map((c) => `- [${c.verdict ?? "pending"}] ${c.text}`).join("\n")}\n`,
        type: "text/markdown",
        name: `${base}.md`,
      };
    case "bundle":
      return { body: JSON.stringify(d, null, 2), type: "application/json", name: `${base}.assay-bundle.json` };
    default:
      throw new HttpError(400, "bad_request", `Unknown export format ${format}`);
  }
}

async function api(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const method = req.method ?? "GET";
  const path = url.pathname;
  if (method === "POST" && path === "/api/pair") {
    const body = await readBody(req);
    if (pairUsed || Date.now() > pairExpires || body.code !== PAIR_CODE)
      throw new HttpError(
        401,
        "unauthorized",
        "Pairing code is wrong, used or expired",
        "Run `assay serve` again and open the new link",
      );
    pairUsed = true;
    send(
      res,
      200,
      { ok: true },
      { "set-cookie": `assay_session=${SESSION}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000` },
    );
    return;
  }
  if (!authed(req)) throw new HttpError(401, "unauthorized", "Not paired", "Open the link that `assay serve` prints");
  const m = (re: RegExp) => path.match(re);
  let g: RegExpMatchArray | null;

  if (method === "POST" && path === "/api/ws-ticket") {
    const ticket = randomBytes(16).toString("hex");
    tickets.set(ticket, Date.now() + 5 * 60_000);
    return send(res, 200, { ticket });
  }
  if (method === "GET" && path === "/api/state") return send(res, 200, db.app);
  if (method === "GET" && path === "/api/doctor") return send(res, 200, db.doctor);
  if (method === "GET" && path === "/api/accounts") return send(res, 200, db.app.accounts);
  if (method === "GET" && path === "/api/calibration") return send(res, 200, db.calibration);
  if (method === "GET" && path === "/api/usage")
    return send(res, 200, usageBy(url.searchParams.get("by") ?? "account_id"));
  if (method === "GET" && path === "/api/capabilities")
    return send(res, 200, {
      version: db.app.version,
      probes: ["file.identify", "archive.list", "elf.imports", "elf.symbols"],
    });

  if (method === "POST" && path === "/api/cases") {
    const body = await readBody(req);
    const id = `c${++idCounter}`;
    const recipe = db.app.recipes.find((r) => r.id === body.recipeId);
    const title = typeof body.title === "string" && body.title ? body.title : (recipe?.title ?? "Untitled case");
    const d: CaseDetail = {
      summary: {
        id,
        title,
        workspace: typeof body.workspace === "string" ? body.workspace : db.app.workspaceRoot,
        status: "open",
        parentCase: null,
        forkedAt: null,
        createdAt: Date.now(),
        activity: "idle",
        counts: emptyCounts(),
      },
      timeline: [],
      claims: [],
      unknowns: [],
      evidence: [],
      workers: [],
      approvals: [],
      chainIntact: true,
      settings: { provider: "claude", accountId: "acc-claude-default", model: null, mode: "enforced", budgetUsd: null },
    };
    db.cases.set(id, d);
    if (recipe) {
      const p = typeof body.path === "string" ? body.path : "";
      addEntry(d, "system", `Case created from recipe “${recipe.title}”${p ? ` for ${p}` : ""}.`);
    }
    db.app.firstRun = false;
    pushCase(d);
    return send(res, 200, d.summary);
  }
  g = m(/^\/api\/cases\/([^/]+)$/);
  if (g) {
    const d = needCase(g[1]!);
    if (method === "GET") return send(res, 200, d);
    if (method === "PATCH") {
      const body = await readBody(req);
      if (typeof body.title === "string" && body.title.trim()) d.summary.title = body.title.trim();
      if (body.settings && typeof body.settings === "object")
        d.settings = { ...d.settings, ...(body.settings as object) };
      pushCase(d);
      return send(res, 200, d.summary);
    }
  }
  g = m(
    /^\/api\/cases\/([^/]+)\/(messages|estimate|interrupt|fork|sweep|verify|reassay|second-opinion|workers|export)$/,
  );
  if (g) {
    const d = needCase(g[1]!);
    const op = g[2]!;
    if (op === "export" && method === "GET") {
      const f = exportFile(d, url.searchParams.get("format") ?? "md");
      res.writeHead(200, { "content-type": f.type, "content-disposition": `attachment; filename="${f.name}"` });
      res.end(f.body);
      return;
    }
    if (method !== "POST") throw new HttpError(404, "not_found", "No such route");
    const body = await readBody(req);
    switch (op) {
      case "messages": {
        const r: SendMessageRequest = {
          text: str(body.text, "text"),
          provider: str(body.provider, "provider") as ProviderId,
          accountId: str(body.accountId, "accountId"),
        };
        if (typeof body.model === "string") r.model = body.model;
        const acct = db.app.accounts.find((a) => a.id === r.accountId);
        if (acct?.status !== "signed-in")
          throw new HttpError(
            409,
            "account_signed_out",
            "That account is not signed in",
            "Sign in from Accounts, then retry",
          );
        void runTurn(d, r);
        return send(res, 202, { accepted: true });
      }
      case "estimate": {
        const text = typeof body.text === "string" ? body.text : "";
        const low = 0.004 + text.length * 0.00002;
        const est: CostEstimate = {
          usdLow: Math.round(low * 1000) / 1000,
          usdHigh: Math.round(low * 3.2 * 1000) / 1000,
          basis: `${Math.ceil(text.length / 4)} prompt tokens + last 5 turns of this account`,
        };
        return send(res, 200, est);
      }
      case "interrupt":
        turns.get(d.summary.id)?.abort();
        return send(res, 200, { ok: true });
      case "fork": {
        const at = Number(body.atSeq);
        if (!Number.isFinite(at)) throw new HttpError(400, "bad_request", "atSeq is required");
        const id = `c${++idCounter}`;
        const f: CaseDetail = structuredClone(d);
        f.summary = {
          ...f.summary,
          id,
          title: `${d.summary.title} (fork @${at})`,
          parentCase: d.summary.id,
          forkedAt: at,
          createdAt: Date.now(),
          activity: "idle",
        };
        f.timeline = f.timeline.filter((e) => e.seq <= at);
        f.claims = f.claims.filter((c) => (c.eventSeq ?? 0) <= at).map((c) => ({ ...c, caseId: id }));
        f.approvals = [];
        f.workers = f.workers.filter((w) => w.startedAt <= (d.timeline.find((e) => e.seq === at)?.at ?? 0));
        db.cases.set(id, f);
        addEntry(f, "system", `Forked from “${d.summary.title}” at step ${at}`);
        pushCase(f);
        return send(res, 200, f.summary);
      }
      case "sweep": {
        const p = str(body.path, "path");
        const report = { ...SWEEP_C1, subject: p };
        const id = `tc_${++idCounter}`;
        addEntry(d, "tool-call", "assay_sweep", { id, name: "assay_sweep", input: { path: p } });
        addEntry(d, "tool-result", "12 files examined, 3 findings", {
          id,
          name: "assay_sweep",
          ok: true,
          summary: "12 files examined, 3 findings",
        });
        addEntry(d, "sweep", `Sweep of ${p}`, report);
        return send(res, 200, report);
      }
      case "verify": {
        const seen = d.claims.filter((c) => c.label === "seen");
        addEntry(d, "verification", `${seen.length} seen claims re-run`, {
          checked: seen.length,
          verified: seen.filter((c) => c.verdict === "verified").length,
          refuted: seen.filter((c) => c.verdict === "refuted").length,
          unverifiable: seen.filter((c) => c.verdict === "unverifiable").length,
          claimIds: seen.map((c) => c.id),
        });
        return send(res, 200, seen);
      }
      case "reassay": {
        str(body.path, "path");
        return send(res, 200, {
          added: ["fk_new_symbol"],
          removed: ["fk_extra_file"],
          unchanged: ["fk_link_crypto", "fk_rpath"],
        });
      }
      case "second-opinion":
      case "workers": {
        const provider = str(body.provider, "provider") as ProviderId;
        const accountId = str(body.accountId, "accountId");
        const orig = op === "second-opinion" ? d.workers.find((w) => w.id === body.workerId) : undefined;
        if (op === "second-opinion" && !orig) throw new HttpError(404, "not_found", "No such worker");
        const task = orig ? orig.task : str(body.task, "task");
        const w = newWorker(d, orig ? `Second opinion: ${orig.title}` : task.slice(0, 40), task, provider, accountId);
        void runSmallWorker(d, w);
        return send(res, 200, w);
      }
    }
  }
  g = m(/^\/api\/workers\/([^/]+)\/release$/);
  if (method === "POST" && g) {
    for (const d of db.cases.values()) {
      const w = d.workers.find((x) => x.id === g![1]);
      if (w) {
        pushWorker(d, { ...w, status: "done", liveness: "exited", endedAt: w.endedAt ?? Date.now() });
        return send(res, 200, { ok: true });
      }
    }
    throw new HttpError(404, "not_found", "No such worker");
  }
  g = m(/^\/api\/approvals\/([^/]+)$/);
  if (method === "POST" && g) {
    const body = await readBody(req);
    const decision = body.decision === "approve" ? "approve" : body.decision === "deny" ? "deny" : null;
    if (!decision) throw new HttpError(400, "bad_request", "decision must be approve or deny");
    for (const d of db.cases.values()) {
      const a = d.approvals.find((x) => x.id === g![1]);
      if (a) {
        if (a.state !== "pending") throw new HttpError(409, "approval_settled", `Approval is already ${a.state}`);
        a.state = decision === "approve" ? "approved" : "denied";
        broadcast({ type: "approval", approval: a });
        pushCase(d);
        approvalWaiters.get(a.id)?.(decision);
        approvalWaiters.delete(a.id);
        return send(res, 200, a);
      }
    }
    throw new HttpError(404, "not_found", "No such approval");
  }
  if (method === "POST" && path === "/api/accounts") {
    const body = await readBody(req);
    const provider = str(body.provider, "provider") as ProviderId;
    const label = str(body.label, "label");
    const id = `acc-${provider}-${++idCounter}`;
    const a: AccountView = {
      id,
      provider,
      label,
      home: body.home === "new" ? `~/.assay/accounts/${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}` : null,
      status: "signed-out",
      method: null,
      checkedAt: null,
    };
    db.app.accounts.push(a);
    broadcast({ type: "account", account: a });
    return send(res, 200, a);
  }
  g = m(/^\/api\/accounts\/([^/]+)(?:\/(check|login|login-input))?$/);
  if (g) {
    const a = db.app.accounts.find((x) => x.id === g![1]);
    if (!a) throw new HttpError(404, "not_found", "No such account");
    const op = g[2];
    if (method === "DELETE" && !op) {
      db.app.accounts = db.app.accounts.filter((x) => x !== a);
      return send(res, 200, { ok: true });
    }
    if (method === "POST" && op === "check") {
      a.status = "checking";
      broadcast({ type: "account", account: { ...a } });
      setTimeout(() => {
        a.status = a.method ? "signed-in" : "signed-out";
        a.checkedAt = Date.now();
        broadcast({ type: "account", account: { ...a } });
      }, 500 * SPEED);
      return send(res, 200, a);
    }
    if (method === "POST" && op === "login") {
      loginBuffers.set(a.id, "");
      loginScript(a);
      return send(res, 200, { started: true });
    }
    if (method === "POST" && op === "login-input") {
      const body = await readBody(req);
      const data = typeof body.data === "string" ? body.data : "";
      let buf = loginBuffers.get(a.id) ?? "";
      for (const ch of data) {
        if (ch === "\r" || ch === "\n") {
          broadcast({ type: "login-output", accountId: a.id, chunk: "\r\n", done: false });
          if (buf.trim()) {
            a.status = "signed-in";
            a.method = a.provider === "codex" ? "ChatGPT sign-in" : "claude.ai subscription";
            a.checkedAt = Date.now();
            broadcast({ type: "login-output", accountId: a.id, chunk: "\x1b[32mSigned in.\x1b[0m\r\n", done: true });
            broadcast({ type: "account", account: { ...a } });
          } else {
            broadcast({ type: "login-output", accountId: a.id, chunk: "Code is empty, try again: ", done: false });
          }
          buf = "";
        } else if (ch === "\x7f") {
          if (buf) {
            buf = buf.slice(0, -1);
            broadcast({ type: "login-output", accountId: a.id, chunk: "\b \b", done: false });
          }
        } else {
          buf += ch;
          broadcast({ type: "login-output", accountId: a.id, chunk: ch, done: false });
        }
      }
      loginBuffers.set(a.id, buf);
      return send(res, 200, { ok: true });
    }
  }
  g = m(/^\/api\/evidence\/([^/]+)$/);
  if (method === "GET" && g) {
    const r = db.records.get(decodeURIComponent(g[1]!));
    if (!r) throw new HttpError(404, "not_found", "No such observation");
    return send(res, 200, r);
  }
  throw new HttpError(404, "not_found", `No route ${method} ${path}`);
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".woff2": "font/woff2",
};

function serveStatic(res: ServerResponse, pathname: string): void {
  const rel = normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, "");
  let file = join(DIST, rel);
  if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) file = join(DIST, "index.html");
  if (!existsSync(file)) {
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    res.end("ui/dist is not built. Run `npx vite build ui`, or use `npx vite ui` (it proxies /api here).\n");
    return;
  }
  res.writeHead(200, {
    "content-type": TYPES[extname(file)] ?? "application/octet-stream",
    "content-security-policy":
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
    "x-content-type-options": "nosniff",
  });
  res.end(readFileSync(file));
}

const server = createServer((req, res) => {
  if (!hostOk(req))
    return send(res, 403, {
      error: { code: "bad_host", message: "Host refused", retryable: false, fix: null, detail: null },
    });
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (!url.pathname.startsWith("/api/")) return serveStatic(res, url.pathname);
  api(req, res, url).catch((err: unknown) => {
    const e = err instanceof HttpError ? err : new HttpError(500, "internal", (err as Error).message);
    if (!(err instanceof HttpError)) console.error(err);
    send(res, e.status, {
      error: { code: e.code, message: e.message, retryable: e.status >= 500, fix: e.fix, detail: null },
    });
  });
});

server.on("upgrade", (req, socket) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const ticket = url.searchParams.get("ticket") ?? "";
  const exp = tickets.get(ticket);
  if (url.pathname !== "/api/ws" || !hostOk(req) || !authed(req) || !exp || exp < Date.now()) {
    socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
    return;
  }
  tickets.delete(ticket);
  const conn = acceptWebSocket(req, socket);
  if (!conn) {
    socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
    return;
  }
  conns.add(conn);
  conn.onClose = () => conns.delete(conn);
  conn.onText = () => {};
  conn.send(JSON.stringify({ type: "hello", version: db.app.version } satisfies ServerPush));
});

server.listen(PORT, "127.0.0.1", () => {
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : PORT;
  console.log(`Assay mock listening on http://127.0.0.1:${port}/#pair=${PAIR_CODE}`);
});
