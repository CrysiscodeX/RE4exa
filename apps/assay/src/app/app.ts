// Composition root: builds every subsystem and the HTTP routes. One App per ASSAY_HOME store.

import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { type Accounts, createAccounts } from "../accounts/registry.ts";
import type { ProviderId } from "../contracts.ts";
import { AssayError } from "../errors.ts";
import type { Json } from "../evidence/jcs.ts";
import { type Finding, makeRecord, probeKey } from "../evidence/record.ts";
import {
  calibration,
  caseClaims,
  caseEvidence,
  getEvidence,
  listUnknowns,
  openUnknown,
  putEvidence,
  type StoredClaim,
} from "../evidence/store.ts";
import { cyclonedx, makeBundle, markdown, s2Jsonl, sarif } from "../export/export.ts";
import { sha256 } from "../kernel/ids.ts";
import { Kernel } from "../kernel/kernel.ts";
import { capabilityStatement } from "../mcp/capabilities.ts";
import { stdioProxyCommand } from "../mcp/config.ts";
import { createToolRegistry } from "../mcp/registry.ts";
import { createMcpHandler, mountHttp, queueApprover, TokenRegistry } from "../mcp/server.ts";
import { Orchestrator } from "../orchestrator/orchestrator.ts";
import { ApprovalQueue } from "../policy/approvals.ts";
import { redact } from "../policy/redact.ts";
import { diffFindings } from "../probes/diff.ts";
import { createProbeEngine } from "../probes/engine.ts";
import { createProviders, type ProviderRegistry } from "../providers/index.ts";
import type {
  AppState,
  CaseDetail,
  CaseSummary,
  ClaimView,
  DoctorCheck,
  EvidenceView,
  ServerPush,
  UnknownView,
} from "../server/api-types.ts";
import { type Route, type RunningServer, startServer } from "../server/server.ts";
import { runProcess } from "../vendor/orca-process-host/run-process.ts";
import { createVerifier, parseClaimBlocks } from "../verifier/verifier.ts";
import { RECIPES } from "./recipes.ts";

export const VERSION = "0.1.0";

export interface AppOptions {
  home?: string;
  workspace?: string;
  port?: number;
  /** Adds the deterministic fake provider and its default account (demos, e2e). */
  demo?: boolean;
  uiDir?: string;
  providers?: ProviderRegistry;
}

export function defaultHome(): string {
  return process.env.ASSAY_HOME ? resolve(process.env.ASSAY_HOME) : join(homedir(), ".assay");
}

function toClaimView(c: StoredClaim): ClaimView {
  return {
    id: c.id,
    caseId: c.case_id,
    author: c.author,
    text: c.claim.text,
    label: c.claim.label,
    predicate: c.claim.predicate ?? null,
    verdict: c.verdict,
    reason: c.verdict_record?.reason ?? null,
    observationId: c.verdict_record?.observation_id ?? null,
    eventSeq: c.event_seq,
  };
}

function summarizeResult(r: Json): string {
  const s = JSON.stringify(r);
  return s.length > 160 ? `${s.slice(0, 157)}...` : s;
}

export class App {
  readonly home: string;
  readonly workspace: string;
  readonly kernel: Kernel;
  readonly providers: ProviderRegistry;
  readonly accounts: Accounts;
  readonly approvals: ApprovalQueue;
  readonly engine: ReturnType<typeof createProbeEngine>;
  readonly verifier: ReturnType<typeof createVerifier>;
  readonly tokens = new TokenRegistry();
  readonly orchestrator: Orchestrator;
  readonly registry: ReturnType<typeof createToolRegistry>;
  readonly mcpHandler: ReturnType<typeof createMcpHandler>;
  readonly #listeners = new Set<(p: ServerPush) => void>();
  readonly opts: AppOptions;
  server: RunningServer | null = null;

