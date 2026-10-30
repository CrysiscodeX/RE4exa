// Assay on a real project: LearnHarness 0.4.0 (an Electron + Next.js desktop app, 671 files, 152
// of them .tsx). The tree is fetched at its pinned commit (scripts/learnharness.ts). Assay's
// model-free sweep must read all of it, and claims about it must be checked the way Assay checks
// an agent's claims: each true claim verified, and its realistic false twin refuted. Needs
// GitHub, so it runs when ASSAY_LEARNHARNESS=1 (the CI check job sets it; Linux only).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import type { Json } from "@re4exa/core/evidence/jcs";
import { recordClaim } from "@re4exa/core/evidence/store";
import { createProbeEngine } from "@re4exa/core/probes/engine";
import { openTemp } from "@re4exa/core/testing/helpers";
import { createVerifier } from "@re4exa/core/verifier/verifier";
import { fetchLearnHarness, LEARNHARNESS, learnharnessDir } from "../scripts/learnharness.ts";
import { tmp } from "./helpers.ts";

const skip =
  process.env.ASSAY_LEARNHARNESS === "1" ? false : "needs GitHub: set ASSAY_LEARNHARNESS=1 (the CI check job does)";
const CLI = join(import.meta.dirname, "..", "src", "cli.ts");
/** Measured at about 2.2 s for the whole tree; the budget leaves room for a slower CI runner. */
const SWEEP_BUDGET_MS = 15_000;

/** [claim text, predicate, params, verdict]: each fact as LearnHarness's source states it, and a
 * false twin that a reviewer could plausibly assume. */
export const CLAIMS: [string, string, Record<string, Json>, "verified" | "refuted"][] = [
  ["LearnHarness depends on Next.js", "pkg.has-dependency", { path: "learnharness", name: "next" }, "verified"],
  ["LearnHarness depends on lodash", "pkg.has-dependency", { path: "learnharness", name: "lodash" }, "refuted"],
  [
    "Electron is a development dependency",
    "pkg.has-dependency",
    { path: "learnharness", name: "electron", scope: "devDependencies" },
    "verified",
  ],
  [
    "Electron is a runtime dependency",
    "pkg.has-dependency",
    { path: "learnharness", name: "electron", scope: "dependencies" },
    "refuted",
  ],
  [
    "LearnHarness runs a postinstall script",
    "pkg.has-install-script",
    { path: "learnharness", hook: "postinstall" },
    "refuted",
  ],
  [
    "LearnHarness does not run a postinstall script",
    "pkg.has-install-script",
    { path: "learnharness", hook: "postinstall", negate: true },
    "verified",
  ],
  [
    "The main window isolates its renderer context",
    "file.contains",
    { path: "learnharness/electron/main.cjs", text: "contextIsolation: true" },
    "verified",
  ],
  [
    "The main window turns on Node integration",
    "file.contains",
    { path: "learnharness/electron/main.cjs", text: "nodeIntegration: true" },
    "refuted",
  ],
  [
    "The Electron main process loads electron",
    "js.imports",
    { path: "learnharness/electron/main.cjs", specifier: "electron" },
    "verified",
  ],
  [
    "The Electron main process loads axios",
    "js.imports",
    { path: "learnharness/electron/main.cjs", specifier: "axios" },
    "refuted",
  ],
  [
    "The root layout loads Google fonts through next/font",
    "js.imports",
    { path: "learnharness/app/layout.tsx", specifier: "next/font/google" },
    "verified",
  ],
  ["The root layout loads axios", "js.imports", { path: "learnharness/app/layout.tsx", specifier: "axios" }, "refuted"],
  [
    "Web search calls Tavily",
    "endpoint.present",
    { path: "learnharness/src/server/search.ts", host: "api.tavily.com" },
    "verified",
  ],
  [
    "Web search calls Brave Search",
    "endpoint.present",
    { path: "learnharness/src/server/search.ts", host: "api.search.brave.com" },
    "verified",
  ],
  [
    "Web search calls Bing's Web Search API",
    "endpoint.present",
    { path: "learnharness/src/server/search.ts", host: "api.bing.microsoft.com" },
    "refuted",
  ],
];

