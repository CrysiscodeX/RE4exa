// Live benchmark cells on real backends: local (llama.cpp), codex, claude, hybrid. Same tasks,
// same prompt and same grader as every other arm; one cell at a time; every cell's raw
// transcript, models, effort, tokens, cost, time, memory and errors are kept.
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { availableParallelism, freemem, loadavg, totalmem } from "node:os";
import { join } from "node:path";
import { claudeBackend } from "./backends/claude.ts";
import { codexBackend } from "./backends/codex.ts";
import { type BenchConfig, loadConfig } from "./backends/config.ts";
import { hybridBackend } from "./backends/hybrid.ts";
import { LlamaServer, localBackend } from "./backends/local.ts";
import type { Backend, BackendResult } from "./backends/types.ts";
import { contentCheck, type Grade, grade } from "./grade.ts";
import { prompt, workspace } from "./run.ts";
import type { Task } from "./types.ts";

export const BACKENDS = ["local", "codex", "claude", "hybrid"] as const;
export type BackendName = (typeof BACKENDS)[number];

/** The smoke test's five tasks: one of each kind, plus the adversarial note. */
export const SMOKE_TASKS = [
  "identify-hello-x86_64-linux-gnu.2.28-s",
  "links-hello-x86_64-windows-gnu-s.exe",
  "exports-lib-aarch64-macos-s.dylib",
  "debug-pair",
  "adversarial-note",
];

export interface LiveCell {
  task: string;
  class: Task["class"];
  backend: BackendName;
  rep: number;
  targets: Task["subjects"];
  run: BackendResult["run"];
  roles: BackendResult["roles"] | null;
  memory: BackendResult["memory"] | null;
  /** For local and hybrid: the llama.cpp build, device and context size, and the OS it ran on. */
  hardware: {
    os: NodeJS.Platform;
    arch: string;
    llama_backend: string | null;
    device: string | null;
    ctx: number;
  } | null;
  /** The machine's load when the cell started; the bench does not assume it has the machine to itself. */
  machine: { loadavg1: number | null; free_mib: number; total_mib: number; cpus: number };
  /** True for a cell the run never started (the backend had stopped); left out of every mean. */
  not_run: boolean;
  error: string | null;
  timed_out: boolean;
  transcript: string;
  grade: Grade;
  /** The hybrid worker's first answer, graded the same way. */
  grade_first: Grade | null;
  /** Diagnostic only, never the score: with no claims block, what a ```json claims array in the answer would have scored. */
  content_check: number | null;
}

/** What the CLI agents are told about reax; the local model gets the same facts as its tools. */
export const REAX_NOTE =
  "The files are in the current directory. The `reax` command is on PATH: `reax op --list` lists its operations and `reax op <operation> path=<file>` runs one on a file.";

/** The prompt one backend gets for a task. */
export function cellPrompt(backend: BackendName, t: Parameters<typeof prompt>[0]): string {
  return backend === "codex" || backend === "claude" ? `${REAX_NOTE}\n\n${prompt(t)}` : prompt(t);
}

/** A directory with a `reax` command for the agents: a POSIX shim and reax.cmd for Windows. */
function machineNow(): LiveCell["machine"] {
  return {
    loadavg1: process.platform === "win32" ? null : Math.round(loadavg()[0]! * 100) / 100,
    free_mib: Math.round(freemem() / 2 ** 20),
    total_mib: Math.round(totalmem() / 2 ** 20),
    cpus: availableParallelism(),
  };
}

const zeroRun = (): LiveCell["run"] => ({
  model: "",
  requested_model: "",
  effort: "",
  turns: 0,
  tool_calls: 0,
  tokens: { input_uncached: 0, input_cached: 0, output: 0 },
  cost_usd: 0,
  ms: 0,
});

/** The reax home the CLI agents' `reax` uses: under the run's output directory. */
export const reaxHomeFor = (root: string) => join(root, ".reax-home");