  constructor(opts: AppOptions = {}) {
    this.opts = opts;
    this.home = resolve(opts.home ?? defaultHome());
    this.workspace = resolve(opts.workspace ?? process.cwd());
    mkdirSync(this.home, { recursive: true, mode: 0o700 });
    this.kernel = Kernel.open({ path: join(this.home, "assay.db") });
    this.providers = opts.providers ?? createProviders();
    this.accounts = createAccounts({
      kernel: this.kernel,
      home: this.home,
      providers: this.providers,
      pty: "auto",
      defaultFake: opts.demo === true,
      onChange: (account) => this.push({ type: "account", account }),
    });
    this.approvals = new ApprovalQueue(this.kernel);
    this.approvals.on("approval", (approval) => {
      this.push({ type: "approval", approval });
      if (approval.caseId && approval.state === "pending" && !this.kernel.closed)
        this.orchestrator.log(
          approval.caseId,
          "approval",
          `Approval needed: ${approval.action}`,
          { approvalId: approval.id, reason: approval.reason },
          approval.workerId,
        );
      if (approval.caseId) this.#caseChanged(approval.caseId);
    });
    this.engine = createProbeEngine({ kernel: this.kernel, workspace: this.workspace, redact: (v) => redact(v) });
    this.verifier = createVerifier({
      kernel: this.kernel,
      engine: this.engine,
      // cmd.exit claims are re-run only after the person approves, through the same queue as agents' effects
      exec: async ({ caseId, claimId, program, args }) => {
        await this.approvals.request({
          caseId,
          workerId: null,
          action: "verify:cmd.exit",
          detail: { claimId, program, args } as Json,
          reason: "re-run a command to check a claim",
        });
        const r = await runProcess({ program, args, cwd: this.workspace, timeoutMs: 120_000, maxOutputBytes: 1 << 20 });
        const probe = { id: "cmd.exit", version: "1" };
        const params = { program: basename(program), args } as Json;
        const rec = makeRecord(
          {
            probe,
            probe_key: probeKey(probe, params, null),
            predicate: "cmd.exit",
            subject: null,
            params,
            result: {
              code: r.code,
              timedOut: r.timedOut,
              stdout_sha256: sha256(r.stdout),
              stderr_sha256: sha256(r.stderr),
            },
            confidence: "observed",
            producer: { kind: "verifier", id: "assay-verifier" },
            locator: { path: program },
            volatile: { stdout_tail: r.stdout.slice(-2000) },
          },
          this.kernel.now(),
        );
        putEvidence(this.kernel, caseId, rec);
        return { code: r.code, observation_id: rec.observation_id };
      },
    });
    const mcpHost = {
      get url() {
        return "";
      },
      issue: (caseId: string, caller: string) => this.tokens.issue({ caseId, caller }),
      revoke: (t: string) => void this.tokens.revoke(t),
      stdioProxy: (t: string) => stdioProxyCommand(this.mcpUrl(), t),
    };
    Object.defineProperty(mcpHost, "url", { get: () => this.mcpUrl() });
    this.orchestrator = new Orchestrator({
      kernel: this.kernel,
      providers: this.providers,
      account: (id) => this.accounts.ref(id),
      mcp: mcpHost,
      approve: (r) =>
        this.approvals.request({
          caseId: r.caseId,
          workerId: r.workerId,
          action: r.action,
          detail: r.detail,
          reason: r.reason,
        }),
      verifier: {
        verifyCase: (caseId) => this.verifier.verifyCase(caseId),
        parseClaimBlocks: (text) => parseClaimBlocks(text),
      },
      home: this.home,
      emit: (p) => this.push(p),
      caseChanged: (id) => this.#caseChanged(id),
    });
    this.registry = createToolRegistry({
      kernel: this.kernel,
      engine: this.engine,
      approvals: this.approvals,
      workspace: this.workspace,
      verifier: {
        verify: async ({ caseId }) => {
          await this.orchestrator.verify(caseId);
          return caseClaims(this.kernel, caseId).map((c) => ({ id: c.id, verdict: c.verdict })) as unknown as Json;
        },
      },
      extraTools: this.orchestrator.tools(),
    });
    this.mcpHandler = createMcpHandler({ registry: this.registry, version: VERSION });
    this.orchestrator.recover();
  }

  mcpUrl(): string {
    return this.server ? `${this.server.url}/mcp` : "http://127.0.0.1:0/mcp";
  }

  readonly #pushedEvidence = new Map<string, Set<string>>();

  push(p: ServerPush): void {
    for (const l of this.#listeners) l(p);
    // evidence an agent's tool call produced reaches the inspector without a reload
    if (p.type === "timeline" && p.entry.kind === "tool-result") this.#pushNewEvidence(p.caseId);
  }

  #pushNewEvidence(caseId: string): void {
    let seen = this.#pushedEvidence.get(caseId);
    if (!seen) {
      seen = new Set();
      this.#pushedEvidence.set(caseId, seen);
    }
    for (const e of caseEvidence(this.kernel, caseId)) {
      if (seen.has(e.observation_id)) continue;
      seen.add(e.observation_id);
      for (const l of this.#listeners) l({ type: "evidence", caseId, evidence: this.evidenceView(e) });
    }
  }

  #caseChanged(caseId: string): void {
    const summary = this.caseSummary(caseId);
    if (summary) this.push({ type: "case", summary });
  }

