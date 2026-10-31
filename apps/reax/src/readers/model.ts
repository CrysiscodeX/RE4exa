// Model files: GGUF (llama.cpp) and safetensors headers. Reads the metadata and the tensor table
// of files of any size without loading the weights: the header is streamed through a 1 MiB window
// and every count and length is bounded. Checked against a stdlib parser (scripts/oracle-model.py)
// that was itself cross-checked against the gguf package's reader (DECISION-LOG D-10).
import { createHash } from "node:crypto";
import { closeSync, openSync, readSync, statSync } from "node:fs";

/** Bounds on what a hostile header can make the reader do. */
export const LIMITS = {
  /** Header bytes scanned in all (a real 9B model's is about 6 MB). */
  scan: 256 * 1024 * 1024,
  metadataKeys: 4096,
  tensors: 1 << 20,
  dims: 8,
  keyBytes: 64 * 1024,
  /** A string value is kept up to this many bytes in the result. */
  stringBytes: 16 * 1024,
  /** Array elements shown; the length and a sha256 over all of them stand for the rest. */
  arraySample: 8,
  arrayDepth: 4,
  /** The safetensors specification caps its JSON header at 100 MB; this is smaller. */
  safetensorsHeader: 64 * 1024 * 1024,
};

export interface Source {
  size: number;
  read(at: number, length: number): Uint8Array;
}

export function fileSource(abs: string): Source & { close(): void } {
  const fd = openSync(abs, "r");
  return {
    size: statSync(abs).size,
    read(at, length) {
      const b = new Uint8Array(length);
      let off = 0;
      while (off < length) {
        const n = readSync(fd, b, off, length - off, at + off);
        if (n === 0) break;
        off += n;
      }
      return b.subarray(0, off);
    },
    close: () => closeSync(fd),
  };
}

export type GgufValue = string | number | boolean | GgufArray;
export interface GgufArray {
  elementType: string;
  length: number;
  first: GgufValue[];
  /** sha256 of the elements as the file stores them (strings with their length prefixes). */
  sha256: string;
}
export interface GgufTensor {
  name: string;
  dims: number[];
  type: string;
  /** From the start of the data section. */
  offset: number;
  /** null for a type this reader has no size for. */
  bytes: number | null;
}
export interface ModelInfo {
  format: "gguf" | "safetensors";
  fileSize: number;
  version: number | null;
  endian: "little" | "big" | null;
  alignment: number | null;
  tensorCount: number;
  /** Where the tensor data starts in the file. */
  dataOffset: number;
  metadata: { key: string; type: string; value: GgufValue }[];
  tensors: Tensor[];
  /** Product of every tensor's dimensions, as a decimal string. */
  parameters: string;
  /** Tensor count by element type. */
  types: Record<string, number>;
  /** Things wrong with the file itself. */
  problems: string[];
  /** Things this reader did not read (a cut table, a long value). */
  notes: string[];
}
export interface Tensor {
  name: string;
  /** GGUF type name or safetensors dtype. */
  type: string;
  dims: number[];
  offset: number;
  bytes: number | null;
}

/** ggml type id -> name, elements per block, bytes per block. */
const GGML: Record<number, [string, number, number]> = {
  0: ["F32", 1, 4],
  1: ["F16", 1, 2],
  2: ["Q4_0", 32, 18],
  3: ["Q4_1", 32, 20],
  6: ["Q5_0", 32, 22],
  7: ["Q5_1", 32, 24],
  8: ["Q8_0", 32, 34],
  9: ["Q8_1", 32, 36],
  10: ["Q2_K", 256, 84],
  11: ["Q3_K", 256, 110],
  12: ["Q4_K", 256, 144],
  13: ["Q5_K", 256, 176],
  14: ["Q6_K", 256, 210],
  15: ["Q8_K", 256, 292],
  16: ["IQ2_XXS", 256, 66],
  17: ["IQ2_XS", 256, 74],
  18: ["IQ3_XXS", 256, 98],
  19: ["IQ1_S", 256, 50],
  20: ["IQ4_NL", 32, 18],
  21: ["IQ3_S", 256, 110],
  22: ["IQ2_S", 256, 82],
  23: ["IQ4_XS", 256, 136],
  24: ["I8", 1, 1],
  25: ["I16", 1, 2],
  26: ["I32", 1, 4],
  27: ["I64", 1, 8],
  28: ["F64", 1, 8],
  29: ["IQ1_M", 256, 56],
  30: ["BF16", 1, 2],
  34: ["TQ1_0", 256, 54],
  35: ["TQ2_0", 256, 66],
  39: ["MXFP4", 32, 17],
};
const VALUE_TYPES = [
  "uint8",
  "int8",
  "uint16",
  "int16",
  "uint32",
  "int32",
  "float32",
  "bool",
  "string",
  "array",
  "uint64",
  "int64",
  "float64",
];

