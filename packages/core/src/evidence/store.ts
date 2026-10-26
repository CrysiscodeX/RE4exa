// Evidence, unknowns, agent claims and calibration, stored in the kernel's database.

import { CoreError } from "../errors.ts";
import { newId, sha256 } from "../kernel/ids.ts";
import type { Kernel } from "../kernel/kernel.ts";
import { canonicalize, type Json } from "./jcs.ts";
import { type ClaimRecord, validate } from "./record.ts";

type Row = Record<string, unknown>;

export function putEvidence(
  k: Kernel,
  caseId: string | null,
  rec: ClaimRecord,
  eventSeq: number | null = null,
): ClaimRecord {
  validate(rec);
  k.tx(() => {
    k.run(
      "INSERT OR IGNORE INTO evidence(observation_id,probe_key,record,created_at) VALUES(?,?,?,?)",
      rec.observation_id,
      rec.probe_key ?? "",
      JSON.stringify(rec),
      rec.created_at,
    );
    if (caseId)
      k.run(
        "INSERT INTO case_evidence(case_id,observation_id,delivered,event_seq,at) VALUES(?,?,1,?,?) ON CONFLICT(case_id,observation_id) DO UPDATE SET delivered=1",
        caseId,
        rec.observation_id,
        eventSeq,
        k.now(),
      );
  });
  return rec;
}

export function getEvidence(k: Kernel, id: string): ClaimRecord | undefined {
  const r = k.get<{ record: string }>("SELECT record FROM evidence WHERE observation_id=?", id);
  return r ? (JSON.parse(r.record) as ClaimRecord) : undefined;
}

export function evidenceByProbeKey(k: Kernel, probeKey: string): ClaimRecord | undefined {
  const r = k.get<{ record: string }>(
    "SELECT record FROM evidence WHERE probe_key=? ORDER BY created_at LIMIT 1",
    probeKey,
  );
  return r ? (JSON.parse(r.record) as ClaimRecord) : undefined;
}

export function caseEvidence(k: Kernel, caseId: string): ClaimRecord[] {
  return k
    .all<{ record: string }>(
      "SELECT e.record FROM case_evidence c JOIN evidence e ON e.observation_id=c.observation_id WHERE c.case_id=? AND c.delivered=1 ORDER BY e.created_at",
      caseId,
    )
    .map((r) => JSON.parse(r.record) as ClaimRecord);
}

export function requireDelivered(k: Kernel, caseId: string, ids: string[]): void {
  for (const id of ids) {
    const r = k.get<Row>("SELECT delivered FROM case_evidence WHERE case_id=? AND observation_id=?", caseId, id);
    if (!r || Number(r.delivered) !== 1) throw new CoreError("evidence_missing", { observation_id: id, case: caseId });
  }
}

// ---------- unknowns: revisioned and hash-chained (rea's residual-unknown registry) ----------

export interface Unknown {
  id: string;
  rev: number;
  question: string;
  status: "open" | "resolved" | "dismissed";
  origin: string;
  answer?: string | undefined;
  evidence?: string[] | undefined;
  hash: string;
}

export function openUnknown(
  k: Kernel,
  caseId: string,
  input: { question: string; origin: string; eventSeq?: number | null },
): Unknown {
  const id = newId("unk", k.now());
  return writeRevision(
    k,
    caseId,
    id,
    0,
    { question: input.question, status: "open", origin: input.origin },
    input.eventSeq ?? null,
  );
}

export function latestUnknown(k: Kernel, caseId: string, id: string): Unknown | undefined {
  const r = k.get<Row>("SELECT * FROM unknowns WHERE case_id=? AND id=? ORDER BY rev DESC LIMIT 1", caseId, id);
  return r
    ? ({ ...(JSON.parse(r.body as string) as object), id, rev: Number(r.rev), hash: r.hash } as Unknown)
    : undefined;
}

export function listUnknowns(k: Kernel, caseId: string): Unknown[] {
  return k
    .all<Row>(
      "SELECT u.* FROM unknowns u WHERE u.case_id=? AND u.rev=(SELECT MAX(rev) FROM unknowns WHERE case_id=u.case_id AND id=u.id) ORDER BY u.at",
      caseId,
    )
    .map(
      (r) => ({ ...(JSON.parse(r.body as string) as object), id: r.id, rev: Number(r.rev), hash: r.hash }) as Unknown,
    );
}

export function resolveUnknown(
  k: Kernel,
  caseId: string,
  id: string,
  expectedRev: number,
  input: { answer: string; evidence: string[]; status?: "resolved" | "dismissed" },
): Unknown {
  return k.tx(() => {
    const cur = latestUnknown(k, caseId, id);
    if (!cur) throw new CoreError("not_found", { unknown: id });
    if (cur.rev !== expectedRev)
      throw new CoreError("unknown_conflict", { unknown: id, expected: expectedRev, actual: cur.rev });
    const status = input.status ?? "resolved";
    if (status === "resolved") {
      if (input.evidence.length === 0)
        throw new CoreError("evidence_missing", { unknown: id, why: "a resolution must cite evidence" });
      requireDelivered(k, caseId, input.evidence);
    }
    return writeRevision(
      k,
      caseId,
      id,
      cur.rev + 1,
      { question: cur.question, origin: cur.origin, status, answer: input.answer, evidence: input.evidence },
      null,
    );
  });
}

