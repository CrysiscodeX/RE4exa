"""Evidence store: content-addressed records, durable steps, questions and answers.

One SQLite file, single writer (WAL). Evidence payloads are stored once; the id is
sha256 over a canonical JSON projection, so the same observation always gets the
same id and a replayed step converges on the record it already wrote.
"""

from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import time
from pathlib import Path

SCHEMA = """
create table if not exists evidence (
  id text primary key,                 -- ev_<sha256 of canonical identity>
  operation text not null,             -- e.g. identify, inventory, elf, js-refs, rea:inspect_go_binary
  subject_path text, subject_sha256 text,
  tool text not null, tool_version text,
  params text not null,                -- canonical JSON
  result text not null,                -- canonical JSON, the only copy of the payload
  confidence text not null check (confidence in ('observed','derived','inferred')),
  authority text not null,             -- shipped-artifact | controlled-replay | external-tool | analyst-inference
  limitations text not null,           -- JSON array
  links text not null default '[]',    -- JSON array of evidence ids this record derives from
  bytes integer not null, created_at real not null
);
create index if not exists evidence_subject on evidence(subject_sha256, operation);
create table if not exists step (     -- durable, idempotent operations
  key text primary key,                -- sha256(operation + canonical args + subject digest)
  operation text not null, args text not null, status text not null,
  attempts integer not null default 0, evidence_id text, error text,
  started_at real, finished_at real
);
create table if not exists question (
  id text primary key, text text not null, required_confidence text not null default 'observed',
  created_at real not null
);
create table if not exists answer (    -- hash-chained revisions per question
  question_id text not null references question(id), revision integer not null,
  status text not null check (status in ('answered','partial','unknown')),
  text text, confidence text, evidence_ids text not null, rationale text,
  previous_digest text, digest text not null, created_at real not null,
  primary key (question_id, revision)
);
create table if not exists adjudication (
  question_id text not null, revision integer not null,
  outcome text not null check (outcome in ('correct','incorrect')), note text, created_at real not null,
  primary key (question_id, revision)
);
"""

CONFIDENCE_RANK = {"inferred": 0, "derived": 1, "observed": 2}


def canonical(value) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str)


def digest(*parts: str) -> str:
    h = hashlib.sha256()
    for p in parts:
        h.update(p.encode())
        h.update(b"\x00")
    return h.hexdigest()


def file_sha256(path: str | Path) -> str | None:
    p = Path(path)
    if not p.is_file():
        return None
    h = hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


class RexError(Exception):
    """A refusal with a stable code, a plain reason and the fix."""

    def __init__(self, code: str, message: str, fix: str, **details):
        super().__init__(message)
        self.code, self.message, self.fix, self.details = code, message, fix, details

    def to_json(self) -> dict:
        return {"error": {"code": self.code, "message": self.message, "fix": self.fix, **({"details": self.details} if self.details else {})}}


