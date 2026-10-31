// inventory.model against scripts/oracle-model.py (bench/oracle/model.json): GGUF files written by
// the gguf package (little- and big-endian, a custom alignment, every scalar type, arrays, nested
// arrays, quantised tensors) and a safetensors file written by the safetensors package. The
// negative tests feed damaged and hostile headers.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { isCoreError } from "@re4exa/core/errors";
import { EXTRA } from "../scripts/extra-fixtures.ts";
import { runOperation } from "../src/ops/registry.ts";

const REAX = join(import.meta.dirname, "..");
// biome-ignore lint/suspicious/noExplicitAny: the key is JSON from another tool
type Any = any;
const KEY = JSON.parse(readFileSync(join(REAX, "bench", "oracle", "model.json"), "utf8")).files as Record<string, Any>;
const refused = (e: unknown) => isCoreError(e) && e.code === "bad_request";

async function model(path: string, workspace: string, extra: Record<string, unknown> = {}) {
  return runOperation("inventory.model", { path, limit: 10000, ...extra }, { workspace });
}

test("[+rea.tool/inspect_model_artifact] GGUF headers equal the stdlib parser's: version, byte order, alignment, every key and value, every tensor", async () => {
  let n = 0;
  for (const [name, k] of Object.entries(KEY)) {
    if (k.format !== "gguf") continue;
    const r = await model(name, EXTRA);
    const d = r.data as Any;
    assert.equal(r.coverage, "complete", name);
    assert.deepStrictEqual(d.problems, [], name);
    assert.equal(d.version, k.version, name);
    assert.equal(d.endian, k.endian, name);
    assert.equal(d.alignment, k.alignment, name);
    assert.equal(d.tensorCount, k.tensorCount, name);
    assert.equal(d.dataOffset, k.dataOffset, name);
    assert.deepStrictEqual(d.metadata, k.metadata, name);
    assert.deepStrictEqual(
      d.items.map((t: Any) => ({ name: t.name, dims: t.dims, type: t.type, offset: t.offset, bytes: t.bytes })),
      k.tensors,
      name,
    );
    const params = k.tensors.reduce(
      (s: bigint, t: Any) => s + t.dims.reduce((p: bigint, x: number) => p * BigInt(x), 1n),
      0n,
    );
    assert.equal(d.parameters, params.toString(), name);
    n += k.tensors.length;
  }
  assert.ok(n >= 11, `${n} tensors compared`);
});

test("[+rea.tool/inspect_model_artifact] the architecture, context length and quantisation mix are summarised; a tensor search and paging reassemble the table", async () => {
  const r = await model("model-tiny.gguf", EXTRA);
  const d = r.data as Any;
  assert.deepStrictEqual(d.summary, {
    architecture: "llama",
    name: "reax-tiny",
    fileType: 1,
    contextLength: 4096,
    blockCount: 2,
    embeddingLength: 8,
    quantizationVersion: 2,
  });
  assert.deepStrictEqual(d.types, { F16: 1, F32: 1, Q8_0: 1, Q4_0: 1, Q4_K: 1, I32: 1, F64: 1 });
  const found = (await model("model-tiny.gguf", EXTRA, { search: "ffn_" })).data as Any;
  assert.deepStrictEqual(
    found.items.map((t: Any) => t.name),
    ["blk.0.ffn_down.weight", "blk.1.ffn_down.weight", "blk.1.ffn_up.weight"],
  );
  const pages: string[] = [];
  for (let offset = 0; ; ) {
    const p = (await model("model-tiny.gguf", EXTRA, { limit: 2, offset })).data as Any;
    pages.push(...p.items.map((t: Any) => t.name));
    if (p.page.next === null) break;
    offset = p.page.next;
  }
  assert.deepStrictEqual(
    pages,
    KEY["model-tiny.gguf"].tensors.map((t: Any) => t.name),
  );
});

