// Canned, realistic data for the mock server. Everything here is invented sample content.

import type { SweepReport } from "../../src/contracts.ts";
import type {
  AccountView,
  ApprovalView,
  AppState,
  CalibrationView,
  CaseDetail,
  CaseSummary,
  ClaimView,
  DoctorCheck,
  EvidenceView,
  TimelineEntry,
  UnknownView,
  UsageRow,
  WorkerView,
} from "../../src/server/api-types.ts";

export interface MockDb {
  app: AppState;
  cases: Map<string, CaseDetail>;
  records: Map<string, unknown>;
  usage: UsageRow[];
  calibration: CalibrationView[];
  doctor: DoctorCheck[];
}

const T0 = Date.now() - 3 * 3600_000;

export function obsId(n: number): string {
  return `obs_${n.toString(16).padStart(6, "0")}e3b0c44298fc1c149afbf4c8996fb924`;
}

export function digest(n: number): string {
  return `sha256:${(n * 2654435761).toString(16).padStart(8, "0")}9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08`;
}

export function emptyCounts(): CaseSummary["counts"] {
  return { claims: 0, verified: 0, refuted: 0, unverifiable: 0, unknownsOpen: 0, approvalsPending: 0, workers: 0 };
}

export function recount(d: CaseDetail): void {
  const c = d.summary.counts;
  c.claims = d.claims.length;
  c.verified = d.claims.filter((x) => x.verdict === "verified").length;
  c.refuted = d.claims.filter((x) => x.verdict === "refuted").length;
  c.unverifiable = d.claims.filter((x) => x.verdict === "unverifiable").length;
  c.unknownsOpen = d.unknowns.filter((x) => x.status === "open").length;
  c.approvalsPending = d.approvals.filter((x) => x.state === "pending").length;
  c.workers = d.workers.length;
}

export function makeRecord(ev: EvidenceView, result: unknown): unknown {
  return {
    spec: "assay.claim/1",
    observation_id: ev.observationId,
    probe_key: ev.probe ? `pk_${ev.observationId.slice(4, 20)}` : null,
    probe: ev.probe ? { id: ev.probe, version: "1.2.0" } : null,
    predicate: ev.predicate,
    subject: ev.subject ? { digest: ev.subject, format: "tar+gzip" } : null,
    params: {},
    result,
    confidence: ev.confidence,
    producer: { kind: ev.producer.startsWith("probe") ? "runner" : "verifier", id: ev.producer },
    taint: "target",
    redactions: [],
    nested: [],
    limitations: ev.coverage === "partial" ? ["Symlinks outside the archive were not followed"] : [],
    coverage:
      ev.coverage === null
        ? null
        : {
            status: ev.coverage,
            examined: 12,
            skipped: ev.coverage === "partial" ? [{ what: "docs/*.pdf", reason: "no probe for PDF" }] : [],
            unresolved: ev.coverage === "partial" ? 1 : 0,
            unclaimed: 0,
          },
    locator: ev.path ? { path: ev.path } : undefined,
    created_at: ev.createdAt,
  };
}

function ev(
  n: number,
  predicate: string,
  probe: string | null,
  path: string | null,
  confidence: string,
  summary: string,
  coverage: string | null,
): EvidenceView {
  return {
    observationId: obsId(n),
    predicate,
    probe,
    subject: path ? digest(n) : null,
    path,
    confidence,
    producer: probe ? `probe:${probe}` : "verifier:assay",
    summary,
    coverage,
    createdAt: T0 + n * 1000,
  };
}