test("LearnHarness: the pinned tree is fetched without .git, and Assay's sweep reads all of it within budget", {
  skip,
  timeout: 600_000,
}, () => {
  const tree = fetchLearnHarness();
  assert.ok(!existsSync(join(tree, ".git")), "version-control data is not part of the target");
  const pkg = JSON.parse(readFileSync(join(tree, "package.json"), "utf8")) as { name: string; version: string };
  assert.deepEqual([pkg.name, pkg.version], ["learnharness", LEARNHARNESS.release]);
  assert.equal(
    readFileSync(join(learnharnessDir(), LEARNHARNESS.commit, "COMMIT"), "utf8").trim(),
    LEARNHARNESS.commit,
  );

  const home = tmp("assay-lh-home-");
  try {
    const t0 = Date.now();
    const r = spawnSync(
      process.execPath,
      [
        "--conditions=source",
        "--disable-warning=ExperimentalWarning",
        CLI,
        "sweep",
        "--workspace",
        dirname(tree),
        "--home",
        home.dir,
        "--json",
        "learnharness",
      ],
      { encoding: "utf8", maxBuffer: 1 << 28, timeout: 300_000 },
    );
    const wall = Date.now() - t0;
    assert.equal(r.status, 0, r.stderr);
    const report = JSON.parse(r.stdout) as {
      subject: string;
      evidence: string[];
      findings: { class: string; label: string }[];
      notExamined: { what: string; reason: string }[];
      elapsedMs: number;
    };
    assert.equal(report.subject, "learnharness", "the subject, even with options before it");
    assert.ok(report.elapsedMs < SWEEP_BUDGET_MS, `sweep took ${report.elapsedMs} ms (wall ${wall} ms)`);
    assert.ok(report.evidence.length >= 2000, `${report.evidence.length} evidence records`);
    // nothing is "misread": every entry not examined is a format Assay only identifies, or a
    // tool for another OS
    const misread = report.notExamined.filter((x) => /unterminated|misread/.test(x.reason));
    assert.deepEqual(misread, [], "every JavaScript and TypeScript file, .tsx included, is read whole");
    for (const x of report.notExamined)
      assert.match(x.reason, /^unsupported format|^tool missing/, `${x.what}: ${x.reason}`);
    const hosts = new Set(report.findings.filter((f) => f.class === "net.host").map((f) => f.label));
    for (const h of ["api.tavily.com", "api.search.brave.com", "api.openai.com", "api.deepgram.com"])
      assert.ok(hosts.has(h), `the sweep names ${h}`);
  } finally {
    home.cleanup();
  }
});

test("LearnHarness: claims about it are checked like an agent's: true ones verified, realistic false ones refuted", {
  skip,
  timeout: 600_000,
}, async () => {
  const tree = fetchLearnHarness();
  const store = openTemp();
  try {
    const engine = createProbeEngine({ kernel: store.k, workspace: dirname(tree), which: () => null });
    const verifier = createVerifier({ kernel: store.k, engine });
    for (const [text, predicate, params, want] of CLAIMS) {
      const v = await verifier.verify(
        "case_lh",
        recordClaim(store.k, "case_lh", "agent", { text, label: "seen", predicate, params }),
      );
      assert.equal(v.verdict, want, `${text}: ${v.reason}`);
      assert.ok(v.observation_id, `${text}: the verdict cites its evidence`);
    }
  } finally {
    store.cleanup();
  }
});

test("LearnHarness: a commit that is not the pinned one is never returned", { skip, timeout: 600_000 }, () => {
  const dir = tmp("assay-lh-wrong-");
  try {
    assert.throws(() => fetchLearnHarness(dir.dir, "0".repeat(40)), /git fetch|not the pinned/);
    assert.ok(!existsSync(join(dir.dir, "0".repeat(40), "COMMIT")), "no tree is cached for it");
  } finally {
    dir.cleanup();
  }
});