/** A POSIX shell word that is exactly `s`: single-quoted, `'` written as `'\''`; nothing else is special. */
export const shQuote = (s: string) => `'${s.replaceAll("'", "'\\''")}'`;

/** A value for reax.cmd's double quotes: `%` (expanded at parse time, even inside quotes) as `%%`. */
export const cmdEscape = (s: string) => s.replaceAll("%", "%%");

/** Characters a double-quoted cmd value cannot carry (`"` ends the quotes; CR, LF and NUL end the line). */
const CMD_UNSAFE: [string, string][] = [
  ['"', '`"`'],
  ["\r", "a carriage return (CR)"],
  ["\n", "a line feed (LF)"],
  ["\0", "a NUL byte"],
];

/** Throws, naming the character and the value's role, when reax.cmd cannot carry `value`. */
export function assertCmdSafe(role: string, value: string, fix: string): void {
  for (const [c, name] of CMD_UNSAFE)
    if (value.includes(c)) throw new Error(`${role} contains ${name}, which reax.cmd cannot carry; ${fix}`);
}

/**
 * A directory with a `reax` command for the agents: a POSIX shim and reax.cmd for Windows. Neither
 * shell expands anything in the run directory, the node path or the reax.mjs path; a value
 * reax.cmd cannot carry is refused on every platform, before anything is created.
 */
export function toolsDir(root: string): string {
  const bin = join(import.meta.dirname, "..", "..", "bin", "reax.mjs");
  assertCmdSafe("the bench run directory", root, "choose another --out");
  assertCmdSafe("the node executable path", process.execPath, "run the bench with a node installed elsewhere");
  assertCmdSafe("the reax bin path", bin, "run reax from a checkout elsewhere");
  const dir = join(root, ".tools");
  mkdirSync(dir, { recursive: true });
  const shim = join(dir, "reax");
  // Forward slashes on Windows only: Git Bash (Claude Code's shell there) reads them. On POSIX a
  // backslash is a file-name byte like any other, and single quotes keep it as it is.
  const fwd = (p: string) => (process.platform === "win32" ? p.replaceAll("\\", "/") : p);
  // the agents' reax keeps its state (pm.db) in this run's output, never in the developer's home
  const home = reaxHomeFor(root);
  const q = (p: string) => shQuote(fwd(p));
  writeFileSync(shim, `#!/bin/sh\nREAX_HOME=${q(home)} exec ${q(process.execPath)} ${q(bin)} "$@"\n`);
  chmodSync(shim, 0o755);
  // DisableDelayedExpansion: `!` stays literal even when the caller's cmd runs /V:ON
  writeFileSync(
    join(dir, "reax.cmd"),
    `@setlocal DisableDelayedExpansion\r\n@set "REAX_HOME=${cmdEscape(home)}"\r\n@"${cmdEscape(process.execPath)}" "${cmdEscape(bin)}" %*\r\n`,
  );
  return dir;
}

export function buildBackend(name: BackendName, cfg: BenchConfig, server: LlamaServer | null): Backend {
  if (name === "codex") return codexBackend(cfg.codex);
  if (name === "claude") return claudeBackend(cfg.claude);
  if (!server) throw new Error(`${name} needs the local model server`);
  if (name === "local") return localBackend(server, cfg.local);
  return hybridBackend({
    worker: localBackend(server, cfg.local),
    opus: claudeBackend(cfg.claude),
    opusNoTools: claudeBackend(cfg.claude, []),
    codex: codexBackend(cfg.codex),
  });
}

export interface LiveOptions {
  backend: BackendName;
  tasks: Task[];
  reps: number;
  fixturesBin: string;
  out: string;
  config?: BenchConfig;
  /** For tests: a server already started. */
  server?: LlamaServer | null;
  onCell?: (c: LiveCell) => void;
}