  // ---------- views ----------

  caseSummary(id: string): CaseSummary | undefined {
    const c = this.kernel.getCase(id);
    if (!c) return undefined;
    const claims = caseClaims(this.kernel, id);
    const n = (v: string) => claims.filter((x) => x.verdict === v).length;
    const pending = this.approvals.pending(id).length;
    const activity = pending > 0 ? "blocked" : this.orchestrator.caseActivity(id);
    return {
      id: c.id,
      title: c.title,
      workspace: c.workspace,
      status: c.status,
      parentCase: c.parent_case,
      forkedAt: c.forked_at,
      createdAt: c.created_at,
      activity,
      counts: {
        claims: claims.length,
        verified: n("verified"),
        refuted: n("refuted"),
        unverifiable: n("unverifiable"),
        unknownsOpen: this.orchestrator.openUnknownsCount(id),
        approvalsPending: pending,
        workers: this.orchestrator.workers(id).length,
      },
    };
  }

  evidenceView(e: ReturnType<typeof caseEvidence>[number]): EvidenceView {
    return {
      observationId: e.observation_id,
      predicate: e.predicate,
      probe: e.probe ? `${e.probe.id}@${e.probe.version}` : null,
      subject: e.subject?.digest ?? null,
      path: e.locator?.path ?? null,
      confidence: e.confidence,
      producer: `${e.producer.kind}:${e.producer.id}`,
      summary: summarizeResult(e.result),
      coverage: e.coverage?.status ?? null,
      createdAt: e.created_at,
    };
  }

  caseDetail(id: string): CaseDetail {
    const summary = this.caseSummary(id);
    if (!summary) throw new AssayError("not_found", { case: id });
    const c = this.kernel.getCase(id)!;
    const s = (c.meta.settings ?? {}) as Record<string, unknown>;
    const unknowns: UnknownView[] = listUnknowns(this.kernel, id).map((u) => ({
      id: u.id,
      rev: u.rev,
      question: u.question,
      status: u.status,
      origin: u.origin,
      answer: u.answer ?? null,
      evidence: u.evidence ?? [],
    }));
    return {
      summary,
      timeline: this.orchestrator.timeline(id),
      claims: caseClaims(this.kernel, id).map(toClaimView),
      unknowns,
      evidence: caseEvidence(this.kernel, id).map((e) => this.evidenceView(e)),
      workers: this.orchestrator.workers(id),
      approvals: this.approvals.list(id),
      chainIntact: this.kernel.verifyChain(id) === null,
      settings: {
        provider: (s.provider as ProviderId | undefined) ?? null,
        accountId: (s.accountId as string | undefined) ?? null,
        model: (s.model as string | undefined) ?? null,
        mode: (s.mode as "enforced" | "open" | undefined) ?? "enforced",
        budgetUsd: (s.budgetUsd as number | undefined) ?? null,
      },
    };
  }

  async state(): Promise<AppState> {
    return {
      version: VERSION,
      workspaceRoot: this.workspace,
      cases: this.kernel
        .listCases()
        .map((c) => this.caseSummary(c.id))
        .filter((x): x is CaseSummary => x !== undefined),
      accounts: this.accounts.list(),
      providers: await this.providers.detectAll(),
      recipes: RECIPES,
      firstRun: this.kernel.meta("first_run_done") !== "1",
    };
  }

  // ---------- actions ----------

  createCase(input: { title?: string; workspace?: string; recipeId?: string; path?: string }): CaseSummary {
    const recipe = input.recipeId ? RECIPES.find((r) => r.id === input.recipeId) : undefined;
    const title = (input.title ?? recipe?.title ?? "New case").slice(0, 200);
    const c = this.kernel.createCase({
      title,
      workspace: input.workspace ?? this.workspace,
      meta: recipe ? { recipe: recipe.id, path: input.path ?? "." } : {},
    });
    this.kernel.setMeta("first_run_done", "1");
    if (recipe)
      this.orchestrator.log(c.id, "system", recipe.prompt.replaceAll("{path}", input.path ?? "."), {
        recipe: recipe.id,
        draft: true,
      });
    const s = this.caseSummary(c.id)!;
    this.push({ type: "case", summary: s });
    return s;
  }

