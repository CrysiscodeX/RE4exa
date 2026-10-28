// identify.file and inventory.native: what a file is, and what a native binary links, exports and
// imports, for ELF, PE, Mach-O (thin and universal) and WebAssembly in one shape. Built on core's
// bounds-checked parsers; every list says whether it is complete.

import { closeSync, openSync, readSync, statSync } from "node:fs";
import { CoreError } from "@re4exa/core/errors";
import { resolveInWorkspace } from "@re4exa/core/mcp/paths";
import { normalizeArch } from "@re4exa/core/probes/arch";
import { NATIVE_CAP, parseElf } from "@re4exa/core/probes/builtin/elf";
import { IDENTIFY_HEAD, identifyBytes } from "@re4exa/core/probes/builtin/identify";
import { parseMachO } from "@re4exa/core/probes/builtin/macho";
import { parsePe } from "@re4exa/core/probes/builtin/pe";
import { parseWasm } from "@re4exa/core/probes/builtin/wasm";
import "../errors.ts";
import type { OpContext, Operation, OpResult } from "./types.ts";

const ALL = ["linux", "darwin", "win32"] as const;

function readHead(abs: string, max: number): { bytes: Uint8Array; size: number } {
  const size = statSync(abs).size;
  if (size > max && max === NATIVE_CAP) throw new CoreError("target_too_large", { size, limit: max });
  const fd = openSync(abs, "r");
  try {
    const bytes = new Uint8Array(Math.min(size, max));
    let off = 0;
    while (off < bytes.length) {
      const n = readSync(fd, bytes, off, bytes.length - off, off);
      if (n === 0) break;
      off += n;
    }
    return { bytes: bytes.subarray(0, off), size };
  } finally {
    closeSync(fd);
  }
}

function target(ctx: OpContext, path: unknown): { abs: string; rel: string } {
  const r = resolveInWorkspace(ctx.workspace, String(path), { mustExist: true });
  if (!statSync(r.abs).isFile()) throw new CoreError("bad_request", { field: "path", why: "a file, not a directory" });
  return r;
}

// One spelling per architecture, shared with the core verifier so reax's facts and its checks agree.
const arch = normalizeArch;

export interface NameList {
  count: number;
  names: string[];
  /** Every name is listed: none cut by the limit, and the parser read the whole table. */
  complete: boolean;
}

export interface NativeSlice {
  arch: string;
  bits: number;
  kind: string;
  interpreter: string | null;
  /** Shared libraries or DLLs loaded at start-up. */
  links: string[];
  /** False when the parser could not read the whole import or dynamic table (a cut or damaged file). */
  linksComplete: boolean;
  exports: NameList;
  imports: NameList;
  markers: string[];
}

function list(names: string[], total: number, parserComplete: boolean, limit: number): NameList {
  const sorted = [...names].sort();
  return {
    count: total,
    names: sorted.slice(0, limit),
    complete: parserComplete && sorted.length === total && total <= limit,
  };
}

export function inventoryBytes(
  b: Uint8Array,
  format: string,
  limit: number,
): { slices: NativeSlice[]; limitations: string[] } {
  const limitations: string[] = [];
  if (format === "elf") {
    const e = parseElf(b, 1_000_000);
    // Every note the ELF parser writes means a table it could not read whole.
    const symbolsOk = !e.notes.some((n) => /symbols/.test(n));
    const linksOk = !e.notes.some((n) => /string table/.test(n));
    return {
      slices: [
        {
          arch: arch(e.machine),
          bits: e.bits,
          kind: e.type === "dyn" && !e.interpreter ? "shared-object" : e.type === "dyn" ? "executable (PIE)" : e.type,
          interpreter: e.interpreter,
          links: [...e.needed].sort(),
          linksComplete: linksOk,
          exports: list(e.exports.first, e.exports.count, symbolsOk, limit),
          imports: list(e.imports.first, e.imports.count, symbolsOk, limit),
          markers: e.markers,
        },
      ],
      limitations: ["exports and imports are the dynamic symbol table; .symtab is not read yet", ...e.notes],
    };
  }
  if (format === "pe") {
    const p = parsePe(b);
    const imports = p.imports.flatMap((i) => i.functions.map((f) => `${i.dll}!${f}`));
    const importsOk = !p.notes.some((n) => /^import/.test(n));
    const exportsOk = !p.notes.some((n) => /^export/.test(n));
    return {
      slices: [
        {
          arch: arch(p.machine),
          bits: p.bits,
          kind: p.kind === "dll" ? "dll" : "executable",
          interpreter: null,
          links: [...new Set(p.imports.map((i) => i.dll))].sort((a, c) => a.localeCompare(c)),
          linksComplete: importsOk,
          exports: list(p.exports.names, p.exports.count, exportsOk, limit),
          imports: list(imports, imports.length, importsOk, limit),
          markers: p.markers,
        },
      ],
      limitations: p.notes,
    };
  }
  if (format === "macho" || format === "macho-fat") {
    const m = parseMachO(b);
    const slices = m.slices.map((s) => {
      if (s.error) limitations.push(`slice ${s.cpu}: ${s.error}`);
      return {
        arch: arch(s.cpu),
        bits: s.bits,
        kind: s.filetype === "execute" ? "executable" : s.filetype,
        interpreter: null,
        links: s.dylibs.map((d) => d.name).sort(),
        linksComplete: !s.error,
        exports: list(s.exports.names, s.exports.count, s.exports.complete, limit),
        imports: list(s.imports.names, s.imports.count, s.imports.complete, limit),
        markers: s.markers,
      };
    });
    return { slices, limitations };
  }
  if (format === "wasm") {
    const w = parseWasm(b);
    if (w.truncated) limitations.push("the module has more imports or exports than were read");
    const imports = w.imports.map((i) => `${i.module}.${i.name}`);
    const exports = w.exports.map((e) => e.name);
    return {
      slices: [
        {
          arch: "wasm32",
          bits: 32,
          kind: "module",
          interpreter: null,
          links: [...new Set(w.imports.map((i) => i.module))].sort(),
          linksComplete: !w.truncated,
          exports: list(exports, exports.length, !w.truncated, limit),
          imports: list(imports, imports.length, !w.truncated, limit),
          markers: w.customSections.map((c) => `custom:${c}`),
        },
      ],
      limitations,
    };
  }
  throw new CoreError("bad_request", {
    field: "path",
    why: `a native binary (ELF, PE, Mach-O or WebAssembly), not ${format}`,
  });
}

