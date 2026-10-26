import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Json } from "@re4exa/core/evidence/jcs";
import { caseClaims, listUnknowns } from "@re4exa/core/evidence/store";
import { ApprovalQueue } from "@re4exa/core/policy/approvals";
import type { ToolContext, ToolDef } from "../src/contracts.ts";
import { AssayError } from "../src/errors.ts";
import { checkArgs, createToolRegistry } from "../src/mcp/registry.ts";
import { TOOL_SPECS } from "../src/mcp/tools.ts";
import { stubEngine } from "./fixtures/tripwire/_support/stub-engine.ts";
import { openTemp } from "./helpers.ts";

interface Asked {
  action: string;
  detail: Json;
}

function setup(opts: { extraTools?: ToolDef[]; verifier?: boolean } = {}) {
  const { k, cleanup } = openTemp();
  const ws = mkdtempSync(join(tmpdir(), "assay-ws-"));
  writeFileSync(join(ws, "README.md"), "# Demo\nhello world\n");
  mkdirSync(join(ws, "src"));
  writeFileSync(join(ws, "src", "a.ts"), "export const answer = 42;\n// TODO: fix\n");
  const c = k.createCase({ title: "t", workspace: ws });
  const approvals = new ApprovalQueue(k);
  const engine = stubEngine(k, ws);
  let spawns = 0;
  const reg = createToolRegistry({
    kernel: k,
    engine,
    approvals,
    workspace: ws,
    extraTools: opts.extraTools,
    verifier: opts.verifier ? { verify: async (i) => ({ verified: 1, caseId: i.caseId }) } : undefined,
    runProcess: async (spec) => {
      spawns++;
      const { runProcess } = await import("@re4exa/core/vendor/orca-process-host/run-process");
      return runProcess(spec);
    },
  });
  const asked: Asked[] = [];
  let answer: "approve" | "deny" = "deny";
  const ctx = (caller = "coordinator"): ToolContext => ({
    caseId: c.id,
    caller,
    workspace: ws,
    signal: new AbortController().signal,
    approve: async (action, detail) => {
      asked.push({ action, detail });
      if (answer === "deny") throw new AssayError("approval_denied", { action });
    },
  });
  return {
    k,
    ws,
    c,
    reg,
    engine,
    approvals,
    asked,
    ctx,
    spawns: () => spawns,
    setAnswer: (a: "approve" | "deny") => {
      answer = a;
    },
    cleanup: () => {
      approvals.close();
      cleanup();
      rmSync(ws, { recursive: true, force: true });
    },
  };
}

const errCode = (r: { isError?: boolean; data?: Json }) =>
  r.isError ? ((r.data as { code?: string } | undefined)?.code ?? null) : null;

test("list hides coordinatorOnly tools from workers; calling one is tool_not_permitted", async () => {
  const extra: ToolDef = {
    name: "assay_spawn_worker",
    description: "x",
    inputSchema: { type: "object", properties: {} },
    effect: "spawn",
    coordinatorOnly: true,
    handler: async () => ({ text: "spawned" }),
  };
  const s = setup({ extraTools: [extra] });
  try {
    assert.ok(s.reg.list("coordinator").some((t) => t.name === "assay_spawn_worker"));
    assert.ok(!s.reg.list("w1").some((t) => t.name === "assay_spawn_worker"));
    assert.equal(s.reg.list("w1").length, TOOL_SPECS.length);
    assert.equal(errCode(await s.reg.call(s.ctx("w1"), "assay_spawn_worker", {})), "tool_not_permitted");
    assert.equal((await s.reg.call(s.ctx(), "assay_spawn_worker", {})).text, "spawned");
    assert.equal(errCode(await s.reg.call(s.ctx(), "assay_nope", {})), "not_found");
    for (const t of s.reg.tools) assert.ok(t.name.startsWith("assay_") && t.description.length <= 120, t.name);
  } finally {
    s.cleanup();
  }
});

