"""Questions, guarded answers, coverage and calibration.

- Coverage (from strix): an investigation declares its questions up front; the
  report separates answered, partial, unknown and *unaccounted* (never addressed).
- Guard (from REA, with the cause kept): an answer may not claim more confidence
  than its weakest required evidence supports, and every refusal says why.
- Calibration (from laya / my-jev): once answers are adjudicated, report per-class
  precision with Wilson intervals, ECE against nominal levels, and which classes
  should abstain at a target error rate.
"""

from __future__ import annotations

import math
import time

from .store import CONFIDENCE_RANK, RexError, Store, canonical, digest

NOMINAL = {"observed": 0.95, "derived": 0.85, "inferred": 0.60}


def add_question(store: Store, text: str, required_confidence: str = "observed") -> dict:
    if required_confidence not in CONFIDENCE_RANK:
        raise RexError("invalid_confidence", f"{required_confidence} is not a confidence class.", "Use observed, derived or inferred.")
    qid = "q_" + digest(text.strip().lower())[:16]
    with store.con:
        store.con.execute("insert or ignore into question(id, text, required_confidence, created_at) values (?,?,?,?)", (qid, text.strip(), required_confidence, time.time()))
    return {"id": qid, "text": text.strip(), "required_confidence": required_confidence}


def _head(store: Store, qid: str):
    return store.con.execute("select * from answer where question_id = ? order by revision desc limit 1", (qid,)).fetchone()


def answer(store: Store, qid: str, *, status: str, text: str | None, confidence: str | None, evidence_ids: list[str], rationale: str | None = None) -> dict:
    q = store.con.execute("select * from question where id = ?", (qid,)).fetchone()
    if q is None:
        raise RexError("question_not_found", f"No question {qid}.", "Add it with `rex plan add` first; questions must be declared to count toward coverage.", question_id=qid)
    if status not in ("answered", "partial", "unknown"):
        raise RexError("invalid_status", f"{status} is not an answer status.", "Use answered, partial or unknown.")
    if status != "unknown":
        if confidence not in CONFIDENCE_RANK:
            raise RexError("invalid_confidence", "An answer needs a confidence class.", "Pass --confidence observed|derived|inferred, or answer with status unknown.")
        if not evidence_ids:
            raise RexError("no_evidence", "An answer must cite at least one evidence id.", "Run a probe and cite its evidence id, or record status unknown.")
        evidence = [store.get(e) for e in evidence_ids]
        weakest = min(CONFIDENCE_RANK[e["confidence"]] for e in evidence)
        if CONFIDENCE_RANK[confidence] > max(CONFIDENCE_RANK[e["confidence"]] for e in evidence):
            raise RexError("confidence_exceeds_evidence", f"Claimed '{confidence}' but the strongest cited evidence is "
                           f"'{max(evidence, key=lambda e: CONFIDENCE_RANK[e['confidence']])['confidence']}'.",
                           "Lower the claimed confidence or cite evidence of that class.", cited=[{e["id"]: e["confidence"]} for e in evidence])
        if status == "answered" and CONFIDENCE_RANK[confidence] < CONFIDENCE_RANK[q["required_confidence"]]:
            raise RexError("below_required_confidence", f"The question requires '{q['required_confidence']}' evidence; this answer is '{confidence}'.",
                           "Record it as status partial, or gather evidence of the required class.", required=q["required_confidence"])
        if weakest < CONFIDENCE_RANK[confidence] and status == "answered":
            rationale = (rationale or "") + " [note: some cited evidence is weaker than the claim]"
    head = _head(store, qid)
    revision = (head["revision"] + 1) if head else 1
    prev = head["digest"] if head else None
    body = {"question_id": qid, "revision": revision, "status": status, "text": text, "confidence": confidence,
            "evidence_ids": sorted(evidence_ids), "rationale": rationale, "previous_digest": prev}
    d = digest(canonical(body))
    with store.con:
        store.con.execute("insert into answer(question_id, revision, status, text, confidence, evidence_ids, rationale, previous_digest, digest, created_at)"
                          " values (?,?,?,?,?,?,?,?,?,?)", (qid, revision, status, text, confidence, canonical(sorted(evidence_ids)), rationale, prev, d, time.time()))
    return {**body, "digest": d}