/** Forward cursor over a Source with a bounded scan budget. */
class Cursor {
  pos: number;
  scanned = 0;
  #buf: Uint8Array = new Uint8Array(0);
  #start = 0;
  readonly src: Source;
  little = true;
  /** sha256 contexts fed by every byte taken, innermost last. */
  hashers: ReturnType<typeof createHash>[] = [];

  constructor(src: Source, pos: number) {
    this.src = src;
    this.pos = pos;
  }

  /** The next `n` bytes (a view valid until the next call), or throws when the file or the budget ends. */
  take(n: number): Uint8Array {
    if (n < 0 || this.pos + n > this.src.size) throw new Error("the header runs past the end of the file");
    this.scanned += n;
    if (this.scanned > LIMITS.scan) throw new Error(`the header is larger than the ${LIMITS.scan}-byte scan limit`);
    if (this.pos < this.#start || this.pos + n > this.#start + this.#buf.length) {
      this.#buf = this.src.read(this.pos, Math.max(n, 1 << 20));
      this.#start = this.pos;
      if (this.#buf.length < n) throw new Error("the header runs past the end of the file");
    }
    const out = this.#buf.subarray(this.pos - this.#start, this.pos - this.#start + n);
    this.pos += n;
    for (const h of this.hashers) h.update(out);
    return out;
  }

  /** Advance over `n` bytes in 1 MiB steps, so a huge length costs time (and scan budget), not memory. */
  skip(n: number): void {
    for (let left = n; left > 0; ) {
      const step = Math.min(left, 1 << 20);
      this.take(step);
      left -= step;
    }
  }

  view(n: number): DataView {
    const b = this.take(n);
    return new DataView(b.buffer, b.byteOffset, b.byteLength);
  }
  u32 = () => this.view(4).getUint32(0, this.little);
  u64 = (): number => {
    const v = this.view(8).getBigUint64(0, this.little);
    if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`a length or count of ${v} is out of range`);
    return Number(v);
  };
}

function ggufString(c: Cursor, cap: number, notes: string[], what: string): string {
  const n = c.u64();
  if (n > c.src.size) throw new Error(`a string of ${n} bytes is longer than the file`);
  if (n <= cap) return new TextDecoder("utf-8").decode(c.take(n));
  // a long value: skip it, keep its head
  const head = c.take(cap);
  c.skip(n - cap);
  notes.push(`${what}: value cut at ${cap} of ${n} bytes`);
  return new TextDecoder("utf-8").decode(head);
}

function ggufValue(c: Cursor, type: number, notes: string[], what: string, depth: number): GgufValue {
  switch (type) {
    case 0:
      return c.view(1).getUint8(0);
    case 1:
      return c.view(1).getInt8(0);
    case 2:
      return c.view(2).getUint16(0, c.little);
    case 3:
      return c.view(2).getInt16(0, c.little);
    case 4:
      return c.u32();
    case 5:
      return c.view(4).getInt32(0, c.little);
    case 6:
      return c.view(4).getFloat32(0, c.little);
    case 7:
      return c.view(1).getUint8(0) !== 0;
    case 8:
      return ggufString(c, LIMITS.stringBytes, notes, what);
    case 10:
      return c.view(8).getBigUint64(0, c.little).toString();
    case 11:
      return c.view(8).getBigInt64(0, c.little).toString();
    case 12:
      return c.view(8).getFloat64(0, c.little);
    case 9: {
      if (depth >= LIMITS.arrayDepth) throw new Error(`arrays nested deeper than ${LIMITS.arrayDepth}`);
      const et = c.u32();
      const length = c.u64();
      if (et > 12) throw new Error(`unknown array element type ${et}`);
      if (length > c.src.size) throw new Error(`an array of ${length} elements is longer than the file`);
      const h = createHash("sha256");
      c.hashers.push(h);
      const first: GgufValue[] = [];
      try {
        for (let i = 0; i < length; i++) {
          // elements past the sample are read (to find where the array ends) but not kept
          const v = ggufValue(c, et, [], what, depth + 1);
          if (i < LIMITS.arraySample) first.push(v);
        }
      } finally {
        c.hashers.pop();
      }
      return { elementType: VALUE_TYPES[et]!, length, first, sha256: h.digest("hex") };
    }
    default:
      throw new Error(`unknown value type ${type}`);
  }
}

