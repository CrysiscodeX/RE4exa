// S-2 v1 claim record ("assay.claim/1"). See docs/claim-format.md.
//
// Three keys (X-1):
// - ProbeKey: from inputs only (probe id+version, params, subject digest, profile). Known before the
//   probe runs, so it can key a durable step.
// - ObservationId: from the semantic content of the result. No paths, no host, no timings; nested
//   records contribute only their ObservationIds (rea's nested `local_path` defect).
// - FindingKey (extension, ext.findings): stable across versions of the subject; computed by the probe.

import { AssayError } from "../errors.ts";
import { sha256 } from "../kernel/ids.ts";
import { canonicalize, type Json } from "./jcs.ts";

export const SPEC = "assay.claim/1";

export type Confidence = "observed" | "derived" | "inferred" | "analyst-inference";
export type ProducerKind = "runner" | "verifier" | "agent" | "person";
export type Taint = "target" | "user" | "system";

export interface Coverage {
  /** "complete" is allowed only when unresolved and unclaimed are both 0. */
  status: "complete" | "partial" | "none";
  examined: number;
  skipped: { what: string; reason: string }[];
  unresolved: number;
  unclaimed: number;
  forms?: Record<string, { found: number; resolved: number }>;
}

export interface Finding {
  key: string;
  class: string;
  label: string;
}

export interface ClaimRecord {
  spec: typeof SPEC;
  observation_id: string;
  probe_key: string | null;
  probe: { id: string; version: string } | null;
  predicate: string;
  subject: { digest: string; format?: string } | null;
  params: Json;
  result: Json;
  confidence: Confidence;
  producer: { kind: ProducerKind; id: string };
  taint: Taint;
  redactions: { pointer: string; fingerprint: string; kind: string }[];
  nested: string[];
  limitations: string[];
  coverage: Coverage | null;
  /** Not hashed: where the subject was found, how long it took, which host. */
  locator?: { path?: string; offset?: number; symbol?: string } | undefined;
  volatile?: Json | undefined;
  ext?: { findings?: Finding[] } | undefined;
  created_at: number;
}

export type ClaimInput = Omit<
  ClaimRecord,
  "spec" | "observation_id" | "created_at" | "redactions" | "nested" | "limitations" | "coverage" | "taint"
> &
  Partial<Pick<ClaimRecord, "redactions" | "nested" | "limitations" | "coverage" | "taint">>;

export function probeKey(
  probe: { id: string; version: string },
  params: Json,
  subjectDigest: string | null,
  profile: Json = null,
): string {
  return `pk_${sha256(canonicalize({ probe, params, subject: subjectDigest, profile }))}`;
}

function semantic(r: Omit<ClaimRecord, "observation_id">): Json {
  return {
    spec: r.spec,
    probe_key: r.probe_key,
    predicate: r.predicate,
    subject: r.subject ? r.subject.digest : null,
    params: r.params,
    result: r.result,
    confidence: r.confidence,
    producer: r.producer.kind,
    redactions: r.redactions.map((x) => x.fingerprint).sort(),
    nested: [...r.nested].sort(),
    coverage: r.coverage as unknown as Json,
  };
}

export function observationId(r: Omit<ClaimRecord, "observation_id">): string {
  return `ob_${sha256(canonicalize(semantic(r)))}`;
}

export function findingKey(cls: string, normalized: Json): string {
  return `fk_${sha256(canonicalize({ class: cls, normalized }))}`;
}

const CONFIDENCE: Confidence[] = ["observed", "derived", "inferred", "analyst-inference"];
const PRODUCERS: ProducerKind[] = ["runner", "verifier", "agent", "person"];

function fail(path: string, why: string): never {
  throw new AssayError("evidence_invalid", { path, why });
}

/** Build a record: validates, enforces the confidence rule, normalises coverage, computes the id. */
export function makeRecord(input: ClaimInput, now: number): ClaimRecord {
  const r: Omit<ClaimRecord, "observation_id"> = {
    spec: SPEC,
    probe_key: input.probe_key ?? null,
    probe: input.probe ?? null,
    predicate: input.predicate,
    subject: input.subject ?? null,
    params: input.params ?? null,
    result: input.result ?? null,
    confidence: input.confidence,
    producer: input.producer,
    taint: input.taint ?? "target",
    redactions: input.redactions ?? [],
    nested: input.nested ?? [],
    limitations: input.limitations ?? [],
    coverage: input.coverage ?? null,
    locator: input.locator,
    volatile: input.volatile,
    ext: input.ext,
    created_at: now,
  };
  validate(r);
  return { ...r, observation_id: observationId(r) };
}

export function validate(r: Omit<ClaimRecord, "observation_id"> & { observation_id?: string }): void {
  if (r.spec !== SPEC) fail("spec", `must be ${SPEC}`);
  if (typeof r.predicate !== "string" || !/^[a-z][a-z0-9_.-]{1,63}$/.test(r.predicate))
    fail("predicate", "lowercase dotted name");
  if (!CONFIDENCE.includes(r.confidence)) fail("confidence", CONFIDENCE.join("|"));
  if (!r.producer || !PRODUCERS.includes(r.producer.kind) || typeof r.producer.id !== "string")
    fail("producer", "kind and id");
  if (
    (r.confidence === "observed" || r.confidence === "derived") &&
    r.producer.kind !== "runner" &&
    r.producer.kind !== "verifier"
  )
    throw new AssayError("evidence_confidence", { producer: r.producer.kind, confidence: r.confidence });
  if (
    (r.producer.kind === "agent" || r.producer.kind === "person") &&
    r.confidence !== "analyst-inference" &&
    r.confidence !== "inferred"
  )
    throw new AssayError("evidence_confidence", { producer: r.producer.kind, confidence: r.confidence });
  if (r.subject !== null && (typeof r.subject.digest !== "string" || !/^sha256:[0-9a-f]{64}$/.test(r.subject.digest)))
    fail("subject.digest", "sha256:<64 hex>");
  if (r.probe !== null && (typeof r.probe.id !== "string" || typeof r.probe.version !== "string"))
    fail("probe", "id and version");
  if (r.probe_key !== null && !/^pk_[0-9a-f]{64}$/.test(r.probe_key)) fail("probe_key", "pk_<64 hex>");
  for (const n of r.nested) if (!/^ob_[0-9a-f]{64}$/.test(n)) fail("nested", "observation ids only");
  if (r.coverage) {
    const c = r.coverage;
    if (c.status === "complete" && (c.unresolved > 0 || c.unclaimed > 0 || c.skipped.length > 0))
      fail("coverage.status", "complete requires 0 unresolved, 0 unclaimed and nothing skipped");
  }
  if (JSON.stringify(r.params ?? null).match(/"(\/|[A-Za-z]:\\)[^"]*"/))
    fail("params", "absolute paths belong in locator, not params");
  if (r.observation_id !== undefined && r.observation_id !== observationId(r))
    fail("observation_id", "does not match content (tampered)");
}

export function subjectDigest(bytes: Uint8Array): string {
  return `sha256:${sha256(bytes)}`;
}