function render(file: string, format: string, slices: NativeSlice[]): string {
  const lines = [`${file}: ${format}`];
  for (const s of slices) {
    lines.push(`- ${s.arch} ${s.bits}-bit ${s.kind}${s.interpreter ? `, interpreter ${s.interpreter}` : ""}`);
    lines.push(`  links (${s.links.length}): ${s.links.join(", ") || "none"}`);
    const show = (label: string, l: NameList) =>
      `  ${label} (${l.count}${l.complete ? "" : ", not all listed"}): ${l.names.slice(0, 50).join(", ") || "none"}${l.names.length > 50 ? ", ..." : ""}`;
    lines.push(show("exports", s.exports), show("imports", s.imports));
  }
  return lines.join("\n");
}

export const identifyFile: Operation = {
  tool: "identify",
  name: "identify.file",
  summary: "What a file is: format, format families and MIME type, from its first 256 KiB and its name.",
  input: {
    type: "object",
    properties: { path: { type: "string", description: "File path inside the workspace", maxLength: 4096 } },
    required: ["path"],
    additionalProperties: false,
  },
  effect: "read",
  cost: "cheap",
  untrusted: false,
  platforms: [...ALL],
  examples: [
    {
      title: "A universal Mach-O",
      workspace: "fixtures",
      args: { path: "hello-universal-macos-s" },
      expect: { format: "macho-fat" },
    },
    {
      title: "A PE DLL",
      workspace: "fixtures",
      args: { path: "lib-x86_64-windows-gnu-s.dll" },
      expect: { format: "pe" },
    },
  ],
  covers: ["leanrea/LEAN-C04"],
  async run(ctx, args): Promise<OpResult> {
    const t = target(ctx, args.path);
    const { bytes, size } = readHead(t.abs, IDENTIFY_HEAD);
    const id = identifyBytes(bytes, t.rel, size);
    return {
      data: { file: t.rel, size, format: id.format, families: id.families, mime: id.mime },
      text: `${t.rel}: ${id.format} (${id.families.join(", ") || "no family"}), ${size} bytes`,
      coverage: "complete",
      limitations: [],
    };
  },
};

export const inventoryNative: Operation = {
  tool: "inventory",
  name: "inventory.native",
  summary:
    "One-call inventory of a native binary: per architecture slice, its kind, interpreter, linked libraries, exported and imported symbols, and language markers.",
  input: {
    type: "object",
    properties: {
      path: { type: "string", description: "File path inside the workspace", maxLength: 4096 },
      limit: {
        type: "integer",
        description: "Most export or import names listed per slice",
        minimum: 1,
        maximum: 5000,
        default: 200,
      },
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
      title: "The exports of a shared library",
      workspace: "fixtures",
      args: { path: "lib-x86_64-linux-gnu.2.28-s.so" },
      expect: {
        format: "elf",
        slices: [{ exports: { names: ["reax_add", "reax_apply", "reax_counter", "reax_mul", "reax_version"] } }],
      },
    },
    {
      title: "Both slices of a universal binary",
      workspace: "fixtures",
      args: { path: "hello-universal-macos-s" },
      expect: { format: "macho-fat", slices: [{ arch: "x86_64" }, { arch: "aarch64" }] },
    },
  ],
  covers: [
    "rea.tool/list_architectures",
    "rea.tool/inspect_native_exports",
    "rea.tool/inspect_pe_imports",
    "leanrea/LEAN-T11",
    "leanrea/LEAN-T15",
  ],
  async run(ctx, args): Promise<OpResult> {
    const t = target(ctx, args.path);
    const { bytes, size } = readHead(t.abs, NATIVE_CAP);
    const id = identifyBytes(bytes.subarray(0, IDENTIFY_HEAD), t.rel, size);
    const { slices, limitations } = inventoryBytes(bytes, id.format, Number(args.limit ?? 200));
    const complete =
      slices.every((s) => s.linksComplete && s.exports.complete && s.imports.complete) &&
      !limitations.some((l) => l.startsWith("slice"));
    return {
      data: { file: t.rel, format: id.format, slices },
      text: render(t.rel, id.format, slices),
      coverage: complete ? "complete" : "partial",
      limitations,
    };
  },
};
