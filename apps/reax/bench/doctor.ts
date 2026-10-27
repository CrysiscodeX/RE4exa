// Preflight for live runs, on Linux, macOS or Windows: is everything the chosen backends need
// present and set up? It runs only the CLIs' own version and status commands and llama-server's
// device list, plus (with --live) one tiny request per CLI to prove the sign-in and the model
// name work. It never reads a credential file.
//   node bench/doctor.ts [--backend local|codex|claude|hybrid|all] [--live]
import { existsSync, readFileSync, statSync } from "node:fs";
import { freemem, totalmem } from "node:os";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { effortArgsFor } from "../src/bench/backends/claude.ts";
import { configPath, loadConfig } from "../src/bench/backends/config.ts";
import { findCommand, runCliSync } from "../src/bench/backends/proc.ts";
import { parseDevices } from "../src/bench/setup/hardware.ts";
import { fileSha256 } from "../src/bench/setup/install.ts";
import { probeHardware } from "../src/bench/setup/probe.ts";

const { values: a } = parseArgs({
  options: { backend: { type: "string", default: "all" }, live: { type: "boolean", default: false } },
});
const cfg = loadConfig();
const want = (b: string) => a.backend === "all" || a.backend === b || (a.backend === "hybrid" && b !== "hybrid");
const rows: { check: string; ok: boolean; warn?: boolean; detail: string }[] = [];
const row = (check: string, ok: boolean, detail: string, warn = false) => rows.push({ check, ok, warn, detail });
const run = (argv: string[], input = "") => runCliSync(argv, { input, timeoutMs: 180_000 });
const first = (s: string) =>
  s
    .split("\n")
    .find((l) => l.trim())
    ?.trim()
    .slice(0, 160) ?? "";

const [maj, min] = process.versions.node.split(".").map(Number);
row("node >= 24.15", maj! > 24 || (maj === 24 && min! >= 15), process.version);

if (want("local")) {
  const hw = probeHardware();
  row(
    "hardware",
    true,
    `${hw.os} ${hw.arch}; GPU: ${hw.gpus.map((g) => g.name).join(", ") || "none found"}${hw.cudaDriver ? `; CUDA driver ${hw.cudaDriver.join(".")}` : ""}`,
  );
  const v = run([...cfg.local.server, "--version"]);
  row(
    "llama-server",
    v.ok,
    v.missing ? `not found: ${cfg.local.server.join(" ")} (run npm run bench:setup)` : first(v.out),
  );
  if (v.ok) {
    const devices = parseDevices(run([...cfg.local.server, "--list-devices"]).out);
    row(
      "llama.cpp build",
      !!cfg.local.backend,
      cfg.local.backend
        ? `${cfg.local.backend}; devices: ${devices.map((d) => `${d.name} ${d.description} (${d.freeMiB} MiB free)`).join(", ") || "CPU only"}`
        : "no build recorded: run npm run bench:setup",
    );
  }
  const fit = existsSync(configPath())
    ? (
        JSON.parse(readFileSync(configPath(), "utf8")) as {
          provenance?: { fit?: { trials: { ctx: number; peak_rss_mib: number; fits: boolean }[] } };
        }
      ).provenance?.fit
    : undefined;
  const fitted = fit?.trials.find((t) => t.fits && t.ctx === cfg.local.ctx);
  row(
    "context fits the cap",
    !!fitted,
    fitted
      ? `${cfg.local.ctx} tokens; measured at setup: peak ${fitted.peak_rss_mib} MiB resident with it ~90% full, cap ${cfg.local.memCapMiB} MiB`
      : `${cfg.local.ctx} tokens, not measured against the ${cfg.local.memCapMiB} MiB cap: run npm run bench:setup`,
    true,
  );
  const model = cfg.local.model;
  if (!existsSync(model)) row("GGUF model", false, `missing: ${model} (run npm run bench:setup)`);
  else {
    const digest = await fileSha256(model);
    const pinned = cfg.local.modelSha256;
    row(
      "GGUF model",
      !pinned || pinned === digest,
      `${(statSync(model).size / 2 ** 20).toFixed(0)} MiB, sha256 ${digest}${pinned ? (pinned === digest ? " (matches the pin)" : ` (pin is ${pinned})`) : " (not pinned yet: set local.modelSha256 in bench/backends.json)"}`,
    );
    const weightsMiB = statSync(model).size / 2 ** 20;
    row(
      "weights fit the cap",
      weightsMiB < cfg.local.memCapMiB * 0.8,
      `${weightsMiB.toFixed(0)} MiB of weights; cap ${cfg.local.memCapMiB} MiB for weights + KV cache + compute buffers`,
    );
  }
  // A warning only: macOS leaves inactive and purgeable pages out of freemem(), so it under-reports.
  // The 4 GB cap on llama-server is the real guard.
  row(
    "free memory",
    freemem() / 2 ** 20 > cfg.local.memCapMiB + 1024,
    `${(freemem() / 2 ** 30).toFixed(1)} GiB reported free of ${(totalmem() / 2 ** 30).toFixed(1)} GiB`,
    true,
  );
}

