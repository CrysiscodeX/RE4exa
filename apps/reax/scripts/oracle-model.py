# The model-file answer key for reax (scripts/oracle.ts runs it): a GGUF and safetensors header
# parser written against the formats' specifications with only Python's standard library. It was
# cross-checked once against the gguf package's own reader (GGUFReader) and the safetensors
# package, on the fixtures and on a real 5.7 GB model (DECISION-LOG D-10).
#   python3 -I scripts/oracle-model.py <file>   prints JSON on stdout
import hashlib
import json
import mmap
import struct
import sys

# ggml type id -> (name, elements per block, bytes per block)
TYPES = {
    0: ("F32", 1, 4), 1: ("F16", 1, 2), 2: ("Q4_0", 32, 18), 3: ("Q4_1", 32, 20), 6: ("Q5_0", 32, 22),
    7: ("Q5_1", 32, 24), 8: ("Q8_0", 32, 34), 9: ("Q8_1", 32, 36), 10: ("Q2_K", 256, 84),
    11: ("Q3_K", 256, 110), 12: ("Q4_K", 256, 144), 13: ("Q5_K", 256, 176), 14: ("Q6_K", 256, 210),
    15: ("Q8_K", 256, 292), 16: ("IQ2_XXS", 256, 66), 17: ("IQ2_XS", 256, 74), 18: ("IQ3_XXS", 256, 98),
    19: ("IQ1_S", 256, 50), 20: ("IQ4_NL", 32, 18), 21: ("IQ3_S", 256, 110), 22: ("IQ2_S", 256, 82),
    23: ("IQ4_XS", 256, 136), 24: ("I8", 1, 1), 25: ("I16", 1, 2), 26: ("I32", 1, 4), 27: ("I64", 1, 8),
    28: ("F64", 1, 8), 29: ("IQ1_M", 256, 56), 30: ("BF16", 1, 2), 34: ("TQ1_0", 256, 54),
    35: ("TQ2_0", 256, 66), 39: ("MXFP4", 32, 17),
}
SCALARS = {0: "B", 1: "b", 2: "H", 3: "h", 4: "I", 5: "i", 6: "f", 7: "?", 10: "Q", 11: "q", 12: "d"}
NAMES = {0: "uint8", 1: "int8", 2: "uint16", 3: "int16", 4: "uint32", 5: "int32", 6: "float32", 7: "bool",
         8: "string", 9: "array", 10: "uint64", 11: "int64", 12: "float64"}
SAMPLE = 8  # array elements kept in the key; the count and a sha256 cover the rest

path = sys.argv[1]
with open(path, "rb") as fh:
    data = mmap.mmap(fh.fileno(), 0, access=mmap.ACCESS_READ)


def gguf():
    e = "<"
    if struct.unpack_from("<I", data, 4)[0] > 0xFFFF:  # a version that large is the other byte order
        e = ">"
    pos = 4
    version, tcount, kcount = struct.unpack_from(e + "IQQ", data, pos)
    pos += 20

    def string():
        nonlocal pos
        (n,) = struct.unpack_from(e + "Q", data, pos)
        pos += 8
        s = bytes(data[pos:pos + n]).decode("utf-8", "replace")
        pos += n
        return s

    def value(t):
        nonlocal pos
        if t == 8:
            return string()
        if t == 9:
            et, n = struct.unpack_from(e + "IQ", data, pos)
            pos += 12
            start = pos
            items = [value(et) for _ in range(n)]
            # sha256 of the elements as the file stores them (strings with their length prefixes)
            return {"elementType": NAMES[et], "length": n, "first": items[:SAMPLE],
                    "sha256": hashlib.sha256(data[start:pos]).hexdigest()}
        f = SCALARS[t]
        (v,) = struct.unpack_from(e + f, data, pos)
        pos += struct.calcsize(f)
        return str(v) if t in (10, 11) else v  # 64-bit integers as decimal strings: JSON numbers are doubles

    meta = []
    for _ in range(kcount):
        k = string()
        (t,) = struct.unpack_from(e + "I", data, pos)
        pos += 4
        meta.append({"key": k, "type": NAMES[t], "value": value(t)})
    align = next((m["value"] for m in meta if m["key"] == "general.alignment"), 32)
    tensors = []
    for _ in range(tcount):
        name = string()
        (nd,) = struct.unpack_from(e + "I", data, pos)
        pos += 4
        dims = list(struct.unpack_from(e + "Q" * nd, data, pos))
        pos += 8 * nd
        t, off = struct.unpack_from(e + "IQ", data, pos)
        pos += 12
        tname, block, size = TYPES.get(t, ("?%d" % t, 0, 0))
        n = 1
        for d in dims:
            n *= d
        tensors.append({"name": name, "dims": dims, "type": tname, "offset": off,
                        "bytes": n // block * size if block else None})
    data_start = (pos + align - 1) // align * align
    return {"format": "gguf", "version": version, "endian": "little" if e == "<" else "big", "alignment": align,
            "tensorCount": tcount, "dataOffset": data_start, "metadata": meta, "tensors": tensors}


def safetensors():
    (n,) = struct.unpack_from("<Q", data, 0)
    header = json.loads(bytes(data[8:8 + n]))
    meta = header.pop("__metadata__", {})
    tensors = [{"name": k, "dtype": v["dtype"], "shape": v["shape"], "start": v["data_offsets"][0],
                "end": v["data_offsets"][1]} for k, v in header.items()]
    tensors.sort(key=lambda t: t["start"])
    return {"format": "safetensors", "headerBytes": n, "dataOffset": 8 + n, "metadata": meta, "tensors": tensors}


out = gguf() if data[:4] == b"GGUF" else safetensors()
print(json.dumps(out, ensure_ascii=False))
