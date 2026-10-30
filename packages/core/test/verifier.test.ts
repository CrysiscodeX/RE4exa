import assert from "node:assert/strict";
import { test } from "node:test";
import { CoreError } from "../src/errors.ts";
import type { Json } from "../src/evidence/jcs.ts";
import { calibration, getClaim, getEvidence, recordClaim } from "../src/evidence/store.ts";
import { createProbeEngine } from "../src/probes/engine.ts";
import { buildTasks, writeFixtures } from "../src/testing/bench-tasks.ts";
import { openTemp, tmp } from "../src/testing/helpers.ts";
import { checkParams, PREDICATES } from "../src/verifier/predicates.ts";
import { createVerifier, parseClaimBlocks } from "../src/verifier/verifier.ts";

function setup(exec?: Parameters<typeof createVerifier>[0]["exec"]) {
  const store = openTemp();
  const w = tmp("assay-verify-");
  writeFixtures(w.dir);
  const engine = createProbeEngine({ kernel: store.k, workspace: w.dir, which: () => null });
  const verifier = createVerifier({ kernel: store.k, engine, ...(exec ? { exec } : {}) });
  const claim = (predicate: string, params: Json, over: Record<string, unknown> = {}) =>
    recordClaim(store.k, "case_v", "agent-a", {
      text: `${predicate} ${JSON.stringify(params)}`,
      label: "seen",
      predicate,
      params,
      ...over,
    });
  return {
    ...store,
    ws: w.dir,
    engine,
    verifier,
    claim,
    cleanup: () => {
      store.cleanup();
      w.cleanup();
    },
  };
}

test("every predicate verifies a true claim and refutes a false one, citing the evidence", async () => {
  const s = setup();
  try {
    const cases: [string, Json, Json][] = [
      ["file.contains", { path: "elf/tool", text: "libcurl.so.4" }, { path: "elf/tool", text: "libnope" }],
      ["file.identify", { path: "pe/agent.exe", format: "pe" }, { path: "pe/agent.exe", format: "macho" }],
      [
        "pkg.has-dependency",
        { path: "version-pair/v2", name: "telemetry-lite" },
        { path: "version-pair/v1", name: "telemetry-lite" },
      ],
      ["pkg.has-install-script", { path: "postinstall/evil-helper" }, { path: "version-pair/v1" }],
      [
        "js.imports",
        { path: "js-app/src/util.js", specifier: "node:fs" },
        { path: "js-app/src/util.js", specifier: "fs" },
      ],
      [
        "native.links",
        { path: "macho/Updater", library: "libsparkle.dylib" },
        { path: "macho/Updater", library: "libz.dylib" },
      ],
      ["native.arch", { path: "elf/tool", arch: "amd64" }, { path: "elf/tool", arch: "aarch64" }],
      ["native.exports", { path: "elf/tool", symbol: "tool_main" }, { path: "elf/tool", symbol: "no_such_symbol" }],
      [
        "archive.contains",
        { path: "zip-slip/update.zip", entry: "./app/readme.txt" },
        { path: "zip-slip/update.zip", entry: "x" },
      ],
      [
        "endpoint.present",
        { path: "js-app/src/main.js", host: "LIVE.example.org" },
        { path: "js-app/src/main.js", host: "nope.example" },
      ],
    ];
    for (const [pred, yes, no] of cases) {
      const v = await s.verifier.verify("case_v", s.claim(pred, yes));
      assert.equal(v.verdict, "verified", `${pred} ${v.reason}`);
      assert.ok(v.observation_id && getEvidence(s.k, v.observation_id), pred);
      const r = await s.verifier.verify("case_v", s.claim(pred, no));
      assert.equal(r.verdict, "refuted", `${pred} ${r.reason}`);
    }
    const hashClaim = s.claim("file.hash", { path: "elf/tool", sha256: "0".repeat(64) });
    assert.equal((await s.verifier.verify("case_v", hashClaim)).verdict, "refuted");
    const stored = getClaim(s.k, hashClaim.id)!;
    assert.equal(stored.verdict, "refuted");
    assert.ok(stored.verdict_record?.observation_id);
    assert.equal(stored.verdict_record?.probe, "file.hash");
  } finally {
    s.cleanup();
  }
});