  async sweep(caseId: string, path: string): Promise<unknown> {
    if (!this.kernel.getCase(caseId)) throw new AssayError("not_found", { case: caseId });
    const report = await this.engine.sweep({ caseId, path });
    for (const q of report.questions) {
      const u = openUnknown(this.kernel, caseId, { question: q, origin: `sweep:${path}` });
      this.push({
        type: "unknown",
        caseId,
        unknown: {
          id: u.id,
          rev: u.rev,
          question: u.question,
          status: u.status,
          origin: u.origin,
          answer: null,
          evidence: [],
        },
      });
    }
    this.orchestrator.log(
      caseId,
      "sweep",
      `Sweep of ${path}: ${report.evidence.length} evidence records, ${report.findings.length} findings, ${report.questions.length} open questions, ${report.notExamined.length} not examined (${report.elapsedMs} ms).`,
      report,
    );
    for (const id of report.evidence) {
      const e = getEvidence(this.kernel, id);
      if (e) this.push({ type: "evidence", caseId, evidence: this.evidenceView(e) });
    }
    this.#caseChanged(caseId);
    return report;
  }

  /** Re-assay: sweep a new version and pair its findings with the last sweep's by FindingKey. */
  async reassay(caseId: string, path: string): Promise<{ added: Finding[]; removed: Finding[]; unchanged: Finding[] }> {
    const prev = [...this.orchestrator.timeline(caseId)].reverse().find((e) => e.kind === "sweep");
    const before = ((prev?.data as { findings?: Finding[] } | undefined)?.findings ?? []) as Finding[];
    const report = (await this.sweep(caseId, path)) as { findings: Finding[] };
    const d = diffFindings(before, report.findings);
    const out = { added: d.added, removed: d.removed, unchanged: d.unchanged.map((u) => u.after) };
    this.orchestrator.log(
      caseId,
      "sweep",
      `Re-assay of ${path}: ${out.added.length} added, ${out.removed.length} removed, ${out.unchanged.length} unchanged.`,
      {
        added: out.added,
        removed: out.removed,
        unchanged: out.unchanged.length,
      },
    );
    return out;
  }

  exportCase(caseId: string, format: string): { __download: true; body: string; type: string; filename: string } {
    if (!this.kernel.getCase(caseId)) throw new AssayError("not_found", { case: caseId });
    const base = `assay-${caseId}`;
    switch (format) {
      case "s2":
        return {
          __download: true,
          body: s2Jsonl(this.kernel, caseId),
          type: "application/x-ndjson",
          filename: `${base}.s2.jsonl`,
        };
      case "sarif":
        return {
          __download: true,
          body: JSON.stringify(sarif(this.kernel, caseId, VERSION), null, 2),
          type: "application/sarif+json",
          filename: `${base}.sarif`,
        };
      case "cyclonedx":
        return {
          __download: true,
          body: JSON.stringify(cyclonedx(this.kernel, caseId, VERSION), null, 2),
          type: "application/vnd.cyclonedx+json",
          filename: `${base}.cdx.json`,
        };
      case "md":
        return {
          __download: true,
          body: markdown(this.kernel, caseId),
          type: "text/markdown; charset=utf-8",
          filename: `${base}.md`,
        };
      case "bundle":
        return {
          __download: true,
          body: JSON.stringify(makeBundle(this.kernel, caseId, this.home, VERSION), null, 2),
          type: "application/json",
          filename: `${base}.bundle.json`,
        };
      default:
        throw new AssayError("bad_request", { format });
    }
  }

