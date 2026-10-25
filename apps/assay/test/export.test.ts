import assert from "node:assert/strict";
import { test } from "node:test";
import { isAssayError } from "../src/errors.ts";
import { makeRecord, probeKey, subjectDigest } from "../src/evidence/record.ts";
import { putEvidence, recordClaim, setVerdict } from "../src/evidence/store.ts";
import { cyclonedx, makeBundle, markdown, s2Jsonl, sarif, verifyBundle } from "../src/export/export.ts";
import { openTemp } from "./helpers.ts";

function seed() {
  const t = openTemp();
  const c = t.k.createCase({ title: "pkg demo" });
  const digest = subjectDigest(new TextEncoder().encode("{}"));
  const probe = { id: "pkg.manifest", version: "1" };
  const rec = makeRecord(
    {
      probe,
      probe_key: probeKey(probe, null, digest),
      predicate: "pkg.manifest",
      subject: { digest },
      params: null,
      result: { name: "demo", version: "1.0.0", dependencies: { leftpad: "^1.0.0" } },
      confidence: "observed",
      producer: { kind: "runner", id: "assay-runner" },
      locator: { path: "package.json" },
      ext: { findings: [{ key: "fk_x", class: "pkg.dep", label: "depends on leftpad" }] },
    },
    t.k.now(),
  );
  putEvidence(t.k, c.id, rec);
  const cl = recordClaim(t.k, c.id, "fake:a", { text: "depends on lodash", label: "seen", predicate: "pkg.has-dependency" });
  setVerdict(t.k, cl.id, "refuted", { reason: "no such dependency" });
  return { ...t, c };
}

test("exports: S-2 JSONL, SARIF, CycloneDX, Markdown", () => {
  const s = seed();
  assert.equal(s2Jsonl(s.k, s.c.id).trim().split("\n").length, 1);
  const sa = sarif(s.k, s.c.id, "0.1.0") as { runs: { results: { ruleId: string }[] }[] };
  assert.deepEqual(sa.runs[0]!.results.map((r) => r.ruleId).sort(), ["assay/claim-refuted", "assay/pkg.dep"]);
  const bom = cyclonedx(s.k, s.c.id, "0.1.0") as { components: { name: string }[]; specVersion: string };
  assert.equal(bom.specVersion, "1.6");
  assert.deepEqual(bom.components.map((x) => x.name), ["demo", "leftpad"]);
  const md = markdown(s.k, s.c.id);
  assert.match(md, /✖ refuted/);
  assert.match(md, /chain intact/);
  s.cleanup();
});

test("signed bundles verify, and any change is detected", () => {
  const s = seed();
  const b = makeBundle(s.k, s.c.id, s.dir, "0.1.0");
  assert.deepEqual(verifyBundle(structuredClone(b)).records, 1);
  const t1 = structuredClone(b);
  (t1.records[0]!.result as Record<string, unknown>).name = "evil";
  assert.throws(() => verifyBundle(t1), (e) => isAssayError(e, "bundle_tampered"));
  const t2 = structuredClone(b);
  t2.manifest.title = "changed";
  assert.throws(() => verifyBundle(t2), (e) => isAssayError(e, "bundle_tampered"));
  const other = openTemp();
  const otherKey = makeBundle(s.k, s.c.id, other.dir, "0.1.0").signature.public_key;
  assert.throws(() => verifyBundle(structuredClone(b), otherKey), (e) => isAssayError(e, "bundle_tampered"));
  other.cleanup();
  s.cleanup();
});