export const SWEEP_C1: SweepReport = {
  subject: "dist/libfoo-2.4.1.tar.gz",
  evidence: [obsId(1), obsId(2), obsId(3)],
  findings: [
    {
      key: "fk_link_crypto",
      class: "elf.import",
      label: "lib/libfoo.so.2 imports libcrypto.so.3",
      observation_id: obsId(3),
    },
    {
      key: "fk_extra_file",
      class: "archive.extra",
      label: "configure.orig is not in the git tag",
      observation_id: obsId(2),
    },
    { key: "fk_rpath", class: "elf.rpath", label: "bin/foo-cli has RUNPATH $ORIGIN/../lib", observation_id: obsId(3) },
  ],
  questions: ["Was configure.orig produced by the release script or added by hand?"],
  notExamined: [
    { what: "docs/manual.pdf", reason: "no probe for PDF documents" },
    { what: "tests/fixtures/*.bin", reason: "over the sweep byte budget" },
  ],
  elapsedMs: 842,
};

function entry(
  seq: number,
  kind: TimelineEntry["kind"],
  text: string,
  data?: unknown,
  workerId: string | null = null,
): TimelineEntry {
  const e: TimelineEntry = { seq, at: T0 + seq * 7000, kind, workerId, text };
  if (data !== undefined) e.data = data;
  return e;
}

function summary(
  id: string,
  title: string,
  activity: CaseSummary["activity"],
  extra: Partial<CaseSummary> = {},
): CaseSummary {
  return {
    id,
    title,
    workspace: "/home/dev/work/libfoo",
    status: activity === "done" ? "closed" : "open",
    parentCase: null,
    forkedAt: null,
    createdAt: T0,
    activity,
    counts: emptyCounts(),
    ...extra,
  };
}

const C1_ASSISTANT = [
  "The sweep finished. Here is what the **model-free** pass established:",
  "",
  "- The archive holds 12 regular files and no device nodes.",
  "- `lib/libfoo.so.2` links against `libcrypto.so.3` (OpenSSL 3).",
  "- `configure.orig` is present in the tarball but not in tag `v2.4.1`.",
  "",
  "To reproduce the import check locally:",
  "",
  "```sh",
  "readelf -d lib/libfoo.so.2 | grep NEEDED",
  "```",
  "",
  "See the upstream notes at [release checklist](https://example.org/libfoo/RELEASING.md).",
].join("\n");

function caseOne(): CaseDetail {
  const evidence = [
    ev(
      1,
      "file.identify",
      "file.identify",
      "dist/libfoo-2.4.1.tar.gz",
      "observed",
      "gzip-compressed tar archive, 12 entries",
      "complete",
    ),
    ev(
      2,
      "archive.listing",
      "archive.list",
      "dist/libfoo-2.4.1.tar.gz",
      "observed",
      "12 regular files, 0 symlinks, 0 device nodes",
      "partial",
    ),
    ev(3, "elf.imports", "elf.imports", "lib/libfoo.so.2", "observed", "NEEDED: libc.so.6, libcrypto.so.3", "complete"),
    ev(4, "git.tag-diff", "git.tree-diff", "v2.4.1", "derived", "1 file only in tarball: configure.orig", "complete"),
  ];
  const claims: ClaimView[] = [
    {
      id: "clm_01",
      caseId: "c1",
      author: "coordinator",
      text: "The archive holds 12 regular files and no device nodes",
      label: "seen",
      predicate: "archive.listing",
      verdict: "verified",
      reason: "archive.list re-run produced the same listing",
      observationId: obsId(2),
      eventSeq: 6,
    },
    {
      id: "clm_02",
      caseId: "c1",
      author: "coordinator",
      text: "lib/libfoo.so.2 links against libcrypto.so.3",
      label: "seen",
      predicate: "elf.imports",
      verdict: "verified",
      reason: "elf.imports lists libcrypto.so.3 in DT_NEEDED",
      observationId: obsId(3),
      eventSeq: 6,
    },
    {
      id: "clm_03",
      caseId: "c1",
      author: "coordinator",
      text: "configure.orig is not in tag v2.4.1",
      label: "seen",
      predicate: "git.tag-diff",
      verdict: "verified",
      reason: "git tree diff confirms the file is only in the tarball",
      observationId: obsId(4),
      eventSeq: 6,
    },
  ];
  const unknowns: UnknownView[] = [
    {
      id: "unk_01",
      rev: 1,
      question: "Was configure.orig produced by the release script or added by hand?",
      status: "open",
      origin: "sweep",
      answer: null,
      evidence: [obsId(4)],
    },
    {
      id: "unk_02",
      rev: 2,
      question: "Does the tarball contain prebuilt binaries?",
      status: "resolved",
      origin: "coordinator",
      answer: "Yes: lib/libfoo.so.2 and bin/foo-cli are prebuilt ELF objects.",
      evidence: [obsId(1), obsId(3)],
    },
  ];
  const d: CaseDetail = {
    summary: summary("c1", "libfoo 2.4.1 release audit", "idle"),
    timeline: [
      entry(1, "user", "Check whether `dist/libfoo-2.4.1.tar.gz` matches tag v2.4.1 and list what it links against."),
      entry(2, "assistant", "I'll start with a model-free sweep of the tarball, then compare it with the tag."),
      entry(3, "tool-call", "assay_sweep", {
        id: "tc_1",
        name: "assay_sweep",
        input: { path: "dist/libfoo-2.4.1.tar.gz" },
      }),
      entry(4, "tool-result", "12 files examined, 3 findings", {
        id: "tc_1",
        name: "assay_sweep",
        ok: true,
        summary: "12 files examined, 3 findings",
      }),
      entry(5, "sweep", "Sweep of dist/libfoo-2.4.1.tar.gz", SWEEP_C1),
      entry(6, "assistant", C1_ASSISTANT),
      entry(7, "verification", "3 claims re-checked: 3 verified", {
        checked: 3,
        verified: 3,
        refuted: 0,
        unverifiable: 0,
        claimIds: ["clm_01", "clm_02", "clm_03"],
      }),
    ],
    claims,
    unknowns,
    evidence,
    workers: [],
    approvals: [],
    chainIntact: true,
    settings: { provider: "claude", accountId: "acc-claude-default", model: null, mode: "enforced", budgetUsd: 2 },
  };
  recount(d);
  return d;
}

