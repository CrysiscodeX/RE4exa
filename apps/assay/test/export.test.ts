import assert from "node:assert/strict";
import { test } from "node:test";
import { makeRecord, probeKey, subjectDigest } from "@re4exa/core/evidence/record";
import { openUnknown, putEvidence, recordClaim, setVerdict } from "@re4exa/core/evidence/store";
import { isAssayError } from "../src/errors.ts";
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
  const cl = recordClaim(t.k, c.id, "fake:a", {
    text: "depends on lodash",
    label: "seen",
    predicate: "pkg.has-dependency",
  });
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
  assert.deepEqual(
    bom.components.map((x) => x.name),
    ["demo", "leftpad"],
  );
  const md = markdown(s.k, s.c.id);
  assert.match(md, /✖ refuted/);
  assert.match(md, /chain intact/);
  s.cleanup();
});

test("signed bundles verify, and any change is detected", () => {
  const s = seed();
  const b = makeBundle(s.k, s.c.id, s.dir, "0.1.0");
  assert.deepEqual(verifyBundle(structuredClone(b)).records, 1);
  assert.equal(verifyBundle(structuredClone(b)).authenticated, false, "the embedded key proves integrity only");
  assert.equal(verifyBundle(structuredClone(b), b.signature.public_key).authenticated, true);
  const t1 = structuredClone(b);
  (t1.records[0]!.result as Record<string, unknown>).name = "evil";
  assert.throws(
    () => verifyBundle(t1),
    (e) => isAssayError(e, "bundle_tampered"),
  );
  const t2 = structuredClone(b);
  t2.manifest.title = "changed";
  assert.throws(
    () => verifyBundle(t2),
    (e) => isAssayError(e, "bundle_tampered"),
  );
  const other = openTemp();
  const otherKey = makeBundle(s.k, s.c.id, other.dir, "0.1.0").signature.public_key;
  assert.throws(
    () => verifyBundle(structuredClone(b), otherKey),
    (e) => isAssayError(e, "bundle_tampered"),
  );
  // A forger re-signs with their own key: intact, but not authentic against the real signer's key.
  const forged = makeBundle(s.k, s.c.id, other.dir, "0.1.0");
  assert.equal(verifyBundle(structuredClone(forged)).authenticated, false);
  assert.throws(
    () => verifyBundle(structuredClone(forged), b.signature.public_key),
    (e) => isAssayError(e, "bundle_tampered"),
  );
  other.cleanup();
  s.cleanup();
});

test("exports cover every verdict, nameless manifests, repeated dependencies and findings with no path", () => {
  const t = openTemp();
  const c = t.k.createCase({ title: "" });
  const probe = { id: "pkg.manifest", version: "1" };
  const put = (
    result: Record<string, unknown>,
    bytes: string,
    ext?: { findings: { key: string; class: string; label: string }[] },
  ) => {
    const digest = subjectDigest(new TextEncoder().encode(bytes));
    putEvidence(
      t.k,
      c.id,
      makeRecord(
        {
          probe,
          probe_key: probeKey(probe, null, digest),
          predicate: "pkg.manifest",
          subject: { digest },
          params: null,
          result: result as never,
          confidence: "observed",
          producer: { kind: "runner", id: "test-runner" },
          ...(ext ? { ext } : {}),
        },
        t.k.now(),
      ),
    );
  };
  put({ dependencies: { shared: "^1" } }, "a", { findings: [{ key: "fk_np", class: "pkg.dep", label: "no path" }] });
  put({ name: "second", dependencies: { shared: "^2" } }, "b");
  const verdicts = ["verified", "unverifiable", null] as const;
  for (const v of verdicts) {
    const cl = recordClaim(t.k, c.id, "fake:a", { text: `claim ${v} with a | pipe`, label: "seen" });
    if (v) setVerdict(t.k, cl.id, v, { reason: `because ${v}` });
  }
  openUnknown(t.k, c.id, { question: "what is shared?", origin: "test" });

  const results = (
    sarif(t.k, c.id, "0.1.0") as { runs: { results: { ruleId: string; level: string; locations?: unknown[] }[] }[] }
  ).runs[0]!.results;
  assert.deepEqual(
    results.map((r) => r.ruleId),
    ["assay/claim-unverifiable", "assay/pkg.dep"],
    "only refuted and unverifiable claims are reported; verified and unchecked ones are not",
  );
  assert.equal(results[0]!.level, "note");
  assert.deepEqual(results[1]!.locations, [], "a finding with no path has no location");

  const comps = (
    cyclonedx(t.k, c.id, "0.1.0") as {
      components: { name: string; version: string; properties: { value: string }[] }[];
    }
  ).components;
  assert.deepEqual(
    comps.map((x) => x.name),
    ["shared", "second"],
    "a dependency declared by two manifests appears once; a nameless manifest adds no component of its own",
  );
  assert.equal(comps[0]!.properties[0]!.value, "", "declared-by is empty for a nameless manifest");

  const md = markdown(t.k, c.id);
  assert.match(md, /^# case_/, "a case with no title is headed by its id");
  for (const badge of ["✔ verified", "? unverifiable", "· not checked"]) assert.ok(md.includes(badge), badge);
  assert.ok(md.includes("with a \\| pipe"), "pipes in claim text are escaped in the table");
  assert.match(md, /- what is shared\?/);
  t.cleanup();
});