  async doctor(): Promise<DoctorCheck[]> {
    const checks: DoctorCheck[] = [];
    const [maj, min] = process.versions.node.split(".").map(Number);
    checks.push({
      id: "node",
      ok: maj! > 22 || (maj === 22 && min! >= 12),
      detail: `Node ${process.versions.node}`,
      fix: "Install Node 22.12 or later",
    });
    checks.push({
      id: "store",
      ok: true,
      detail: `store ${join(this.home, "assay.db")} (held exclusively by this process)`,
      fix: null,
    });
    for (const p of await this.providers.detectAll())
      checks.push({
        id: `provider:${p.id}`,
        ok: p.installed,
        detail: p.installed ? `${p.id} ${p.version ?? ""} (${p.enforcement})` : `${p.id} not installed`,
        fix: p.installed ? null : `Install the official ${p.id} client`,
      });
    for (const a of this.accounts.list())
      checks.push({
        id: `account:${a.id}`,
        ok: a.status === "signed-in",
        detail: `${a.provider} "${a.label}": ${a.status}`,
        fix: a.status === "signed-in" ? null : "Sign in from the Accounts panel",
      });
    const git = await runProcess({ program: "git", args: ["--version"], timeoutMs: 5000 }).catch(() => null);
    checks.push({
      id: "git",
      ok: git?.code === 0,
      detail: git?.stdout.trim() || "git not found",
      fix: git?.code === 0 ? null : "Install git (needed for worker worktrees)",
    });
    checks.push({
      id: "ui",
      ok: existsSync(join(this.uiDir(), "index.html")),
      detail: this.uiDir(),
      fix: "Run `npm run build:ui` in apps/assay",
    });
    return checks;
  }

  uiDir(): string {
    return resolve(this.opts.uiDir ?? join(import.meta.dirname, "..", "..", "ui", "dist"));
  }

  sessionKey(): Buffer {
    let k = this.kernel.meta("session_key");
    if (!k) {
      k = randomBytes(32).toString("base64");
      this.kernel.setMeta("session_key", k);
    }
    return Buffer.from(k, "base64");
  }