test("unverifiable, with the reason: partial census, unsupported predicates, bad params, outside paths, changed subjects", async () => {
  const s = setup();
  try {
    const expect = async (pred: string, params: Json, re: RegExp, over: Record<string, unknown> = {}) => {
      const v = await s.verifier.verify("case_v", s.claim(pred, params, over));
      assert.equal(v.verdict, "unverifiable", `${pred}: ${v.reason}`);
      assert.match(v.reason, re);
    };
    await expect(
      "native.arch",
      { path: "version-pair/v1/package.json", arch: "x86_64" },
      /not a supported native binary/,
    );
    await expect(
      "native.exports",
      { path: "version-pair/v1/package.json", symbol: "x" },
      /not a supported native binary/,
    );
    await expect("js.imports", { path: "js-app/src/main.js", specifier: "lodash" }, /census is partial/);
    await expect(
      "endpoint.present",
      { path: "js-app/src/main.js", host: "legacy.example.net" },
      /not as an endpoint literal/,
    );
    await expect("net.listens", { path: "elf/tool" }, /unsupported predicate/);
    await expect("file.identify", { path: "elf/tool" }, /missing param format/);
    await expect("file.contains", { path: "elf/tool", text: "a", hex: "61" }, /exactly one of text, hex/);
    await expect("file.hash", { path: "elf/tool", sha256: "xyz" }, /64 hex/);
    await expect("file.identify", { path: "../../etc/passwd", format: "text" }, /outside the workspace/);
    await expect("file.identify", { path: "no/such/file", format: "text" }, /No such path|does not exist/);
    await expect("native.links", { path: "js-app/src/main.js", library: "libc.so.6" }, /not a supported native binary/);
    await expect("file.identify", { path: "elf/tool", format: "elf" }, /subject changed/, {
      subject: { path: "elf/tool", digest: `sha256:${"1".repeat(64)}` },
    });
    await expect("cmd.exit", { program: "true", expect: 0 }, /needs approval/);
    const noPredicate = recordClaim(s.k, "case_v", "agent-a", { text: "it is fine", label: "seen" });
    assert.equal((await s.verifier.verify("case_v", noPredicate)).verdict, "unverifiable");
    // path from the claim's subject when params have none
    const viaSubject = s.claim("file.identify", { format: "zip" }, { subject: { path: "zip-slip/update.zip" } });
    assert.equal((await s.verifier.verify("case_v", viaSubject)).verdict, "verified");
  } finally {
    s.cleanup();
  }
});

test("the text must agree with the predicate: a negated text needs negate: true, which flips the verdict", async () => {
  const s = setup();
  try {
    // Found by review: this used to come back verified, because only the predicate was checked.
    const wrong = s.claim(
      "file.contains",
      { path: "elf/tool", text: "libcurl.so.4" },
      { text: "elf/tool does NOT reference libcurl and is safe" },
    );
    const w = await s.verifier.verify("case_v", wrong);
    assert.equal(w.verdict, "unverifiable");
    assert.match(w.reason, /negation/);
    const neg = (text: string, needle: string) =>
      s.claim("file.contains", { path: "elf/tool", text: needle, negate: true }, { text });
    assert.equal(
      (await s.verifier.verify("case_v", neg("the tool does not contain libnope", "libnope"))).verdict,
      "verified",
    );
    assert.equal(
      (await s.verifier.verify("case_v", neg("the tool doesn't reference libcurl", "libcurl.so.4"))).verdict,
      "refuted",
    );
    const noNegText = s.claim(
      "file.contains",
      { path: "elf/tool", text: "libnope", negate: true },
      { text: "it has libnope" },
    );
    assert.equal((await s.verifier.verify("case_v", noNegText)).verdict, "unverifiable");
  } finally {
    s.cleanup();
  }
});

test("inferred and unknown claims are not re-run and keep a null verdict", async () => {
  const s = setup();
  try {
    for (const label of ["inferred", "unknown"] as const) {
      const c = s.claim("file.identify", { path: "elf/tool", format: "elf" }, { label });
      const v = await s.verifier.verify("case_v", c);
      assert.equal(v.verdict, null);
      assert.match(v.reason, new RegExp(label));
      assert.equal(getClaim(s.k, c.id)!.verdict, null);
    }
    assert.equal(calibration(s.k).length, 0);
  } finally {
    s.cleanup();
  }
});

test("cmd.exit runs only through the injected approval-gated exec", async () => {
  const calls: string[] = [];
  const s = setup(async (req) => {
    calls.push(`${req.program} ${req.args.join(" ")}`);
    if (req.program === "denied") throw new CoreError("approval_denied");
    return { code: req.program === "false" ? 1 : 0 };
  });
  try {
    assert.equal(
      (await s.verifier.verify("case_v", s.claim("cmd.exit", { program: "true", args: ["-x"], expect: 0 }))).verdict,
      "verified",
    );
    assert.equal(
      (await s.verifier.verify("case_v", s.claim("cmd.exit", { program: "false", expect: 0 }))).verdict,
      "refuted",
    );
    const d = await s.verifier.verify("case_v", s.claim("cmd.exit", { program: "denied", expect: 0 }));
    assert.equal(d.verdict, "unverifiable");
    assert.match(d.reason, /denied/);
    assert.deepEqual(calls, ["true -x", "false ", "denied "]);
  } finally {
    s.cleanup();
  }
});

