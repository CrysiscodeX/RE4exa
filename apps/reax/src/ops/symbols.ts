// inventory.symbols, inventory.procedures, read.symbol and inventory.overview: what a binary names,
// where its functions are, what is at an address, and a one-call summary.
import { CoreError } from "@re4exa/core/errors";
import { NATIVE_CAP } from "@re4exa/core/probes/builtin/elf";
import { IDENTIFY_HEAD, identifyBytes } from "@re4exa/core/probes/builtin/identify";
import "../errors.ts";
import { addressToOffset, LAYOUT_FORMATS, layout } from "../readers/layout.ts";
import { type Procedure, type Sym, type SymbolSlice, symbols } from "../readers/symbols.ts";
import { pageStream } from "./bytes.ts";
import { readHead, target } from "./file.ts";
import { inventoryBytes } from "./native.ts";
import { PAGE_INPUT } from "./page.ts";
import type { JsonSchema, OpContext, Operation, OpResult } from "./types.ts";

const ALL = ["linux", "darwin", "win32"] as const;
const PATH: JsonSchema = { type: "string", description: "File path inside the workspace", maxLength: 4096 };
const ARCH: JsonSchema = {
  type: "string",
  maxLength: 32,
  description: "Which slice of a universal binary (its architecture); the first slice if omitted",
};
const SEARCH: JsonSchema = { type: "string", maxLength: 1024, description: "Keep only names containing this text" };

function load(ctx: OpContext, path: unknown) {
  const t = target(ctx, path);
  const { bytes, size } = readHead(t.abs, NATIVE_CAP);
  const format = identifyBytes(bytes.subarray(0, IDENTIFY_HEAD), t.rel, size).format;
  if (!(LAYOUT_FORMATS as readonly string[]).includes(format))
    throw new CoreError("bad_request", {
      field: "path",
      why: `a native binary (ELF, PE, Mach-O or WebAssembly); this file is ${format}`,
    });
  let slices: SymbolSlice[];
  try {
    slices = symbols(bytes, format);
  } catch (e) {
    throw new CoreError("bad_request", { field: "path", why: `its tables cannot be read: ${(e as Error).message}` });
  }
  return { ...t, bytes, size, format, slices };
}

function slice(slices: SymbolSlice[], arch: unknown): SymbolSlice {
  if (arch === undefined) return slices[0]!;
  const s = slices.find((x) => x.arch === arch);
  if (!s) throw new CoreError("bad_request", { field: "arch", why: `one of ${slices.map((x) => x.arch).join(", ")}` });
  return s;
}

const contains = (name: string | null, q: string | undefined, fold: boolean) =>
  q === undefined || (name !== null && (fold ? name.toLowerCase().includes(q.toLowerCase()) : name.includes(q)));

