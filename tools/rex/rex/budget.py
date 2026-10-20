"""Attention budget: every output says what it costs; large evidence is viewed
summary-first and fetched by handle (the evidence id), in the manner of caveman's
retrievable originals."""

from __future__ import annotations

import json


def tokens_est(text: str) -> int:
    """Rough token estimate (UTF-8 bytes / 4). Labelled as an estimate everywhere it is shown."""
    return max(1, len(text.encode()) // 4)


def summarize(value, depth: int = 0, max_items: int = 8, max_str: int = 240):
    """Structure-preserving summary: long lists keep head and tail with an elision count."""
    if isinstance(value, dict):
        return {k: summarize(v, depth + 1, max_items, max_str) for k, v in value.items()}
    if isinstance(value, list):
        if len(value) <= max_items:
            return [summarize(v, depth + 1, max_items, max_str) for v in value]
        head = [summarize(v, depth + 1, max_items, max_str) for v in value[: max_items - 2]]
        tail = [summarize(v, depth + 1, max_items, max_str) for v in value[-2:]]
        return [*head, {"__elided__": len(value) - max_items}, *tail]
    if isinstance(value, str) and len(value) > max_str:
        return value[:max_str] + f"… [+{len(value) - max_str} chars]"
    return value


def view(evidence: dict, mode: str = "summary", path: str | None = None, offset: int = 0, limit: int = 50) -> dict:
    """summary: elided structure; full: everything; page: a slice of one list inside the result."""
    result = evidence["result"]
    if mode == "page":
        node = result
        for key in (path or "").split(".") if path else []:
            node = node[int(key)] if isinstance(node, list) else node[key]
        if not isinstance(node, list):
            raise ValueError(f"{path} is not a list")
        body = {"path": path, "offset": offset, "limit": limit, "total": len(node), "items": node[offset:offset + limit],
                "next_offset": offset + limit if offset + limit < len(node) else None}
    elif mode == "full":
        body = result
    else:
        body = summarize(result)
    meta = {k: evidence[k] for k in ("id", "operation", "subject_path", "subject_sha256", "tool", "tool_version", "confidence", "authority", "limitations", "links", "bytes")}
    out = {"evidence": meta, "view": mode, "result": body}
    text = json.dumps(out, ensure_ascii=False)
    out["cost"] = {"bytes": len(text.encode()), "tokens_est": tokens_est(text), "full_bytes": evidence["bytes"],
                   "more": None if mode == "full" else f"rex show {evidence['id']} --view full (or --view page --path <list>)"}
    return out
