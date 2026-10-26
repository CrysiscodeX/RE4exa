import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { type Case, parseJunit, tagsOf } from "../src/ledger/junit.ts";
import type { LimitationRow, ParityRow, Platform } from "../src/ledger/schema.ts";
import { computeStatus, gateFailures, laneOf } from "../src/ledger/status.ts";

const REAX = join(import.meta.dirname, "..");
let dir: string;
let realXml: string;

// A real JUnit report from this Node, not a hand-written imitation of one.
before(() => {
  dir = mkdtempSync(join(tmpdir(), "reax-junit-"));
  writeFileSync(
    join(dir, "sample.test.mjs"),
    [
      'import { test, describe } from "node:test";',
      'import assert from "node:assert";',
      'test("[+K-1] passes & <escapes>", () => {});',
      'test("[-K-1] fails", () => { assert.equal(1, 2); });',
      'test("[+K-2] skipped", { skip: "no engine" }, () => {});',
      'test("[+K-3] todo", { todo: true }, () => {});',
      'describe("group", () => { test("[-K-2] nested passes", () => {}); });',
    ].join("\n"),
  );
  const out = join(dir, "linux.xml");
  spawnSync(
    process.execPath,
    ["--test", "--test-reporter=junit", `--test-reporter-destination=${out}`, "sample.test.mjs"],
    {
      cwd: dir,
      // Without NODE_TEST_CONTEXT the child reports to its own file, not to this runner.
      env: { ...process.env, NODE_OPTIONS: "", NODE_TEST_CONTEXT: undefined },
    },
  );
  realXml = readFileSync(out, "utf8");
});
after(() => rmSync(dir, { recursive: true, force: true }));

test("[+RX-0b/junit-read] a node --test JUnit report gives each test's name and outcome", () => {
  const cases = parseJunit(realXml);
  const by = new Map(cases.map((c) => [c.name, c.outcome]));
  assert.equal(by.get("[+K-1] passes & <escapes>"), "pass", "entities are decoded");
  assert.equal(by.get("[-K-1] fails"), "fail");
  assert.equal(by.get("[+K-2] skipped"), "skip");
  assert.notEqual(by.get("[+K-3] todo"), "pass", "a todo test proves nothing");
  assert.equal(by.get("[-K-2] nested passes"), "pass", "tests inside a describe are read");
  assert.deepEqual(tagsOf("[+A/b] and [-C.d] [x] [+]"), [
    { polarity: "+", key: "A/b" },
    { polarity: "-", key: "C.d" },
  ]);
});

test("[-RX-0b/junit-read] a file that is not a JUnit report, or a nameless test case, is refused", () => {
  assert.throws(() => parseJunit("TAP version 13\nok 1 - x\n"), /not a JUnit report/);
  assert.throws(() => parseJunit("<testsuites><testcase classname='x'/></testsuites>"), /no name/);
});

const P: Platform[] = ["linux", "darwin", "win32"];
const row = (key: string, over: Partial<ParityRow> = {}): ParityRow => ({
  key,
  kind: "reax-infra",
  title: `row ${key}`,
  family: null,
  reax: { tool: null, operation: null, engine: null },
  phase: 0,
  platforms: P,
  wont: null,
  source: null,
  ...over,
});
const lim = (id: string): LimitationRow => ({
  id,
  subject: "reax",
  category: "other",
  title: `limitation ${id}`,
  evidence: "",
  severity: "unrated",
  kind: "design",
  source: { file: "x", section: "x", key: id },
  fix: "f",
  phase: 1,
  platforms: ["linux"],
  wont: null,
});
const c = (name: string, outcome: Case["outcome"] = "pass"): Case => ({ name, file: "t", outcome });
const both = (k: string) => [c(`[+${k}] works`), c(`[-${k}] refuses`)];
const lanes = (cases: Record<string, Case[]>) => Object.entries(cases).map(([n, cs]) => laneOf(n, cs));
const statusOf = (rows: (ParityRow | LimitationRow)[], ls: ReturnType<typeof lanes>, doc = (_op: string) => true) =>
  new Map(computeStatus(rows, ls, doc).rows.map((s) => [s.key, s.status]));