export function ggufInfo(src: Source): ModelInfo {
  const info: ModelInfo = {
    format: "gguf",
    fileSize: src.size,
    version: null,
    endian: null,
    alignment: null,
    tensorCount: 0,
    dataOffset: 0,
    metadata: [],
    tensors: [],
    parameters: "0",
    types: {},
    problems: [],
    notes: [],
  };
  const c = new Cursor(src, 4);
  try {
    // a version number that large is the same number in the other byte order
    const v = c.view(4);
    c.little = v.getUint32(0, true) <= 0xffff;
    info.endian = c.little ? "little" : "big";
    info.version = v.getUint32(0, c.little);
    if (info.version < 2 || info.version > 3) {
      // version 1 (before August 2023) used 32-bit lengths and is not read
      info.problems.push(`GGUF version ${info.version} is not one this reader knows (2 and 3)`);
      return info;
    }
    const tensorCount = c.u64();
    const kvCount = c.u64();
    info.tensorCount = tensorCount;
    if (kvCount > LIMITS.metadataKeys) {
      info.notes.push(`${kvCount} metadata keys; the first ${LIMITS.metadataKeys} are read`);
    }
    for (let i = 0; i < Math.min(kvCount, LIMITS.metadataKeys); i++) {
      const keyLen = c.u64();
      if (keyLen > LIMITS.keyBytes) throw new Error(`a key of ${keyLen} bytes`);
      const key = new TextDecoder("utf-8").decode(c.take(keyLen));
      const type = c.u32();
      if (type > 12) throw new Error(`key ${key}: unknown value type ${type}`);
      info.metadata.push({ key, type: VALUE_TYPES[type]!, value: ggufValue(c, type, info.notes, key, 0) });
    }
    if (kvCount > LIMITS.metadataKeys) {
      info.notes.push("the tensor table follows the unread keys and was not read");
      return info;
    }
    const al = info.metadata.find((m) => m.key === "general.alignment")?.value;
    info.alignment = typeof al === "number" && al > 0 ? al : 32;
    if (tensorCount > LIMITS.tensors) {
      info.notes.push(`${tensorCount} tensors; the first ${LIMITS.tensors} are read`);
    }
    let params = 0n;
    for (let i = 0; i < Math.min(tensorCount, LIMITS.tensors); i++) {
      const nameLen = c.u64();
      if (nameLen > LIMITS.keyBytes) throw new Error(`a tensor name of ${nameLen} bytes`);
      const name = new TextDecoder("utf-8").decode(c.take(nameLen));
      const nd = c.u32();
      if (nd > LIMITS.dims) throw new Error(`tensor ${name}: ${nd} dimensions`);
      const dims: number[] = [];
      for (let d = 0; d < nd; d++) dims.push(c.u64());
      const t = c.u32();
      const offset = c.u64();
      const g = GGML[t];
      let elements = 1n;
      for (const d of dims) elements *= BigInt(d);
      params += elements;
      let bytes: number | null = null;
      if (g && elements % BigInt(g[1]) === 0n) bytes = Number((elements / BigInt(g[1])) * BigInt(g[2]));
      else if (g)
        info.problems.push(`tensor ${name}: ${elements} elements is not a multiple of ${g[0]}'s block of ${g[1]}`);
      const type = g ? g[0] : `unknown(${t})`;
      info.types[type] = (info.types[type] ?? 0) + 1;
      info.tensors.push({ name, type, dims, offset, bytes });
    }
    info.parameters = params.toString();
    info.dataOffset = Math.ceil(c.pos / info.alignment) * info.alignment;
    const bad = info.tensors.filter((t) => t.bytes !== null && info.dataOffset + t.offset + t.bytes > src.size);
    if (bad.length)
      info.problems.push(
        `${bad.length} tensors extend past the end of the file (the first is ${bad[0]!.name}): the file is cut short`,
      );
    const unaligned = info.tensors.filter((t) => t.offset % info.alignment! !== 0);
    if (unaligned.length) info.problems.push(`${unaligned.length} tensors are not at a multiple of ${info.alignment}`);
  } catch (e) {
    info.notes.push(`GGUF header: ${(e as Error).message}; what follows was not read`);
  }
  return info;
}

