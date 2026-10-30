// pe.info: COFF and optional headers, sections, import directory (DLLs and functions), delay
// imports, export directory, and the CLR header marker for .NET assemblies.

import type { Json } from "../../evidence/jcs.ts";
import { type AssayProbe, asciiAt, cstr, fail, NATIVE_NAME_CAP, u16, u32, u64parts } from "../util.ts";
import { libFindings, NATIVE_CAP } from "./elf.ts";

const MACHINES: Record<number, string> = {
  332: "i386",
  34404: "amd64",
  43620: "arm64",
  448: "arm",
  452: "armnt",
  512: "ia64",
  20580: "riscv64",
};
const SUBSYSTEMS: Record<number, string> = {
  1: "native",
  2: "windows-gui",
  3: "windows-cui",
  7: "posix-cui",
  9: "windows-ce-gui",
  10: "efi-application",
  11: "efi-boot-driver",
  12: "efi-runtime-driver",
  14: "xbox",
  16: "windows-boot-application",
};

export interface PeInfo {
  machine: string;
  bits: 32 | 64;
  kind: "exe" | "dll";
  subsystem: string;
  timestamp: number;
  timestampIso: string;
  entryRva: number;
  sections: string[];
  imports: { dll: string; functions: string[]; delay?: boolean }[];
  exports: { dll: string | null; count: number; names: string[] };
  markers: string[];
  notes: string[];
}

