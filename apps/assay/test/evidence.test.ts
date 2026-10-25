import assert from "node:assert/strict";
import { test } from "node:test";
import { isAssayError } from "../src/errors.ts";
import { canonicalize } from "../src/evidence/jcs.ts";
import { findingKey, makeRecord, observationId, probeKey, subjectDigest, validate } from "../src/evidence/record.ts";
import {
  calibration,
  caseClaims,
  caseEvidence,
  latestUnknown,
  listUnknowns,
  openUnknown,
  putEvidence,
  recordClaim,
  resolveUnknown,
  setVerdict,
  wilson,
} from "../src/evidence/store.ts";
import { openTemp } from "./helpers.ts";

const probe = { id: "file.identify", version: "1" };
const digest = subjectDigest(new TextEncoder().encode("hello"));

function rec(over: Record<string, unknown> = {}) {
  return makeRecord(
    {
      probe,
      probe_key: probeKey(probe, { mode: "magic" }, digest),
      predicate: "file.identify",
      subject: { digest },
      params: { mode: "magic" },
      result: { format: "text" },
      confidence: "observed",
      producer: { kind: "runner", id: "host-a" },
      ...over,
    } as never,
    1,
  );
}

test("JCS canonical form sorts keys, normalises numbers and rejects non-JSON values", () => {
  assert.equal(
    canonicalize({ b: 1, a: [true, null, "x"], c: { z: 1e21, y: -0 } }),
    '{"a":[true,null,"x"],"b":1,"c":{"y":0,"z":1e+21}}',
  );
  assert.throws(() => canonicalize({ x: Number.NaN }));
  assert.throws(() => canonicalize({ x: () => 1 }));
  assert.equal(canonicalize({ a: undefined, b: 2 }), '{"b":2}');
});

test("X-1 identity: same bytes at two paths and on two hosts give equal keys (M8)", () => {
  const a = rec({
    locator: { path: "/home/a/pkg/index.js" },
    volatile: { ms: 12, host: "linux" },
    producer: { kind: "runner", id: "host-a" },
  });
  const b = rec({
    locator: { path: "C:\\b\\index.js" },
    volatile: { ms: 40, host: "win32" },
    producer: { kind: "runner", id: "host-b" },
  });
  assert.equal(a.probe_key, b.probe_key);
  assert.equal(a.observation_id, b.observation_id);
});

test("X-1 identity: changing a parameter, the result or a nested record changes the right key", () => {
  const base = rec();
  assert.notEqual(probeKey(probe, { mode: "deep" }, digest), base.probe_key);
  assert.notEqual(rec({ result: { format: "binary" } }).observation_id, base.observation_id);
  const nested = rec({ nested: [base.observation_id] });
  assert.notEqual(nested.observation_id, base.observation_id);
  assert.equal(rec({ nested: [base.observation_id] }).observation_id, nested.observation_id);
  assert.notEqual(findingKey("dep", { name: "x" }), findingKey("dep", { name: "y" }));
});

test("only the runner or verifier may record observed evidence; agents record analyst-inference", () => {
  assert.throws(
    () => rec({ producer: { kind: "agent", id: "claude" } }),
    (e) => isAssayError(e, "evidence_confidence"),
  );
  const ok = rec({ producer: { kind: "agent", id: "claude" }, confidence: "analyst-inference" });
  assert.equal(ok.confidence, "analyst-inference");
  assert.throws(
    () => rec({ producer: { kind: "person", id: "me" }, confidence: "derived" }),
    (e) => isAssayError(e, "evidence_confidence"),
  );
});

test("coverage cannot say complete while anything is unresolved, unclaimed or skipped (M9)", () => {
  const cov = { status: "complete", examined: 3, skipped: [], unresolved: 1, unclaimed: 0 };
  assert.throws(
    () => rec({ coverage: cov }),
    (e) => isAssayError(e, "evidence_invalid"),
  );
  assert.throws(
    () => rec({ coverage: { ...cov, unresolved: 0, skipped: [{ what: "a.bin", reason: "size" }] } }),
    (e) => isAssayError(e, "evidence_invalid"),
  );
  assert.equal(rec({ coverage: { ...cov, unresolved: 0 } }).coverage!.status, "complete");
});