function writeRevision(
  k: Kernel,
  caseId: string,
  id: string,
  rev: number,
  body: Record<string, unknown>,
  eventSeq: number | null,
): Unknown {
  const prev =
    rev === 0
      ? "0".repeat(64)
      : (k.get<{ hash: string }>("SELECT hash FROM unknowns WHERE case_id=? AND id=? AND rev=?", caseId, id, rev - 1)
          ?.hash ?? "");
  const hash = sha256(canonicalize({ id, rev, body: body as Json, prev }));
  k.run(
    "INSERT INTO unknowns(id,rev,case_id,body,prev_hash,hash,event_seq,at) VALUES(?,?,?,?,?,?,?,?)",
    id,
    rev,
    caseId,
    JSON.stringify(body),
    prev,
    hash,
    eventSeq,
    k.now(),
  );
  return { ...(body as object), id, rev, hash } as Unknown;
}

// ---------- agent claims and verdicts ----------

export type ClaimLabel = "seen" | "inferred" | "unknown";
export type Verdict = "verified" | "refuted" | "unverifiable";

export interface AgentClaim {
  text: string;
  label: ClaimLabel;
  predicate?: string | undefined;
  params?: Json | undefined;
  subject?: { path?: string; digest?: string } | undefined;
  cites?: string[] | undefined;
  question_class?: string | undefined;
}

export interface StoredClaim {
  id: string;
  case_id: string;
  author: string;
  claim: AgentClaim;
  verdict: Verdict | null;
  verdict_record: { observation_id?: string; reason: string; probe?: string } | null;
  /** Seq of the assistant message the claim belongs to, when known. */
  event_seq: number | null;
  created_at: number;
}

export function recordClaim(
  k: Kernel,
  caseId: string,
  author: string,
  claim: AgentClaim,
  eventSeq: number | null = null,
): StoredClaim {
  if (typeof claim.text !== "string" || claim.text.length === 0 || claim.text.length > 2000)
    throw new CoreError("evidence_invalid", { path: "text" });
  if (!["seen", "inferred", "unknown"].includes(claim.label))
    throw new CoreError("evidence_invalid", { path: "label" });
  const id = newId("clm", k.now());
  k.run(
    "INSERT INTO claims(id,case_id,author,record,event_seq,created_at) VALUES(?,?,?,?,?,?)",
    id,
    caseId,
    author,
    JSON.stringify(claim),
    eventSeq,
    k.now(),
  );
  return {
    id,
    case_id: caseId,
    author,
    claim,
    verdict: null,
    verdict_record: null,
    event_seq: eventSeq,
    created_at: k.now(),
  };
}

export function setVerdict(k: Kernel, claimId: string, verdict: Verdict, record: StoredClaim["verdict_record"]): void {
  k.tx(() => {
    const c = getClaim(k, claimId);
    if (!c) throw new CoreError("not_found", { claim: claimId });
    k.run("UPDATE claims SET verdict=?, verdict_record=? WHERE id=?", verdict, JSON.stringify(record), claimId);
    const cls = c.claim.question_class ?? c.claim.predicate ?? "general";
    k.run(
      `INSERT INTO calibration(producer,question_class,${verdict}) VALUES(?,?,1) ON CONFLICT(producer,question_class) DO UPDATE SET ${verdict}=${verdict}+1`,
      c.author,
      cls,
    );
  });
}

export function getClaim(k: Kernel, id: string): StoredClaim | undefined {
  const r = k.get<Row>("SELECT * FROM claims WHERE id=?", id);
  return r ? rowToClaim(r) : undefined;
}

export function caseClaims(k: Kernel, caseId: string): StoredClaim[] {
  return k.all<Row>("SELECT * FROM claims WHERE case_id=? ORDER BY created_at", caseId).map(rowToClaim);
}

function rowToClaim(r: Row): StoredClaim {
  return {
    id: r.id as string,
    case_id: r.case_id as string,
    author: r.author as string,
    claim: JSON.parse(r.record as string) as AgentClaim,
    verdict: (r.verdict as Verdict | null) ?? null,
    verdict_record: r.verdict_record ? JSON.parse(r.verdict_record as string) : null,
    event_seq: r.event_seq === null || r.event_seq === undefined ? null : Number(r.event_seq),
    created_at: Number(r.created_at),
  };
}

// ---------- calibration (my-jev / laya): Wilson interval on precision of `seen` claims ----------

export function wilson(successes: number, n: number, z = 1.96): [number, number] {
  if (n === 0) return [0, 1];
  const p = successes / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [Math.max(0, (c - m) / d), Math.min(1, (c + m) / d)];
}

export interface CalibrationRow {
  producer: string;
  question_class: string;
  verified: number;
  refuted: number;
  unverifiable: number;
  precision: number | null;
  interval: [number, number];
  status: "ok" | "insufficient" | "demoted";
}

/** Precision = verified / (verified + refuted). Below n=30 the row is INSUFFICIENT; a lower bound under 0.8 demotes the producer. */
export function calibration(k: Kernel): CalibrationRow[] {
  return k.all<Row>("SELECT * FROM calibration ORDER BY producer, question_class").map((r) => {
    const v = Number(r.verified);
    const f = Number(r.refuted);
    const n = v + f;
    const interval = wilson(v, n);
    const status: CalibrationRow["status"] = n < 30 ? "insufficient" : interval[0] < 0.8 ? "demoted" : "ok";
    return {
      producer: r.producer as string,
      question_class: r.question_class as string,
      verified: v,
      refuted: f,
      unverifiable: Number(r.unverifiable),
      precision: n ? v / n : null,
      interval,
      status,
    };
  });
}