function caseFork(): CaseDetail {
  const base = caseOne();
  const d: CaseDetail = {
    ...base,
    summary: summary("c2", "libfoo audit, Codex symbol diff", "idle", { parentCase: "c1", forkedAt: 5 }),
    timeline: [...base.timeline.slice(0, 5), entry(8, "system", "Forked from “libfoo 2.4.1 release audit” at step 5")],
    claims: [],
    unknowns: [],
    chainIntact: true,
    settings: { provider: "codex", accountId: "acc-codex-work", model: "gpt-5-codex", mode: "enforced", budgetUsd: 1 },
  };
  recount(d);
  return d;
}

function caseThree(): CaseDetail {
  const workers: WorkerView[] = [
    {
      id: "w_c3_1",
      caseId: "c3",
      title: "Symbolise backtrace",
      task: "Symbolise the backtrace in core.4411 using the shipped debug info",
      provider: "codex",
      accountId: "acc-codex-work",
      status: "done",
      liveness: "exited",
      worktree: null,
      startedAt: T0 + 60_000,
      endedAt: T0 + 240_000,
      result: "Crash in parse_header() at src/header.c:212 (NULL deref of hdr->ext).",
      costUsd: 0.042,
    },
  ];
  const d: CaseDetail = {
    summary: summary("c3", "Triage nightly core dump", "done", { workspace: "/home/dev/work/nightly" }),
    timeline: [
      entry(1, "user", "Why did the nightly build crash? The core is in `artifacts/core.4411`."),
      entry(2, "worker", "Started worker “Symbolise backtrace”", { workerId: "w_c3_1", event: "spawned" }),
      entry(3, "worker", "Worker “Symbolise backtrace” finished", {
        workerId: "w_c3_1",
        event: "done",
        result: workers[0]!.result,
      }),
      entry(
        4,
        "assistant",
        "The crash is a NULL dereference of `hdr->ext` in `parse_header()`; it was claimed but not re-run.",
      ),
    ],
    claims: [
      {
        id: "clm_31",
        caseId: "c3",
        author: "w_c3_1",
        text: "Crash in parse_header() at src/header.c:212",
        label: "inferred",
        predicate: null,
        verdict: "unverifiable",
        reason: "no probe can re-run a debugger session",
        observationId: null,
        eventSeq: 4,
      },
    ],
    unknowns: [],
    evidence: [],
    workers,
    approvals: [],
    chainIntact: true,
    settings: { provider: "claude", accountId: "acc-claude-default", model: null, mode: "enforced", budgetUsd: null },
  };
  recount(d);
  return d;
}