  routes(): Route[] {
    const body = (b: unknown) => (b ?? {}) as Record<string, unknown>;
    const str = (v: unknown, field: string): string => {
      if (typeof v !== "string" || !v) throw new AssayError("bad_request", { field });
      return v;
    };
    return [
      { method: "GET", path: "/api/state", handler: () => this.state() },
      { method: "GET", path: "/api/doctor", handler: () => this.doctor() },
      {
        method: "GET",
        path: "/api/capabilities",
        handler: () => capabilityStatement({ engine: this.engine, verifier: true }),
      },
      { method: "POST", path: "/api/cases", handler: ({ body: b }) => this.createCase(body(b) as never) },
      { method: "GET", path: "/api/cases/:id", handler: ({ params }) => this.caseDetail(params.id!) },
      {
        method: "PATCH",
        path: "/api/cases/:id",
        handler: ({ params, body: b }) => {
          const x = body(b);
          this.kernel.updateCase(params.id!, {
            title: typeof x.title === "string" ? x.title.slice(0, 200) : undefined,
            meta: x.settings ? { settings: x.settings } : undefined,
          });
          return this.caseSummary(params.id!);
        },
      },
      {
        method: "POST",
        path: "/api/cases/:id/messages",
        handler: ({ params, body: b }) => this.orchestrator.sendMessage(params.id!, body(b) as never),
      },
      {
        method: "POST",
        path: "/api/cases/:id/estimate",
        handler: ({ params, body: b }) =>
          this.orchestrator.estimate(params.id!, { text: "", ...(body(b) as object) } as never),
      },
      {
        method: "POST",
        path: "/api/cases/:id/interrupt",
        handler: async ({ params }) => {
          await this.orchestrator.interrupt(params.id!);
          return { ok: true };
        },
      },
      {
        method: "POST",
        path: "/api/cases/:id/fork",
        handler: ({ params, body: b }) => {
          const at = Number(body(b).atSeq);
          if (!Number.isInteger(at) || at < 1) throw new AssayError("bad_request", { field: "atSeq" });
          const f = this.kernel.forkCase(params.id!, at);
          const s = this.caseSummary(f.id)!;
          this.push({ type: "case", summary: s });
          return s;
        },
      },
      {
        method: "POST",
        path: "/api/cases/:id/sweep",
        handler: ({ params, body: b }) => this.sweep(params.id!, str(body(b).path, "path")),
      },
      {
        method: "POST",
        path: "/api/cases/:id/verify",
        handler: async ({ params }) => {
          await this.orchestrator.verify(params.id!);
          return caseClaims(this.kernel, params.id!).map(toClaimView);
        },
      },
      {
        method: "POST",
        path: "/api/cases/:id/reassay",
        handler: ({ params, body: b }) => this.reassay(params.id!, str(body(b).path, "path")),
      },
      {
        method: "POST",
        path: "/api/cases/:id/second-opinion",
        handler: ({ params, body: b }) => this.orchestrator.secondOpinion(params.id!, body(b) as never),
      },
      {
        method: "POST",
        path: "/api/cases/:id/workers",
        handler: ({ params, body: b }) => {
          const x = body(b);
          return this.orchestrator.spawnWorker(params.id!, {
            task: str(x.task, "task"),
            provider: x.provider as ProviderId | undefined,
            accountId: x.accountId as string | undefined,
            worktree: x.worktree === true,
          });
        },
      },
      {
        method: "POST",
        path: "/api/workers/:id/release",
        handler: async ({ params }) => {
          const w = this.orchestrator.workerView(params.id!);
          if (!w) throw new AssayError("not_found", { worker: params.id });
          await this.orchestrator.releaseWorker(w.caseId, w.id);
          return { ok: true };
        },
      },
      {
        method: "POST",
        path: "/api/approvals/:id",
        handler: ({ params, body: b }) => {
          const x = body(b);
          if (x.decision !== "approve" && x.decision !== "deny")
            throw new AssayError("bad_request", { field: "decision" });
          return this.approvals.decide(params.id!, x.decision, typeof x.reason === "string" ? x.reason : undefined);
        },
      },
      { method: "GET", path: "/api/accounts", handler: () => this.accounts.list() },
      {
        method: "POST",
        path: "/api/accounts",
        handler: ({ body: b }) => {
          const x = body(b);
          return this.accounts.create({
            provider: str(x.provider, "provider") as ProviderId,
            label: str(x.label, "label"),
            home: x.home === "new" ? "new" : "default",
          });
        },
      },
      { method: "POST", path: "/api/accounts/:id/check", handler: ({ params }) => this.accounts.check(params.id!) },
      {
        method: "POST",
        path: "/api/accounts/:id/login",
        handler: ({ params }) =>
          this.accounts.login(params.id!, (chunk, done) =>
            this.push({ type: "login-output", accountId: params.id!, chunk, done }),
          ),
      },
      {
        method: "POST",
        path: "/api/accounts/:id/login-input",
        handler: ({ params, body: b }) => {
          this.accounts.input(params.id!, str(body(b).data, "data"));
          return { ok: true };
        },
      },
      {
        method: "DELETE",
        path: "/api/accounts/:id",
        handler: ({ params }) => {
          this.accounts.remove(params.id!);
          return { ok: true };
        },
      },
      {
        method: "GET",
        path: "/api/evidence/:id",
        handler: ({ params }) => {
          const e = getEvidence(this.kernel, params.id!);
          if (!e) throw new AssayError("not_found", { evidence: params.id });
          return e;
        },
      },
      {
        method: "GET",
        path: "/api/cases/:id/export",
        handler: ({ params, query }) => this.exportCase(params.id!, query.get("format") ?? "md"),
      },
      {
        method: "GET",
        path: "/api/usage",
        handler: ({ query }) =>
          this.orchestrator.usage(
            (["account_id", "provider", "case_id", "worker_id"].includes(query.get("by") ?? "")
              ? query.get("by")
              : "account_id") as never,
          ),
      },
      {
        method: "GET",
        path: "/api/calibration",
        handler: () =>
          calibration(this.kernel).map((r) => ({
            producer: r.producer,
            questionClass: r.question_class,
            verified: r.verified,
            refuted: r.refuted,
            unverifiable: r.unverifiable,
            precision: r.precision,
            interval: r.interval,
            status: r.status,
          })),
      },
    ];
  }

  async listen(port?: number): Promise<RunningServer> {
    await this.accounts.ensureDefaults().catch(() => []);
    // ask each official client whether its account is signed in (pushes `account` updates as they land)
    void this.accounts.checkAll().catch(() => []);
    this.server = await startServer({
      port: port ?? this.opts.port,
      uiDir: this.uiDir(),
      sessionKey: this.sessionKey(),
      routes: this.routes(),
      version: VERSION,
      mcp: (req, res) =>
        mountHttp(req, res, {
          tokens: this.tokens,
          handler: this.mcpHandler,
          approve: queueApprover(this.approvals),
          workspace: this.workspace,
        }),
      onPushSubscribe: (send) => {
        this.#listeners.add(send);
        return () => this.#listeners.delete(send);
      },
    });
    return this.server;
  }

  async close(): Promise<void> {
    await this.orchestrator.shutdown();
    if (this.server) await this.server.close();
    this.accounts.close();
    this.approvals.close();
    this.kernel.close();
  }
}

export function readJsonFile(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}
