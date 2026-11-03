# The answer key for reax setup's reading of client configuration files (bench/oracle/set.json),
# from Python's standard library only: json (object_pairs_hook for duplicate keys, parse_int and
# parse_float keeping each number's source text) and hashlib. It shares no code with src/setup.
# For each file: the verdict (ok, config_conflict, or the malformed reason), the sha256 of its
# bytes, and for ok the configuration after setup as a canonical dump (sorted keys, ASCII escapes,
# numbers as their source text), with ENTRY as mcpServers.reax.
#   python3 -I scripts/oracle-set.py <fixtures/set>   prints JSON on stdout
import hashlib
import json
import math
import os
import re
import sys

ENTRY = {"type": "stdio", "command": "NODE", "args": ["REAX_BIN", "mcp"]}


class Num:
    def __init__(self, src):
        self.src = src


def js_number_text(src):
    """The text JavaScript's Number::toString gives for the double nearest to src (ECMA-262
    Number::toString), or None for an infinity."""
    x = float(src)
    if math.isinf(x) or math.isnan(x):
        return None
    if x == 0:
        return "0"
    sign = "-" if x < 0 else ""
    m = re.fullmatch(r"(\d+)(?:\.(\d+))?(?:e([+-]\d+))?", repr(abs(x)))
    ip, fp, e = m.group(1), m.group(2) or "", int(m.group(3) or 0)
    allds = ip + fp
    lead = len(allds) - len(allds.lstrip("0"))
    n = len(ip) + e - lead
    digits = allds.lstrip("0").rstrip("0")
    k = len(digits)
    if k <= n <= 21:
        return sign + digits + "0" * (n - k)
    if 0 < n <= 21:
        return sign + digits[:n] + "." + digits[n:]
    if -6 < n <= 0:
        return sign + "0." + "0" * (-n) + digits
    ex = n - 1
    return sign + digits[0] + ("." + digits[1:] if k > 1 else "") + "e" + ("+" if ex >= 0 else "-") + str(abs(ex))


def verdict(data):
    if len(data) > 16 * 1024 * 1024:
        return "too_large", None
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        return "syntax", None
    if text.startswith("﻿"):
        return "syntax", None
    flags = {"dup": False, "imprecise": False}

    def pairs(ps):
        keys = [k for k, _ in ps]
        if len(set(keys)) != len(keys):
            flags["dup"] = True
        return dict(ps)

    def num(src):
        if js_number_text(src) != src:
            flags["imprecise"] = True
        return Num(src)

    def const(name):
        raise ValueError(name)

    try:
        value = json.loads(text, object_pairs_hook=pairs, parse_int=num, parse_float=num, parse_constant=const)
    except ValueError:
        return "syntax", None
    if flags["dup"]:
        return "duplicate_key", None
    if flags["imprecise"]:
        return "number_precision", None
    if not isinstance(value, dict):
        return "not_object", None
    if "mcpServers" in value and not isinstance(value["mcpServers"], dict):
        return "servers_not_object", None
    if "reax" in value.get("mcpServers", {}):
        return "config_conflict", None
    value.setdefault("mcpServers", {})["reax"] = ENTRY
    return "ok", canonical(value)


def canonical(v):
    if isinstance(v, dict):
        return "{" + ",".join(json.dumps(k) + ":" + canonical(v[k]) for k in sorted(v)) + "}"
    if isinstance(v, list):
        return "[" + ",".join(canonical(x) for x in v) + "]"
    if isinstance(v, Num):
        return v.src
    if isinstance(v, str):
        return json.dumps(v)
    if v is True:
        return "true"
    if v is False:
        return "false"
    if v is None:
        return "null"
    raise TypeError(type(v))


def main():
    d = sys.argv[1]
    files = {}
    for f in sorted(os.listdir(d)):
        data = open(os.path.join(d, f), "rb").read()
        v, after = verdict(data)
        row = {"verdict": v, "sha256": hashlib.sha256(data).hexdigest()}
        if after is not None:
            row["after"] = after
        files[f] = row
    print(json.dumps({"entry": ENTRY, "files": files}, sort_keys=True))


main()
