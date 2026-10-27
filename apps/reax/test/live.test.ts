// The live backends, end to end against stand-ins: a stub llama-server and fake codex and claude
// CLIs that print the event formats the real ones print. The real runs happen on a machine with
// llama.cpp and signed-in CLIs (bench/mac-setup.sh); these tests prove the plumbing, the grading,
// the memory cap, the sign-in and timeout paths and the hybrid's review round.
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { claudeArgv } from "../src/bench/backends/claude.ts";
import { type BenchConfig, DEFAULTS } from "../src/bench/backends/config.ts";
import { allocatedMiB, LlamaServer } from "../src/bench/backends/local.ts";
import { cellPrompt, REAX_NOTE, runLive } from "../src/bench/live.ts";
import { loadTasks } from "../src/bench/run.ts";
import { opArgs } from "../src/cli.ts";

const REAX = join(import.meta.dirname, "..");
const FIX = join(import.meta.dirname, "fixtures");
const tasks = loadTasks(join(REAX, "bench", "tasks"));
const one = (id: string) => tasks.filter((t) => t.id === id);

function config(over: Partial<{ port: number; kv: string }> = {}): BenchConfig {
  const c = structuredClone(DEFAULTS);
  c.local.server = [process.execPath, join(FIX, "stub-llama.mjs")];
  c.local.port = over.port ?? 18000 + Math.floor(Math.random() * 2000);
  c.local.model = "stub.gguf";
  c.codex.cmd = [process.execPath, join(FIX, "fake-codex.mjs")];
  c.claude.cmd = [process.execPath, join(FIX, "fake-claude.mjs")];
  c.claude.effortArgs = ["--effort", "medium"];
  c.local.memCapMiB = 4096;
  c.cell.timeoutMs = 60_000;
  return c;
}

async function withServer<T>(cfg: BenchConfig, fn: (s: LlamaServer) => Promise<T>): Promise<T> {
  const s = new LlamaServer(cfg.local);
  await s.start(20_000);
  try {
    return await fn(s);
  } finally {
    await s.close();
  }
}

const out = () => mkdtempSync(join(tmpdir(), "reax-live-"));

