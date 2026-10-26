import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { cmpKey, readJsonl } from "../src/ledger/io.ts";
import { loadLedger } from "../src/ledger/load.ts";
import { section } from "../src/ledger/markdown.ts";
import type { LimitationRow, ParityRow } from "../src/ledger/schema.ts";
import {
  donorLimitations,
  leanreaLimitations,
  leanreaParity,
  merge,
  OWNED,
  type PhaseMap,
  reaLimitations,
  reaParity,
} from "../src/ledger/seed.ts";

const REAX = join(import.meta.dirname, "..");
const ROOT = join(REAX, "..", "..");
const LEDGER = join(REAX, "docs", "ledger");
const phases = JSON.parse(readFileSync(join(LEDGER, "phase-map.json"), "utf8")) as PhaseMap;
const profile = (name: string) =>
  readFileSync(join(ROOT, "docs", "profiles", `${name}.md`), "utf8").replaceAll("\r\n", "\n");

/** First-cell ids of every table row in a section, counted with a plain regex rather than the
 * seeder's table reader, so a seeder bug that drops rows cannot also hide them here. */
function idsIn(text: string, heading: string, re: RegExp): Set<string> {
  const out = new Set<string>();
  for (const l of section(text, heading).lines) {
    const m = l.match(re);
    if (m) out.add(m[1]!);
  }
  return out;
}

test("[+RX-0b/register-seeded] the committed ledger equals a fresh seed of the profiles", () => {
  const fresh: [string, (LimitationRow | ParityRow)[]][] = [
    ["limitations/rea.jsonl", reaLimitations(ROOT)],
    ["limitations/leanrea.jsonl", leanreaLimitations(ROOT)],
    ["limitations/donors.jsonl", donorLimitations(ROOT)],
    ["parity/rea.jsonl", reaParity(ROOT, phases)],
    ["parity/leanrea.jsonl", leanreaParity(ROOT, phases)],
  ];
  for (const [file, rows] of fresh) {
    const committed = new Set(
      readJsonl<LimitationRow | ParityRow>(join(LEDGER, file)).map((r) => ("id" in r ? r.id : r.key)),
    );
    const missing = rows.map((r) => ("id" in r ? r.id : r.key)).filter((k) => !committed.has(k));
    assert.deepEqual(missing, [], `${file} is missing rows the profile has; run npm run seed`);
    assert.ok(rows.length > 0, `${file}: the seeder found no rows`);
  }
});

