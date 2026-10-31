# Checks scripts/oracle-model.py against the gguf package's own GGUFReader (and the type-size table
# against gguf.GGML_QUANT_SIZES), run by hand with the fixture virtualenv (see model-fixtures.py):
#   /tmp/reax-fixvenv/bin/python scripts/oracle-model-crosscheck.py <model.gguf>...
import json
import subprocess
import sys
from pathlib import Path

import gguf
import numpy as np

here = Path(__file__).parent
src = (here / "oracle-model.py").read_text()
ns: dict = {}
exec(src.split("path = sys.argv[1]")[0], ns)  # the constants only
bad = 0
for t, (name, block, size) in ns["TYPES"].items():
    # gguf-py gives Q8_1 40 bytes (4 + 4 + 32); ggml's block_q8_1 is 36 (two halves and 32 bytes)
    if name == "Q8_1":
        continue
    q = gguf.GGMLQuantizationType(t)
    if q.name != name or gguf.GGML_QUANT_SIZES[q] != (block, size):
        print("type table differs:", t, name, block, size, q.name, gguf.GGML_QUANT_SIZES[q])
        bad += 1
for path in sys.argv[1:]:
    mine = json.loads(subprocess.check_output([sys.executable, "-I", str(here / "oracle-model.py"), path], text=True))
    r = gguf.GGUFReader(path)
    assert len(r.tensors) == mine["tensorCount"], path
    assert r.data_offset == mine["dataOffset"], (path, r.data_offset, mine["dataOffset"])
    theirs = {k: f for k, f in r.fields.items()}
    mykeys = [m["key"] for m in mine["metadata"]]
    assert [k for k in theirs if not k.startswith("GGUF.")] == mykeys, path
    for m in mine["metadata"]:
        f = theirs[m["key"]]
        v = m["value"]
        if f.types[0] == gguf.GGUFValueType.STRING:
            assert bytes(f.parts[f.data[0]]).decode() == v, m["key"]
        elif f.types[0] == gguf.GGUFValueType.ARRAY:
            # the package's reader does not unpack arrays of arrays into one part per element
            if v["elementType"] != "array":
                assert len(f.data) == v["length"], m["key"]
        else:
            got = f.parts[f.data[0]][0]
            assert str(got) == str(v) or float(got) == float(v), (m["key"], got, v)
    for a, b in zip(r.tensors, mine["tensors"]):
        assert a.name == b["name"] and a.data_offset - r.data_offset == b["offset"], (a.name, b)
        assert list(a.shape) == b["dims"] and a.tensor_type.name == b["type"], (a.name, b)
        assert a.n_bytes == b["bytes"], (a.name, a.n_bytes, b["bytes"])
    print("ok", path, mine["tensorCount"], "tensors,", len(mine["metadata"]), "keys")
sys.exit(1 if bad else 0)