const ST_BYTES: Record<string, number> = {
  BOOL: 1,
  U8: 1,
  I8: 1,
  F8_E5M2: 1,
  F8_E4M3: 1,
  I16: 2,
  U16: 2,
  F16: 2,
  BF16: 2,
  I32: 4,
  U32: 4,
  F32: 4,
  F64: 8,
  I64: 8,
  U64: 8,
};

export function safetensorsInfo(src: Source): ModelInfo {
  const info: ModelInfo = {
    format: "safetensors",
    fileSize: src.size,
    version: null,
    endian: null,
    alignment: null,
    tensorCount: 0,
    dataOffset: 0,
    metadata: [],
    tensors: [],
    parameters: "0",
    types: {},
    problems: [],
    notes: [],
  };
  try {
    const len = new DataView(src.read(0, 8).buffer).getBigUint64(0, true);
    if (len > BigInt(LIMITS.safetensorsHeader) || 8 + Number(len) > src.size)
      throw new Error(`a header of ${len} bytes (limit ${LIMITS.safetensorsHeader}, file ${src.size})`);
    const n = Number(len);
    info.dataOffset = 8 + n;
    const json = JSON.parse(new TextDecoder("utf-8").decode(src.read(8, n))) as Record<string, unknown>;
    const meta = json.__metadata__;
    if (meta && typeof meta === "object")
      for (const [key, value] of Object.entries(meta as Record<string, unknown>))
        info.metadata.push({ key, type: typeof value === "string" ? "string" : "other", value: String(value) });
    let params = 0n;
    const dataSize = src.size - info.dataOffset;
    for (const [name, raw] of Object.entries(json)) {
      if (name === "__metadata__") continue;
      const t = raw as { dtype?: string; shape?: number[]; data_offsets?: number[] };
      if (!t || typeof t.dtype !== "string" || !Array.isArray(t.shape) || !Array.isArray(t.data_offsets)) {
        info.problems.push(`tensor ${name}: not a dtype, shape and data_offsets`);
        continue;
      }
      if (info.tensors.length >= LIMITS.tensors) {
        info.notes.push(`more than ${LIMITS.tensors} tensors; the rest were not read`);
        break;
      }
      const [start, end] = t.data_offsets as [number, number];
      let elements = 1n;
      for (const d of t.shape) elements *= BigInt(d);
      params += elements;
      const width = ST_BYTES[t.dtype];
      if (width !== undefined && Number(elements) * width !== end - start)
        info.problems.push(`tensor ${name}: ${elements} ${t.dtype} elements do not fill its ${end - start} bytes`);
      if (width === undefined) info.problems.push(`tensor ${name}: unknown dtype ${t.dtype}`);
      if (!(end >= start) || end > dataSize)
        info.problems.push(`tensor ${name}: bytes ${start} to ${end} lie outside the data`);
      info.types[t.dtype] = (info.types[t.dtype] ?? 0) + 1;
      info.tensors.push({ name, type: t.dtype, dims: t.shape, offset: start, bytes: end - start });
    }
    info.tensors.sort((a, b) => a.offset - b.offset);
    info.tensorCount = info.tensors.length;
    info.parameters = params.toString();
  } catch (e) {
    info.notes.push(`safetensors header: ${(e as Error).message}`);
  }
  return info;
}
