// UI smoke test: builds the UI, starts the mock server, and drives the app in Chromium through pairing,
// the wizard, a full coordinator turn (streaming, approval, claims, evidence), worker tabs, forking, the
// command palette and theme switching. Runs axe-core in both themes and saves screenshots.

import assert from "node:assert/strict";
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SHOTS = join(ROOT, "test-results", "ui");
const AXE = readFileSync(join(ROOT, "node_modules", "axe-core", "axe.min.js"), "utf8");

// Playwright is preinstalled globally; typed loosely so the test does not need its type package.
interface Locator {
  click(o?: object): Promise<void>;
  hover(): Promise<void>;
  fill(v: string): Promise<void>;
  press(k: string): Promise<void>;
  waitFor(o?: object): Promise<void>;
  textContent(): Promise<string | null>;
  getAttribute(n: string): Promise<string | null>;
  count(): Promise<number>;
  first(): Locator;
  filter(o: object): Locator;
  locator(s: string): Locator;
  getByRole(r: string, o?: object): Locator;
  getByText(t: string | RegExp, o?: object): Locator;
}
interface Page {
  goto(u: string): Promise<unknown>;
  evaluate<T>(f: string | (() => T)): Promise<T>;
  screenshot(o: object): Promise<unknown>;
  locator(s: string): Locator;
  getByRole(r: string, o?: object): Locator;
  getByText(t: string | RegExp, o?: object): Locator;
  keyboard: { press(k: string): Promise<void>; type(t: string): Promise<void> };
  waitForFunction(f: string, a?: unknown, o?: object): Promise<unknown>;
  on(e: string, cb: (x: { type(): string; text(): string }) => void): void;
  setViewportSize(s: { width: number; height: number }): Promise<void>;
}
interface Browser {
  newContext(o?: object): Promise<{ newPage(): Promise<Page>; close(): Promise<void> }>;
  close(): Promise<void>;
}

let server: ChildProcess | null = null;
let browser: Browser | null = null;
let page: Page;
let base = "";
const consoleErrors: string[] = [];

interface AxeResult {
  violations: {
    id: string;
    impact: string | null;
    help: string;
    nodes: { target: string[]; failureSummary?: string }[];
  }[];
}

async function axe(p: Page, label: string): Promise<AxeResult["violations"]> {
  await p.evaluate(AXE);
  const r = (await p.evaluate("axe.run(document, { resultTypes: ['violations'] })")) as AxeResult;
  const bad = r.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  for (const v of bad)
    console.log(
      `[axe ${label}] ${v.impact} ${v.id}: ${v.help}\n${v.nodes
        .slice(0, 5)
        .map((n) => `   ${n.target.join(" ")} :: ${n.failureSummary ?? ""}`)
        .join("\n")}`,
    );
  const minor = r.violations.filter((v) => !bad.includes(v));
  for (const v of minor)
    console.log(`[axe ${label}] ${v.impact} ${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`);
  if (minor.length) console.log(`[axe ${label}] minor: ${minor.map((v) => `${v.id}(${v.impact})`).join(", ")}`);
  return bad;
}

before(async () => {
  mkdirSync(SHOTS, { recursive: true });
  if (!process.env.ASSAY_UI_SKIP_BUILD) execFileSync("npx", ["vite", "build", "ui"], { cwd: ROOT, stdio: "pipe" });
  server = spawn(
    process.execPath,
    ["ui/mock/server.ts", "--port", "0", "--pair-code", "smoke-code", "--speed", "0.5"],
    {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "inherit"],
    },
  );
  base = await new Promise<string>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("mock server did not start")), 15_000);
    server!.stdout!.on("data", (b: Buffer) => {
      const m = b.toString().match(/http:\/\/127\.0\.0\.1:(\d+)\//);
      if (m) {
        clearTimeout(t);
        resolve(`http://127.0.0.1:${m[1]}`);
      }
    });
  });
  const { chromium } = require("playwright") as { chromium: { launch(): Promise<Browser> } };
  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  page = await ctx.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
});

after(async () => {
  await browser?.close();
  server?.kill();
});

test("unpaired browser sees how to pair", async () => {
  const ctx = await browser!.newContext();
  const p = await ctx.newPage();
  await p.goto(`${base}/`);
  await p.getByRole("heading", { name: "Pair this browser with Assay" }).waitFor();
  await p.getByText("assay serve").first().waitFor();
  await ctx.close();
});