export const inventorySymbols: Operation = {
  tool: "inventory",
  name: "inventory.symbols",
  summary:
    "Every symbol a native binary names (ELF .symtab and .dynsym with versions, PE exports and imports, Mach-O nlist, wasm imports, exports and names): address, size, kind, binding, section and library. Filters by name, kind and defined or undefined; pages with offset and limit.",
  input: {
    type: "object",
    properties: {
      path: PATH,
      arch: ARCH,
      search: SEARCH,
      ignore_case: { type: "boolean", default: false, description: "Match search without regard to case" },
      kind: { type: "string", enum: ["any", "function", "object", "tls", "other"], default: "any" },
      defined: { type: "string", enum: ["any", "defined", "undefined"], default: "any" },
      ...PAGE_INPUT,
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
      title: "The functions a C++ binary defines whose names mention reax",
      workspace: "fixtures",
      args: { path: "shapes-x86_64-linux-gnu.2.28-g", search: "reax", kind: "function", defined: "defined" },
      expect: { page: { total: 2 } },
    },
  ],
  covers: ["rea.tool/list_names"],
  async run(ctx, args): Promise<OpResult> {
    const l = load(ctx, args.path);
    const s = slice(l.slices, args.arch);
    const fold = args.ignore_case === true;
    const want = (x: Sym) =>
      contains(x.name, args.search as string | undefined, fold) &&
      (args.kind === "any" ||
        x.kind === args.kind ||
        (args.kind === "other" && !["function", "object", "tls"].includes(x.kind))) &&
      (args.defined === "any" || (args.defined === "defined") === x.defined);
    const p = pageStream(s.symbols.filter(want), args);
    return {
      data: { file: l.rel, format: l.format, arch: s.arch, items: p.items, page: p.page },
      text: [
        `${l.rel} ${s.arch}: ${p.page.total} symbols${p.page.next !== null ? `; next offset ${p.page.next}` : ""}`,
        ...p.items.map(
          (x) =>
            `  ${x.addr ?? "undefined"}  ${x.kind} ${x.bind}  ${x.name}${x.version ? `${x.versionHidden || !x.defined ? "@" : "@@"}${x.version}` : ""}${x.library ? `  [${x.library}]` : ""}${x.section ? `  (${x.section})` : ""}`,
        ),
      ].join("\n"),
      coverage: s.notes.some((n) => /cut|could not/.test(n)) ? "partial" : "complete",
      limitations: s.notes,
    };
  },
};

export const inventoryProcedures: Operation = {
  tool: "inventory",
  name: "inventory.procedures",
  summary:
    "The procedures (functions) of a native binary with start address, size and name where known, merged from every table that records them: symbols, ELF .eh_frame, PE exports and .pdata, Mach-O nlist and function starts, wasm function bodies. Finds functions in stripped binaries. Filters by name; pages with offset and limit.",
  input: {
    type: "object",
    properties: {
      path: PATH,
      arch: ARCH,
      search: SEARCH,
      ignore_case: { type: "boolean", default: false, description: "Match search without regard to case" },
      ...PAGE_INPUT,
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
      title: "Functions of a stripped ELF executable, from its unwind table",
      workspace: "fixtures",
      args: { path: "shapes-x86_64-linux-gnu.2.28-s" },
      expect: { page: { total: 4 }, items: [{ addr: "0x10014e0", size: 43 }] },
    },
  ],
  covers: ["rea.tool/list_procedures", "rea.tool/search_procedures"],
  async run(ctx, args): Promise<OpResult> {
    const l = load(ctx, args.path);
    const s = slice(l.slices, args.arch);
    const fold = args.ignore_case === true;
    const q = args.search as string | undefined;
    const p = pageStream(
      s.procedures.filter((x) => contains(x.name, q, fold)),
      args,
    );
    const unnamed = s.procedures.filter((x) => x.name === null).length;
    const limitations = [...s.notes];
    if (q !== undefined && unnamed) limitations.push(`${unnamed} procedures have no name and cannot match a search`);
    return {
      data: { file: l.rel, format: l.format, arch: s.arch, items: p.items, page: p.page },
      text: [
        `${l.rel} ${s.arch}: ${p.page.total} procedures${unnamed ? ` (${unnamed} unnamed)` : ""}${p.page.next !== null ? `; next offset ${p.page.next}` : ""}`,
        ...p.items.map(
          (x) => `  ${x.addr}  ${x.size ?? "?"} bytes  ${x.name ?? `sub_${x.addr.slice(2)}`}  [${x.sources.join(",")}]`,
        ),
      ].join("\n"),
      coverage: s.notes.some((n) => /cut|could not|not read yet/.test(n)) ? "partial" : "complete",
      limitations,
    };
  },
};

function containing(procs: Procedure[], a: bigint): Procedure | null {
  let best: Procedure | null = null;
  for (const p of procs) {
    const start = BigInt(p.addr);
    if (start <= a && p.size !== null && a < start + BigInt(p.size)) if (!best || start > BigInt(best.addr)) best = p;
  }
  return best;
}

