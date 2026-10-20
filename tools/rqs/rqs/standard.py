"""Load the RQS-2030 standard (the JSON rendered by standard/build.py)."""

from __future__ import annotations

import json
import os
from pathlib import Path

DEFAULT = Path(__file__).resolve().parents[3] / "standard" / "rqs-2030.json"


class RqsError(Exception):
    def __init__(self, code: str, message: str, fix: str):
        super().__init__(message)
        self.code, self.message, self.fix = code, message, fix

    def to_json(self) -> dict:
        return {"error": {"code": self.code, "message": self.message, "fix": self.fix}}


def load(path: str | None = None) -> dict:
    p = Path(path or os.environ.get("RQS_STANDARD") or DEFAULT)
    if not p.exists():
        raise RqsError("standard_not_found", f"{p} does not exist", "Run `python3 standard/build.py` or set RQS_STANDARD to rqs-2030.json.")
    return json.loads(p.read_text(encoding="utf-8"))


def criteria(std: dict) -> list[dict]:
    """Every criterion with its dimension id attached."""
    return [{**c, "dimension": d["id"]} for d in std["dimensions"] for c in d["criteria"]]


def applicable(c: dict, flags: dict) -> bool:
    return not c.get("applies_if") or bool(flags.get(c["applies_if"]))