class Store:
    def __init__(self, path: str | Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.con = sqlite3.connect(self.path, timeout=30)
        self.con.row_factory = sqlite3.Row
        self.con.execute("pragma journal_mode = wal")
        self.con.execute("pragma synchronous = normal")
        self.con.executescript(SCHEMA)

    def close(self) -> None:
        self.con.close()

    def __del__(self):
        try:
            self.con.close()
        except Exception:
            pass

    # ---- evidence -----------------------------------------------------------------------
    def put(self, *, operation: str, tool: str, params: dict, result, confidence: str, authority: str,
            limitations: list[str], subject_path: str | None = None, subject_sha256: str | None = None,
            tool_version: str | None = None, links: list[str] | None = None) -> dict:
        identity = canonical({"operation": operation, "subject": subject_sha256, "tool": tool, "tool_version": tool_version,
                              "params": params, "result": result, "confidence": confidence, "authority": authority,
                              "limitations": sorted(limitations), "links": sorted(links or [])})
        eid = "ev_" + digest(identity)
        result_json = canonical(result)
        with self.con:
            self.con.execute(
                "insert or ignore into evidence(id, operation, subject_path, subject_sha256, tool, tool_version, params, result, confidence,"
                " authority, limitations, links, bytes, created_at) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (eid, operation, subject_path, subject_sha256, tool, tool_version, canonical(params), result_json, confidence,
                 authority, canonical(sorted(limitations)), canonical(sorted(links or [])), len(result_json), time.time()))
        return self.get(eid)

    def get(self, eid: str) -> dict:
        row = self.con.execute("select * from evidence where id = ?", (eid,)).fetchone()
        if row is None:
            raise RexError("evidence_not_found", f"No evidence {eid} in this store.", "List ids with `rex evidence list` or re-run the probe.", evidence_id=eid)
        d = dict(row)
        for k in ("params", "result", "limitations", "links"):
            d[k] = json.loads(d[k])
        return d

    def list(self, operation: str | None = None, subject: str | None = None, limit: int = 50, offset: int = 0) -> list[dict]:
        sql, p = "select id, operation, subject_path, subject_sha256, tool, confidence, authority, bytes, created_at from evidence where 1=1", []
        if operation:
            sql += " and operation = ?"; p.append(operation)
        if subject:
            sql += " and (subject_sha256 = ? or subject_path = ?)"; p += [subject, subject]
        sql += " order by created_at limit ? offset ?"
        return [dict(r) for r in self.con.execute(sql, (*p, limit, offset))]

    # ---- durable steps ------------------------------------------------------------------
    def step(self, operation: str, args: dict, subject_sha256: str | None, fn, max_attempts: int = 3) -> dict:
        """Run fn() once per (operation, args, subject); later calls return the stored evidence.

        A step left 'running' by a crashed process is retried; after max_attempts the step
        is parked as 'failed' instead of crash-looping."""
        key = digest(operation, canonical(args), subject_sha256 or "")
        row = self.con.execute("select * from step where key = ?", (key,)).fetchone()
        if row and row["status"] == "done":
            return {"reused": True, "evidence": self.get(row["evidence_id"])}
        if row and row["status"] == "failed" and row["attempts"] >= max_attempts:
            raise RexError("step_parked", f"Step {operation} failed {row['attempts']} times and is parked.", "Inspect the error, fix the input, then run `rex steps retry`.",
                           step=key, last_error=row["error"])
        with self.con:
            self.con.execute("insert into step(key, operation, args, status, attempts, started_at) values (?,?,?, 'running', 1, ?)"
                             " on conflict(key) do update set status='running', attempts=step.attempts+1, started_at=excluded.started_at",
                             (key, operation, canonical(args), time.time()))
        try:
            ev = fn()
        except Exception as e:
            with self.con:
                self.con.execute("update step set status='failed', error=? where key=?", (f"{type(e).__name__}: {e}"[:500], key))
            raise
        with self.con:
            self.con.execute("update step set status='done', evidence_id=?, finished_at=?, error=null where key=?", (ev["id"], time.time(), key))
        return {"reused": False, "evidence": ev}

    def steps(self, status: str | None = None) -> list[dict]:
        sql = "select key, operation, status, attempts, evidence_id, error from step" + (" where status = ?" if status else "") + " order by started_at"
        return [dict(r) for r in self.con.execute(sql, (status,) if status else ())]

    def retry_parked(self) -> int:
        with self.con:
            return self.con.execute("update step set status='failed', attempts=0 where status='failed'").rowcount

    # ---- portable bundles (streamed: no single-object size limit) -------------------------
    def export(self, path: str | Path) -> dict:
        n = 0
        tmp = Path(str(path) + ".tmp")
        with tmp.open("w") as f:
            f.write(canonical({"rex_bundle": 1}) + "\n")
            for row in self.con.execute("select * from evidence order by id"):
                d = dict(row)
                for k in ("params", "result", "limitations", "links"):
                    d[k] = json.loads(d[k])
                f.write(canonical({"evidence": d}) + "\n")
                n += 1
            for table in ("question", "answer", "adjudication"):
                for row in self.con.execute(f"select * from {table}"):
                    f.write(canonical({table: dict(row)}) + "\n")
        os.replace(tmp, path)
        return {"path": str(path), "evidence": n, "bytes": Path(path).stat().st_size}

    BUNDLE_TABLES = ("question", "answer", "adjudication")

    def import_(self, path: str | Path) -> dict:
        """Import a bundle. Every record is checked before it is written: evidence ids must match
        their content, table and column names must exist in this schema (they are never taken from
        the file on trust), and answers must keep their hash chain and the confidence guard."""
        counts = {"evidence": 0, "rejected": 0, "question": 0, "answer": 0, "adjudication": 0}
        columns = {t: {r[1] for r in self.con.execute(f"pragma table_info({t})")} for t in self.BUNDLE_TABLES}
        with Path(path).open() as f, self.con:
            header = json.loads(f.readline())
            if header.get("rex_bundle") != 1:
                raise RexError("not_a_bundle", "File is not a rex bundle (missing header).", "Export with `rex export`.")
            for line in f:
                rec = json.loads(line)
                if not isinstance(rec, dict) or len(rec) != 1:
                    counts["rejected"] += 1
                    continue
                if "evidence" in rec:
                    e = rec["evidence"]
                    try:
                        identity = canonical({"operation": e["operation"], "subject": e["subject_sha256"], "tool": e["tool"], "tool_version": e["tool_version"],
                                              "params": e["params"], "result": e["result"], "confidence": e["confidence"], "authority": e["authority"],
                                              "limitations": sorted(e["limitations"]), "links": sorted(e["links"])})
                        ok = "ev_" + digest(identity) == e["id"] and e["confidence"] in CONFIDENCE_RANK
                    except (KeyError, TypeError):
                        ok = False
                    if not ok:
                        counts["rejected"] += 1  # tampered or corrupted record: refuse it, keep going
                        continue
                    self.con.execute("insert or ignore into evidence(id, operation, subject_path, subject_sha256, tool, tool_version, params, result, confidence,"
                                     " authority, limitations, links, bytes, created_at) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                                     (e["id"], e["operation"], e["subject_path"], e["subject_sha256"], e["tool"], e["tool_version"], canonical(e["params"]),
                                      canonical(e["result"]), e["confidence"], e["authority"], canonical(e["limitations"]), canonical(e["links"]), e["bytes"], e["created_at"]))
                    counts["evidence"] += 1
                    continue
                (table, row), = rec.items()
                if table not in columns or not isinstance(row, dict) or not row or not set(row) <= columns[table] or not self._valid_row(table, row):
                    counts["rejected"] += 1  # unknown table or column, or a row that breaks an invariant
                    continue
                names = list(row)  # every name is a column of `table`, checked above
                self.con.execute(f"insert or ignore into {table}({','.join(names)}) values ({','.join('?' * len(names))})", tuple(row[c] for c in names))
                counts[table] += 1
        return counts

    def _valid_row(self, table: str, row: dict) -> bool:
        try:
            if table == "question":
                return row["id"] == "q_" + digest(str(row["text"]).strip().lower())[:16] and row.get("required_confidence", "observed") in CONFIDENCE_RANK
            if table == "answer":
                ids = json.loads(row["evidence_ids"])
                body = {"question_id": row["question_id"], "revision": row["revision"], "status": row["status"], "text": row.get("text"),
                        "confidence": row.get("confidence"), "evidence_ids": sorted(ids), "rationale": row.get("rationale"), "previous_digest": row.get("previous_digest")}
                if digest(canonical(body)) != row["digest"] or row["status"] not in ("answered", "partial", "unknown"):
                    return False
                if self.con.execute("select 1 from question where id = ?", (row["question_id"],)).fetchone() is None:
                    return False
                prev = self.con.execute("select digest from answer where question_id = ? and revision = ?", (row["question_id"], row["revision"] - 1)).fetchone()
                if (prev[0] if prev else None) != row.get("previous_digest"):
                    return False
                if row["status"] != "unknown":
                    found = [self.con.execute("select confidence from evidence where id = ?", (i,)).fetchone() for i in ids]
                    if not ids or None in found or row.get("confidence") not in CONFIDENCE_RANK:
                        return False
                    if CONFIDENCE_RANK[row["confidence"]] > max(CONFIDENCE_RANK[c[0]] for c in found):
                        return False
                return True
            if table == "adjudication":
                return row["outcome"] in ("correct", "incorrect") and self.con.execute(
                    "select 1 from answer where question_id = ? and revision = ?", (row["question_id"], row["revision"])).fetchone() is not None
        except (KeyError, TypeError, ValueError):
            return False
        return False
