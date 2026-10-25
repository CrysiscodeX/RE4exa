// Full stack: App + server + MCP + fake provider over real HTTP and WebSocket.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { WebSocket } from "ws";
import { App } from "../src/app/app.ts";
import type { AppState, CaseDetail, CaseSummary, ServerPush } from "../src/server/api-types.ts";
import { tmp } from "./helpers.ts";

async function client(base: string, pairingUrl: string) {
  const code = new URL(pairingUrl).hash.replace("#pair=", "");
  const r = await fetch(`${base}/api/pair`, {
    method: "POST",
    body: JSON.stringify({ code }),
    headers: { "content-type": "application/json" },
  });
  assert.equal(r.status, 200);
  const cookie = r.headers.get("set-cookie")!.split(";")[0]!;
  const api = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { cookie, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const j = (await res.json()) as T & { error?: unknown };
    if (!res.ok)
      throw Object.assign(new Error(`HTTP ${res.status} ${JSON.stringify(j)}`), { status: res.status, body: j });
    return j;
  };
  return { api, cookie };
}

function workspace(): { dir: string; cleanup: () => void } {
  const t = tmp("assay-ws-");
  const pkg = join(t.dir, "pkg");
  mkdirSync(pkg);
  writeFileSync(
    join(pkg, "package.json"),
    JSON.stringify({
      name: "demo",
      version: "1.0.0",
      scripts: { postinstall: "node setup.js" },
      dependencies: { leftpad: "1.3.0" },
    }),
  );
  writeFileSync(
    join(pkg, "setup.js"),
    'const https = require("https");\nhttps.get("https://telemetry.example.com/ping");\n',
  );
  writeFileSync(
    join(pkg, "index.js"),
    'import x from "./lib.js";\nconst w = new Worker(new URL("./worker.js", import.meta.url));\nexport default x;\n',
  );
  return t;
}

