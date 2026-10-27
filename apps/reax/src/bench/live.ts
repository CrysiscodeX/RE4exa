// Live benchmark cells on real backends: local (llama.cpp), codex, claude, hybrid. Same tasks,
// same prompt and same grader as every other arm; one cell at a time; every cell's raw
// transcript, models, effort, tokens, cost, time, memory and errors are kept.
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { claudeBackend } from "./backends/claude.ts";
import { codexBackend } from "./backends/codex.ts";
import { type BenchConfig, loadConfig } from "./backends/config.ts";
import { hybridBackend } from "./backends/hybrid.ts";
import { LlamaServer, localBackend } from "./backends/local.ts";
import type { Backend, BackendResult } from "./backends/types.ts";
import { type Grade, grade } from "./grade.ts";
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
  error: string | null;
  timed_out: boolean;
  transcript: string;
  grade: Grade;
  /** The hybrid worker's first answer, graded the same way. */
  grade_first: Grade | null;
}

/** A directory with a `reax` command for the agents (POSIX shim; reax runs in the cell's cwd). */
export function toolsDir(root: string): string {
  const dir = join(root, ".tools");
  mkdirSync(dir, { recursive: true });
  const bin = join(import.meta.dirname, "..", "..", "bin", "reax.mjs");
  const shim = join(dir, "reax");
  writeFileSync(shim, `#!/bin/sh\nexec "${process.execPath}" "${bin}" "$@"\n`);
  chmodSync(shim, 0o755);
  writeFileSync(join(dir, "reax.cmd"), `@"${process.execPath}" "${bin}" %*\r\n`);
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
  try {
    for (let rep = 1; rep <= o.reps; rep++)
      for (const t of o.tasks) {
        const ws = workspace(t, o.fixturesBin);
        try {
          const r = await backend.run(prompt(t), {
            workspace: ws,
            toolsDir: tools,
            deadline: Date.now() + cfg.cell.timeoutMs,
          });
          const name = `${o.backend}-${t.id}-${rep}.txt`;
          writeFileSync(
            join(o.out, "transcripts", name),
            `# prompt\n\n${prompt(t)}\n\n# answer\n\n${r.answer}\n\n# transcript\n\n${r.transcript}`,
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
            error: r.error ?? null,
            timed_out: !!r.timed_out,
            transcript: `transcripts/${name}`,
            grade: grade(t, r.answer),
            grade_first: r.first_answer !== undefined ? grade(t, r.first_answer) : null,
          };
          cells.push(cell);
          o.onCell?.(cell);
          writeFileSync(join(o.out, "cells.jsonl"), `${cells.map((c) => JSON.stringify(c)).join("\n")}\n`);
          if (cell.error?.startsWith("memory cap")) break;
        } finally {
          rmSync(ws, { recursive: true, force: true });
        }
      }
  } finally {
    if (own) server?.stop();
  }
  writeFileSync(join(o.out, "summary.md"), liveSummary(cells));
  return cells;
}

export function liveSummary(cells: LiveCell[]): string {
  const out = [
    "# Live benchmark summary",
    "",
    "| Backend | Cells | Mean accuracy | Hits | Wrong | Label errors | Parse errors | Errors | Mean s | Cost USD | Models |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|",
  ];
  const by = new Map<string, LiveCell[]>();
  for (const c of cells) by.set(c.backend, [...(by.get(c.backend) ?? []), c]);
  for (const [b, cs] of by) {
    const s = (f: (c: LiveCell) => number) => cs.reduce((a, c) => a + f(c), 0);
    out.push(
      `| ${b} | ${cs.length} | ${(s((c) => c.grade.accuracy) / cs.length).toFixed(3)} | ${s((c) => c.grade.hits)}/${s((c) => c.grade.positives)} | ${s((c) => c.grade.wrong)} | ${s((c) => c.grade.labelErrors)} | ${cs.filter((c) => c.grade.parseError).length} | ${cs.filter((c) => c.error).length} | ${(s((c) => c.run.ms) / cs.length / 1000).toFixed(1)} | ${s((c) => c.run.cost_usd).toFixed(3)} | ${[...new Set(cs.map((c) => c.run.model))].join("; ")} |`,
    );
  }
  const hybrid = cells.filter((c) => c.grade_first);
  if (hybrid.length) {
    const m = (f: (c: LiveCell) => number) => (hybrid.reduce((a, c) => a + f(c), 0) / hybrid.length).toFixed(3);
    out.push(
      "",
      `Hybrid: the local worker's first answers averaged ${m((c) => c.grade_first!.accuracy)}; after review, ${m((c) => c.grade.accuracy)}.`,
    );
  }
  const errors = cells.filter((c) => c.error);
  if (errors.length) out.push("", "## Errors", "", ...errors.map((c) => `- ${c.backend} ${c.task}: ${c.error}`));
  return `${out.join("\n")}\n`;
}
