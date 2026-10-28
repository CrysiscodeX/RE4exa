// The 0.1.0 demo, end to end, as a person runs it: Assay's full stack (App, HTTP server, MCP,
// the demo agent) on a case holding five real binaries. The agent gets its facts from reax (the
// reax.* probes) and records claims, and Assay's verifier checks each one with core's own
// readers: true claims verified, false ones refuted. No account or network is needed.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { App } from "../src/app/app.ts";
import type { AppState, CaseDetail, CaseSummary } from "../src/server/api-types.ts";
import { tmp } from "./helpers.ts";

const FIXTURES = join(import.meta.dirname, "..", "..", "reax", "fixtures", "bin");
export const DEMO_FILES = [
  "hello-x86_64-linux-gnu.2.28-s",
  "lib-x86_64-linux-gnu.2.28-s.so",
  "hello-x86_64-windows-gnu-s.exe",
  "lib-aarch64-macos-s.dylib",
  "hello-universal-macos-s",
];

async function pair(base: string, pairingUrl: string) {
  const code = new URL(pairingUrl).hash.replace("#pair=", "");
  const r = await fetch(`${base}/api/pair`, {
    method: "POST",
    body: JSON.stringify({ code }),
    headers: { "content-type": "application/json" },
  });
  assert.equal(r.status, 200);
  const cookie = r.headers.get("set-cookie")!.split(";")[0]!;
  return async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { cookie, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const j = (await res.json()) as T;
    if (!res.ok) throw new Error(`HTTP ${res.status} ${JSON.stringify(j)}`);
    return j;
  };
}