test("[+rea.tool/inspect_model_artifact] a safetensors header equals the stdlib parser's: dtype, shape, byte range of every tensor, and the metadata", async () => {
  const k = KEY["model-tiny.safetensors"];
  const r = await model("model-tiny.safetensors", EXTRA);
  const d = r.data as Any;
  assert.equal(r.coverage, "complete");
  assert.deepStrictEqual(d.problems, []);
  assert.equal(d.dataOffset, k.dataOffset);
  assert.deepStrictEqual(
    d.metadata.map((m: Any) => [m.key, m.value]),
    Object.entries(k.metadata),
  );
  assert.deepStrictEqual(
    d.items.map((t: Any) => ({ name: t.name, dtype: t.type, shape: t.dims, start: t.offset, end: t.offset + t.bytes })),
    k.tensors,
  );
});

test("[-rea.tool/inspect_model_artifact] a file that is neither is refused; a cut file, a wrong version and hostile lengths are reported, not trusted", async () => {
  await assert.rejects(model("manifest.json", EXTRA), refused);
  const dir = mkdtempSync(join(tmpdir(), "reax-model-"));
  try {
    const good = readFileSync(join(EXTRA, "model-tiny.gguf"));
    const dataOffset = KEY["model-tiny.gguf"].dataOffset;
    // 1. cut in the middle of the tensor data: the header is fine, the tensors run past the end
    writeFileSync(join(dir, "cut.gguf"), good.subarray(0, dataOffset + 100));
    const cut = (await model("cut.gguf", dir)).data as Any;
    assert.match(cut.problems.join(" "), /extend past the end of the file/);
    // 2. cut inside the header: partial, and what was read stays
    writeFileSync(join(dir, "header.gguf"), good.subarray(0, 300));
    const header = await model("header.gguf", dir);
    assert.equal(header.coverage, "partial");
    assert.match(header.limitations.join(" "), /runs past the end of the file/);
    assert.ok((header.data as Any).metadata.length >= 3, "the keys before the cut are kept");
    // 3. an unknown version
    const v = Buffer.from(good);
    v.writeUInt32LE(9, 4);
    writeFileSync(join(dir, "version.gguf"), v);
    assert.match(((await model("version.gguf", dir)).data as Any).problems.join(" "), /version 9/);
    // 4. lengths far larger than the file: a string value, a key, and an array of fixed-width numbers
    // (each guard on its own: the other checks would also stop these by running off the end)
    const str = Buffer.from(good);
    str.writeBigUInt64LE(2n ** 40n, str.indexOf("reax-tiny") - 8);
    writeFileSync(join(dir, "string.gguf"), str);
    const sv = await model("string.gguf", dir);
    assert.equal(sv.coverage, "partial");
    assert.match(sv.limitations.join(" "), /string of \d+ bytes is longer than the file/);
    const key = Buffer.from(good);
    key.writeBigUInt64LE(2n ** 40n, 4 + 4 + 8 + 8); // the first key's length
    writeFileSync(join(dir, "key.gguf"), key);
    assert.match((await model("key.gguf", dir)).limitations.join(" "), /a key of \d+ bytes/);
    const arr = Buffer.from(good);
    const name = "tokenizer.ggml.token_type"; // an int32 array: only the length guard stops it early
    arr.writeBigUInt64LE(2n ** 40n, arr.indexOf(name) + name.length + 8);
    writeFileSync(join(dir, "array.gguf"), arr);
    const a = await model("array.gguf", dir);
    assert.equal(a.coverage, "partial");
    assert.match(a.limitations.join(" "), /array of \d+ elements is longer than the file/);
    // 5. a safetensors header that claims more bytes than the file has
    const st = Buffer.from(readFileSync(join(EXTRA, "model-tiny.safetensors")));
    st.writeBigUInt64LE(2n ** 50n, 0);
    writeFileSync(join(dir, "big.safetensors"), st);
    const big = await model("big.safetensors", dir);
    assert.equal(big.coverage, "partial");
    // 6. a tensor whose range lies outside the data
    const bad = Buffer.from(readFileSync(join(EXTRA, "model-tiny.safetensors")));
    writeFileSync(join(dir, "range.safetensors"), bad.subarray(0, bad.length - 20));
    assert.match(((await model("range.safetensors", dir)).data as Any).problems.join(" "), /outside the data/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
