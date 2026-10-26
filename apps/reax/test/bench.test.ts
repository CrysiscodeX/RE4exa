import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Manifest } from "../scripts/fixtures.ts";
import { PERTURBATIONS } from "../src/bench/fake.ts";
import { grade, parseClaims } from "../src/bench/grade.ts";
import { loadTasks, runCells, workspace } from "../src/bench/run.ts";
import type { Task } from "../src/bench/types.ts";

const REAX = join(import.meta.dirname, "..");
const BIN = join(REAX, "fixtures", "bin");
const tasks = loadTasks(join(REAX, "bench", "tasks"));
const byId = new Map(tasks.map((t) => [t.id, t]));
const manifest = JSON.parse(readFileSync(join(REAX, "fixtures", "manifest.json"), "utf8")) as Manifest;

const block = (rows: unknown[]) => `\`\`\`claims\n${JSON.stringify(rows)}\n\`\`\``;
const perfect = (t: Task) =>
  block(
    t.oracle
      .filter((o) => o.expect)
      .map((o) => ({ predicate: o.predicate, subject: o.subject, value: o.value, label: "observed" })),
  );

test("[+RX-0c/bench-grader] [+leanrea/LEAN-C56] a correct answer scores 1 on every task, in any accepted vocabulary", () => {
  for (const t of tasks) {
    const g = grade(t, perfect(t));
    assert.equal(g.accuracy, 1, `${t.id}: ${JSON.stringify(g.detail)}`);
    assert.equal(g.wrong + g.labelErrors, 0, t.id);
  }
  const t = byId.get("identify-hello-universal-macos-s")!;
  const f = t.subjects[0]!.file;
  const g = grade(
    t,
    `prose\n${block([
      { predicate: "format", subject: `./bin/${f}`, value: "Mach-O universal", label: "observed" },
      { predicate: "arch", subject: f, value: "x86-64", label: "Observed" },
      { predicate: "native.arch", subject: f, value: "arm64", label: "observed" },
    ])}`,
  );
  assert.equal(g.accuracy, 1, JSON.stringify(g.detail));
});

test("[-RX-0c/bench-grader] [-leanrea/LEAN-C56] refuted facts, values outside a complete set, prose-only and malformed answers lose", () => {
  const links = byId.get("links-hello-x86_64-linux-gnu.2.28-s")!;
  const f = links.subjects[0]!.file;
  const g1 = grade(
    links,
    `It links libc.so.6 and uses /lib64/ld-linux-x86-64.so.2.\n${block([
      { predicate: "native.links", subject: f, value: "libc.so.6", label: "observed" },
      { predicate: "native.links", subject: f, value: "libc.so.6", label: "observed" },
      { predicate: "native.links", subject: f, value: "libssl.so.3", label: "observed" },
      { predicate: "native.links", subject: f, value: "libm.so.6", label: "observed" },
      { predicate: "native.interpreter", subject: f, value: "/lib/ld-musl-x86_64.so.1", label: "observed" },
      { predicate: "native.entry", subject: f, value: "0x1000", label: "observed" },
    ])}`,
  );
  assert.deepEqual(
    { hits: g1.hits, wrong: g1.wrong, unscored: g1.unscored, positives: g1.positives },
    { hits: 1, wrong: 3, unscored: 1, positives: 2 },
    "duplicate counted once; libssl refuted; libm outside the complete set; a second interpreter is wrong",
  );
  assert.equal(g1.accuracy, -1);
  const prose = grade(links, "It links libc.so.6 and its interpreter is /lib64/ld-linux-x86-64.so.2.");
  assert.equal(prose.accuracy, 0, "prose outside a claims block is not graded");
  assert.equal(prose.parseError, "no claims block");
  assert.match(parseClaims("```claims\n[{oops]\n```").error!, /not JSON/);
  assert.equal(parseClaims('```claims\n{"a":1}\n```').error, "claims block is not an array");
  const musl = byId.get("links-hello-x86_64-linux-musl-s")!;
  const m = musl.subjects[0]!.file;
  const none = grade(
    musl,
    block([
      { predicate: "native.links", subject: m, value: null, label: "observed" },
      { predicate: "native.interpreter", subject: m, value: "none", label: "observed" },
    ]),
  );
  assert.equal(none.accuracy, 1, "an explicit none is the answer for a static binary");
  const some = grade(musl, block([{ predicate: "native.links", subject: m, value: "libc.so", label: "observed" }]));
  assert.equal(some.wrong, 1, "any library claimed for a static binary is wrong");
  const inferred = grade(
    links,
    block([{ predicate: "native.links", subject: f, value: "libc.so.6", label: "inferred" }]),
  );
  assert.equal(inferred.labelErrors, 1, "an observable fact labelled inferred is a label error");
});

