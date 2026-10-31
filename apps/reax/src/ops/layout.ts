// inventory.segments, read.address and read.entropy: where a binary's parts are, how its addresses
// map to file offsets, and how random its bytes look.
import { CoreError } from "@re4exa/core/errors";
import { NATIVE_CAP } from "@re4exa/core/probes/builtin/elf";
import { IDENTIFY_HEAD, identifyBytes } from "@re4exa/core/probes/builtin/identify";
import "../errors.ts";
import { addressToOffset, LAYOUT_FORMATS, type LayoutSlice, layout, offsetToAddress } from "../readers/layout.ts";
import { pageStream, SCAN_CAP } from "./bytes.ts";
import { ForwardReader, readHead, target } from "./file.ts";
import { PAGE_INPUT } from "./page.ts";
import type { JsonSchema, OpContext, Operation, OpResult } from "./types.ts";

const ALL = ["linux", "darwin", "win32"] as const;
const PATH: JsonSchema = { type: "string", description: "File path inside the workspace", maxLength: 4096 };
const ARCH: JsonSchema = {
  type: "string",
  maxLength: 32,
  description: "Which slice of a universal binary (its architecture); the first slice if omitted",
};

function layoutOf(ctx: OpContext, path: unknown): { rel: string; abs: string; format: string; slices: LayoutSlice[] } {
  const t = target(ctx, path);
  const { bytes, size } = readHead(t.abs, NATIVE_CAP);
  const format = identifyBytes(bytes.subarray(0, IDENTIFY_HEAD), t.rel, size).format;
  if (!(LAYOUT_FORMATS as readonly string[]).includes(format))
    throw new CoreError("bad_request", {
      field: "path",
      why: `a native binary (ELF, PE, Mach-O or WebAssembly); this file is ${format}`,
    });
  try {
    return { ...t, format, slices: layout(bytes, format) };
  } catch (e) {
    throw new CoreError("bad_request", { field: "path", why: `its tables cannot be read: ${(e as Error).message}` });
  }
}

function pickSlice(slices: LayoutSlice[], arch: unknown): LayoutSlice {
  if (arch === undefined) return slices[0]!;
  const s = slices.find((x) => x.arch === arch);
  if (!s) throw new CoreError("bad_request", { field: "arch", why: `one of ${slices.map((x) => x.arch).join(", ")}` });
  return s;
}

const regionLine = (g: LayoutSlice["sections"][number]) =>
  `  ${g.name || "(unnamed)"}${g.segment ? ` [${g.segment}]` : ""}  ${g.kind}  addr ${g.addr ?? "-"}  size ${g.size}  file ${g.offset ?? "-"}+${g.fileSize}  ${g.perms ?? ""}`;

export const inventorySegments: Operation = {
  tool: "inventory",
  name: "inventory.segments",
  summary:
    "The layout of a native binary, per architecture slice: its segments and sections with virtual address, size, file offset, bytes in the file, permissions, type and flags.",
  input: { type: "object", properties: { path: PATH }, required: ["path"], additionalProperties: false },
  effect: "read",
  cost: "cheap",
  untrusted: true,
  platforms: [...ALL],
  examples: [
    {
      title: "The sections of a PE DLL",
      workspace: "fixtures",
      args: { path: "lib-x86_64-windows-gnu-s.dll" },
      expect: { format: "pe", slices: [{ arch: "x86_64", sections: [{ name: ".text", addr: "0x180001000" }] }] },
    },
  ],
  covers: ["rea.tool/list_segments", "rea.tool/inspect_binary_layout"],
  async run(ctx, args): Promise<OpResult> {
    const l = layoutOf(ctx, args.path);
    const limitations = l.slices.flatMap((s) => s.notes.map((n) => `${s.arch}: ${n}`));
    const text = [
      `${l.rel}: ${l.format}, ${l.slices.length} slice${l.slices.length === 1 ? "" : "s"}`,
      ...l.slices.flatMap((s) => [
        `${s.arch}${s.base ? ` at file offset ${s.base}` : ""}${s.imageBase ? `, image base ${s.imageBase}` : ""}: ${s.segments.length} segments, ${s.sections.length} sections`,
        ...(s.segments.length ? [" segments:", ...s.segments.map(regionLine)] : []),
        " sections:",
        ...s.sections.map(regionLine),
      ]),
    ].join("\n");
    return {
      data: { file: l.rel, format: l.format, slices: l.slices },
      text,
      coverage: limitations.length ? "partial" : "complete",
      limitations,
    };
  },
};