function caseFour(): CaseDetail {
  const d: CaseDetail = {
    summary: summary("c4", "Vendor SBOM check", "error", { workspace: "/home/dev/work/vendor" }),
    timeline: [
      entry(1, "user", "Compare `vendor/sbom.json` with what is actually in `vendor/`."),
      entry(2, "error", "The store was written by a newer Assay", {
        code: "store_schema_newer",
        message: "The store was written by a newer Assay",
        fix: "Upgrade Assay; downgrading a store is refused",
        retryable: false,
      }),
    ],
    claims: [],
    unknowns: [],
    evidence: [],
    workers: [],
    approvals: [],
    chainIntact: false,
    settings: { provider: "claude", accountId: "acc-claude-default", model: null, mode: "open", budgetUsd: 0.5 },
  };
  recount(d);
  return d;
}

export function accounts(): AccountView[] {
  return [
    {
      id: "acc-claude-default",
      provider: "claude",
      label: "Claude (default login)",
      home: null,
      status: "signed-in",
      method: "claude.ai subscription",
      checkedAt: Date.now() - 600_000,
    },
    {
      id: "acc-codex-work",
      provider: "codex",
      label: "Codex (work)",
      home: "~/.assay/accounts/codex-work",
      status: "signed-in",
      method: "ChatGPT sign-in",
      checkedAt: Date.now() - 900_000,
    },
    {
      id: "acc-claude-personal",
      provider: "claude",
      label: "Claude (personal)",
      home: "~/.assay/accounts/claude-personal",
      status: "signed-out",
      method: null,
      checkedAt: Date.now() - 86_400_000,
    },
  ];
}

