// Run benchmark cells: one task, one arm, one repetition each. Every cell gets a fresh workspace
// holding copies of its subject files (digests checked) and any extra files, and records what the
// plan's §10 asks for: the raw transcript, model id, skill commit, target digests, tool versions,
// turn and tool-call counts, the cached and uncached token split, wall time and whether it timed
// out. Cells run one after another, never concurrently.

import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakeAnswer } from "./fake.ts";
import { type Grade, grade } from "./grade.ts";
import { ANSWER_FORMAT } from "./prompt.ts";
import type { Task } from "./types.ts";

export const ARMS = ["fake", "reax", "rea", "leanrea"] as const;
export type Arm = (typeof ARMS)[number];

export interface Cell {
  task: string;
  class: Task["class"];
  arm: Arm;
  rep: number;
  model: string;
  skill_commit: string | null;
  targets: { file: string; sha256: string }[];
  tools: Record<string, string>;
  turns: number;
  tool_calls: number;
  tokens: { input_uncached: number; input_cached: number; output: number };
  cost_usd: number;
  ms: number;
  timed_out: boolean;
  transcript: string;
  grade: Grade;
}

export function loadTasks(dir: string): Task[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as Task);
}

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

/** A fresh directory with the task's subjects (each checked against its digest) and extra files. */
export function workspace(t: Task, fixturesBin: string): string {
  const ws = mkdtempSync(join(tmpdir(), `reax-bench-${t.id.slice(0, 40)}-`));
  for (const s of t.subjects) {
    copyFileSync(join(fixturesBin, s.file), join(ws, s.file));
    if (sha(readFileSync(join(ws, s.file))) !== s.sha256)
      throw new Error(`${t.id}: ${s.file} does not match the task's digest`);
  }
  for (const f of t.extraFiles ?? []) writeFileSync(join(ws, f.name), f.text);
  return ws;
}

export function prompt(t: Task): string {
  return `${t.question}\n\n${ANSWER_FORMAT}`;
}

export interface RunOptions {
  arm: Arm;
  tasks: Task[];
  reps: number;
  fixturesBin: string;
  out: string;
}

export function runCells(o: RunOptions): Cell[] {
  if (o.arm !== "fake")
    throw new Error(
      `the ${o.arm} arm is not implemented yet (phase 0c has the fake arm only). Live arms run only under bench/PREREG.md, from a manual or scheduled workflow`,
    );
  mkdirSync(join(o.out, "transcripts"), { recursive: true });
  const cells: Cell[] = [];
  for (let rep = 1; rep <= o.reps; rep++)
    for (const t of o.tasks) {
      const ws = workspace(t, o.fixturesBin);
      const t0 = performance.now();
      try {
        const a = fakeAnswer(t);
        const name = `${o.arm}-${t.id}-${rep}.md`;
        writeFileSync(join(o.out, "transcripts", name), `# prompt\n\n${prompt(t)}\n\n# answer\n\n${a.answer}`);
        cells.push({
          task: t.id,
          class: t.class,
          arm: o.arm,
          rep,
          model: "fake",
          skill_commit: null,
          targets: t.subjects,
          tools: { node: process.version },
          turns: a.turns,
          tool_calls: a.toolCalls,
          tokens: { input_uncached: 0, input_cached: 0, output: 0 },
          cost_usd: 0,
          ms: Math.round(performance.now() - t0),
          timed_out: false,
          transcript: `transcripts/${name}`,
          grade: grade(t, a.answer),
        });
      } finally {
        rmSync(ws, { recursive: true, force: true });
      }
    }
  writeFileSync(
    join(o.out, "cells.jsonl"),
    cells.map((c) => JSON.stringify(c)).join("\n") + (cells.length ? "\n" : ""),
  );
  writeFileSync(join(o.out, "summary.md"), summary(cells));
  return cells;
}

export function summary(cells: Cell[]): string {
  const out = [
    "# Benchmark summary",
    "",
    "| Arm | Class | Cells | Mean accuracy | Hits | Wrong | Label errors | Parse errors |",
    "|---|---|---:|---:|---:|---:|---:|---:|",
  ];
  const groups = new Map<string, Cell[]>();
  for (const c of cells) groups.set(`${c.arm}\u0000${c.class}`, [...(groups.get(`${c.arm}\u0000${c.class}`) ?? []), c]);
  for (const [k, cs] of [...groups].sort()) {
    const [arm, klass] = k.split("\u0000");
    const sum = (f: (c: Cell) => number) => cs.reduce((a, c) => a + f(c), 0);
    out.push(
      `| ${arm} | ${klass} | ${cs.length} | ${(sum((c) => c.grade.accuracy) / cs.length).toFixed(3)} | ${sum((c) => c.grade.hits)}/${sum((c) => c.grade.positives)} | ${sum((c) => c.grade.wrong)} | ${sum((c) => c.grade.labelErrors)} | ${cs.filter((c) => c.grade.parseError).length} |`,
    );
  }
  return `${out.join("\n")}\n`;
}