export const readSymbol: Operation = {
  tool: "read",
  name: "read.symbol",
  summary:
    "Look up a symbol or procedure: by name, its address, size, file offset and section; by address, the symbol and procedure that contain it and the offset into them.",
  input: {
    type: "object",
    properties: {
      path: PATH,
      name: { type: "string", maxLength: 4096, description: "An exact symbol name" },
      address: { type: "string", maxLength: 24, description: 'A virtual address, hex ("0x1000") or decimal' },
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
      title: "Where main is, and what a mid-function address belongs to",
      workspace: "fixtures",
      args: { path: "shapes-x86_64-linux-gnu.2.28-g", address: "0x10015b8" },
      expect: { procedure: { name: "main", addr: "0x10015b0" }, delta: 8 },
    },
  ],
  covers: [
    "rea.tool/address_name",
    "rea.tool/procedure_address",
    "rea.tool/procedure_info",
    "rea.tool/resolve_containing_procedure",
  ],
  async run(ctx, args): Promise<OpResult> {
    if ((args.name === undefined) === (args.address === undefined))
      throw new CoreError("bad_request", { field: "name", why: "exactly one of name or address" });
    const l = load(ctx, args.path);
    const s = slice(l.slices, args.arch);
    const lay = layout(l.bytes, l.format).find((x) => x.arch === s.arch) ?? layout(l.bytes, l.format)[0]!;
    const fileOffset = (addr: string | null) =>
      addr === null ? null : l.format === "wasm" ? Number(BigInt(addr)) : addressToOffset(lay, BigInt(addr)).offset;
    if (args.name !== undefined) {
      const name = String(args.name);
      const syms = s.symbols.filter((x) => x.name === name);
      const procs = s.procedures.filter((x) => x.name === name);
      const items = syms.map((x) => ({ ...x, offset: fileOffset(x.addr) }));
      const proc = procs[0] ?? (syms[0]?.addr ? containing(s.procedures, BigInt(syms[0].addr)) : null);
      return {
        data: {
          file: l.rel,
          arch: s.arch,
          name,
          found: items.length > 0 || procs.length > 0,
          symbols: items,
          procedure: proc,
        },
        text:
          items.length || procs.length
            ? [
                `${l.rel} ${s.arch}: ${name}`,
                ...items.map(
                  (x) =>
                    `  ${x.defined ? `at ${x.addr} (file offset ${x.offset ?? "none"})` : `undefined${x.library ? `, from ${x.library}` : ""}`}  ${x.kind} ${x.bind}${x.size !== null ? `, ${x.size} bytes` : ""}${x.section ? `, in ${x.section}` : ""}  [${x.source}]`,
                ),
                ...(proc ? [`  procedure ${proc.addr}, ${proc.size ?? "?"} bytes [${proc.sources.join(",")}]`] : []),
              ].join("\n")
            : `${l.rel} ${s.arch}: no symbol named ${JSON.stringify(name)}`,
        coverage: "complete",
        limitations: s.notes,
      };
    }
    const a = String(args.address).trim();
    if (!/^(0x[0-9a-fA-F]+|\d+)$/.test(a))
      throw new CoreError("bad_request", { field: "address", why: 'hex ("0x...") or decimal digits' });
    const addr = BigInt(a);
    const proc = containing(s.procedures, addr);
    // the nearest defined symbol at or below the address, and whether its size covers it
    let sym: Sym | null = null;
    for (const x of s.symbols)
      if (x.defined && x.addr !== null && BigInt(x.addr) <= addr && (!sym || BigInt(x.addr) > BigInt(sym.addr!)))
        sym = x;
    const symDelta = sym ? Number(addr - BigInt(sym.addr!)) : null;
    const symCovers = sym !== null && sym.size !== null && sym.size > 0 ? symDelta! < sym.size : null;
    const delta = proc ? Number(addr - BigInt(proc.addr)) : null;
    const label = proc
      ? `${proc.name ?? `sub_${proc.addr.slice(2)}`}+0x${delta!.toString(16)}`
      : sym
        ? `${sym.name}+0x${symDelta!.toString(16)}${symCovers === false ? " (past its end)" : ""}`
        : null;
    return {
      data: {
        file: l.rel,
        arch: s.arch,
        address: `0x${addr.toString(16)}`,
        offset: fileOffset(`0x${addr.toString(16)}`),
        label,
        procedure: proc,
        delta,
        symbol: sym,
        symbolDelta: symDelta,
        symbolCovers: symCovers,
      },
      text: `${l.rel} ${s.arch}: 0x${addr.toString(16)} is ${label ?? "in no known procedure or symbol"}`,
      coverage: "complete",
      limitations: s.notes,
    };
  },
};

