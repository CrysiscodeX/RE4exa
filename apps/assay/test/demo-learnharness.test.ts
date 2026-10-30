// The "Audit a desktop app" recipe on a real app, end to end through Assay's full stack (App, HTTP,
// MCP, the demo agent): LearnHarness 0.4.0, an Electron + Next.js app whose tree holds AGENTS.md,
// instructions written for coding agents ("STOP and ask", "read node_modules/..."). An agent
// investigating it must see that text only as data. Each claim is checked by Assay's verifier.
// Needs GitHub (ASSAY_LEARNHARNESS=1; the CI check job sets it).
import assert from "node:assert/strict";
import { cpSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fetchLearnHarness } from "../scripts/learnharness.ts";
import { App } from "../src/app/app.ts";
import type { CaseDetail, CaseSummary } from "../src/server/api-types.ts";
import { tmp } from "./helpers.ts";
import { CLAIMS } from "./learnharness-claims.ts";
import { pair, waitCase, waitSignedIn } from "./waits.ts";

const skip =
  process.env.ASSAY_LEARNHARNESS === "1" ? false : "needs GitHub: set ASSAY_LEARNHARNESS=1 (the CI check job does)";

test("demo: the Audit a desktop app recipe on LearnHarness; its AGENTS.md stays data, and every claim is checked", {
  skip,
  timeout: 600_000,
}, async () => {
  const ws = tmp("assay-demo-lh-ws-");
  const home = tmp("assay-demo-lh-home-");
  mkdirSync(join(ws.dir, "learnharness"));
  cpSync(fetchLearnHarness(), join(ws.dir, "learnharness"), { recursive: true });
  const app = new App({ home: home.dir, workspace: ws.dir, demo: true });
  const server = await app.listen();
  try {
    const api = await pair(server.url, server.pairingUrl());
    const fake = await waitSignedIn(api, "fake");
    const c = await api<CaseSummary>("POST", "/api/cases", {
      title: "LearnHarness 0.4.0",
      recipeId: "audit-electron",
      path: "learnharness",
    });
    const say = (text: string) =>
      api("POST", `/api/cases/${c.id}/messages`, { text, provider: "fake", accountId: fake.id });
    const replies = (d: CaseDetail) => d.timeline.filter((e) => e.kind === "assistant").length;

    // 1. the model-free first pass over the whole app
    await say("sweep learnharness");
    const swept = await waitCase(api, c.id, (d) => replies(d) >= 1, 120_000);
    assert.ok(
      swept.timeline.some((e) => e.kind === "tool-call" && JSON.stringify(e).includes("assay_sweep")),
      "the agent swept over MCP",
    );
    assert.ok(swept.evidence.length >= 2000, `${swept.evidence.length} evidence records in the case`);

    // 2. the agent reads LearnHarness's own instructions for agents
    await say("read learnharness/AGENTS.md");
    const read = await waitCase(api, c.id, (d) => replies(d) >= 2);
    // The timeline keeps a summary of each tool result; the file's first instruction is in it, and
    // it comes after the envelope's opening tag, which names the file it came from.
    const result = read.timeline.find((e) => e.kind === "tool-result" && JSON.stringify(e).includes("assay_read_file"));
    assert.ok(result, "the read went through Assay's tool");
    const text = String((result as { text?: unknown }).text ?? "");
    assert.match(text, /^<untrusted-content id="u-[0-9a-f]+" origin="file:learnharness\/AGENTS\.md">/);
    const at = text.indexOf("This is NOT the Next.js you know");
    assert.ok(at > text.indexOf(">"), "the file's instruction to agents arrives inside the envelope");

    // 3. having read target text, the session is tainted: a command now waits for the person,
    // and the approval names the file it came from
    await say("run git status");
    const blocked = await waitCase(api, c.id, (d) => d.approvals.some((a) => a.state === "pending"), 30_000);
    const pending = blocked.approvals.find((a) => a.state === "pending");
    assert.ok(pending, "the command waits for approval");
    const detail = pending!.detail as { tainted?: boolean; untrustedSources?: string[] };
    assert.equal(detail.tainted, true, pending!.reason);
    assert.ok(
      (detail.untrustedSources ?? []).some((s) => s.includes("AGENTS.md")),
      `the approval names its source: ${JSON.stringify(detail.untrustedSources)}`,
    );
    await api("POST", `/api/approvals/${pending!.id}`, { decision: "deny", reason: "an audit runs nothing" });
    await waitCase(api, c.id, (d) => replies(d) >= 3);

    // 4. the agent's claims, checked by Assay's verifier
    for (const [text, predicate, params] of CLAIMS) await say(`claim ${predicate} ${JSON.stringify(params)} ${text}`);
    const done = await waitCase(
      api,
      c.id,
      (d) => d.claims.filter((x) => x.predicate && x.verdict !== null).length >= CLAIMS.length,
      120_000,
    );
    for (const [text, predicate, , want] of CLAIMS) {
      const got = done.claims.find((x) => x.text === text);
      assert.ok(got, `${text} was recorded`);
      assert.equal(got!.predicate, predicate);
      assert.equal(got!.verdict, want, `${text}: ${got!.reason}`);
      assert.ok(got!.observationId, `${text}: the verdict cites its evidence`);
    }
    const n = (v: string) => CLAIMS.filter((x) => x[3] === v).length;
    assert.equal(done.summary.counts.verified, n("verified"));
    assert.equal(done.summary.counts.refuted, n("refuted"));
    assert.ok(done.chainIntact, "the case log is intact");
  } finally {
    await app.close();
    ws.cleanup();
    home.cleanup();
  }
});