export function parsePe(b: Uint8Array): PeInfo {
  if (!asciiAt(b, 0, "MZ")) fail("not a PE file (no MZ header)");
  const lf = u32(b, 0x3c);
  if (!asciiAt(b, lf, "PE\0\0")) fail("PE signature not found");
  const coff = lf + 4;
  const machine = u16(b, coff);
  const nsec = u16(b, coff + 2);
  const ts = u32(b, coff + 4);
  const optSize = u16(b, coff + 16);
  const chars = u16(b, coff + 18);
  const opt = coff + 20;
  const magic = u16(b, opt);
  if (magic !== 0x10b && magic !== 0x20b) fail("PE: unknown optional header magic", { magic });
  const plus = magic === 0x20b;
  const entryRva = u32(b, opt + 16);
  const imageBase = plus ? u64parts(b, opt + 24) : { hi: 0, lo: u32(b, opt + 28) };
  const subsystem = u16(b, opt + 68);
  const nrva = Math.min(u32(b, opt + (plus ? 108 : 92)), 16);
  const ddBase = opt + (plus ? 112 : 96);
  const dirs: { rva: number; size: number }[] = [];
  for (let i = 0; i < nrva; i++) {
    if (ddBase + i * 8 + 8 > opt + optSize) break;
    dirs.push({ rva: u32(b, ddBase + i * 8), size: u32(b, ddBase + i * 8 + 4) });
  }
  const secs: { name: string; va: number; vsize: number; raw: number; rawSize: number }[] = [];
  const secBase = opt + optSize;
  for (let i = 0; i < Math.min(nsec, 96); i++) {
    const o = secBase + i * 40;
    const nameBytes = b.subarray(o, o + 8);
    if (nameBytes.length < 8) fail("PE: section table past end");
    let e = 0;
    while (e < 8 && nameBytes[e] !== 0) e++;
    secs.push({
      name: Buffer.from(nameBytes.subarray(0, e)).toString("latin1"),
      vsize: u32(b, o + 8),
      va: u32(b, o + 12),
      rawSize: u32(b, o + 16),
      raw: u32(b, o + 20),
    });
  }
  const notes: string[] = [];
  const rva = (r: number): number => {
    if (r < 0) return -1;
    for (const s of secs) {
      const span = Math.max(s.vsize, s.rawSize);
      if (r >= s.va && r < s.va + span) {
        const off = s.raw + (r - s.va);
        return off < b.length ? off : -1;
      }
    }
    return r < (secs[0]?.va ?? 0) && r < b.length ? r : -1;
  };
  const str = (r: number, max = 512): string | null => {
    const o = rva(r);
    return o >= 0 ? cstr(b, o, max) : null;
  };

  let budget = 8192;
  const thunks = (start: number): string[] => {
    const fns: string[] = [];
    let o = rva(start);
    if (o < 0) return fns;
    for (let k = 0; k < 4096 && budget > 0; k++, budget--) {
      const t = plus ? u64parts(b, o) : { hi: 0, lo: u32(b, o) };
      if (t.hi === 0 && t.lo === 0) break;
      const ordinal = plus ? (t.hi & 0x80000000) !== 0 : (t.lo & 0x80000000) !== 0;
      if (ordinal) fns.push(`#${t.lo & 0xffff}`);
      else {
        const n = rva((t.lo & 0x7fffffff) + 2);
        fns.push(n >= 0 ? cstr(b, n, 512) : "?");
      }
      o += plus ? 8 : 4;
    }
    return fns;
  };

  const imports: PeInfo["imports"] = [];
  const imp = dirs[1];
  if (imp && imp.rva !== 0) {
    let o = rva(imp.rva);
    if (o < 0) notes.push("import directory not mapped");
    for (let i = 0; o >= 0 && i < 512; i++, o += 20) {
      const oft = u32(b, o);
      const name = u32(b, o + 12);
      const ft = u32(b, o + 16);
      if (oft === 0 && name === 0 && ft === 0) break;
      const dll = str(name, 256);
      if (dll === null) {
        notes.push(`import descriptor ${i} has an unmapped name`);
        continue;
      }
      imports.push({ dll, functions: thunks(oft || ft) });
    }
  }
  const delay = dirs[13];
  if (delay && delay.rva !== 0) {
    let o = rva(delay.rva);
    const base = imageBase.hi === 0 ? imageBase.lo : 0;
    for (let i = 0; o >= 0 && i < 256; i++, o += 32) {
      const attrs = u32(b, o);
      const name = u32(b, o + 4);
      const intRva = u32(b, o + 16);
      if (attrs === 0 && name === 0 && intRva === 0) break;
      const fix = (v: number) => (attrs & 1 ? v : v - base);
      const dll = str(fix(name), 256);
      if (dll !== null) imports.push({ dll, functions: intRva ? thunks(fix(intRva)) : [], delay: true });
    }
  }
  if (budget <= 0) notes.push("import function cap reached");

  const exportsOut: PeInfo["exports"] = { dll: null, count: 0, names: [] };
  const exp = dirs[0];
  if (exp && exp.rva !== 0) {
    const o = rva(exp.rva);
    if (o >= 0) {
      exportsOut.dll = str(u32(b, o + 12), 256);
      const nNames = u32(b, o + 24);
      const namesRva = u32(b, o + 32);
      exportsOut.count = nNames;
      const no = rva(namesRva);
      for (let i = 0; no >= 0 && i < Math.min(nNames, NATIVE_NAME_CAP); i++) {
        const s = str(u32(b, no + i * 4), 512);
        if (s !== null) exportsOut.names.push(s);
      }
    } else notes.push("export directory not mapped");
  }
  const markers: string[] = [];
  if (dirs[14] && dirs[14].rva !== 0) markers.push("dotnet-clr");
  if (secs.some((s) => s.name === ".symtab") && secs.some((s) => s.name === ".data")) markers.push("go");
  return {
    machine: MACHINES[machine] ?? `0x${machine.toString(16)}`,
    bits: plus ? 64 : 32,
    kind: chars & 0x2000 ? "dll" : "exe",
    subsystem: SUBSYSTEMS[subsystem] ?? `${subsystem}`,
    timestamp: ts,
    timestampIso: new Date(ts * 1000).toISOString(),
    entryRva,
    sections: secs.map((s) => s.name),
    imports,
    exports: exportsOut,
    markers,
    notes,
  };
}

export const peInfo: AssayProbe = {
  id: "pe.info",
  version: "2", // 2: export names kept up to NATIVE_NAME_CAP, so large libraries can be verified
  predicate: "pe.info",
  summary: "PE machine, subsystem, timestamp, sections, imported DLLs and functions, exports, .NET marker",
  appliesTo: (i) => i.format === "pe",
  platforms: ["linux", "darwin", "win32"],
  cost: "cheap",
  confidence: "observed",
  sweep: ["each"],
  async run(ctx) {
    const b = await ctx.read(undefined, NATIVE_CAP);
    const info = parsePe(b);
    return {
      result: info as unknown as Json,
      findings: libFindings(info.imports.map((i) => i.dll.toLowerCase())),
      limitations: [
        "LoadLibrary/GetProcAddress at run time is not in the import table",
        "the timestamp field is often a build hash in reproducible builds",
        ...info.notes,
      ],
    };
  },
};