test("validation rejects tampering, absolute paths in params and bad digests", () => {
  const r = rec();
  assert.throws(
    () => validate({ ...r, result: { format: "evil" } }),
    (e) => isAssayError(e, "evidence_invalid"),
  );
  assert.throws(
    () => rec({ params: { file: "/etc/passwd" } }),
    (e) => isAssayError(e, "evidence_invalid"),
  );
  assert.throws(
    () => rec({ subject: { digest: "md5:abc" } }),
    (e) => isAssayError(e, "evidence_invalid"),
  );
  assert.throws(
    () => rec({ predicate: "Bad Name" }),
    (e) => isAssayError(e, "evidence_invalid"),
  );
  assert.throws(
    () => rec({ nested: ["not-an-id"] }),
    (e) => isAssayError(e, "evidence_invalid"),
  );
  const { observation_id: _id, ...rest } = r;
  assert.equal(observationId(rest), r.observation_id);
});

test("unknowns are revisioned; a resolution must cite delivered evidence and the latest revision", () => {
  const { k, cleanup } = openTemp();
  const c = k.createCase({ title: "t" });
  const u = openUnknown(k, c.id, { question: "Does it phone home?", origin: "sweep" });
  assert.throws(
    () => resolveUnknown(k, c.id, u.id, 0, { answer: "no", evidence: [] }),
    (e) => isAssayError(e, "evidence_missing"),
  );
  assert.throws(
    () => resolveUnknown(k, c.id, u.id, 0, { answer: "no", evidence: ["ob_".padEnd(67, "0")] }),
    (e) => isAssayError(e, "evidence_missing"),
  );
  const ev = putEvidence(k, c.id, rec());
  const r1 = resolveUnknown(k, c.id, u.id, 0, { answer: "no", evidence: [ev.observation_id] });
  assert.equal(r1.rev, 1);
  assert.throws(
    () => resolveUnknown(k, c.id, u.id, 0, { answer: "x", evidence: [ev.observation_id] }),
    (e) => isAssayError(e, "unknown_conflict"),
  );
  assert.equal(latestUnknown(k, c.id, u.id)!.status, "resolved");
  assert.equal(listUnknowns(k, c.id).length, 1);
  assert.equal(caseEvidence(k, c.id).length, 1);
  resolveUnknown(k, c.id, u.id, 1, { answer: "not needed", evidence: [], status: "dismissed" });
  cleanup();
});

test("claims carry verdicts, and verdicts feed calibration with Wilson intervals", () => {
  const { k, cleanup } = openTemp();
  const c = k.createCase({ title: "t" });
  for (let i = 0; i < 40; i++) {
    const cl = recordClaim(k, c.id, "claude:a1", { text: `claim ${i}`, label: "seen", predicate: "file.contains" });
    setVerdict(k, cl.id, i < 38 ? "verified" : "refuted", { reason: "re-run" });
  }
  const weak = recordClaim(k, c.id, "codex:b", { text: "x", label: "seen", predicate: "file.contains" });
  setVerdict(k, weak.id, "refuted", { reason: "re-run" });
  const rows = calibration(k);
  const strong = rows.find((r) => r.producer === "claude:a1")!;
  assert.equal(strong.status, "ok");
  assert.ok(strong.interval[0] > 0.8 && strong.interval[1] <= 1);
  assert.equal(rows.find((r) => r.producer === "codex:b")!.status, "insufficient");
  assert.equal(caseClaims(k, c.id).length, 41);
  assert.throws(
    () => recordClaim(k, c.id, "x", { text: "", label: "seen" }),
    (e) => isAssayError(e, "evidence_invalid"),
  );
  assert.throws(
    () => setVerdict(k, "clm_missing", "verified", null),
    (e) => isAssayError(e, "not_found"),
  );
  const [lo, hi] = wilson(0, 0);
  assert.deepEqual([lo, hi], [0, 1]);
  cleanup();
});
