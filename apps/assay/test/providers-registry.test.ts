import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type { ProviderAdapter } from "../src/contracts.ts";
import { isAssayError } from "../src/errors.ts";
import { createProviders } from "../src/providers/index.ts";
import { which } from "../src/providers/util.ts";
import { runProcess } from "../src/vendor/orca-process-host/run-process.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else if (/\.(ts|mjs|js)$/.test(name)) out.push(p);
  }
  return out;
}

describe("provider registry", () => {
  it("has every provider id and detects them all without throwing", async () => {
    const r = createProviders({
      claude: { env: { PATH: "/nonexistent" } },
      codex: { env: { PATH: "/nonexistent" } },
      acp: { env: { PATH: "/nonexistent" } },
    });
    assert.deepEqual([...r.keys()].sort(), ["acp", "claude", "codex", "fake"]);
    const infos = await r.detectAll();
    assert.deepEqual(
      infos.map((i) => [i.id, i.installed, i.enforcement]),
      [
        ["claude", false, "enforced"],
        ["codex", false, "partial"],
        ["acp", false, "partial"],
        ["fake", true, "enforced"],
      ],
    );
    assert.equal(r.require("fake").id, "fake");
    r.delete("codex");
    assert.throws(
      () => r.require("codex"),
      (e: unknown) => isAssayError(e, "provider_unavailable"),
    );
  });

  it("a failing detect is reported as not installed; overrides replace adapters; acpAgents merge over defaults", async () => {
    const broken: ProviderAdapter = {
      id: "codex",
      detect: async () => {
        throw new Error("nope");
      },
      status: async () => ({ signedIn: false, method: null, detail: {} }),
      loginCommand: () => ({ program: "x", args: [], env: {} }),
      start: async () => {
        throw new Error("no");
      },
    };
    const r = createProviders({
      overrides: [broken],
      acpAgents: { mine: { program: "/nonexistent/mine", args: [] } },
      claude: { env: { PATH: "/nonexistent" } },
      acp: { env: { PATH: "/nonexistent" } },
    });
    const codex = (await r.detectAll()).find((i) => i.id === "codex");
    assert.equal(codex?.installed, false);
    assert.match(codex?.notes[0] ?? "", /detect failed: nope/);
    const acp = (await r.detectAll()).find((i) => i.id === "acp");
    assert.match(acp?.notes.join(" ") ?? "", /gemini, claude-code-acp, mine/);
  });
});

describe("guardrails: provider and account code never touches credentials", () => {
  // Built by concatenation so this file does not contain the strings it forbids.
  const forbidden = [
    `.credentials${".json"}`,
    `security find-generic${"-password"}`,
    `api/oauth${"/usage"}`,
    `wham${"/usage"}`,
  ];
  const commentOnly = [`auth${".json"}`, `key${"chain"}`];
  const scanned = [
    ...files(join(ROOT, "src/providers")),
    ...files(join(ROOT, "src/accounts")),
    ...files(join(ROOT, "test/fixtures/providers")),
  ];

  it("scans a non-empty set of files", () => {
    assert.ok(scanned.length >= 8, scanned.join(", "));
  });

  for (const f of scanned) {
    it(`no credential paths or undocumented endpoints in ${f.slice(ROOT.length)}`, () => {
      const lines = readFileSync(f, "utf8").split("\n");
      lines.forEach((line, i) => {
        for (const s of forbidden) assert.ok(!line.includes(s), `${f}:${i + 1} contains a forbidden string`);
        const t = line.trim();
        const isComment = t.startsWith("//") || t.startsWith("*") || t.startsWith("/*");
        for (const s of commentOnly)
          assert.ok(
            isComment || !line.toLowerCase().includes(s),
            `${f}:${i + 1} mentions a credential store outside a comment`,
          );
      });
    });
  }

  it("does not use pi-ai's OAuth paths", () => {
    for (const f of scanned) assert.ok(!/pi-ai.*oauth|oauth.*pi-ai/i.test(readFileSync(f, "utf8")), f);
  });
});

const claude = which("claude");

describe("the installed claude CLI lists the flags the adapter relies on", {
  skip: claude ? false : "claude is not installed",
}, () => {
  it("claude --help", async () => {
    const r = await runProcess({ program: claude!, args: ["--help"], timeoutMs: 20_000 });
    const help = `${r.stdout}\n${r.stderr}`;
    for (const flag of [
      "--print",
      "--output-format",
      "--input-format",
      "--include-partial-messages",
      "--mcp-config",
      "--strict-mcp-config",
      "--tools",
      "--allowedTools",
      "--append-system-prompt",
      "--setting-sources",
      "--permission-mode",
      "--permission-prompt-tool",
      "--resume",
      "--model",
      "--max-budget-usd",
    ])
      assert.ok(help.includes(flag), `claude --help does not list ${flag}`);
  });

  it("claude auth has status --json and login", async () => {
    const auth = await runProcess({ program: claude!, args: ["auth", "--help"], timeoutMs: 20_000 });
    assert.match(auth.stdout + auth.stderr, /login/);
    assert.match(auth.stdout + auth.stderr, /status/);
    const st = await runProcess({ program: claude!, args: ["auth", "status", "--help"], timeoutMs: 20_000 });
    assert.match(st.stdout + st.stderr, /--json/);
  });
});