test("[+RX-0b/register-seeded] an independent count of profile ids matches the ledger", () => {
  const parity = new Set(readJsonl<ParityRow>(join(LEDGER, "parity", "rea.jsonl")).map((r) => r.key));
  for (const id of idsIn(profile("rea"), "## 5.", /^\|\s*(REA-C\d+[a-z]?)\s*\|/))
    assert.ok(parity.has(`rea.family/${id}`), `rea family ${id} is not in parity/rea.jsonl`);
  const cat = JSON.parse(readFileSync(join(LEDGER, "sources", "rea-6.8.0-tools.json"), "utf8")) as {
    tool_count: number;
    tools: { name: string }[];
    prompts: string[];
  };
  assert.equal(cat.tools.length, cat.tool_count);
  assert.equal(cat.tools.length, 229, "rea 6.8.0 lists 229 tools");
  for (const t of cat.tools) assert.ok(parity.has(`rea.tool/${t.name}`), `rea tool ${t.name} has no row`);
  for (const p of cat.prompts) assert.ok(parity.has(`rea.prompt/${p}`), `rea prompt ${p} has no row`);

  const lean = new Set(readJsonl<ParityRow>(join(LEDGER, "parity", "leanrea.jsonl")).map((r) => r.key));
  const leanIds = idsIn(profile("leanrea"), "## 5.", /^\|\s*(LEAN-[CT]\d+)\s*\|/);
  assert.ok(leanIds.size > 50);
  for (const id of leanIds) assert.ok(lean.has(`leanrea/${id}`), `leanrea ${id} has no row`);

  const issues = new Set(readJsonl<LimitationRow>(join(LEDGER, "limitations", "rea.jsonl")).map((r) => r.id));
  const nums = [
    ...section(profile("rea"), "### 3.1")
      .lines.join("\n")
      .matchAll(/^\|[^|\n]*\|\s*\[#(\d+)\]/gm),
  ].map((m) => m[1]);
  assert.ok(nums.length > 0);
  for (const n of nums) assert.ok(issues.has(`REA-ISS-${n}`), `rea issue #${n} has no limitation row`);
});

test("[+RX-0b/register-seeded] every seeded row points at text that is in its profile section", () => {
  for (const { row } of loadLedger(LEDGER).limitations) {
    if (row.subject === "reax" || row.orphaned) continue;
    const text = readFileSync(join(ROOT, row.source.file), "utf8");
    const body = section(text, row.source.section).lines.join("\n");
    assert.ok(body.length > 0, `${row.id}: section ${row.source.section} is empty`);
  }
});

test("[-RX-0b/register-seeded] a profile whose section heading was renamed makes the seeder fail", () => {
  const dir = mkdtempSync(join(tmpdir(), "reax-seed-"));
  try {
    cpSync(join(ROOT, "docs", "profiles"), join(dir, "docs", "profiles"), { recursive: true });
    const f = join(dir, "docs", "profiles", "rea.md");
    writeFileSync(f, readFileSync(f, "utf8").replace(/^### 9A\./m, "### Nine A."));
    assert.throws(() => reaLimitations(dir), /no heading starting with "### 9A\."/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const lim = (id: string, over: Partial<LimitationRow> = {}): LimitationRow => ({
  id,
  subject: "rea",
  category: "other",
  title: `row ${id}`,
  evidence: "e",
  severity: "unrated",
  kind: "unknown",
  source: { file: "docs/profiles/rea.md", section: "### 9B.", key: id },
  fix: null,
  phase: null,
  platforms: ["linux"],
  wont: null,
  ...over,
});

test("[+RX-0b/register-orphans] a row the profile dropped is kept, marked orphaned, and keeps its triage", () => {
  const existing = [lim("A", { fix: "do x", phase: 1 }), lim("B", { fix: "do y", phase: 2 })];
  const out = merge(
    existing,
    [lim("A", { title: "row A, reworded" })],
    (r) => r.id,
    OWNED.limitation,
    new Set(["docs/profiles/rea.md"]),
  );
  const a = out.find((r) => r.id === "A")!;
  const b = out.find((r) => r.id === "B")!;
  assert.equal(a.title, "row A, reworded", "profile-owned fields refresh");
  assert.equal(a.fix, "do x", "triage survives a re-seed");
  assert.equal(a.phase, 1);
  assert.equal(b.orphaned, true);
  assert.equal(b.fix, "do y");
});

test("[-RX-0b/register-orphans] rows the seeder does not own pass through; a re-added row is no longer orphaned", () => {
  const own = lim("RX-1", { subject: "reax", source: { file: "apps/reax/src/x.ts", section: "-", key: "1" } });
  const back = lim("B", { orphaned: true });
  const out = merge([own, back], [lim("B")], (r) => r.id, OWNED.limitation, new Set(["docs/profiles/rea.md"]));
  assert.equal(out.find((r) => r.id === "RX-1")!.orphaned, undefined);
  assert.equal(out.find((r) => r.id === "B")!.orphaned, undefined);
  assert.throws(() => merge([], [lim("C"), lim("C")], (r) => r.id, OWNED.limitation, new Set()), /twice/);
});

test("[+RX-0b/ledger-valid] the committed ledger loads, validates, and every file is sorted", () => {
  const l = loadLedger(LEDGER);
  assert.ok(l.limitations.length > 200 && l.parity.length > 300);
  for (const dir of ["limitations", "parity"]) {
    const files = new Set((dir === "parity" ? l.parity : l.limitations).map((x) => x.file));
    for (const f of files) {
      const keys = readJsonl<LimitationRow | ParityRow>(join(LEDGER, dir, f)).map((r) => ("id" in r ? r.id : r.key));
      assert.deepEqual(keys, [...keys].sort(cmpKey), `${dir}/${f} is not sorted by key`);
    }
  }
});

test("[-RX-0b/ledger-valid] a key in two files, a bad phase and an unreviewed wont are refused", () => {
  const dir = mkdtempSync(join(tmpdir(), "reax-ledger-"));
  mkdirSync(join(dir, "limitations"), { recursive: true });
  mkdirSync(join(dir, "parity"), { recursive: true });
  cpSync(join(LEDGER, "parity", "reax.jsonl"), join(dir, "parity", "reax.jsonl"));
  const put = (rel: string, rows: object[]) =>
    writeFileSync(join(dir, rel), rows.map((r) => JSON.stringify(r)).join("\n"));
  try {
    put("limitations/a.jsonl", [lim("X")]);
    put("limitations/b.jsonl", [lim("X")]);
    assert.throws(() => loadLedger(dir), /ledger key X is in both/);
    rmSync(join(dir, "limitations", "b.jsonl"));
    put("limitations/a.jsonl", [lim("X", { phase: 9 })]);
    assert.throws(() => loadLedger(dir), /phase is 0-4/);
    put("limitations/a.jsonl", [lim("X", { wont: { reason: "costly", reviewer: "" } })]);
    assert.throws(() => loadLedger(dir), /a wont needs a reason and a reviewer/);
    writeFileSync(join(dir, "limitations", "a.jsonl"), "{not json");
    assert.throws(() => loadLedger(dir), /a\.jsonl:1: not JSON/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