if (want("codex")) {
  const v = run([...cfg.codex.cmd, "--version"]);
  row("codex CLI", v.ok, v.missing ? "not found: npm install -g @openai/codex" : first(v.out));
  const s = run([...cfg.codex.cmd, "login", "status"]);
  row("codex sign-in", s.ok, s.ok ? first(s.out) : "not signed in: run `codex login`");
  if (a.live && s.ok) {
    const r = run(
      [
        ...cfg.codex.cmd,
        "exec",
        "--json",
        "--model",
        cfg.codex.model,
        "-c",
        `model_reasoning_effort="${cfg.codex.effort}"`,
        "--sandbox",
        "read-only",
        "--skip-git-repo-check",
        "-",
      ],
      "Reply with OK",
    );
    row(`codex model ${cfg.codex.model}`, r.ok && /OK/.test(r.out), r.ok ? "answered" : first(r.out));
  }
}

if (want("claude")) {
  const v = run([...cfg.claude.cmd, "--version"]);
  row("claude CLI", v.ok, v.missing ? "not found: npm install -g @anthropic-ai/claude-code" : first(v.out));
  if (process.platform === "win32") {
    // Claude Code on Windows runs its Bash tool in Git Bash.
    const git = findCommand("git", process.env);
    const bash = [
      process.env.CLAUDE_CODE_GIT_BASH_PATH,
      join(process.env.ProgramFiles ?? "C:\\Program Files", "Git", "bin", "bash.exe"),
      git !== "git" ? join(dirname(git), "..", "bin", "bash.exe") : undefined,
    ].find((p) => p && existsSync(p));
    row("Git Bash (for Claude Code)", !!bash, bash ?? "not found: install Git for Windows (https://git-scm.com)");
  }
  const effort = effortArgsFor(cfg.claude);
  row(
    "claude effort option",
    true,
    effort
      ? `${cfg.claude.effortArgs ? "configured" : "found in --help"}: ${effort.join(" ")}`
      : "no --effort option in this version; cells will record effort as not applied",
  );
  if (a.live) {
    const r = run(
      [...cfg.claude.cmd, "-p", "--output-format", "json", "--model", cfg.claude.model, ...(effort ?? [])],
      "Reply with OK",
    );
    let detail = first(r.out);
    try {
      const j = JSON.parse(r.stdout) as { result?: string; is_error?: boolean; modelUsage?: object };
      detail = j.is_error
        ? `error: ${j.result}`
        : `answered on ${Object.keys(j.modelUsage ?? {}).join(", ") || "unknown model"}`;
      row(`claude model ${cfg.claude.model}`, r.ok && !j.is_error, detail);
    } catch {
      row(`claude model ${cfg.claude.model}`, false, detail || "no JSON output (signed in? run `claude`, then /login)");
    }
  } else row("claude sign-in", true, "checked only with --live (it sends one short request)");
}

const width = Math.max(...rows.map((r) => r.check.length));
for (const r of rows) console.log(`${r.ok ? "ok  " : r.warn ? "warn" : "FAIL"}  ${r.check.padEnd(width)}  ${r.detail}`);
const bad = rows.filter((r) => !r.ok && !r.warn).length;
console.log(bad ? `\n${bad} checks failed` : "\nall checks passed");
process.exit(bad ? 1 : 0);