export const readAddress: Operation = {
  tool: "read",
  name: "read.address",
  summary:
    "Map a virtual address to its file offset, or a file offset to its virtual address, through the segments that load the file, and name the section that holds it.",
  input: {
    type: "object",
    properties: {
      path: PATH,
      address: { type: "string", maxLength: 24, description: 'A virtual address, hex ("0x1000") or decimal' },
      offset: { type: "integer", minimum: 0, description: "A file offset" },
      arch: ARCH,
    },
    required: ["path"],
    additionalProperties: false,
  },
  effect: "read",
  cost: "cheap",
  untrusted: true,
  platforms: [...ALL],
  examples: [
    {
      title: "Where .text of a PE DLL starts in the file",
      workspace: "fixtures",
      args: { path: "lib-x86_64-windows-gnu-s.dll", address: "0x180001000" },
      expect: { offset: 1024, section: ".text" },
    },
  ],
  covers: ["rea.tool/address_to_file_offset"],
  async run(ctx, args): Promise<OpResult> {
    if ((args.address === undefined) === (args.offset === undefined))
      throw new CoreError("bad_request", { field: "address", why: "exactly one of address or offset" });
    const l = layoutOf(ctx, args.path);
    if (l.format === "wasm")
      throw new CoreError("bad_request", { field: "path", why: "WebAssembly has no load addresses; use file offsets" });
    const s = pickSlice(l.slices, args.arch);
    if (args.address !== undefined) {
      const a = String(args.address).trim();
      if (!/^(0x[0-9a-fA-F]+|\d+)$/.test(a))
        throw new CoreError("bad_request", { field: "address", why: 'hex ("0x...") or decimal digits' });
      const addr = BigInt(a);
      const m = addressToOffset(s, addr);
      const why =
        m.region === null
          ? "no segment loads this address"
          : m.offset === null
            ? `${m.region.name} holds it only in memory (no bytes in the file)`
            : null;
      return {
        data: {
          file: l.rel,
          arch: s.arch,
          address: `0x${addr.toString(16)}`,
          offset: m.offset,
          segment: m.region?.name ?? null,
          section: m.section?.name ?? null,
          why,
        },
        text: `${l.rel} ${s.arch}: 0x${addr.toString(16)} -> ${m.offset !== null ? `file offset ${m.offset} (0x${m.offset.toString(16)})` : why}${m.section ? `, in ${m.section.name}` : ""}`,
        coverage: s.notes.length ? "partial" : "complete",
        limitations: s.notes,
      };
    }
    const offset = args.offset as number;
    const m = offsetToAddress(s, offset);
    const why = m.addr === null ? "no segment loads this offset" : null;
    return {
      data: {
        file: l.rel,
        arch: s.arch,
        offset,
        address: m.addr,
        segment: m.region?.name ?? null,
        section: m.section?.name ?? null,
        why,
      },
      text: `${l.rel} ${s.arch}: file offset ${offset} -> ${m.addr ?? why}${m.section ? `, in ${m.section.name}` : ""}`,
      coverage: s.notes.length ? "partial" : "complete",
      limitations: s.notes,
    };
  },
};

/** Shannon entropy of a byte histogram, in bits per byte (0 to 8). */
export function entropy(counts: Uint32Array, n: number): number {
  if (n === 0) return 0;
  let h = 0;
  for (let i = 0; i < 256; i++) {
    const c = counts[i]!;
    if (c === 0) continue;
    const p = c / n;
    h -= p * Math.log2(p);
  }
  return h;
}

const round6 = (x: number) => Math.round(x * 1e6) / 1e6;