test("verifyCase re-runs each unverdicted seen claim once and feeds calibration", async () => {
  const s = setup();
  try {
    s.claim("file.identify", { path: "elf/tool", format: "elf" });
    s.claim("file.identify", { path: "elf/tool", format: "pe" });
    s.claim("file.identify", { path: "elf/tool", format: "elf" }, { label: "inferred" });
    const first = await s.verifier.verifyCase("case_v");
    assert.deepEqual(
      first.map((r) => r.verdict),
      ["verified", "refuted", null],
    );
    const again = await s.verifier.verifyCase("case_v");
    assert.deepEqual(
      again.map((r) => r.verdict),
      [null],
    );
    const cal = calibration(s.k).find((c) => c.producer === "agent-a" && c.question_class === "file.identify")!;
    assert.equal(cal.verified, 1);
    assert.equal(cal.refuted, 1);
  } finally {
    s.cleanup();
  }
});

test("parseClaimBlocks extracts fenced assay-claims arrays and reports bad entries", () => {
  const text = [
    "Here is what I saw.",
    "```assay-claims",
    JSON.stringify([
      {
        text: "tool links libcurl",
        label: "seen",
        predicate: "native.links",
        params: { path: "elf/tool", library: "libcurl.so.4" },
      },
      { text: "probably phones home", label: "inferred", cites: [`ob_${"a".repeat(64)}`], question_class: "net" },
      { text: "", label: "seen" },
      { text: "x", label: "maybe" },
      { text: "x", label: "seen", predicate: "Bad Name" },
      { text: "x", label: "seen", params: [1] },
      { text: "x", label: "seen", cites: ["nope"] },
      { text: "x", label: "seen", subject: { digest: "md5:1" } },
      "not an object",
    ]),
    "```",
    "```assay-claims",
    "{ not json",
    "```",
    "```assay-claims extra-info",
    '{"text":"single object","label":"seen"}',
    "```",
    "```json",
    '[{"text":"ignored","label":"seen"}]',
    "```",
  ].join("\n");
  const r = parseClaimBlocks(text);
  assert.deepEqual(
    r.claims.map((c) => c.text),
    ["tool links libcurl", "probably phones home"],
  );
  assert.equal(r.claims[0]!.predicate, "native.links");
  assert.deepEqual(
    r.errors.map((e) => [e.block, e.index]),
    [
      [0, 2],
      [0, 3],
      [0, 4],
      [0, 5],
      [0, 6],
      [0, 7],
      [0, 8],
      [1, null],
      [2, null],
    ],
  );
  assert.match(r.errors[7]!.reason, /not valid JSON/);
  assert.match(r.errors[8]!.reason, /JSON array/);
});

test("predicate schemas: every predicate documents its params and checkParams enforces them", () => {
  for (const spec of Object.values(PREDICATES)) {
    assert.ok(spec.summary && spec.verified && spec.refuted && spec.unverifiable, spec.predicate);
    for (const [name, p] of Object.entries(spec.params)) assert.ok(p.doc, `${spec.predicate}.${name}`);
  }
  assert.equal(
    checkParams(PREDICATES["cmd.exit"]!, { program: "x", expect: 0, args: [1] }),
    "param args must be an array of strings",
  );
  assert.equal(checkParams(PREDICATES["cmd.exit"]!, { program: "x", expect: "0" }), "param expect must be a number");
  assert.equal(
    checkParams(PREDICATES["js.imports"]!, { path: "a", specifier: "" }),
    "param specifier must be a non-empty string",
  );
});

function twin(predicate: string, params: Record<string, unknown>): Record<string, unknown> | null {
  const p = { ...params };
  switch (predicate) {
    case "file.contains":
      if (p.text !== undefined) p.text = `${p.text}-NOPE-zz`;
      else p.hex = "deadbeefcafef00d1122";
      return p;
    case "file.identify":
      p.format = "sqlite";
      return p;
    case "file.hash":
      p.sha256 = "0".repeat(64);
      return p;
    case "pkg.has-dependency":
      p.name = `${p.name}-nope`;
      return p;
    case "pkg.has-install-script":
      p.hook = "prepare";
      return p;
    case "js.imports":
      p.specifier = `${p.specifier}-nope`;
      return p;
    case "native.links":
      p.library = "libnope.so.9";
      return p;
    case "archive.contains":
      p.entry = `${p.entry}.nope`;
      return p;
    case "endpoint.present":
      p.host = `nope-${p.host}`;
      return p;
    default:
      return null;
  }
}

