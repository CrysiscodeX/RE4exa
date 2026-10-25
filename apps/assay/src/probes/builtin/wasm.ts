// wasm.info: WebAssembly core module sections, imports and exports (by section, bounded).

import type { Json } from "../../evidence/jcs.ts";
import { type Finding, findingKey } from "../../evidence/record.ts";
import { type AssayProbe, bytesAt, fail, u32, utf8 } from "../util.ts";

const SECTION_NAMES = [
  "custom",
  "type",
  "import",
  "function",
  "table",
  "memory",
  "global",
  "export",
  "start",
  "element",
  "code",
  "data",
  "datacount",
  "tag",
];
const KINDS = ["func", "table", "memory", "global", "tag"];

export interface WasmInfo {
  version: number;
  sections: { id: number; name: string; size: number }[];
  imports: { module: string; name: string; kind: string }[];
  exports: { name: string; kind: string }[];
  customSections: string[];
  truncated: boolean;
}

class Cur {
  b: Uint8Array;
  p: number;
  end: number;
  constructor(b: Uint8Array, p: number, end: number) {
    this.b = b;
    this.p = p;
    this.end = end;
  }
  byte(): number {
    if (this.p >= this.end) fail("wasm: read past section end", { offset: this.p });
    return this.b[this.p++]!;
  }
  leb(maxBytes = 5): number {
    let v = 0;
    let mul = 1;
    for (let i = 0; i < maxBytes; i++) {
      const c = this.byte();
      v += (c & 0x7f) * mul;
      if ((c & 0x80) === 0) {
        if (!Number.isSafeInteger(v)) fail("wasm: LEB128 value too large");
        return v;
      }
      mul *= 128;
    }
    return fail("wasm: LEB128 too long", { offset: this.p });
  }
  name(): string {
    const n = this.leb();
    if (n > 65_536 || this.p + n > this.end) fail("wasm: name past section end", { offset: this.p });
    const s = utf8(this.b.subarray(this.p, this.p + n));
    this.p += n;
    return s;
  }
  limits(): void {
    const flags = this.leb();
    const wide = (flags & 4) !== 0;
    this.leb(wide ? 10 : 5);
    if (flags & 1) this.leb(wide ? 10 : 5);
  }
}

export function parseWasm(b: Uint8Array, cap = 10_000): WasmInfo {
  if (!bytesAt(b, 0, [0, 0x61, 0x73, 0x6d])) fail("not a WebAssembly module");
  const version = u32(b, 4);
  if (version !== 1) fail("wasm: only core modules (version 1) are parsed; components are not", { version });
  const out: WasmInfo = { version, sections: [], imports: [], exports: [], customSections: [], truncated: false };
  const top = new Cur(b, 8, b.length);
  let guard = 0;
  while (top.p < b.length) {
    if (guard++ > 100_000) fail("wasm: too many sections");
    const id = top.byte();
    const size = top.leb();
    const start = top.p;
    const end = start + size;
    if (end > b.length) fail("wasm: section past end of file", { id });
    if (out.sections.length < 256) out.sections.push({ id, name: SECTION_NAMES[id] ?? `unknown-${id}`, size });
    const c = new Cur(b, start, end);
    if (id === 0) {
      if (out.customSections.length < 256) out.customSections.push(c.name());
    } else if (id === 2) {
      const n = c.leb();
      for (let i = 0; i < n; i++) {
        if (out.imports.length >= cap) {
          out.truncated = true;
          break;
        }
        const module = c.name();
        const name = c.name();
        const kind = c.byte();
        if (kind === 0) c.leb();
        else if (kind === 1) {
          c.byte();
          c.limits();
        } else if (kind === 2) c.limits();
        else if (kind === 3) {
          c.byte();
          c.byte();
        } else if (kind === 4) {
          c.byte();
          c.leb();
        } else fail("wasm: unknown import kind", { kind });
        out.imports.push({ module, name, kind: KINDS[kind]! });
      }
    } else if (id === 7) {
      const n = c.leb();
      for (let i = 0; i < n; i++) {
        if (out.exports.length >= cap) {
          out.truncated = true;
          break;
        }
        const name = c.name();
        const kind = c.byte();
        c.leb();
        out.exports.push({ name, kind: KINDS[kind] ?? `unknown-${kind}` });
      }
    }
    top.p = end;
  }
  return out;
}

export const wasmInfo: AssayProbe = {
  id: "wasm.info",
  version: "1",
  predicate: "wasm.info",
  summary: "WebAssembly sections, imports (module/name/kind) and exports",
  appliesTo: (i) => i.format === "wasm",
  platforms: ["linux", "darwin", "win32"],
  cost: "cheap",
  confidence: "observed",
  sweep: ["each"],
  async run(ctx) {
    const b = await ctx.read(undefined, 256 * 1024 * 1024);
    const info = parseWasm(b);
    const findings: Finding[] = [...new Set(info.imports.map((i) => i.module))]
      .sort()
      .map((m) => ({ key: findingKey("wasm.import", { module: m }), class: "wasm.import", label: m }));
    return {
      result: info as unknown as Json,
      findings,
      limitations: info.truncated ? ["import/export lists were capped"] : [],
    };
  },
};