test("[+RX-1/bench-live] each backend runs standalone and its cell records the model, effort, tokens and grade", async () => {
  const cfg = config();
  const dir = out();
  try {
    const t = one("identify-hello-x86_64-linux-gnu.2.28-s");
    const local = await withServer(cfg, (s) =>
      runLive({
        backend: "local",
        tasks: t,
        reps: 1,
        fixturesBin: join(REAX, "fixtures", "bin"),
        out: join(dir, "local"),
        config: cfg,
        server: s,
      }),
    );
    assert.equal(local[0]!.error, null);
    assert.equal(local[0]!.run.model, "stub-qwen3-4b");
    assert.equal(local[0]!.run.tool_calls, 1);
    assert.deepEqual(local[0]!.run.tokens, { input_uncached: 1000, input_cached: 800, output: 120 });
    assert.ok(local[0]!.grade.hits >= 2, JSON.stringify(local[0]!.grade.detail));
    assert.deepEqual(local[0]!.memory, {
      allocated_mib: 3300,
      peak_rss_mib: local[0]!.memory!.peak_rss_mib,
      cap_mib: 4096,
    });

    const codex = await runLive({
      backend: "codex",
      tasks: t,
      reps: 1,
      fixturesBin: join(REAX, "fixtures", "bin"),
      out: join(dir, "codex"),
      config: cfg,
    });
    assert.equal(codex[0]!.error, null);
    assert.equal(codex[0]!.run.requested_model, "gpt-6.1-sol");
    assert.equal(codex[0]!.run.effort, '-c model_reasoning_effort="medium"');
    assert.equal(codex[0]!.run.tool_calls, 1, "the fake ran the real reax command through the shim");
    assert.equal(codex[0]!.grade.hits, 1);

    const claude = await runLive({
      backend: "claude",
      tasks: t,
      reps: 1,
      fixturesBin: join(REAX, "fixtures", "bin"),
      out: join(dir, "claude"),
      config: cfg,
    });
    assert.equal(claude[0]!.run.model, "claude-opus-5-5");
    assert.equal(claude[0]!.run.effort, "--effort medium");
    assert.equal(claude[0]!.run.cost_usd, 0.03);
    assert.ok(readdirSync(join(dir, "claude", "transcripts")).length === 1);
    assert.match(readFileSync(join(dir, "claude", "summary.md"), "utf8"), /\| claude \| 1 \|/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("[-RX-1/bench-live] a signed-out CLI and an over-cap model are reported as errors, not as wrong answers", async () => {
  const dir = out();
  const t = one("identify-hello-x86_64-linux-gnu.2.28-s");
  try {
    process.env.FAKE_SIGNED_OUT = "1";
    const cfg = config();
    const codex = await runLive({
      backend: "codex",
      tasks: t,
      reps: 1,
      fixturesBin: join(REAX, "fixtures", "bin"),
      out: join(dir, "codex"),
      config: cfg,
    });
    assert.match(codex[0]!.error ?? "", /sign-in needed: run `codex login`/);
    const claude = await runLive({
      backend: "claude",
      tasks: t,
      reps: 1,
      fixturesBin: join(REAX, "fixtures", "bin"),
      out: join(dir, "claude"),
      config: cfg,
    });
    assert.match(claude[0]!.error ?? "", /sign-in needed/);
    delete process.env.FAKE_SIGNED_OUT;
    process.env.STUB_KV_MIB = "5000.00";
    const big = config();
    const capped = await withServer(big, (s) =>
      runLive({
        backend: "local",
        tasks: tasks.slice(0, 3),
        reps: 1,
        fixturesBin: join(REAX, "fixtures", "bin"),
        out: join(dir, "local"),
        config: big,
        server: s,
      }),
    );
    assert.equal(capped.length, 3, "every cell is listed, run or not");
    assert.match(capped[0]!.error ?? "", /memory cap: llama.cpp allocated 7700 MiB, over the 4096 MiB cap/);
    assert.deepEqual(
      capped.map((c) => c.not_run),
      [true, true, true],
      "over the cap at load, no cell can run: each is listed as not run, none is dropped",
    );
    assert.match(capped[1]!.error ?? "", /^not run: the backend had stopped \(memory cap/);
    const summary = readFileSync(join(dir, "local", "summary.md"), "utf8");
    assert.match(summary, /\| local \| 0 \| 3 \| - \|/, "cells run and not run, per backend; no mean over no cells");
    assert.match(summary, /## Not run/);
    assert.ok(capped.every((c) => c.machine.total_mib > 0 && c.hardware?.ctx === big.local.ctx));
    assert.equal(allocatedMiB("x buffer size =  1.5 MiB\ny buffer size = 2 MiB"), 4);
  } finally {
    delete process.env.FAKE_SIGNED_OUT;
    delete process.env.STUB_KV_MIB;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("[+RX-1/bench-hybrid] the hybrid plans with Opus, works locally, reviews with Codex and Opus, revises once, and grades both answers", async () => {
  const cfg = config();
  const dir = out();
  try {
    const cells = await withServer(cfg, (s) =>
      runLive({
        backend: "hybrid",
        tasks: one("identify-hello-x86_64-linux-gnu.2.28-s"),
        reps: 1,
        fixturesBin: join(REAX, "fixtures", "bin"),
        out: dir,
        config: cfg,
        server: s,
      }),
    );
    const c = cells[0]!;
    assert.deepEqual(Object.keys(c.roles ?? {}), ["plan", "worker", "codex_review", "opus_review", "worker_revision"]);
    assert.ok(c.grade_first, "the worker's first answer is graded too");
    assert.equal(c.roles!.plan!.model, "claude-opus-5-5");
    assert.equal(c.roles!.codex_review!.requested_model, "gpt-6.1-sol");
    assert.equal(c.run.cost_usd, 0.01 + 0.02);
    assert.match(readFileSync(join(dir, "summary.md"), "utf8"), /Hybrid: the local worker's first answers averaged/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("[-RX-1/bench-hybrid] Opus planning with no tools gets every tool disallowed; a failed Codex review does not stop the cell", async () => {
  const cfg = config();
  const dir = out();
  const argsFile = join(dir, "args.jsonl");
  try {
    process.env.FAKE_ARGS_FILE = argsFile;
    cfg.codex.cmd = [process.execPath, "-e", "process.exit(3)"];
    const cells = await withServer(cfg, (s) =>
      runLive({
        backend: "hybrid",
        tasks: one("identify-hello-x86_64-linux-gnu.2.28-s"),
        reps: 1,
        fixturesBin: join(REAX, "fixtures", "bin"),
        out: join(dir, "run"),
        config: cfg,
        server: s,
      }),
    );
    assert.match(cells[0]!.error ?? "", /codex_review: codex exited 3 \(the run continued without it\)/);
    assert.ok(cells[0]!.grade, "the cell is still graded");
    const plan = readFileSync(argsFile, "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as string[])[0]!;
    const dis = plan.slice(plan.indexOf("--disallowedTools") + 1);
    for (const tool of ["Bash", "Read", "Write", "Edit", "WebFetch"])
      assert.ok(dis.includes(tool), `${tool} disallowed for the planner`);
    assert.ok(plan.includes("--strict-mcp-config"), "the user's MCP servers are not loaded");
  } finally {
    delete process.env.FAKE_ARGS_FILE;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the claude backend finds --effort in the CLI's help when none is configured, and leaves it out when the CLI has none", () => {
  const cfg = config();
  cfg.claude.effortArgs = null;
  const argv = claudeArgv(cfg.claude);
  assert.deepEqual(argv.slice(argv.indexOf("--effort"), argv.indexOf("--effort") + 2), ["--effort", "medium"]);
  process.env.FAKE_NO_EFFORT = "1";
  try {
    const other = config();
    other.claude.effortArgs = null;
    other.claude.cmd = [process.execPath, join(FIX, "fake-claude.mjs"), "--no-effort-variant"];
    assert.ok(!claudeArgv(other.claude).includes("--effort"));
  } finally {
    delete process.env.FAKE_NO_EFFORT;
  }
});

test("agents call reax with key=value arguments that need no quoting in any shell, and the CLI agents are told about reax", () => {
  assert.deepEqual(opArgs(["identify.file", "path=a b.exe", "limit=5", "--format", "json", "flag=true"]), {
    path: "a b.exe",
    limit: 5,
    flag: true,
  });
  assert.deepEqual(opArgs(["x", "--json", '{"path":"p"}', "path=q"]), { path: "q" }, "key=value wins over --json");
  assert.deepEqual(opArgs(["x", 'path="quoted"']), { path: '"quoted"' }, "a JSON string stays the raw text");
  assert.throws(() => opArgs(["x", "nonsense"]), /expected key=value/);
  const t = one("identify-hello-x86_64-linux-gnu.2.28-s")[0]!;
  assert.ok(cellPrompt("codex", t).startsWith(REAX_NOTE) && cellPrompt("claude", t).startsWith(REAX_NOTE));
  assert.ok(!cellPrompt("local", t).includes(REAX_NOTE), "the local model gets reax as its tools instead");
});

test("[+LEAN-C49-LIMIT] a cell that runs out of time is still written, with its transcript and timed_out set", async () => {
  const cfg = config();
  cfg.cell.timeoutMs = 1500;
  const dir = out();
  try {
    process.env.FAKE_SLEEP_MS = "10000";
    const cells = await runLive({
      backend: "claude",
      tasks: one("identify-hello-x86_64-linux-gnu.2.28-s"),
      reps: 1,
      fixturesBin: join(REAX, "fixtures", "bin"),
      out: dir,
      config: cfg,
    });
    assert.equal(cells.length, 1);
    assert.equal(cells[0]!.timed_out, true);
    assert.equal(cells[0]!.grade.accuracy, 0);
    assert.equal(readFileSync(join(dir, "cells.jsonl"), "utf8").trim().split("\n").length, 1);
  } finally {
    delete process.env.FAKE_SLEEP_MS;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("[-LEAN-C49-LIMIT] a cell that finishes in time is not marked timed out", async () => {
  const cfg = config();
  const dir = out();
  try {
    const cells = await runLive({
      backend: "claude",
      tasks: one("identify-hello-x86_64-linux-gnu.2.28-s"),
      reps: 1,
      fixturesBin: join(REAX, "fixtures", "bin"),
      out: dir,
      config: cfg,
    });
    assert.equal(cells[0]!.timed_out, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the backends never open a provider's credential store or token", () => {
  const dir = join(REAX, "src", "bench", "backends");
  for (const f of readdirSync(dir)) {
    const src = readFileSync(join(dir, f), "utf8");
    assert.doesNotMatch(
      src,
      /auth\.json|\.credentials|keychain|security find-generic-password|access_token|refresh_token|OAUTH/i,
      f,
    );
  }
});
