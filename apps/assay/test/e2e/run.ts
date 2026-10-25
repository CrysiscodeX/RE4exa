// End-to-end in a real browser against the real server (fake provider, no network):
// pair → set up → open a case → chat → MCP tools → verified/refuted chips → approve → workers →
// restart the server → the case, its claims and its chain survive. Screenshots in test-results/e2e/.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { App } from "../../src/app/app.ts";
import type { AppState, CaseSummary } from "../../src/server/api-types.ts";
import { tmp } from "../helpers.ts";

const require = createRequire(import.meta.url);
// biome-ignore lint/suspicious/noExplicitAny: Playwright's types are not a dependency of this package
const { chromium } = require("playwright") as { chromium: { launch(o?: object): Promise<any> } };
const OUT = join(import.meta.dirname, "..", "..", "test-results", "e2e");
mkdirSync(OUT, { recursive: true });

const ws = tmp("assay-e2e-ws-");
const home = tmp("assay-e2e-home-");
mkdirSync(join(ws.dir, "pkg"));
writeFileSync(
  join(ws.dir, "pkg", "package.json"),
  JSON.stringify(
    {
      name: "demo-pkg",
      version: "1.0.0",
      scripts: { postinstall: "node setup.js" },
      dependencies: { leftpad: "1.3.0" },
    },
    null,
    2,
  ),
);
writeFileSync(join(ws.dir, "pkg", "setup.js"), 'require("https").get("https://telemetry.example.com/ping");\n');

const t0 = Date.now();
let app = new App({ home: home.dir, workspace: ws.dir, demo: true });
let server = await app.listen();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const shot = (name: string) => page.screenshot({ path: join(OUT, `${name}.png`) });
const metrics: Record<string, number | string> = {};

try {
  await page.goto(server.pairingUrl());
  await page.getByRole("heading", { name: "Set up your workbench" }).waitFor({ timeout: 15_000 });
  await shot("01-wizard");
  await page.getByRole("button", { name: "Skip setup" }).click();
  const api = async <T>(method: string, path: string, body?: unknown): Promise<T> =>
    page.evaluate(
      async ([m, p, b]: [string, string, unknown]) => {
        const r = await fetch(p, {
          method: m,
          headers: { "content-type": "application/json" },
          body: b === undefined ? undefined : JSON.stringify(b),
        });
        return r.json();
      },
      [method, path, body] as [string, string, unknown],
    ) as Promise<T>;
  const state = await api<AppState>("GET", "/api/state");
  const fake = state.accounts.find((a) => a.provider === "fake")!;
  for (
    let i = 0;
    i < 50 && (await api<AppState>("GET", "/api/state")).accounts.find((x) => x.id === fake.id)?.status !== "signed-in";
    i++
  )
    await page.waitForTimeout(100);
  const c = await api<CaseSummary>("POST", "/api/cases", {
    title: "demo-pkg install behaviour",
    recipeId: "investigate-package",
    path: "pkg",
  });
  await page.reload();
  await page.locator(`[role="treeitem"][data-key="c:${c.id}"]`).click();
  await page.getByRole("heading", { level: 1, name: "demo-pkg install behaviour" }).waitFor();

  await page.getByRole("combobox", { name: "Provider" }).selectOption("fake");
  await page.getByRole("combobox", { name: /^Account/ }).selectOption(fake.id);
  const box = page.getByRole("textbox", { name: "Message to the coordinator" });
  await box.fill("sweep pkg");
  await box.press("Enter");
  await page
    .locator(".entry")
    .filter({ hasText: /Sweep|sweep/ })
    .first()
    .waitFor({ timeout: 20_000 });

  await box.fill(
    'claim pkg.has-install-script {"path":"pkg/package.json","hook":"postinstall"} demo-pkg runs a postinstall script',
  );
  await box.press("Enter");
  await page
    .getByRole("button", { name: /Claim verified: demo-pkg runs a postinstall script/ })
    .waitFor({ timeout: 20_000 });
  metrics.serve_to_first_verified_claim_ms = Date.now() - t0;
  await box.fill('claim pkg.has-dependency {"path":"pkg/package.json","name":"lodash"} demo-pkg depends on lodash');
  await box.press("Enter");
  await page.getByRole("button", { name: /Claim refuted: demo-pkg depends on lodash/ }).waitFor({ timeout: 20_000 });
  await shot("02-claims");

  await box.fill("run node --version");
  await box.press("Enter");
  const approve = page.getByRole("button", { name: "Approve", exact: true }).first();
  await approve.waitFor({ timeout: 20_000 });
  await shot("03-approval");
  await approve.click();

  await box.fill("spawn 2 workers: sweep pkg; read pkg/setup.js");
  await box.press("Enter");
  for (let i = 0; i < 100; i++) {
    const n = await page.locator('[role="treeitem"][data-key^="w:"]').count();
    if (n >= 2) break;
    await page.waitForTimeout(100);
  }
  assert.ok(
    (await page.locator('[role="treeitem"][data-key^="w:"]').count()) >= 2,
    "two workers appear under the case",
  );
  await shot("04-workers");

  // durability: stop the server, start a new one on the same store
  const before = await api<{ timeline: unknown[]; claims: { verdict: string | null }[] }>("GET", `/api/cases/${c.id}`);
  await app.close();
  app = new App({ home: home.dir, workspace: ws.dir, demo: true });
  server = await app.listen();
  await page.goto(server.pairingUrl());
  await page.getByRole("tree", { name: "Cases" }).waitFor({ timeout: 15_000 });
  await page.locator(`[role="treeitem"][data-key="c:${c.id}"]`).click();
  await page.getByText("Chain intact").waitFor();
  await page.getByRole("button", { name: /Claim verified: demo-pkg runs a postinstall script/ }).waitFor();
  const after = await api<{ timeline: unknown[]; claims: { verdict: string | null }[] }>("GET", `/api/cases/${c.id}`);
  assert.ok(after.timeline.length >= before.timeline.length, "the case log survived the restart");
  assert.deepEqual(
    after.claims.map((x) => x.verdict),
    before.claims.map((x) => x.verdict),
  );
  await shot("05-after-restart");
  metrics.result = "pass";
  writeFileSync(join(OUT, "metrics.json"), `${JSON.stringify(metrics, null, 2)}\n`);
  console.log(`e2e ok ${JSON.stringify(metrics)}`);
} catch (e) {
  await shot("failure").catch(() => undefined);
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser.close();
  await app.close();
  ws.cleanup();
  home.cleanup();
}