test("pairing clears the hash and shows the first-run wizard", async () => {
  await page.goto(`${base}/#pair=smoke-code`);
  await page.getByRole("heading", { name: "Set up your workbench" }).waitFor();
  assert.equal(await page.evaluate(() => location.hash), "");
  await page.getByText("Codex keeps its built-in shell tool", { exact: false }).waitFor();
  await page.screenshot({ path: join(SHOTS, "wizard.png") });
  const bad = await axe(page, "wizard");
  assert.equal(bad.length, 0, `wizard axe: ${bad.map((v) => v.id).join(", ")}`);
});

test("skip the wizard and open a case", async () => {
  await page.getByRole("button", { name: "Skip setup" }).click();
  await page.getByRole("tree", { name: "Cases" }).waitFor();
  await page.locator('[role="treeitem"][data-key="c:c1"]').click();
  await page.getByRole("heading", { level: 1, name: "libfoo 2.4.1 release audit" }).waitFor();
  await page.getByText("Chain intact").waitFor();
  // existing claim chips from the history
  await page.getByRole("button", { name: /Claim verified: lib\/libfoo\.so\.2 links against libcrypto/ }).waitFor();
});

test("send a message, see streaming text, approve, see claim chips", async () => {
  await page.evaluate(() => {
    const w = window as unknown as { __announced: string[] };
    w.__announced = [];
    const live = document.querySelector('[aria-live="polite"][aria-atomic="true"]');
    if (live)
      new MutationObserver(() => w.__announced.push(live.textContent ?? "")).observe(live, {
        childList: true,
        characterData: true,
        subtree: true,
      });
  });
  const box = page.getByRole("textbox", { name: "Message to the coordinator" });
  await box.fill("Diff the symbols against 2.4.0 and check the build scripts.");
  await page.locator(".estimate").getByText(/~\$/).waitFor();
  await box.press("Enter");
  await page
    .locator(".entry-streaming")
    .getByText(/split this across two workers/)
    .waitFor();
  const approve = page.getByRole("button", { name: "Approve", exact: true }).first();
  await approve.waitFor({ timeout: 15_000 });
  await page
    .getByText(/Approval needed: exec: tar/)
    .first()
    .waitFor();
  const badApproval = await axe(page, "approval pending");
  assert.equal(badApproval.length, 0, `approval axe: ${badApproval.map((v) => v.id).join(", ")}`);
  await approve.click();
  await page.getByText("approved", { exact: true }).first().waitFor();
  await page
    .getByRole("button", { name: /Claim refuted: bin\/foo-cli is statically linked/ })
    .waitFor({ timeout: 20_000 });
  await page
    .getByRole("button", { name: /Claim unverifiable: The default build does not access the network/ })
    .waitFor();
  await page.getByRole("button", { name: /Claim verified: libfoo 2\.4\.1 adds 3 exported symbols/ }).waitFor();
  await page.waitForFunction("window.__announced.some((t) => t.startsWith('Turn in'))");
  const said = await page.evaluate(() => (window as unknown as { __announced: string[] }).__announced);
  assert.ok(
    said.some((t) => t.startsWith("Approval needed: exec")),
    `live region said: ${said.join(" | ")}`,
  );
});

test("claim chip opens its evidence in the inspector", async () => {
  await page.getByRole("button", { name: /Claim refuted: bin\/foo-cli is statically linked/ }).click();
  const rec = page.getByRole("region", { name: "Evidence record" });
  await rec.waitFor();
  await rec.getByText(/"predicate": "elf\.dynamic"/).waitFor();
  await rec.getByText("bin/foo-cli").first().waitFor();
  await page.screenshot({ path: join(SHOTS, "inspector.png") });
});

test("open a worker tab from the worker tree", async () => {
  await page.getByRole("treeitem", { name: /Diff exported symbols/ }).click();
  const tab = page.getByRole("tab", { name: /Diff exported symbols/ });
  await tab.waitFor();
  assert.equal(await tab.getAttribute("aria-selected"), "true");
  await page
    .getByRole("tabpanel")
    .getByText(/3 symbols were added/)
    .first()
    .waitFor();
  await page.screenshot({ path: join(SHOTS, "worker-tab.png") });
  // Raw tab lazily loads xterm and shows the agent event log
  await page.getByRole("tab", { name: "Raw" }).click();
  await page
    .locator(".xterm-rows")
    .getByText(/tool-call/)
    .first()
    .waitFor();
  await page.getByRole("tab", { name: /Coordinator/ }).click();
});