export async function runLive(o: LiveOptions): Promise<LiveCell[]> {
  const cfg = o.config ?? loadConfig();
  mkdirSync(join(o.out, "transcripts"), { recursive: true });
  const tools = toolsDir(o.out);
  const needsLocal = o.backend === "local" || o.backend === "hybrid";
  let server = o.server ?? null;
  let own = false;
  if (needsLocal && !server) {
    server = new LlamaServer(cfg.local);
    await server.start();
    own = true;
  }
  const backend = buildBackend(o.backend, cfg, server);
  const cells: LiveCell[] = [];
  const hardware = needsLocal
    ? {
        os: process.platform,
        arch: process.arch,
        llama_backend: cfg.local.backend,
        device: cfg.local.device,
        ctx: cfg.local.ctx,
      }
    : null;
  const save = () => writeFileSync(join(o.out, "cells.jsonl"), `${cells.map((c) => JSON.stringify(c)).join("\n")}\n`);
  /** Why the backend can run no more cells (the memory cap stopped the server), or null. */
  let stopped: string | null = null;
  let closedNote = "";
  try {
    for (let rep = 1; rep <= o.reps; rep++)
      for (const t of o.tasks) {
        if (!stopped && server?.overCap) stopped = `memory cap: ${server.overCap}`;
        if (stopped) {
          const cell: LiveCell = {
            task: t.id,
            class: t.class,
            backend: o.backend,
            rep,
            targets: t.subjects,
            run: { ...zeroRun(), model: "not run", requested_model: "" },
            roles: null,
            memory: null,
            hardware,
            machine: machineNow(),
            not_run: true,
            error: `not run: the backend had stopped (${stopped})`,
            timed_out: false,
            transcript: "",
            grade: grade(t, ""),
            grade_first: null,
            content_check: null,
          };
          cells.push(cell);
          o.onCell?.(cell);
          save();
          continue;
        }
        const machine = machineNow();
        const ws = workspace(t, o.fixturesBin);
        const text = cellPrompt(o.backend, t);
        try {
          const r = await backend.run(text, {
            workspace: ws,
            toolsDir: tools,
            deadline: Date.now() + cfg.cell.timeoutMs,
          });
          const name = `${o.backend}-${t.id}-${rep}.txt`;
          writeFileSync(
            join(o.out, "transcripts", name),
            `# prompt\n\n${text}\n\n# answer\n\n${r.answer}\n\n# transcript\n\n${r.transcript}`,
          );
          const cell: LiveCell = {
            task: t.id,
            class: t.class,
            backend: o.backend,
            rep,
            targets: t.subjects,
            run: r.run,
            roles: r.roles ?? null,
            memory: r.memory ?? null,
            hardware,
            machine,
            not_run: false,
            error: r.error ?? null,
            timed_out: !!r.timed_out,
            transcript: `transcripts/${name}`,
            grade: grade(t, r.answer),
            grade_first: r.first_answer !== undefined ? grade(t, r.first_answer) : null,
            content_check: contentCheck(t, r.answer),
          };
          cells.push(cell);
          o.onCell?.(cell);
          save();
          if (cell.error?.includes("memory cap")) stopped = cell.error;
        } finally {
          rmSync(ws, { recursive: true, force: true });
        }
      }
  } finally {
    if (own && server) {
      const closed = await server.close();
      closedNote = `Local model server: closed after the run${closed.confirmed ? " (exit and freed port confirmed" : " (NOT confirmed: check `npm run bench:doctor` for a stray llama-server"}${closed.graceful ? "" : "; it needed SIGKILL"}, ${closed.ms} ms).`;
    }
  }
  writeFileSync(join(o.out, "summary.md"), liveSummary(cells) + (closedNote ? `\n${closedNote}\n` : ""));
  return cells;
}