export const readEntropy: Operation = {
  tool: "read",
  name: "read.entropy",
  summary:
    "Shannon entropy (bits per byte, 0 to 8) of any file: the whole file, each block of a fixed size, and for native binaries each section's bytes. High entropy suggests compressed or encrypted data. Blocks page with offset and limit.",
  input: {
    type: "object",
    properties: {
      path: PATH,
      block: { type: "integer", minimum: 256, maximum: 1 << 20, default: 4096, description: "Block size in bytes" },
      ...PAGE_INPUT,
    },
    required: ["path"],
    additionalProperties: false,
  },
  effect: "read",
  cost: "medium",
  untrusted: false,
  platforms: [...ALL],
  examples: [
    {
      title: "A small WebAssembly module in one block",
      workspace: "fixtures",
      args: { path: "lib-wasm32-freestanding-s.wasm" },
      expect: { size: 295, page: { total: 1 } },
    },
  ],
  covers: ["rea.tool/inspect_byte_entropy"],
  async run(ctx, args): Promise<OpResult> {
    const t = target(ctx, args.path);
    const r = new ForwardReader(t.abs);
    try {
      if (r.size > SCAN_CAP) throw new CoreError("target_too_large", { size: r.size, limit: SCAN_CAP });
      const block = args.block as number;
      const whole = new Uint32Array(256);
      const blocks = function* () {
        for (let at = 0; at < r.size; at += block) {
          const c = new Uint32Array(256);
          const end = Math.min(r.size, at + block);
          for (let p = at; p < end; p++) {
            const x = r.byte(p);
            c[x]!++;
            whole[x]!++;
          }
          yield { offset: at, size: end - at, entropy: round6(entropy(c, end - at)) };
        }
      };
      const p = pageStream(blocks(), args);
      const fileEntropy = round6(entropy(whole, r.size));
      // per-section entropy for the formats reax lays out
      let sections: { slice: string; name: string; offset: number; size: number; entropy: number }[] = [];
      const head = readHead(t.abs, Math.min(r.size, IDENTIFY_HEAD));
      const format = identifyBytes(head.bytes, t.rel, r.size).format;
      const limitations: string[] = [];
      if ((LAYOUT_FORMATS as readonly string[]).includes(format) && r.size <= NATIVE_CAP) {
        try {
          const all = readHead(t.abs, NATIVE_CAP).bytes;
          sections = layout(all, format).flatMap((s) =>
            s.sections
              .filter((x) => x.offset !== null && x.fileSize > 0 && x.offset + x.fileSize <= all.length)
              .map((x) => {
                const c = new Uint32Array(256);
                for (let i = x.offset!; i < x.offset! + x.fileSize; i++) c[all[i]!]!++;
                return {
                  slice: s.arch,
                  name: x.name,
                  offset: x.offset!,
                  size: x.fileSize,
                  entropy: round6(entropy(c, x.fileSize)),
                };
              }),
          );
        } catch (e) {
          limitations.push(`section entropy is missing: the tables cannot be read (${(e as Error).message})`);
        }
      }
      const high = sections.filter((s) => s.entropy >= 7.2);
      return {
        data: { file: t.rel, size: r.size, block, entropy: fileEntropy, sections, items: p.items, page: p.page },
        text: [
          `${t.rel}: ${r.size} bytes, entropy ${fileEntropy} bits per byte; ${p.page.total} blocks of ${block}${p.page.next !== null ? `, next offset ${p.page.next}` : ""}`,
          ...(sections.length
            ? [
                `sections: ${sections.map((s) => `${s.name}=${s.entropy}`).join(", ")}`,
                ...(high.length
                  ? [`high (>= 7.2, likely compressed or encrypted): ${high.map((s) => s.name).join(", ")}`]
                  : []),
              ]
            : []),
          ...p.items.map((b) => `  ${b.offset}+${b.size}: ${b.entropy}`),
        ].join("\n"),
        coverage: limitations.length ? "partial" : "complete",
        limitations,
      };
    } finally {
      r.close();
    }
  },
};