def coverage(store: Store) -> dict:
    rows = []
    for q in store.con.execute("select * from question order by created_at"):
        h = _head(store, q["id"])
        state = h["status"] if h else "unaccounted"
        rows.append({"id": q["id"], "question": q["text"], "state": state, "confidence": h["confidence"] if h else None,
                     "revision": h["revision"] if h else 0, "evidence": len(__import__("json").loads(h["evidence_ids"])) if h else 0})
    counts = {s: sum(r["state"] == s for r in rows) for s in ("answered", "partial", "unknown", "unaccounted")}
    total = len(rows)
    caveats = []
    if counts["unaccounted"]:
        caveats.append(f"{counts['unaccounted']} declared question(s) were never addressed; this is not the same as 'checked, nothing found'.")
    failed = store.con.execute("select count(*) from step where status = 'failed'").fetchone()[0]
    if failed:
        caveats.append(f"{failed} probe step(s) failed; their questions may be under-evidenced (see `rex steps --status failed`).")
    return {"total": total, **counts, "complete": total > 0 and counts["unaccounted"] == 0 and failed == 0,
            "answered_share": round(counts["answered"] / total, 3) if total else None, "caveats": caveats, "questions": rows}


def adjudicate(store: Store, qid: str, outcome: str, revision: int | None = None, note: str | None = None) -> dict:
    h = _head(store, qid) if revision is None else store.con.execute("select * from answer where question_id=? and revision=?", (qid, revision)).fetchone()
    if h is None:
        raise RexError("answer_not_found", f"No answer for {qid}.", "Answer the question before adjudicating it.")
    if outcome not in ("correct", "incorrect"):
        raise RexError("invalid_outcome", "Outcome must be correct or incorrect.", "Pass correct or incorrect.")
    with store.con:
        store.con.execute("insert or replace into adjudication(question_id, revision, outcome, note, created_at) values (?,?,?,?,?)", (qid, h["revision"], outcome, note, time.time()))
    return {"question_id": qid, "revision": h["revision"], "outcome": outcome}


def wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    if n == 0:
        return (0.0, 1.0)
    p = k / n
    den = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / den
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den
    return (round(max(0.0, centre - half), 4), round(min(1.0, centre + half), 4))


def calibrate(store: Store, target_error: float = 0.1, nominal: dict | None = None, min_n: int = 10) -> dict:
    nominal = nominal or NOMINAL
    rows = store.con.execute("select a.confidence, j.outcome from adjudication j join answer a on a.question_id=j.question_id and a.revision=j.revision"
                             " where a.status != 'unknown'").fetchall()
    classes, n_total, ece = {}, len(rows), 0.0
    for c in ("observed", "derived", "inferred"):
        outs = [r["outcome"] == "correct" for r in rows if r["confidence"] == c]
        n, k = len(outs), sum(outs)
        acc = k / n if n else None
        lo, hi = wilson(k, n)
        classes[c] = {"n": n, "correct": k, "precision": round(acc, 4) if acc is not None else None, "wilson95": [lo, hi], "nominal": nominal[c],
                      "gap": round(nominal[c] - acc, 4) if acc is not None else None,
                      "status": "no-data" if n == 0 else "insufficient-data" if n < min_n else "abstain" if lo < 1 - target_error else "trusted",
                      "abstain": None if n < min_n else lo < 1 - target_error}
        if n:
            ece += n / n_total * abs(nominal[c] - acc)
    order_ok = all(classes[a]["precision"] is None or classes[b]["precision"] is None or classes[a]["precision"] >= classes[b]["precision"]
                   for a, b in (("observed", "derived"), ("derived", "inferred")))
    return {"adjudicated": n_total, "target_error": target_error, "classes": classes, "ece_vs_nominal": round(ece, 4) if n_total else None,
            "ordering_holds": order_ok,
            "min_n": min_n,
            "advice": [f"Answers labelled '{c}' should be recorded as unknown or re-probed: the lower bound of their precision ({v['wilson95'][0]}) is below {1 - target_error}."
                       for c, v in classes.items() if v["abstain"]]
                      + [f"'{c}': only {v['n']} adjudicated answer(s); need {min_n} before trusting or abstaining." for c, v in classes.items() if v["status"] == "insufficient-data"]}