test("[+RX-0b/status-computed] covered needs a passing + and - test on every platform the row names", () => {
  const s = statusOf(
    [row("A"), lim("L-1")],
    lanes({ linux: [...both("A"), ...both("L-1")], darwin: both("A"), "win32-engines": both("A") }),
  );
  assert.equal(s.get("A"), "covered", "a suffixed lane counts for its platform");
  assert.equal(s.get("L-1"), "fixed", "a limitation is fixed, not covered");
});

test("[-RX-0b/status-computed] skips, missing lanes, one polarity and undocumented operations are not covered", () => {
  const rows = [
    row("S"),
    row("M"),
    row("ONE"),
    row("OP", { reax: { tool: "read", operation: "read.elf", engine: null } }),
  ];
  const all = [...both("M"), c("[+ONE] works"), ...both("OP"), c("[+S] works", "skip"), c("[-S] refuses", "skip")];
  const s = statusOf(rows, lanes({ linux: all, darwin: all }), (op) => op !== "read.elf");
  assert.equal(s.get("S"), "planned", "a skipped test counts as not run");
  assert.equal(s.get("M"), "partial", "win32 has no lane in this run");
  assert.equal(s.get("ONE"), "partial", "no negative test");
  assert.equal(s.get("OP"), "partial", "the operation is not in docs/operations.md");
  const why = computeStatus([row("M")], lanes({ linux: both("M") }), () => true).rows[0]!.why;
  assert.match(why, /darwin: no lane in this run; win32: no lane in this run/);
});

test("[+RX-0b/status-regressed] one failing tagged test, on any lane, makes the row regressed", () => {
  const s = statusOf(
    [row("R")],
    lanes({ linux: both("R"), darwin: both("R"), win32: [...both("R"), c("[-R] edge", "fail")] }),
  );
  assert.equal(s.get("R"), "regressed");
});

test("[-RX-0b/status-regressed] a failing test that is not tagged with the key does not touch the row", () => {
  const ok = [...both("R"), c("[+OTHER] x", "fail"), c("untagged", "fail")];
  const s = statusOf([row("R"), row("OTHER")], lanes({ linux: ok, darwin: ok, win32: ok }));
  assert.equal(s.get("R"), "covered");
  assert.equal(s.get("OTHER"), "regressed");
});

test("[+RX-0b/unknown-tags] a tag that names no ledger row is reported", () => {
  const r = computeStatus([row("A")], lanes({ linux: [...both("A"), c("[+A-typo] x")] }), () => true);
  assert.deepEqual(r.unknownTags, ["A-typo"]);
});

test("[-RX-0b/unknown-tags] tags that name rows are not reported, and an unknown lane name is refused", () => {
  assert.deepEqual(computeStatus([row("A")], lanes({ linux: both("A") }), () => true).unknownTags, []);
  assert.throws(() => laneOf("ubuntu", []), /must start with linux, darwin or win32/);
});

test("[+RX-0b/phase-gate] the gate passes when every row of the phase is covered, fixed or a reviewed wont", () => {
  const rows = [
    row("A"),
    row("W", { wont: { reason: "no open equal", reviewer: "lead" } }),
    row("LATER", { phase: 2 }),
  ];
  const ls = lanes({ linux: both("A"), darwin: both("A"), win32: both("A") });
  assert.deepEqual(gateFailures(computeStatus(rows, ls, () => true).rows, 0), []);
});