test("[+RX-0c/bench-tasks] 30 tasks over the fixture corpus, each subject pinned by the corpus digest", () => {
  assert.equal(tasks.length, 30);
  const digests = new Map(manifest.entries.flatMap((e) => e.outputs).map((o) => [o.file, o.sha256]));
  const classes = new Set(tasks.map((t) => t.class));
  for (const c of ["cheap", "medium", "deep", "adversarial"])
    assert.ok(classes.has(c as Task["class"]), `has a ${c} task`);
  for (const t of tasks) {
    assert.ok(
      t.oracle.some((o) => o.expect),
      `${t.id} has a positive item`,
    );
    for (const s of t.subjects) assert.equal(s.sha256, digests.get(s.file), `${t.id}: ${s.file}`);
    for (const o of t.oracle)
      assert.ok(
        t.subjects.some((s) => s.file === o.subject),
        `${t.id}: oracle subject ${o.subject} is a task subject`,
      );
  }
  assert.ok(
    tasks.filter((t) => t.oracle.some((o) => !o.expect)).length >= 15,
    "at least half the tasks have a refuted fact to avoid",
  );
});

test("[-RX-0c/bench-tasks] a subject whose bytes differ from the task's digest is refused", () => {
  const t = structuredClone(byId.get("identify-hello-x86_64-linux-musl-s")!);
  t.subjects[0]!.sha256 = "0".repeat(64);
  assert.throws(() => workspace(t, BIN), /does not match the task's digest/);
});

const llvm = ["llvm-readobj", "llvm-readobj-18"].some((c) => spawnSync(c, ["--version"]).status === 0);
test("[+RX-0c/bench-oracle] the committed tasks match a fresh run of LLVM's tools over the corpus", {
  skip: process.platform === "linux" && llvm ? false : "needs LLVM 18 tools on Linux",
}, () => {
  const r = spawnSync(
    process.execPath,
    ["--conditions=source", "--disable-warning=ExperimentalWarning", join(REAX, "bench", "make-tasks.ts"), "--check"],
    { encoding: "utf8" },
  );
  assert.equal(r.status, 0, r.stderr + r.stdout);
});

test("[-RX-0c/bench-oracle] the oracle records what the source has but the binary does not", () => {
  const cpp = byId.get("cpp-functions")!;
  assert.deepEqual(
    cpp.oracle.filter((o) => !o.expect).map((o) => o.value),
    ["reax::Circle::area", "reax::twice"],
    "inlined at -O2: claiming them is wrong",
  );
  const exe = byId.get("exports-hello-x86_64-linux-gnu.2.28-s")!;
  assert.ok(
    exe.oracle.some((o) => o.expect && o.complete && o.value === null),
    "an executable exports no reax_* symbol",
  );
});

test("[+RX-0c/bench-harness] the fake arm runs every task and each cell records what the plan asks for", () => {
  const out = mkdtempSync(join(tmpdir(), "reax-bench-"));
  try {
    const cells = runCells({ arm: "fake", tasks, reps: 1, fixturesBin: BIN, out });
    assert.equal(cells.length, 30);
    for (const c of cells) {
      for (const k of [
        "model",
        "skill_commit",
        "targets",
        "tools",
        "turns",
        "tool_calls",
        "tokens",
        "cost_usd",
        "ms",
        "timed_out",
        "transcript",
      ])
        assert.ok(k in c, `${c.task}: ${k}`);
      assert.ok(readFileSync(join(out, c.transcript), "utf8").includes("```claims") || c.grade.parseError);
      if (!PERTURBATIONS[c.task] || c.task === "identify-hello-x86_64-macos-s")
        assert.equal(c.grade.accuracy, 1, c.task);
    }
    const g = (id: string) => cells.find((c) => c.task === id)!.grade;
    const links = byId.get("links-hello-x86_64-windows-gnu-s.exe")!.oracle.filter((o) => o.expect).length;
    assert.equal(g("links-hello-x86_64-windows-gnu-s.exe").hits, links - 1);
    assert.equal(g("exports-lib-x86_64-linux-gnu.2.28-s.so").wrong, 1);
    assert.equal(g("adversarial-note").wrong, 2);
    assert.deepEqual([g("cpp-functions").wrong, g("cpp-functions").labelErrors], [1, 1]);
    assert.equal(g("debug-pair").accuracy, 1);
    assert.equal(g("debug-pair").unscored, 1);
    assert.equal(g("tag-hello-wasm32-wasi-s.wasm").parseError, "no claims block");
    assert.equal(readFileSync(join(out, "cells.jsonl"), "utf8").trim().split("\n").length, 30);
    assert.match(readFileSync(join(out, "summary.md"), "utf8"), /\| fake \| adversarial \| 1 \|/);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test("[-RX-0c/bench-harness] a live arm is refused until it exists, and the CLI rejects an unknown arm", () => {
  assert.throws(
    () => runCells({ arm: "reax", tasks, reps: 1, fixturesBin: BIN, out: tmpdir() }),
    /not implemented yet/,
  );
  const r = spawnSync(
    process.execPath,
    ["--conditions=source", "--disable-warning=ExperimentalWarning", join(REAX, "bench", "run.ts"), "--arm", "gpt"],
    { encoding: "utf8" },
  );
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--arm is one of fake, reax, rea, leanrea/);
});