test("full stack: pair, chat with the fake provider, sweep, claims verified, workers, approvals, export", {
  timeout: 120_000,
}, async () => {
  const ws = workspace();
  const home = tmp("assay-home-");
  const app = new App({ home: home.dir, workspace: ws.dir, demo: true });
  const server = await app.listen();
  try {
    // refuse foreign origins and unpaired requests
    const bad = await fetch(`${server.url}/api/state`, { headers: { origin: "http://evil.example" } });
    assert.equal(bad.status, 403);
    const unpaired = await fetch(`${server.url}/api/state`);
    assert.equal(unpaired.status, 401);
    const reuse = server.pairingUrl();
    const { api } = await client(server.url, reuse);
    await assert.rejects(client(server.url, reuse), "a pairing code works once");

    const state = await api<AppState>("GET", "/api/state");
    assert.equal(state.firstRun, true);
    const fake = state.accounts.find((a) => a.provider === "fake")!;
    assert.ok(fake, "demo mode creates the fake account");

    // WebSocket with a single-use ticket
    const { ticket } = await api<{ ticket: string }>("POST", "/api/ws-ticket");
    const sock = new WebSocket(`${server.url.replace("http", "ws")}/api/ws?ticket=${ticket}`, {
      headers: { origin: server.url },
    });
    const pushes: ServerPush[] = [];
    sock.on("message", (d) => pushes.push(JSON.parse(String(d)) as ServerPush));
    await new Promise((r) => sock.once("open", r));

    const c = await api<CaseSummary>("POST", "/api/cases", {
      title: "demo package",
      recipeId: "investigate-package",
      path: "pkg",
    });
    const sweep = await api<{ evidence: string[]; questions: string[] }>("POST", `/api/cases/${c.id}/sweep`, {
      path: "pkg",
    });
    assert.ok(sweep.evidence.length >= 3);
    assert.ok(
      sweep.questions.some((q) => /install/i.test(q)),
      "the postinstall script becomes a question",
    );

    await api("POST", `/api/cases/${c.id}/messages`, { text: "sweep pkg", provider: "fake", accountId: fake.id });
    let detail: CaseDetail | null = null;
    for (let i = 0; i < 200; i++) {
      detail = await api<CaseDetail>("GET", `/api/cases/${c.id}`);
      if (detail.timeline.some((e) => e.kind === "assistant") && detail.summary.activity !== "working") break;
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(
      detail!.timeline.some((e) => e.kind === "assistant"),
      "the fake agent answered",
    );
    assert.ok(
      detail!.timeline.some((e) => e.kind === "tool-call"),
      "the fake agent called Assay tools over MCP",
    );
    assert.ok(detail!.chainIntact);

    // claims recorded by the agent are re-run by the verifier
    await api("POST", `/api/cases/${c.id}/messages`, {
      text: 'claim pkg.has-install-script {"path":"pkg/package.json","hook":"postinstall"} the package runs a postinstall script',
      provider: "fake",
      accountId: fake.id,
    });
    await api("POST", `/api/cases/${c.id}/messages`, {
      text: 'claim pkg.has-dependency {"path":"pkg/package.json","name":"lodash"} the package depends on lodash',
      provider: "fake",
      accountId: fake.id,
    });
    let claims: CaseDetail["claims"] = [];
    for (let i = 0; i < 200; i++) {
      claims = (await api<CaseDetail>("GET", `/api/cases/${c.id}`)).claims;
      const done = (pred: string) => claims.some((x) => x.predicate === pred && x.verdict !== null);
      if (done("pkg.has-install-script") && done("pkg.has-dependency")) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    const verdicts = Object.fromEntries(claims.filter((x) => x.predicate).map((x) => [x.predicate, x.verdict]));
    assert.equal(verdicts["pkg.has-install-script"], "verified");
    assert.equal(verdicts["pkg.has-dependency"], "refuted");

    // an exec request goes to approval; deny it
    await api("POST", `/api/cases/${c.id}/messages`, {
      text: "run node --version",
      provider: "fake",
      accountId: fake.id,
    });
    let approvalId: string | null = null;
    for (let i = 0; i < 200 && !approvalId; i++) {
      const d = await api<CaseDetail>("GET", `/api/cases/${c.id}`);
      approvalId = d.approvals.find((a) => a.state === "pending")?.id ?? null;
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(approvalId, "exec waits for approval");
    await api("POST", `/api/approvals/${approvalId}`, { decision: "deny" });

    // workers in parallel
    const w = await api<{ id: string }>("POST", `/api/cases/${c.id}/workers`, {
      task: "sweep pkg",
      provider: "fake",
      accountId: fake.id,
    });
    assert.ok(w.id);
    // fork, exports, usage, calibration, capabilities, doctor
    const fork = await api<CaseSummary>("POST", `/api/cases/${c.id}/fork`, { atSeq: 2 });
    assert.equal(fork.parentCase, c.id);
    const md = await fetch(`${server.url}/api/cases/${c.id}/export?format=md`, {
      headers: { cookie: (await client(server.url, server.pairingUrl())).cookie },
    });
    assert.match(await md.text(), /verified/);
    assert.ok(Array.isArray(await api("GET", "/api/usage")));
    assert.ok(Array.isArray(await api("GET", "/api/calibration")));
    assert.ok((await api<{ tools: unknown[] }>("GET", "/api/capabilities")).tools.length > 10);
    assert.ok((await api<unknown[]>("GET", "/api/doctor")).length > 3);
    assert.ok(pushes.some((p) => p.type === "timeline"));
    assert.ok(pushes.some((p) => p.type === "agent"));
    assert.ok(pushes.some((p) => p.type === "approval"));
    sock.close();
  } finally {
    await app.close();
    ws.cleanup();
    home.cleanup();
  }
});

test("a second server on the same store is refused", async () => {
  const home = tmp("assay-home-");
  const a = new App({ home: home.dir, workspace: home.dir });
  assert.throws(() => new App({ home: home.dir, workspace: home.dir }), /another assay process/i);
  await a.close();
  home.cleanup();
});

test("verifier re-runs of cmd.exit: approval first, allow-listed environment, secrets in output redacted", async () => {
  const { recordClaim, getEvidence } = await import("../src/evidence/store.ts");
  const home = tmp("assay-home-");
  const ws = workspace();
  process.env.ASSAY_TEST_SECRET = "should-not-reach-the-child";
  const app = new App({ home: home.dir, workspace: ws.dir });
  try {
    const c = app.kernel.createCase({ title: "cmd", workspace: ws.dir });
    const token = `ghp_${"a1B2".repeat(9)}`;
    const script = `console.log(process.env.ASSAY_TEST_SECRET ?? "env-clean"); console.log("${token}")`;
    const claim = recordClaim(app.kernel, c.id, "agent", {
      text: "the script exits 0",
      label: "seen",
      predicate: "cmd.exit",
      params: { program: process.execPath, args: ["-e", script], expect: 0 },
    });
    app.approvals.on("approval", (a: { id: string; state: string }) => {
      if (a.state === "pending") app.approvals.decide(a.id, "approve");
    });
    const v = await app.verifier.verify(c.id, claim);
    assert.equal(v.verdict, "verified", v.reason);
    const rec = getEvidence(app.kernel, v.observation_id!)!;
    const tail = JSON.stringify(rec.volatile);
    assert.ok(tail.includes("env-clean"), tail);
    assert.ok(!tail.includes(token), "the token-shaped output is stored only as a fingerprint");
  } finally {
    delete process.env.ASSAY_TEST_SECRET;
    await app.close();
    home.cleanup();
    ws.cleanup();
  }
});