test("arguments are checked against the schema with actionable errors", async () => {
  const s = setup();
  try {
    const r = await s.reg.call(s.ctx(), "assay_read_file", { path: 3 } as never);
    assert.equal(errCode(r), "bad_request");
    const body = JSON.parse(r.text) as { fix: string; detail: { why: string } };
    assert.match(body.detail.why, /path must be string/);
    assert.ok(body.fix.length > 0);
    assert.match(checkArgs(TOOL_SPECS[0]!.inputSchema, {}) ?? "", /probe is required/);
    assert.match(checkArgs(TOOL_SPECS[0]!.inputSchema, { probe: "a", path: "b", zz: 1 }) ?? "", /unknown argument zz/);
    assert.equal(
      errCode(await s.reg.call(s.ctx(), "assay_record_claim", { text: "x", label: "maybe" })),
      "bad_request",
    );
  } finally {
    s.cleanup();
  }
});

test("reads are enveloped and taint the caller; effects then need approval with an untrusted reason", async () => {
  const s = setup();
  try {
    // Auto-approve exec in this case: an untainted caller runs without a prompt.
    s.approvals.addRule(s.c.id, { tool: "assay_exec" });
    const pre = await s.reg.call(s.ctx("w1"), "assay_exec", {
      program: process.execPath,
      args: ["-e", "process.stdout.write('hi')"],
    });
    assert.equal(pre.isError, undefined, pre.text);
    assert.equal(s.asked.length, 0);
    assert.equal(s.spawns(), 1);
    assert.match(pre.text, /^<untrusted-content id="u-[0-9a-f]+" origin="exec:/);
    assert.match(pre.text, /hi/);
    assert.match(pre.text, /\[assay: exit 0\]$/);
    // exec output is untrusted too, so w1 is now tainted.
    assert.equal(s.reg.taint.isTainted(s.c.id, "w1"), true);

    const read = await s.reg.call(s.ctx("w2"), "assay_read_file", { path: "README.md" });
    assert.match(
      read.text,
      /^<untrusted-content id="u-[0-9a-f]{24}" origin="file:README.md">\n# Demo\nhello world\n\n<\/untrusted-content id="u-[0-9a-f]{24}">\n\[assay: README.md bytes 0..19 of 19\]$/,
    );
    assert.equal(read.untrusted, true);
    assert.equal(s.reg.taint.isTainted(s.c.id, "w2"), true);
    const blocked = await s.reg.call(s.ctx("w2"), "assay_exec", { program: "touch", args: ["PWNED"] });
    assert.equal(errCode(blocked), "approval_denied");
    assert.equal(s.asked.length, 1);
    assert.equal(s.asked[0]!.action, "assay_exec");
    assert.match(
      (s.asked[0]!.detail as { reason: string }).reason,
      /session read untrusted content \(file:README\.md\)/,
    );
    assert.equal(s.spawns(), 1);
    assert.ok(!existsSync(join(s.ws, "PWNED")));

    // Approved: it runs.
    s.setAnswer("approve");
    const ok = await s.reg.call(s.ctx("w2"), "assay_write_file", { path: "out/note.txt", content: "hi" });
    assert.equal(ok.isError, undefined, ok.text);
    assert.equal(readFileSync(join(s.ws, "out", "note.txt"), "utf8"), "hi");
    assert.match((s.asked[1]!.detail as { reason: string }).reason, /^effect write; session read untrusted content/);

    // evenWhenTainted rule: no prompt even for a tainted caller.
    s.approvals.addRule(s.c.id, { tool: "assay_write_file", evenWhenTainted: true });
    await s.reg.call(s.ctx("w2"), "assay_write_file", { path: "out/n2.txt", content: "x" });
    assert.equal(s.asked.length, 2);
    // A deny rule refuses outright.
    s.approvals.addRule(s.c.id, { tool: "assay_write_file", action: "deny" });
    assert.equal(
      errCode(await s.reg.call(s.ctx("w3"), "assay_write_file", { path: "z", content: "x" })),
      "approval_denied",
    );
    assert.equal(s.asked.length, 2);
  } finally {
    s.cleanup();
  }
});

test("path guard: outside paths, symlink escapes and .git writes are refused", async () => {
  const s = setup();
  const outside = mkdtempSync(join(tmpdir(), "assay-out-"));
  try {
    writeFileSync(join(outside, "secret.txt"), "top secret");
    symlinkSync(join(outside, "secret.txt"), join(s.ws, "link.txt"));
    symlinkSync(outside, join(s.ws, "linkdir"));
    mkdirSync(join(s.ws, ".git", "hooks"), { recursive: true });
    symlinkSync(join(s.ws, ".git"), join(s.ws, "docs")); // docs -> .git: a write to docs/hooks/x lands in .git
    s.setAnswer("approve");
    for (const p of ["../x", "/etc/passwd", "link.txt", "linkdir/secret.txt"])
      assert.equal(errCode(await s.reg.call(s.ctx(), "assay_read_file", { path: p })), "path_outside_workspace", p);
    for (const p of [
      "../evil",
      "linkdir/new.txt",
      "link.txt",
      ".git/hooks/pre-commit",
      ".GIT/hooks/pre-commit",
      ".git./hooks/pre-commit",
      "docs/hooks/pre-commit",
      "docs/config",
    ])
      assert.equal(
        errCode(await s.reg.call(s.ctx(), "assay_write_file", { path: p, content: "x" })),
        "path_outside_workspace",
        p,
      );
    assert.equal(readFileSync(join(outside, "secret.txt"), "utf8"), "top secret");
    assert.ok(!existsSync(join(outside, "new.txt")));
    assert.ok(!existsSync(join(s.ws, ".git", "hooks", "pre-commit")));
    assert.equal(errCode(await s.reg.call(s.ctx(), "assay_read_file", { path: "missing.txt" })), "path_not_found");
    assert.equal(
      errCode(await s.reg.call(s.ctx(), "assay_exec", { program: "ls", args: [], cwd: "../" })),
      "path_outside_workspace",
    );
  } finally {
    rmSync(outside, { recursive: true, force: true });
    s.cleanup();
  }
});

test("large results stay under 8 KB with one payload copy behind a handle; assay_fetch pages it, enveloped", async () => {
  const s = setup();
  try {
    const big = Array.from({ length: 2000 }, (_, i) => `row ${i} ${"x".repeat(40)}`).join("\n");
    writeFileSync(join(s.ws, "big.txt"), big);
    const r = await s.reg.call(s.ctx(), "assay_read_file", { path: "big.txt" });
    assert.ok(Buffer.byteLength(r.text) <= 8192, String(Buffer.byteLength(r.text)));
    assert.ok(r.handle?.startsWith("h_"));
    assert.ok(!JSON.stringify(r.data).includes("row 1"), "data must not repeat the payload");
    assert.equal(s.reg.handles.size, 1);
    let next: number | null = Number(/"offset":(\d+)/.exec(r.text)![1]);
    let assembled = r.text.slice(r.text.indexOf(">\n") + 2, r.text.indexOf("\n</untrusted-content"));
    const ids = new Set<string>();
    while (next !== null) {
      const p = await s.reg.call(s.ctx(), "assay_fetch", { handle: r.handle!, offset: next });
      assert.ok(Buffer.byteLength(p.text) <= 8192);
      const m = /^<untrusted-content id="(u-[0-9a-f]+)"[^>]*>\n([\s\S]*)\n<\/untrusted-content id="\1">\n/.exec(p.text);
      assert.ok(m, p.text.slice(0, 100));
      ids.add(m[1]!);
      assembled += m[2]!;
      next = (p.data as { next: number | null }).next;
    }
    assert.equal(assembled, big);
    assert.ok(ids.size > 3);
    assert.equal(errCode(await s.reg.call(s.ctx(), "assay_fetch", { handle: "h_bogus" })), "handle_unknown");
  } finally {
    s.cleanup();
  }
});

test("secrets in untrusted output are redacted before they reach the model", async () => {
  const s = setup();
  try {
    const tok = `ghp_${"Zx9".repeat(12)}`;
    writeFileSync(join(s.ws, ".env"), `GITHUB_TOKEN=${tok}\n`);
    const r = await s.reg.call(s.ctx(), "assay_read_file", { path: ".env" });
    assert.ok(!r.text.includes(tok));
    assert.match(r.text, /\[redacted:github-token:[0-9a-f]{8}\]/);
    assert.match(r.text, /1 secret\(s\) redacted/);
  } finally {
    s.cleanup();
  }
});

test("search, probe, evidence, claims and unknowns", async () => {
  const s = setup({ verifier: true });
  try {
    const sr = await s.reg.call(s.ctx(), "assay_search", { pattern: "TODO|answer" });
    assert.match(sr.text, /src\/a\.ts:1: export const answer = 42;/);
    assert.match(sr.text, /src\/a\.ts:2: \/\/ TODO: fix/);
    assert.equal(sr.untrusted, true);
    const fn = await s.reg.call(s.ctx(), "assay_search", { pattern: "a\\.ts$" });
    assert.match(fn.text, /src\/a\.ts: \(file name matches\)/);
    const bad = await s.reg.call(s.ctx(), "assay_search", { pattern: "(" });
    assert.equal(bad.isError, undefined);

    const lp = await s.reg.call(s.ctx(), "assay_list_probes", {});
    assert.match(lp.text, /file\.strings@1/);
    assert.equal(lp.untrusted, undefined);
    const pr = await s.reg.call(s.ctx(), "assay_probe", { probe: "file.strings", path: "src/a.ts" });
    assert.equal(pr.isError, undefined, pr.text);
    const obs = (pr.data as { observation_id: string }).observation_id;
    assert.match(obs, /^ob_[0-9a-f]{64}$/);
    assert.match(pr.text, /^<untrusted-content/);
    assert.equal(
      errCode(await s.reg.call(s.ctx(), "assay_probe", { probe: "nope", path: "src/a.ts" })),
      "probe_unknown",
    );
    const sw = await s.reg.call(s.ctx(), "assay_sweep", { path: "README.md" });
    assert.match(sw.text, /1 evidence/);

    const le = await s.reg.call(s.ctx(), "assay_list_evidence", {});
    assert.match(le.text, new RegExp(obs));
    const ge = await s.reg.call(s.ctx(), "assay_get_evidence", { observation_id: obs });
    assert.match(ge.text, /answer = 42/);
    assert.equal(
      errCode(await s.reg.call(s.ctx(), "assay_get_evidence", { observation_id: `ob_${"0".repeat(64)}` })),
      "evidence_missing",
    );

    const cl = await s.reg.call(s.ctx("w1"), "assay_record_claim", {
      text: "a.ts exports answer",
      label: "seen",
      predicate: "file.strings",
      path: "src/a.ts",
      cites: [obs],
    });
    assert.equal(cl.isError, undefined, cl.text);
    const claims = caseClaims(s.k, s.c.id);
    assert.equal(claims.length, 1);
    assert.equal(claims[0]!.author, "w1");
    assert.deepEqual(claims[0]!.claim.subject, { path: "src/a.ts" });
    assert.equal(
      errCode(await s.reg.call(s.ctx(), "assay_record_claim", { text: "x", label: "seen", cites: ["ob_missing"] })),
      "evidence_missing",
    );

    const ou = await s.reg.call(s.ctx(), "assay_open_unknown", { question: "Is it signed?" });
    const { id, rev } = ou.data as { id: string; rev: number };
    assert.equal(
      errCode(await s.reg.call(s.ctx(), "assay_resolve_unknown", { id, rev: 5, answer: "no", evidence: [obs] })),
      "unknown_conflict",
    );
    const ru = await s.reg.call(s.ctx(), "assay_resolve_unknown", { id, rev, answer: "no", evidence: [obs] });
    assert.equal(ru.isError, undefined, ru.text);
    assert.equal(listUnknowns(s.k, s.c.id)[0]!.status, "resolved");

    const v = await s.reg.call(s.ctx(), "assay_verify", {});
    assert.match(v.text, /verified/);
  } finally {
    s.cleanup();
  }
});

test("exec: argv only, bounded, minimal environment; handler errors become tool_failed", async () => {
  const s = setup();
  try {
    s.setAnswer("approve");
    process.env.ASSAY_TEST_SECRET_ENV = "should-not-leak";
    const r = await s.reg.call(s.ctx(), "assay_exec", {
      program: process.execPath,
      args: [
        "-e",
        "console.log(JSON.stringify([process.argv[1], process.env.ASSAY_TEST_SECRET_ENV ?? null]))",
        "a; touch PWNED",
      ],
    });
    delete process.env.ASSAY_TEST_SECRET_ENV;
    assert.match(r.text, /\["a; touch PWNED",null\]/);
    assert.ok(!existsSync(join(s.ws, "PWNED")));
    const slow = await s.reg.call(s.ctx(), "assay_exec", {
      program: process.execPath,
      args: ["-e", "setTimeout(() => {}, 5000)"],
      timeoutMs: 200,
    });
    assert.match(slow.text, /timed out/);
    assert.equal((slow.data as { timedOut: boolean }).timedOut, true);
    const missing = await s.reg.call(s.ctx(), "assay_exec", { program: "/nonexistent/program", args: [] });
    assert.equal(errCode(missing), "tool_failed");
    assert.equal(
      errCode(await s.reg.call(s.ctx(), "assay_exec", { program: "ls", args: [], timeoutMs: 60_000 })),
      "bad_request",
    );
  } finally {
    s.cleanup();
  }
});

test("a missing path suggests similar paths in the error the agent reads", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { suggestPaths, pathNotFound } = await import("@re4exa/core/mcp/suggest");
  const root = mkdtempSync(join(tmpdir(), "assay-suggest-"));
  mkdirSync(join(root, "postinstall", "evil-helper"), { recursive: true });
  writeFileSync(join(root, "postinstall", "evil-helper", "package.json"), "{}");
  writeFileSync(join(root, "postinstall", "evil-helper-1.0.0.tgz"), "x");
  assert.deepEqual(suggestPaths(root, "evil-helper").slice(0, 2), [
    "postinstall/evil-helper",
    "postinstall/evil-helper-1.0.0.tgz",
  ]);
  const e = pathNotFound(root, "evil-helper");
  assert.equal(e.code, "path_not_found");
  assert.match(e.message, /Did you mean: postinstall\/evil-helper/);
  assert.deepEqual(suggestPaths(root, "zzzz-nothing"), []);
  rmSync(root, { recursive: true, force: true });
});

test("approval cards show arguments in full up to 256 KiB, and flag longer ones as partial with a digest", async () => {
  const { summarizeArgs, APPROVAL_SHOW_MAX } = await import("../src/mcp/registry.ts");
  const small = "a".repeat(5000);
  assert.equal((summarizeArgs({ content: small }) as Record<string, Json>).content, small);
  const big = `${"b".repeat(APPROVAL_SHOW_MAX)}TAIL`;
  const out = summarizeArgs({ path: "x", content: big }) as Record<string, Json>;
  assert.deepEqual(out.partial, ["content"]);
  const c = out.content as Record<string, Json>;
  assert.equal(c.chars, big.length);
  assert.match(String(c.sha256), /^[0-9a-f]{64}$/);
  assert.ok(String(c.tail).endsWith("TAIL"));
});
