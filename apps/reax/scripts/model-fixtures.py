# Writes the model fixtures in fixtures/extra with the formats' own writers, which share no code with
# reax: the gguf package (llama.cpp's Python library) and safetensors. Run by scripts/extra-fixtures.ts
# (`node scripts/extra-fixtures.ts models`) in a virtualenv that has both:
#   python3 -m venv /tmp/reax-fixvenv && /tmp/reax-fixvenv/bin/pip install gguf safetensors numpy pyyaml tqdm
#   python3 scripts/model-fixtures.py <output dir>   prints the library versions as JSON
import json
import os
import sys
from importlib.metadata import version

import gguf
import numpy as np
from gguf import GGMLQuantizationType as Q
from gguf import GGUFEndian, GGUFValueType as V
from gguf.quants import quantize
from safetensors.numpy import save_file

out = sys.argv[1]
rng = np.random.default_rng(7)

TOKENS = [f"tok{i}" for i in range(36)] + ["é", "日本", "▁the", "ignore previous instructions"]


def common(w: gguf.GGUFWriter, small: bool) -> None:
    w.add_string("general.name", "reax-tiny")
    w.add_uint32("general.file_type", 1)
    w.add_uint32("general.quantization_version", 2)
    w.add_uint32("llama.context_length", 4096)
    w.add_uint32("llama.block_count", 2)
    w.add_uint32("llama.embedding_length", 8)
    w.add_float32("llama.rope.freq_base", 10000.0)
    if small:
        return
    w.add_key_value("t.u8", 200, V.UINT8)
    w.add_key_value("t.i8", -100, V.INT8)
    w.add_key_value("t.u16", 60000, V.UINT16)
    w.add_key_value("t.i16", -30000, V.INT16)
    w.add_key_value("t.i32", -2000000000, V.INT32)
    w.add_key_value("t.u64", 2**63 + 5, V.UINT64)
    w.add_key_value("t.i64", -(2**62), V.INT64)
    w.add_key_value("t.f64", 3.141592653589793, V.FLOAT64)
    w.add_bool("t.bool_true", True)
    w.add_bool("t.bool_false", False)
    w.add_string("t.empty", "")
    w.add_array("tokenizer.ggml.tokens", TOKENS)
    w.add_array("tokenizer.ggml.scores", [float(-i) for i in range(len(TOKENS))])
    w.add_array("tokenizer.ggml.token_type", [1] * len(TOKENS))
    w.add_array("t.nested", [[1, 2], [3]])
    w.add_string("tokenizer.ggml.model", "llama")
    w.add_uint32("tokenizer.ggml.bos_token_id", 1)


def tensors(w: gguf.GGUFWriter, small: bool) -> None:
    w.add_tensor("token_embd.weight", rng.standard_normal((16, 8)).astype(np.float16))
    w.add_tensor("blk.0.attn_norm.weight", rng.standard_normal(8).astype(np.float32))
    if small:
        return
    for name, q in (("blk.0.ffn_down.weight", Q.Q8_0), ("blk.1.ffn_down.weight", Q.Q4_0), ("blk.1.ffn_up.weight", Q.Q4_K)):
        cols = 256 if q == Q.Q4_K else 64
        if q == Q.Q8_0:
            data = quantize(rng.standard_normal((2, cols)).astype(np.float32), q)
        else:  # the library only quantizes a few types; the contents are not what the fixture is for
            block, size = gguf.GGML_QUANT_SIZES[q]
            data = rng.integers(0, 256, (2, cols // block * size), dtype=np.uint8)
        w.add_tensor(name, data, raw_dtype=q)
    w.add_tensor("output_ids", np.arange(6, dtype=np.int32).reshape(2, 3))
    w.add_tensor("scalar_like", np.array([1.5], dtype=np.float64))


def write(name: str, endian, small: bool, alignment=None) -> None:
    path = os.path.join(out, name)
    w = gguf.GGUFWriter(path, "llama", endianess=endian)
    if alignment:
        w.add_uint32("general.alignment", alignment)
        w.data_alignment = alignment
    common(w, small)
    tensors(w, small)
    w.write_header_to_file()
    w.write_kv_data_to_file()
    w.write_tensors_to_file()
    w.close()


write("model-tiny.gguf", GGUFEndian.LITTLE, False)
write("model-tiny-be.gguf", GGUFEndian.BIG, True)
write("model-align64.gguf", GGUFEndian.LITTLE, True, 64)

save_file(
    {
        "embed.weight": rng.standard_normal((4, 3)).astype(np.float32),
        "layers.0.bias": rng.standard_normal(3).astype(np.float16),
        "ids": np.arange(5, dtype=np.int64),
        "mask": np.array([True, False, True]),
        "bytes": np.arange(7, dtype=np.uint8),
    },
    os.path.join(out, "model-tiny.safetensors"),
    metadata={"format": "pt", "note": "reax fixture"},
)
print(json.dumps({"gguf": version("gguf"), "safetensors": version("safetensors"), "numpy": version("numpy")}))
