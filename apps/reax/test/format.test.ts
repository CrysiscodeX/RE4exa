// The output formats, the response budget and paging. TOON and YAML are checked by round trip
// through independent decoders (the TOON reference decoder, the `yaml` package in YAML 1.2 and 1.1
// modes, and PyYAML where python3 has it) over seeded random JSON values built from the strings
// and numbers that break naive encoders.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { isCoreError } from "@re4exa/core/errors";
import { decode } from "@toon-format/toon";
import YAML from "yaml";
import { llms, main } from "../src/cli.ts";
import { filterOutput } from "../src/format/filter.ts";
import { FORMATS, limitTokens, markdown, type Rendered, render } from "../src/format/index.ts";
import { toToon } from "../src/format/toon.ts";
import { toYaml } from "../src/format/yaml.ts";
import { PAGE_INPUT, page } from "../src/ops/page.ts";
import { applyBudget, OPERATIONS, RESPONSE_BUDGET, runOperation, TEXT_CAP } from "../src/ops/registry.ts";
import { checkInput } from "../src/ops/schema.ts";
import type { Operation } from "../src/ops/types.ts";

const REAX = join(import.meta.dirname, "..");
const BIN = join(REAX, "fixtures", "bin");

// ------------------------------------------------------------------------------------------------
// seeded random JSON

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TRICKY = [
  "",
  " ",
  " lead",
  "trail ",
  "a,b",
  "a|b",
  "a\tb",
  "line\nbreak",
  "cr\rlf",
  'q"uote',
  "back\\slash",
  "colon: x",
  "a:b",
  "-",
  "- item",
  "-1",
  "1",
  "01",
  "1.0",
  "1e5",
  "1E-7",
  "-0",
  ".5",
  "5.",
  "0x10",
  "1_000",
  "Infinity",
  "NaN",
  "true",
  "false",
  "null",
  "True",
  "NULL",
  "~",
  "yes",
  "No",
  "on",
  "OFF",
  "y",
  "n",
  "2026-10-31",
  "12:30",
  "1:20:30",
  "#comment",
  "a #b",
  "&anchor",
  "*alias",
  "!tag",
  "%dir",
  "@at",
  "`tick",
  "? q",
  "| pipe",
  "> fold",
  "'single",
  "[x]",
  "{x}",
  "a]",
  "<<",
  "=",
  "\u0000nul",
  "\u0007bell",
  "\u007f",
  " sep",
  "é",
  "日本語",
  "😀 emoji",
  "​zero",
  "‮bidi",
  "key.with.dots",
  "__proto__",
  "constructor",
];
const NUMBERS = [
  0,
  -0,
  1,
  -1,
  42,
  0.1 + 0.2,
  1e21,
  1e-7,
  123456789012345680000,
  2 ** 53,
  -(2 ** 53),
  5e-324,
  1.7976931348623157e308,
  3.14,
  -2.5e-10,
  1e100,
];

function value(r: () => number, depth: number): unknown {
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)]!;
  const str = () =>
    r() < 0.7
      ? pick(TRICKY)
      : Array.from({ length: 1 + Math.floor(r() * 8) }, () => String.fromCodePoint(Math.floor(r() * 0x2fff))).join("");
  const k = r();
  if (depth <= 0 || k < 0.45) {
    const p = r();
    if (p < 0.1) return null;
    if (p < 0.2) return r() < 0.5;
    if (p < 0.45) return pick(NUMBERS);
    return str();
  }
  if (k < 0.6) return Array.from({ length: Math.floor(r() * 4) }, () => value(r, 0));
  if (k < 0.75) {
    // a uniform table
    const keys = Array.from({ length: 1 + Math.floor(r() * 3) }, str);
    return Array.from({ length: 1 + Math.floor(r() * 4) }, () =>
      Object.fromEntries(keys.map((key) => [key, value(r, 0)])),
    );
  }
  if (k < 0.85) return Array.from({ length: Math.floor(r() * 4) }, () => value(r, depth - 1));
  return Object.fromEntries(Array.from({ length: Math.floor(r() * 5) }, () => [str(), value(r, depth - 1)]));
}