export const inventoryOverview: Operation = {
  tool: "inventory",
  name: "inventory.overview",
  summary:
    "One call for a first look at a native binary: per slice its architecture, kind, entry point, links, how many sections, segments, symbols (defined and undefined) and procedures it has, and which sections look compressed or encrypted.",
  input: { type: "object", properties: { path: PATH }, required: ["path"], additionalProperties: false },
  effect: "read",
  cost: "cheap",
  untrusted: true,
  platforms: [...ALL],
  examples: [
    {
      title: "A first look at a Linux shared library",
      workspace: "fixtures",
      args: { path: "lib-x86_64-linux-gnu.2.28-s.so" },
      expect: { format: "elf", slices: [{ arch: "x86_64", kind: "shared-object" }] },
    },
  ],
  covers: ["rea.tool/binary_overview"],
  async run(ctx, args): Promise<OpResult> {
    const l = load(ctx, args.path);
    const inv = inventoryBytes(l.bytes, l.format, 50);
    const lay = layout(l.bytes, l.format);
    const slices = l.slices.map((s, i) => {
      const n = inv.slices[i];
      const g = lay[i]!;
      const high: string[] = [];
      for (const x of g.sections) {
        if (x.offset === null || x.fileSize < 256 || x.offset + x.fileSize > l.bytes.length) continue;
        const c = new Uint32Array(256);
        for (let k = x.offset; k < x.offset + x.fileSize; k++) c[l.bytes[k]!]!++;
        let h = 0;
        for (const v of c) if (v) h -= (v / x.fileSize) * Math.log2(v / x.fileSize);
        if (h >= 7.2) high.push(x.name);
      }
      return {
        arch: s.arch,
        kind: n?.kind ?? null,
        entry: g.entry,
        links: n?.links ?? [],
        sections: g.sections.length,
        segments: g.segments.length,
        symbols: {
          defined: s.symbols.filter((x) => x.defined).length,
          undefined: s.symbols.filter((x) => !x.defined).length,
        },
        procedures: { total: s.procedures.length, named: s.procedures.filter((p) => p.name !== null).length },
        highEntropySections: high,
      };
    });
    const limitations = [...new Set([...inv.limitations, ...l.slices.flatMap((s) => s.notes)])];
    return {
      data: { file: l.rel, format: l.format, size: l.size, slices },
      text: [
        `${l.rel}: ${l.format}, ${l.size} bytes, ${slices.length} slice${slices.length === 1 ? "" : "s"}`,
        ...slices.map(
          (s) =>
            `  ${s.arch} ${s.kind ?? ""}${s.entry ? `, entry ${s.entry}` : ""}: ${s.sections} sections, ${s.segments} segments; ${s.symbols.defined} defined and ${s.symbols.undefined} undefined symbols; ${s.procedures.total} procedures (${s.procedures.named} named); links ${s.links.join(", ") || "none"}${s.highEntropySections.length ? `; high entropy: ${s.highEntropySections.join(", ")}` : ""}`,
        ),
      ].join("\n"),
      coverage: inv.slices.every((x) => x.linksComplete) ? "complete" : "partial",
      limitations,
    };
  },
};