test("M4: on a mixed corpus of bench claims, true ones verify, false ones never verify (false-verified = 0)", async (t) => {
  const s = setup();
  try {
    const tasks = buildTasks().tasks;
    const corpus: {
      predicate: string;
      params: Record<string, unknown>;
      truth: "verified" | "refuted" | "unverifiable" | "not-verified";
      label?: string;
    }[] = [];
    for (const task of tasks)
      for (const o of task.oracle) {
        corpus.push({ predicate: o.predicate, params: o.params, truth: o.expect });
        if (o.expect === "verified") {
          const tw = twin(o.predicate, o.params);
          if (tw) corpus.push({ predicate: o.predicate, params: tw, truth: "not-verified" });
        }
      }
    corpus.push(
      { predicate: "net.listens", params: { path: "elf/tool", port: 80 }, truth: "unverifiable" },
      { predicate: "native.links", params: { path: "elf/tool" }, truth: "unverifiable" },
      { predicate: "cmd.exit", params: { program: "true", expect: 0 }, truth: "unverifiable" },
      { predicate: "file.identify", params: { path: "../outside", format: "elf" }, truth: "unverifiable" },
    );
    const inferred = {
      predicate: "file.identify",
      params: { path: "elf/tool", format: "pe" },
      truth: "not-verified" as const,
      label: "inferred",
    };
    corpus.push(inferred);
    assert.ok(corpus.length >= 60, `corpus has ${corpus.length} claims`);
    let verified = 0;
    let falseVerified = 0;
    let exact = 0;
    let seen = 0;
    for (const c of corpus) {
      const sc = s.claim(c.predicate, c.params as Json, c.label ? { label: c.label } : {});
      const v = await s.verifier.verify("case_v", sc);
      if (c.label) {
        assert.equal(v.verdict, null);
        continue;
      }
      seen++;
      if (v.verdict === "verified") {
        verified++;
        if (c.truth !== "verified") falseVerified++;
      }
      if (c.truth === "not-verified")
        assert.notEqual(v.verdict, "verified", `${c.predicate} ${JSON.stringify(c.params)}`);
      else assert.equal(v.verdict, c.truth, `${c.predicate} ${JSON.stringify(c.params)}: ${v.reason}`);
      if (c.truth === v.verdict || (c.truth === "not-verified" && v.verdict !== "verified")) exact++;
    }
    const share = verified / seen;
    t.diagnostic(
      `M4 verified-share=${share.toFixed(3)} false-verified=${falseVerified} claims=${seen} agreement=${exact}/${seen}`,
    );
    assert.equal(falseVerified, 0);
  } finally {
    s.cleanup();
  }
});

test("claims with aliased params (lib, pattern, url, file) are normalised before re-running", async () => {
  const { normalizeParams, literalFromPattern } = await import("../src/verifier/predicates.ts");
  assert.deepEqual(normalizeParams("native.links", { file: "pe/agent.exe", lib: "advapi32.dll" }), {
    path: "pe/agent.exe",
    library: "advapi32.dll",
  });
  assert.deepEqual(normalizeParams("endpoint.present", { path: "a.js", url: "https://x.example.net/i?h=1" }), {
    path: "a.js",
    host: "x.example.net",
  });
  assert.deepEqual(normalizeParams("file.contains", { path: "a", pattern: "api\\.stable\\.example\\.com/ping" }), {
    path: "a",
    text: "api.stable.example.com/ping",
  });
  assert.equal(literalFromPattern("https.get\\(.*"), null, "a real regex is not turned into text");
  assert.deepEqual(
    normalizeParams("pkg.has-dependency", { path: "p", name: "x", dependency: "y" }),
    { path: "p", name: "x", dependency: "y" },
    "the canonical name wins",
  );
});

test("native.exports reads the whole export table of a large library (found on LearnHarness's libvips: ELF kept 64 names, PE 4,096)", async () => {
  const { makeElf64, makePe64 } = await import("../src/testing/gen.ts");
  const { writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const s = setup();
  try {
    const names = (n: number) => Array.from({ length: n }, (_, i) => `big_export_${i}`);
    writeFileSync(join(s.ws, "big.so"), makeElf64({ exports: names(300) }));
    writeFileSync(join(s.ws, "big.dll"), makePe64({ dll: true, exports: names(5000) }));
    for (const [path, last] of [
      ["big.so", 299],
      ["big.dll", 4999],
    ] as const) {
      const late = await s.verifier.verify("case_v", s.claim("native.exports", { path, symbol: `big_export_${last}` }));
      assert.equal(late.verdict, "verified", `${path}: ${late.reason}`);
      const absent = await s.verifier.verify("case_v", s.claim("native.exports", { path, symbol: "not_exported" }));
      assert.equal(absent.verdict, "refuted", `${path}: ${absent.reason}`);
    }
  } finally {
    s.cleanup();
  }
});