test("demo 0.1.0: the agent examines five binaries with reax inside Assay, and every claim is checked", {
  timeout: 120_000,
}, async () => {
  const ws = tmp("assay-demo-ws-");
  const home = tmp("assay-demo-home-");
  mkdirSync(join(ws.dir, "bin"));
  for (const f of DEMO_FILES) copyFileSync(join(FIXTURES, f), join(ws.dir, "bin", f));
  const app = new App({ home: home.dir, workspace: ws.dir, demo: true });
  const server = await app.listen();
  let closed = false;
  try {
    const api = await pair(server.url, server.pairingUrl());
    const state = await api<AppState>("GET", "/api/state");
    const fake = state.accounts.find((a) => a.provider === "fake")!;
    assert.ok(
      state.recipes.some((r) => r.id === "examine-binary"),
      "the examine-binary recipe is offered",
    );
    const c = await api<CaseSummary>("POST", "/api/cases", {
      title: "five binaries",
      recipeId: "examine-binary",
      path: "bin",
    });
    const say = (text: string) =>
      api("POST", `/api/cases/${c.id}/messages`, { text, provider: "fake", accountId: fake.id });
    const settled = async (pred: (d: CaseDetail) => boolean) => {
      let d: CaseDetail | null = null;
      for (let i = 0; i < 400; i++) {
        d = await api<CaseDetail>("GET", `/api/cases/${c.id}`);
        if (pred(d) && d.summary.activity !== "working") return d;
        await new Promise((r) => setTimeout(r, 50));
      }
      return d!;
    };

    // 1. the agent reads the facts through reax
    await say("probe reax.inventory.native bin/hello-universal-macos-s");
    const afterProbe = await settled((d) => d.timeline.some((e) => e.kind === "assistant"));
    const answer = afterProbe.timeline
      .filter((e) => e.kind === "assistant")
      .map((e) => JSON.stringify(e))
      .join("\n");
    assert.match(answer, /reax\.inventory\.native/, "the agent's answer comes from the reax probe");
    assert.match(answer, /macho-fat/);
    assert.match(answer, /untrusted-content/, "target text reaches the model only inside the envelope");
    assert.match(answer, /ob_[0-9a-f]{64}/, "the result carries an evidence id to cite");
    assert.ok(
      afterProbe.timeline.some((e) => e.kind === "tool-call" && JSON.stringify(e).includes("assay_probe")),
      "the agent called the probe over MCP",
    );

    // 2. it records claims; Assay checks each with core's readers
    const claims: [string, object, "verified" | "refuted"][] = [
      ["native.arch", { path: "bin/hello-universal-macos-s", arch: "arm64" }, "verified"],
      ["native.arch", { path: "bin/hello-x86_64-windows-gnu-s.exe", arch: "aarch64" }, "refuted"],
      ["native.exports", { path: "bin/lib-aarch64-macos-s.dylib", symbol: "reax_add" }, "verified"],
      ["native.exports", { path: "bin/lib-x86_64-linux-gnu.2.28-s.so", symbol: "reax_hidden" }, "refuted"],
      ["native.links", { path: "bin/hello-x86_64-windows-gnu-s.exe", library: "KERNEL32.dll" }, "verified"],
      ["native.links", { path: "bin/hello-x86_64-linux-gnu.2.28-s", library: "libssl.so.3" }, "refuted"],
      ["file.identify", { path: "bin/lib-aarch64-macos-s.dylib", format: "macho" }, "verified"],
    ];
    for (const [i, [pred, params]] of claims.entries())
      await say(`claim ${pred} ${JSON.stringify(params)} demo claim ${i + 1}`);
    const done = await settled(
      (d) => d.claims.filter((x) => x.predicate && x.verdict !== null).length >= claims.length,
    );
    const got = done.claims.filter((x) => x.predicate);
    assert.equal(got.length, claims.length, JSON.stringify(got.map((x) => [x.predicate, x.verdict])));
    for (const [i, [pred, params, want]] of claims.entries()) {
      const match = got.find((x) => x.text === `demo claim ${i + 1}`);
      assert.ok(match, `${pred} ${JSON.stringify(params)} was recorded`);
      assert.equal(match!.predicate, pred);
      assert.equal(match!.verdict, want, `${pred} ${JSON.stringify(params)}: ${match!.reason}`);
      assert.ok(match!.observationId, "the verdict cites the evidence it was checked against");
    }
    assert.ok(done.chainIntact, "the case log is intact");

    // 3. the terminal summary: with the server stopped, the CLI exports the case's claims, each
    // with its verdict and the reason for it
    await app.close();
    closed = true;
    const cli = join(import.meta.dirname, "..", "src", "cli.ts");
    const assay = (...a: string[]) =>
      spawnSync(
        process.execPath,
        [
          "--conditions=source",
          "--disable-warning=ExperimentalWarning",
          cli,
          ...a,
          "--home",
          home.dir,
          "--workspace",
          ws.dir,
        ],
        { encoding: "utf8", timeout: 60_000 },
      );
    const list = assay("cases");
    assert.equal(list.status, 0, list.stderr);
    const line = list.stdout.split("\n").find((l) => l.includes("five binaries"));
    assert.ok(line, list.stdout);
    assert.match(line!, /4 ✔ verified, 3 ✖ refuted, 0 \? unverifiable, 0 · not checked/);
    const id = line!.split(/\s+/)[0]!;
    assert.equal(id, c.id);
    const out = assay("export", id, "--format", "md");
    assert.equal(out.status, 0, out.stderr);
    for (const [i, [, , want]] of claims.entries()) {
      const row = out.stdout.split("\n").find((l) => l.includes(`| demo claim ${i + 1} |`));
      assert.ok(row, `claim ${i + 1} is in the summary`);
      const reason = got.find((x) => x.text === `demo claim ${i + 1}`)!.reason!;
      assert.ok(row!.includes(want === "verified" ? "✔ verified" : "✖ refuted"), row);
      assert.ok(reason && row!.includes(reason.replaceAll("|", "\\|").replace(/\r?\n/g, " ")), row);
    }
    assert.match(out.stdout, /Log chain intact/);
  } finally {
    if (!closed) await app.close();
    ws.cleanup();
    home.cleanup();
  }
});