export function createDb(firstRun: boolean): MockDb {
  const cases = new Map<string, CaseDetail>();
  for (const c of [caseOne(), caseFork(), caseThree(), caseFour()]) cases.set(c.summary.id, c);
  const records = new Map<string, unknown>();
  const results: Record<string, unknown> = {
    [obsId(1)]: { format: "tar+gzip", entries: 12, compressed: 48213, uncompressed: 201744 },
    [obsId(2)]: {
      files: ["configure", "configure.orig", "Makefile.in", "lib/libfoo.so.2", "bin/foo-cli", "include/foo.h"],
      symlinks: 0,
      devices: 0,
    },
    [obsId(3)]: { needed: ["libc.so.6", "libcrypto.so.3"], runpath: "$ORIGIN/../lib" },
    [obsId(4)]: { onlyInTarball: ["configure.orig"], onlyInTag: [], changed: [] },
  };
  for (const c of cases.values())
    for (const e of c.evidence) records.set(e.observationId, makeRecord(e, results[e.observationId] ?? {}));
  const app: AppState = {
    version: "0.1.0-mock",
    workspaceRoot: "/home/dev/work",
    cases: [...cases.values()].map((c) => c.summary),
    accounts: accounts(),
    providers: [
      {
        id: "claude",
        installed: true,
        version: "2.3.1",
        program: "/usr/local/bin/claude",
        enforcement: "enforced",
        notes: ["Built-in tools are disabled; only Assay's MCP tools are offered."],
      },
      {
        id: "codex",
        installed: true,
        version: "0.61.0",
        program: "/home/dev/.local/bin/codex",
        enforcement: "partial",
        notes: ["Codex keeps its built-in shell tool; each call is routed through Assay approval."],
      },
      {
        id: "acp",
        installed: false,
        version: null,
        program: null,
        enforcement: "unenforced",
        notes: ["No ACP agent found on PATH (looked for gemini, goose).", "Install one and press Re-detect."],
      },
    ],
    recipes: [
      {
        id: "release-audit",
        title: "Audit a release artifact",
        description: "Compare a tarball or package with its tagged source and list what it links against.",
        prompt: "Audit {path}: does it match the tagged source? What does it link against?",
        needsPath: true,
      },
      {
        id: "what-is-this",
        title: "What does this binary do?",
        description: "Identify a file, read its imports and strings, and explain its behaviour with evidence.",
        prompt: "Explain what {path} does. Back each statement with evidence.",
        needsPath: true,
      },
      {
        id: "dep-upgrade",
        title: "Review a dependency upgrade",
        description: "Diff two versions of a dependency and flag new network, exec or install-script behaviour.",
        prompt: "Review the dependency change in {path}.",
        needsPath: true,
      },
      {
        id: "open",
        title: "Open question",
        description: "Start an empty case and ask anything.",
        prompt: "",
        needsPath: false,
      },
    ],
    firstRun,
  };
  return {
    app,
    cases,
    records,
    usage: [
      {
        key: "acc-claude-default",
        provider: "claude",
        turns: 14,
        inputTokens: 182_340,
        outputTokens: 21_877,
        costUsd: 0.8421,
        resent: 2,
      },
      {
        key: "acc-codex-work",
        provider: "codex",
        turns: 6,
        inputTokens: 64_102,
        outputTokens: 9_311,
        costUsd: 0.2133,
        resent: 0,
      },
    ],
    calibration: [
      {
        producer: "claude:sonnet",
        questionClass: "elf.imports",
        verified: 41,
        refuted: 2,
        unverifiable: 3,
        precision: 0.953,
        interval: [0.84, 0.99],
        status: "ok",
      },
      {
        producer: "claude:sonnet",
        questionClass: "archive.listing",
        verified: 7,
        refuted: 0,
        unverifiable: 1,
        precision: 1,
        interval: [0.59, 1],
        status: "insufficient",
      },
      {
        producer: "codex:gpt-5-codex",
        questionClass: "git.tag-diff",
        verified: 12,
        refuted: 6,
        unverifiable: 2,
        precision: 0.667,
        interval: [0.44, 0.84],
        status: "demoted",
      },
      {
        producer: "codex:gpt-5-codex",
        questionClass: "file.identify",
        verified: 2,
        refuted: 0,
        unverifiable: 0,
        precision: null,
        interval: [0, 1],
        status: "insufficient",
      },
    ],
    doctor: [
      { id: "node", ok: true, detail: "Node 22.22.0 (needs ≥ 22.12)", fix: null },
      { id: "store", ok: true, detail: "~/.assay/store.db, schema 4, WAL mode", fix: null },
      { id: "claude", ok: true, detail: "claude 2.3.1 at /usr/local/bin/claude", fix: null },
      { id: "codex", ok: true, detail: "codex 0.61.0; built-in shell tool stays on (partial enforcement)", fix: null },
      {
        id: "acp",
        ok: false,
        detail: "No ACP agent found on PATH",
        fix: "Install an ACP-capable agent (for example `npm i -g @google/gemini-cli`) and re-run doctor",
      },
      {
        id: "readelf",
        ok: false,
        detail: "readelf not found: elf.* probes are unavailable",
        fix: "Install binutils (apt install binutils / brew install binutils)",
      },
    ],
  };
}

export function pendingApproval(caseId: string, n: number): ApprovalView {
  return {
    id: `apr_${n}`,
    caseId,
    workerId: null,
    action: "exec: tar -tvzf dist/libfoo-2.4.1.tar.gz",
    detail: {
      program: "tar",
      args: ["-tvzf", "dist/libfoo-2.4.1.tar.gz"],
      cwd: "/home/dev/work/libfoo",
      timeoutMs: 10000,
    },
    reason: "effect: exec (session read untrusted content)",
    state: "pending",
    createdAt: Date.now(),
  };
}