test("[-RX-0b/phase-gate] the gate fails on a planned or partial row at or below the phase, not on later or untriaged ones", () => {
  const rows = [row("P"), row("Q", { phase: 1 }), row("U", { phase: null }), row("LATER", { phase: 3 })];
  const ls = lanes({ linux: both("Q") });
  const keys = (n: number) => gateFailures(computeStatus(rows, ls, () => true).rows, n).map((s) => s.key);
  assert.deepEqual(keys(0), ["P"]);
  assert.deepEqual(keys(1), ["P", "Q"]);
});

function runCheck(ledger: string, reports: string, ...extra: string[]) {
  return spawnSync(
    process.execPath,
    [
      "--conditions=source",
      "--disable-warning=ExperimentalWarning",
      join(REAX, "scripts", "parity-check.ts"),
      "--ledger",
      ledger,
      "--reports",
      reports,
      "--out",
      join(reports, "parity.md"),
      ...extra,
    ],
    { encoding: "utf8", env: { ...process.env, GITHUB_STEP_SUMMARY: "" } },
  );
}

function junit(cases: [string, Case["outcome"]][]) {
  const body = cases
    .map(([n, o]) =>
      o === "pass"
        ? `<testcase name="${n}"/>`
        : `<testcase name="${n}">${o === "fail" ? "<failure/>" : "<skipped/>"}</testcase>`,
    )
    .join("");
  return `<?xml version="1.0"?><testsuites>${body}</testsuites>`;
}

test("[+RX-0b/phase-gate] parity-check exits 0 and writes the report when the gate is met", () => {
  const d = mkdtempSync(join(tmpdir(), "reax-check-"));
  try {
    mkdirSync(join(d, "ledger", "parity"), { recursive: true });
    mkdirSync(join(d, "reports"));
    writeFileSync(join(d, "ledger", "parity", "x.jsonl"), `${JSON.stringify(row("A"))}\n`);
    for (const p of P)
      writeFileSync(
        join(d, "reports", `${p}.xml`),
        junit([
          ["[+A] w", "pass"],
          ["[-A] r", "pass"],
        ]),
      );
    const r = runCheck(join(d, "ledger"), join(d, "reports"), "--gate-phase", "0");
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.match(readFileSync(join(d, "reports", "parity.md"), "utf8"), /Gate passed/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("[-RX-0b/unknown-tags] parity-check exits 1 on an unknown tag, a regression, an orphan or an unmet gate", () => {
  const d = mkdtempSync(join(tmpdir(), "reax-check-"));
  try {
    mkdirSync(join(d, "ledger", "parity"), { recursive: true });
    mkdirSync(join(d, "reports"));
    const ledger = join(d, "ledger");
    const write = (rows: ParityRow[], cases: [string, Case["outcome"]][]) => {
      writeFileSync(join(ledger, "parity", "x.jsonl"), rows.map((x) => JSON.stringify(x)).join("\n"));
      for (const p of P) writeFileSync(join(d, "reports", `${p}.xml`), junit(cases));
    };
    const ok: [string, Case["outcome"]][] = [
      ["[+A] w", "pass"],
      ["[-A] r", "pass"],
    ];
    write([row("A")], [...ok, ["[+NOPE] x", "pass"]]);
    assert.match(runCheck(ledger, join(d, "reports")).stdout, /tagged with NOPE, which no ledger row has/);
    write([row("A")], [...ok, ["[-A] r2", "fail"]]);
    assert.equal(runCheck(ledger, join(d, "reports")).status, 1);
    write([row("A"), row("B", { orphaned: true, phase: 4 })], ok);
    assert.match(runCheck(ledger, join(d, "reports")).stdout, /B is orphaned/);
    write([row("A"), row("B")], ok);
    const gated = runCheck(ledger, join(d, "reports"), "--gate-phase", "0");
    assert.equal(gated.status, 1);
    assert.match(gated.stdout, /Gate failed:\*\* 1 row of phase/);
    rmSync(join(d, "reports"), { recursive: true });
    assert.match(runCheck(ledger, join(d, "reports")).stderr, /no JUnit reports/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