test("fork from a timeline entry", async () => {
  const entry = page.locator('.entry[data-seq="2"]');
  await entry.hover();
  await page.getByRole("button", { name: "Fork from step 2", exact: true }).click();
  await page.getByRole("heading", { level: 1, name: /\(fork @2\)/ }).waitFor();
  await page.getByRole("treeitem", { name: /fork @2/ }).waitFor();
  // back to the original case for the theme screenshots
  await page.locator('[role="treeitem"][data-key="c:c1"]').click();
  await page.getByRole("heading", { level: 1, name: "libfoo 2.4.1 release audit" }).waitFor();
});

test("keyboard: sidebar arrows and Escape closes the palette", async () => {
  await page.getByRole("treeitem", { selected: true }).first().click();
  await page.keyboard.press("ArrowDown");
  const focused = await page.evaluate(() => document.activeElement?.getAttribute("role"));
  assert.equal(focused, "treeitem");
  await page.keyboard.press("Control+k");
  await page.getByRole("combobox", { name: "Type a command" }).waitFor();
  await page.keyboard.press("Escape");
  await page.waitForFunction("!document.querySelector('dialog[open]')");
});

test("dark theme passes axe", async () => {
  await page.locator('[role="treeitem"][data-key="c:c1"]').click();
  await page.getByRole("heading", { level: 1, name: "libfoo 2.4.1 release audit" }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "dark");
  await page.screenshot({ path: join(SHOTS, "dark.png") });
  const bad = await axe(page, "dark");
  assert.equal(bad.length, 0, `dark axe: ${bad.map((v) => v.id).join(", ")}`);
});

test("command palette toggles the theme; light theme passes axe", async () => {
  await page.keyboard.press("Control+k");
  const input = page.getByRole("combobox", { name: "Type a command" });
  await input.waitFor();
  await input.fill("toggle theme");
  await page.getByRole("option", { name: /Toggle theme/ }).waitFor();
  await page.screenshot({ path: join(SHOTS, "palette.png") });
  const badPalette = await axe(page, "palette");
  assert.equal(badPalette.length, 0, `palette axe: ${badPalette.map((v) => v.id).join(", ")}`);
  await input.press("Enter");
  await page.waitForFunction("document.documentElement.dataset.theme === 'light'");
  await page.waitForFunction("!document.querySelector('dialog[open]')");
  await page.screenshot({ path: join(SHOTS, "light.png") });
  const bad = await axe(page, "light");
  assert.equal(bad.length, 0, `light axe: ${bad.map((v) => v.id).join(", ")}`);
});

test("rail pages render and pass axe", async () => {
  for (const [name, check] of [
    ["Doctor", /checks need attention/],
    ["Usage", /Total/],
    ["Calibration", /insufficient data/],
    ["Settings", /Default mode for new turns/],
    ["Accounts", /Add an account/],
  ] as const) {
    await page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("button", { name: new RegExp(`^${name}`) })
      .click();
    await page.getByRole("heading", { level: 1, name }).waitFor();
    await page.getByText(check).first().waitFor();
    const bad = await axe(page, name);
    assert.equal(bad.length, 0, `${name} axe: ${bad.map((v) => v.id).join(", ")}`);
  }
});

test("sign in through the embedded login terminal", async () => {
  await page.getByRole("button", { name: "Sign in Claude (personal)" }).click();
  await page
    .locator(".xterm-rows")
    .getByText(/Paste the code/)
    .waitFor();
  await page.locator(".login-term .xterm").click();
  await page.keyboard.type("QXZT-7781");
  await page.keyboard.press("Enter");
  await page.getByText("Sign-in finished.").waitFor();
  await page.getByRole("row", { name: /Claude \(personal\).*signed-in/ }).waitFor();
  await page.screenshot({ path: join(SHOTS, "accounts-login.png") });
  const bad = await axe(page, "accounts+terminal");
  assert.equal(bad.length, 0, `accounts axe: ${bad.map((v) => v.id).join(", ")}`);
  await page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("button", { name: /^Cases/ })
    .click();
});

test("no console errors", () => {
  assert.deepEqual(
    consoleErrors.filter((e) => !/Failed to load resource: the server responded with a status of 401/.test(e)),
    [],
  );
});
