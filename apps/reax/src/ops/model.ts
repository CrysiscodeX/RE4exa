// inventory.model: the header of a GGUF or safetensors model file (metadata, tensor table, sizes)
// without reading the weights, for files of any size.
import { CoreError } from "@re4exa/core/errors";
import "../errors.ts";
import { fileSource, ggufInfo, type ModelInfo, safetensorsInfo } from "../readers/model.ts";
import { pageStream } from "./bytes.ts";
import { readRange, target } from "./file.ts";
import { PAGE_INPUT } from "./page.ts";
import type { JsonSchema, Operation, OpResult } from "./types.ts";

const PATH: JsonSchema = { type: "string", description: "File path inside the workspace", maxLength: 4096 };

/** The keys agents ask first, taken from the metadata under the architecture's prefix. */
function summary(m: ModelInfo): Record<string, string | number | boolean | null> {
  const get = (k: string) => {
    const v = m.metadata.find((x) => x.key === k)?.value;
    return typeof v === "object" ? null : (v ?? null);
  };
  const arch = get("general.architecture");
  const a = (k: string) => (typeof arch === "string" ? get(`${arch}.${k}`) : null);
  return {
    architecture: arch,
    name: get("general.name"),
    fileType: get("general.file_type"),
    contextLength: a("context_length"),
    blockCount: a("block_count"),
    embeddingLength: a("embedding_length"),
    quantizationVersion: get("general.quantization_version"),
  };
}

export const inventoryModel: Operation = {
  tool: "inventory",
  name: "inventory.model",
  summary:
    "The header of a GGUF or safetensors model file, whatever its size: format version, byte order, every metadata key with its value (long arrays such as a vocabulary as a length, the first elements and a sha256), the tensor table (name, shape, element type, offset, size) with a total parameter count and a count by quantisation type, and what is wrong with the file (tensors past its end, misaligned offsets). Filters tensors by name; pages with offset and limit.",
  input: {
    type: "object",
    properties: {
      path: PATH,
      search: { type: "string", maxLength: 1024, description: "Keep only tensors whose name contains this text" },
      ...PAGE_INPUT,
    },
    required: ["path"],
    additionalProperties: false,
  },
  effect: "read",
  cost: "cheap",
  untrusted: true,
  platforms: ["linux", "darwin", "win32"],
  examples: [
    {
      title: "What a model file is, without loading it",
      workspace: "extra",
      args: { path: "model-tiny.gguf" },
      expect: { format: "gguf", version: 3, summary: { architecture: "llama", blockCount: 2 } },
    },
  ],
  covers: ["rea.tool/inspect_model_artifact"],
  async run(ctx, args): Promise<OpResult> {
    const t = target(ctx, args.path);
    const head = readRange(t.abs, 0, 16);
    const gguf = head.length >= 4 && String.fromCharCode(head[0]!, head[1]!, head[2]!, head[3]!) === "GGUF";
    const safetensors = !gguf && head.length >= 9 && head[8] === 0x7b; // the JSON header starts with "{"
    if (!gguf && !safetensors)
      throw new CoreError("bad_request", { field: "path", why: "a GGUF or safetensors file; this is neither" });
    const src = fileSource(t.abs);
    let m: ModelInfo;
    try {
      m = gguf ? ggufInfo(src) : safetensorsInfo(src);
    } finally {
      src.close();
    }
    const q = args.search as string | undefined;
    const p = pageStream(
      m.tensors.filter((x) => !q || x.name.includes(q)),
      args,
    );
    const { tensors: _all, ...rest } = m;
    const value = (v: unknown): string => (typeof v === "object" ? JSON.stringify(v) : String(v));
    return {
      data: { file: t.rel, ...rest, summary: summary(m), items: p.items, page: p.page },
      text: [
        `${t.rel}: ${m.format}${m.version !== null ? ` v${m.version}` : ""}${m.endian ? `, ${m.endian}-endian` : ""}, ${m.tensorCount} tensors, ${m.parameters} parameters, data at ${m.dataOffset}`,
        ...m.metadata.map((x) => `  ${x.key} (${x.type}): ${value(x.value)}`),
        `  types: ${Object.entries(m.types)
          .map(([k, n]) => `${k} x${n}`)
          .join(", ")}`,
        ...p.items.map(
          (x) => `  ${x.name}  ${x.type}  [${x.dims.join(", ")}]  offset ${x.offset}  ${x.bytes ?? "?"} bytes`,
        ),
        ...(p.page.next !== null ? [`  next offset ${p.page.next}`] : []),
        ...m.problems.map((x) => `  problem: ${x}`),
      ].join("\n"),
      coverage: m.notes.length ? "partial" : "complete",
      limitations: m.notes,
    };
  },
};