export function liveSummary(cells: LiveCell[]): string {
  const out = [
    "# Live benchmark summary",
    "",
    "Means are over the cells that ran; cells the run never started are counted as not run.",
    "",
    "| Backend | Cells run | Not run | Mean accuracy | Hits | Wrong | Label errors | Parse errors | Errors | Mean s | Cost USD | Models |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|",
  ];
  const by = new Map<string, LiveCell[]>();
  for (const c of cells) by.set(c.backend, [...(by.get(c.backend) ?? []), c]);
  for (const [b, all] of by) {
    const cs = all.filter((c) => !c.not_run);
    const s = (f: (c: LiveCell) => number) => cs.reduce((a, c) => a + f(c), 0);
    const mean = (f: (c: LiveCell) => number, d: number) => (cs.length ? (s(f) / cs.length).toFixed(d) : "-");
    out.push(
      `| ${b} | ${cs.length} | ${all.length - cs.length} | ${mean((c) => c.grade.accuracy, 3)} | ${s((c) => c.grade.hits)}/${s((c) => c.grade.positives)} | ${s((c) => c.grade.wrong)} | ${s((c) => c.grade.labelErrors)} | ${cs.filter((c) => c.grade.parseError).length} | ${cs.filter((c) => c.error).length} | ${mean((c) => c.run.ms / 1000, 1)} | ${s((c) => c.run.cost_usd).toFixed(3)} | ${[...new Set(cs.map((c) => c.run.model))].join("; ")} |`,
    );
  }
  for (const [b, all] of by) {
    const noBlock = all.filter((c) => !c.not_run && c.grade.parseError === "no claims block");
    const held = noBlock.filter((c) => c.content_check !== null);
    if (noBlock.length)
      out.push(
        "",
        `Format, ${b}: ${noBlock.length} cells had no claims block${held.length ? `; ${held.length} of them held a JSON claims array under another fence, which would have scored ${(held.reduce((a, c) => a + c.content_check!, 0) / held.length).toFixed(3)} on average` : ""}. Diagnostic only: the score above is strict and unchanged.`,
      );
  }
  const ran = cells.filter((c) => !c.not_run && c.machine);
  if (ran.length) {
    const free = ran.map((c) => c.machine.free_mib);
    const load = ran.map((c) => c.machine.loadavg1).filter((x): x is number => x !== null);
    out.push(
      "",
      `Machine during the run: ${Math.min(...free)}-${Math.max(...free)} MiB reported free of ${ran[0]!.machine.total_mib} MiB${load.length ? `, load average ${Math.min(...load).toFixed(1)}-${Math.max(...load).toFixed(1)} on ${ran[0]!.machine.cpus} CPUs` : ""}. The bench does not assume it has the machine to itself: times are descriptive, noisy, and not comparable across runs.`,
    );
  }
  const hw = [
    ...new Set(
      cells
        .filter((c) => c.hardware)
        .map(
          (c) =>
            `${c.hardware!.os} ${c.hardware!.arch}, llama.cpp ${c.hardware!.llama_backend ?? "build not recorded"} on ${c.hardware!.device ?? "device not recorded"}`,
        ),
    ),
  ];
  if (hw.length) out.push("", `Local model ran on: ${hw.join("; ")}.`);
  const hybrid = cells.filter((c) => c.grade_first);
  if (hybrid.length) {
    const m = (f: (c: LiveCell) => number) => (hybrid.reduce((a, c) => a + f(c), 0) / hybrid.length).toFixed(3);
    out.push(
      "",
      `Hybrid: the local worker's first answers averaged ${m((c) => c.grade_first!.accuracy)}; after review, ${m((c) => c.grade.accuracy)}.`,
    );
  }
  const errors = cells.filter((c) => c.error && !c.not_run);
  const notRun = cells.filter((c) => c.not_run);
  if (notRun.length) out.push("", "## Not run", "", ...notRun.map((c) => `- ${c.backend} ${c.task}: ${c.error}`));
  if (errors.length) out.push("", "## Errors", "", ...errors.map((c) => `- ${c.backend} ${c.task}: ${c.error}`));
  return `${out.join("\n")}\n`;
}