/** The value as JSON sees it (NaN to null, -0 to 0, undefined dropped). */
const asJson = (v: unknown) => JSON.parse(JSON.stringify(v ?? null)) as unknown;

const CASES = (() => {
  const r = rng(0x5eed);
  const out: unknown[] = [
    {},
    [],
    { a: {} },
    { a: [] },
    [{}],
    [[]],
    [[1, 2], [3]],
    {
      items: [
        { a: 1, b: "x,y" },
        { a: 2, b: "z" },
      ],
    },
    { mixed: [1, { a: 1 }, [2], "s"] },
    { n: Number.NaN, i: Number.POSITIVE_INFINITY, z: -0 },
  ];
  for (let i = 0; i < 600; i++) out.push({ v: value(r, 4) });
  for (let i = 0; i < 100; i++) out.push(value(r, 3));
  return out;
})();

// ------------------------------------------------------------------------------------------------

test("[+RX-1/output-formats] TOON and YAML round-trip through independent decoders on 710 random and edge-case values", () => {
  let n = 0;
  for (const c of CASES) {
    const want = asJson(c);
    const t = toToon(c);
    assert.deepStrictEqual(decode(t), want, `TOON:\n${t}\nfrom ${JSON.stringify(c)}`);
    const y = toYaml(c);
    assert.deepStrictEqual(YAML.parse(y), want, `YAML 1.2:\n${y}\nfrom ${JSON.stringify(c)}`);
    assert.deepStrictEqual(YAML.parse(y, { version: "1.1" }), want, `YAML 1.1:\n${y}\nfrom ${JSON.stringify(c)}`);
    n++;
  }
  assert.equal(n, CASES.length);
  // PyYAML (a YAML 1.1 resolver written by others) reads every document the same way, where present
  const py = spawnSync("python3", ["-c", "import yaml"], { encoding: "utf8" });
  if (py.status === 0) {
    const dir = mkdtempSync(join(tmpdir(), "reax-yaml-"));
    try {
      const docs = CASES.map((c) => toYaml(c));
      writeFileSync(join(dir, "docs.json"), JSON.stringify(docs));
      const script =
        "import json,sys,yaml\n" +
        "docs=json.load(open(sys.argv[1],encoding='utf-8'))\n" +
        "print(json.dumps([yaml.safe_load(d) for d in docs]))";
      const r = spawnSync("python3", ["-I", "-c", script, join(dir, "docs.json")], {
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
      });
      assert.equal(r.status, 0, r.stderr);
      const got = JSON.parse(r.stdout) as unknown[];
      for (const [i, c] of CASES.entries()) assert.deepStrictEqual(got[i], asJson(c), `PyYAML:\n${docs[i]}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

const sample: Rendered = {
  operation: "demo.list",
  coverage: "partial",
  limitations: ["one | odd\nlimitation"],
  data: {
    file: "a.bin",
    items: [
      { name: "a|b", n: 1 },
      { name: "line\nbreak", n: 2, extra: "```" },
    ],
    page: { offset: 0, limit: 2, total: 5, next: 2 },
  },
  text: "a.bin: 2 rows",
};

test("[+RX-1/output-formats] every format renders the same result; jsonl and markdown keep one row per line", () => {
  for (const f of FORMATS) assert.ok(render(f, sample).length > 0, f);
  const j = JSON.parse(render("json", sample));
  assert.deepStrictEqual(j.data, sample.data);
  const lines = render("jsonl", sample).split("\n");
  assert.equal(lines.length, 3);
  const head = JSON.parse(lines[0]!);
  assert.equal(head.operation, "demo.list");
  assert.deepStrictEqual(head.page, sample.data && (sample.data as { page: unknown }).page);
  assert.deepStrictEqual(
    lines.slice(1).map((l) => JSON.parse(l)),
    (sample.data as { items: unknown[] }).items,
  );
  assert.deepStrictEqual(decode(render("toon", sample)), asJson({ ...sample, text: undefined }));
  assert.deepStrictEqual(YAML.parse(render("yaml", sample)), asJson({ ...sample, text: undefined }));
  const md = markdown(sample).split("\n");
  const table = md.filter((l) => l.startsWith("|"));
  assert.equal(table.length, 4, "header, rule and two rows");
  // escaped pipes do not add columns; newlines do not add rows
  for (const row of table) assert.equal(row.replaceAll("\\|", "").split("|").length - 2, 3, row);
  const fenced = markdown({ ...sample, data: { note: "has ``` inside" } });
  assert.match(fenced, /^````json$/m, "a body with ``` gets a longer fence");
  assert.deepStrictEqual(JSON.parse(fenced.split("\n").slice(3, -1).join("\n")), { note: "has ``` inside" });
});

test("[-RX-1/output-formats] an unknown format, a bad token limit and an unknown option are refused", async () => {
  const run = async (...argv: string[]) => {
    const errs: string[] = [];
    const w = process.stderr.write.bind(process.stderr);
    const o = process.stdout.write.bind(process.stdout);
    process.stderr.write = ((s: string) => {
      errs.push(s);
      return true;
    }) as typeof process.stderr.write;
    process.stdout.write = (() => true) as typeof process.stdout.write;
    try {
      return { code: await main(argv), err: errs.join("") };
    } finally {
      process.stderr.write = w;
      process.stdout.write = o;
    }
  };
  const base = ["op", "identify.file", "path=hello-x86_64-linux-gnu-s", "--workspace", BIN];
  let r = await run(...base, "--format", "xml");
  assert.equal(r.code, 1);
  assert.match(r.err, /--format is one of/);
  r = await run(...base, "--token-limit", "0");
  assert.equal(r.code, 1);
  assert.match(r.err, /--token-limit/);
  r = await run(...base, "--formt", "json");
  assert.equal(r.code, 1);
  assert.match(r.err, /unknown option --formt/);
  // a value that YAML 1.1 would read as a boolean or a number stays a string
  for (const s of ["yes", "No", "on", "0x10", "1e5", "1:20", "~", "<<"]) {
    assert.equal(YAML.parse(toYaml({ s }), { version: "1.1" }).s, s);
    assert.equal((decode(toToon({ s })) as { s: string }).s, s);
  }
});

/** Runs the CLI as a user does, in a child process, from another working directory. */
function cli(...argv: string[]) {
  const r = spawnSync(
    process.execPath,
    ["--conditions=source", "--disable-warning=ExperimentalWarning", join(REAX, "src", "cli.ts"), ...argv],
    { encoding: "utf8", cwd: tmpdir() },
  );
  return { code: r.status, out: r.stdout, err: r.stderr };
}

test("[+leanrea/LEAN-C10] every CLI output is capped: --token-limit cuts on a line and says how to get the rest", () => {
  const full = cli(
    "op",
    "inventory.native",
    "path=lib-x86_64-linux-gnu.2.28-s.so",
    "--workspace",
    BIN,
    "--format",
    "yaml",
  );
  assert.equal(full.code, 0, full.err);
  const cut = cli(
    "op",
    "inventory.native",
    "path=lib-x86_64-linux-gnu.2.28-s.so",
    "--workspace",
    BIN,
    "--format",
    "yaml",
    "--token-limit",
    "40",
  );
  assert.equal(cut.code, 0, cut.err);
  assert.ok(cut.out.length < full.out.length);
  assert.match(cut.out, /\[output cut at about 40 tokens/);
  // the envelope still closes around a cut body (inventory carries target text)
  assert.match(cut.out, /<\/untrusted-content id="[^"]+">\s*$/);
  const s = limitTokens("aaaa\nbbbb\ncccc", 2);
  assert.ok(s.startsWith("aaaa\n["), s);
  assert.equal(limitTokens("short", 100), "short");
});

test("[-leanrea/LEAN-C10] an operation's text over the cap is cut and says so; its data keeps everything", () => {
  const r = applyBudget("test.big", {
    data: { n: 1 },
    text: "x".repeat(20_000),
    coverage: "complete",
    limitations: [],
  });
  assert.equal(r.text.length, TEXT_CAP + "\n[text cut at 8000 characters; the full result is in data]".length);
  assert.match(r.text, /\[text cut at 8000 characters/);
  assert.deepStrictEqual(r.data, { n: 1 });
});

test("[+RX-1/paging] pages of any size reassemble the whole list, and page.next ends with null", () => {
  const all = Array.from({ length: 23 }, (_, i) => i);
  for (const limit of [1, 5, 22, 23, 50]) {
    const got: number[] = [];
    let offset: number | null = 0;
    let pages = 0;
    while (offset !== null) {
      const p: ReturnType<typeof page<number>> = page(all, { offset, limit });
      got.push(...p.items);
      assert.equal(p.page.total, 23);
      offset = p.page.next;
      pages++;
    }
    assert.deepStrictEqual(got, all, `limit ${limit}`);
    assert.equal(pages, Math.max(1, Math.ceil(23 / limit)));
  }
  assert.deepStrictEqual(page(all, { offset: 30, limit: 5 }), {
    items: [],
    page: { offset: 30, limit: 5, total: 23, next: null },
  });
  assert.equal(PAGE_INPUT.limit.maximum, 10_000);
});

test("[-RX-1/paging] a negative offset, a zero or oversized limit and a fractional offset are refused before the operation runs", () => {
  const schema = { type: "object" as const, properties: { ...PAGE_INPUT }, additionalProperties: false as const };
  for (const bad of [{ offset: -1 }, { limit: 0 }, { limit: 10_001 }, { offset: 1.5 }, { offset: "3" }])
    assert.throws(
      () => checkInput("test.page", schema, bad),
      (e: unknown) => isCoreError(e) && e.code === "bad_request",
      JSON.stringify(bad),
    );
  assert.doesNotThrow(() => checkInput("test.page", schema, { offset: 0, limit: 10_000 }));
});

/** A paged operation over a long list, to drive the response budget. */
const longList: Operation = {
  ...OPERATIONS[0]!,
  name: "test.long",
  input: { type: "object", properties: { ...PAGE_INPUT }, additionalProperties: false },
  async run(_ctx, args) {
    const all = Array.from({ length: 5000 }, (_, i) => ({ i, s: "y".repeat(100) }));
    const p = page(all, args);
    return { data: { ...p }, text: `${p.items.length} rows`, coverage: "complete", limitations: [] };
  },
};

test("[+rea.family/REA-C35] a page over the response budget is shortened to fit and continues where it stopped", async () => {
  const budget = 50_000;
  const seen: number[] = [];
  let offset: number | null = 0;
  let rounds = 0;
  while (offset !== null && rounds < 1000) {
    const r = applyBudget(longList.name, await longList.run({ workspace: BIN }, { offset, limit: 2000 }), budget);
    const d = r.data as { items: { i: number }[]; page: { next: number | null } };
    assert.ok(Buffer.byteLength(JSON.stringify(r.data)) <= budget);
    seen.push(...d.items.map((x) => x.i));
    if (d.page.next !== null) assert.match(r.limitations.join(" "), /continue at offset/);
    offset = d.page.next;
    rounds++;
  }
  assert.deepStrictEqual(
    seen,
    Array.from({ length: 5000 }, (_, i) => i),
  );
  assert.ok(rounds > 1);
  // a real operation stays within the default budget
  const inv = await runOperation("inventory.native", { path: "lib-x86_64-linux-gnu.2.28-s.so" }, { workspace: BIN });
  assert.ok(Buffer.byteLength(JSON.stringify(inv.data)) <= RESPONSE_BUDGET);
});

test("[-rea.family/REA-C35] a result over the budget that cannot page is refused with result_too_large", () => {
  const blob = { data: { s: "z".repeat(10_000) }, text: "", coverage: "complete" as const, limitations: [] };
  assert.throws(
    () => applyBudget("test.blob", blob, 1000),
    (e: unknown) => isCoreError(e) && e.code === "result_too_large",
  );
  // a page whose first row alone is over the budget is refused too, not returned empty
  const one = {
    data: { items: [{ s: "z".repeat(5000) }], page: { offset: 0, limit: 1, total: 1, next: null } },
    text: "",
    coverage: "complete" as const,
    limitations: [],
  };
  assert.throws(
    () => applyBudget("test.one", one, 1000),
    (e: unknown) => isCoreError(e) && e.code === "result_too_large",
  );
  // under the budget nothing changes
  const ok = applyBudget("test.ok", blob, 1_000_000);
  assert.equal(ok, blob);
});

test("[+RX-1/output-formats] --filter-output keeps the named paths (and page), and reports a path that matched nothing", () => {
  const data = {
    file: "x",
    slices: [
      { arch: "x86_64", exports: { names: ["a"], complete: true } },
      { arch: "aarch64", exports: { names: ["b"], complete: false } },
    ],
    page: { offset: 0, limit: 1, total: 1, next: null },
  };
  assert.deepStrictEqual(filterOutput(data, ["slices.arch"]), {
    data: { slices: [{ arch: "x86_64" }, { arch: "aarch64" }], page: data.page },
    unmatched: [],
  });
  assert.deepStrictEqual(filterOutput(data, ["slices.1.exports.names", "file"]).data, {
    slices: [{ exports: { names: ["b"] } }],
    file: "x",
    page: data.page,
  });
  assert.deepStrictEqual(
    (filterOutput(data, ["slices.arch", "slices.exports.complete"]).data as { slices: unknown }).slices,
    [
      { arch: "x86_64", exports: { complete: true } },
      { arch: "aarch64", exports: { complete: false } },
    ],
  );
  assert.deepStrictEqual(filterOutput(data, ["nope", "slices.9"]).unmatched, ["nope", "slices.9"]);
  const r = cli(
    "op",
    "inventory.native",
    "path=hello-universal-macos-s",
    "--workspace",
    BIN,
    "--format",
    "json",
    "--filter-output",
    "slices.arch,missing",
  );
  assert.equal(r.code, 0, r.err);
  const j = JSON.parse(r.out);
  assert.deepStrictEqual(j.data, { slices: [{ arch: "x86_64" }, { arch: "aarch64" }] });
  assert.match(j.limitations.join(" "), /missing matched nothing/);
});

test("[+RX-1/output-formats] --llms lists every operation with its arguments and an example that runs", () => {
  const r = cli("--llms");
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out.trimEnd(), llms());
  for (const op of OPERATIONS) {
    assert.match(r.out, new RegExp(`^## ${op.name.replace(".", "\\.")}$`, "m"));
    const ex = r.out.split("\n").find((l) => l.startsWith("  Example: ") && l.includes(` ${op.name}`))!;
    const argv = ex.replace("  Example: reax ", "").split(" ");
    const run = cli(...argv, "--workspace", BIN, "--format", "json");
    assert.equal(run.code, 0, `${ex}: ${run.err}`);
  }
  // every format is reachable from the command line, and untrusted text is enveloped outside JSON
  for (const f of FORMATS) {
    const o = cli("op", "inventory.native", "path=lib-x86_64-linux-gnu.2.28-s.so", "--workspace", BIN, "--format", f);
    assert.equal(o.code, 0, `${f}: ${o.err}`);
    if (f === "json" || f === "jsonl") assert.doesNotMatch(o.out, /untrusted-content/);
    else assert.match(o.out, /^<untrusted-content id=/, f);
  }
});
