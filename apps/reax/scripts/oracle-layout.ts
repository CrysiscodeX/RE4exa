// The layout and entropy answer keys (part of scripts/oracle.ts):
// - sections and segments from llvm-readobj 18 (`--sections --program-headers` for ELF,
//   `--sections` for PE and wasm, `--sections --macho-segment` for Mach-O, every slice of a
//   universal binary), parsed from its LLVM-style text output;
// - Shannon entropy from Python (math.log2), per 4096-byte block, for the whole file, and for each
//   section's bytes at the offsets llvm-readobj reports.
import { spawnSync } from "node:child_process";

export type Rec = Record<string, string | number>;
export interface LayoutKey {
  slices: { arch: string; sections: Rec[]; segments: Rec[] }[];
}

function readobj(args: string[], path: string): string {
  for (const bin of ["llvm-readobj-18", "llvm-readobj"]) {
    const r = spawnSync(bin, [...args, path], { encoding: "latin1", maxBuffer: 1 << 28 });
    if (r.error) continue;
    if (r.status !== 0) throw new Error(`${bin} ${args.join(" ")} ${path}: ${r.stderr.trim()}`);
    return r.stdout;
  }
  throw new Error("llvm-readobj (LLVM 18) is not installed");
}

/** The text of each slice ("File:" starts one; a universal binary has several). */
function slices(out: string): { arch: string; text: string }[] {
  return out
    .split(/^File: .*$/m)
    .slice(1)
    .map((text) => ({ arch: /^Arch: (.*)$/m.exec(text)?.[1]?.trim() ?? "", text }));
}

/** Each `<kind> {` block's own fields (nested blocks skipped); a `Key [ (0x..)` field is its hex. */
function blocks(text: string, kind: string): Record<string, string>[] {
  const lines = text.split("\n");
  const out: Record<string, string>[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = new RegExp(`^( *)${kind} \\{$`).exec(lines[i]!);
    if (!m) continue;
    const indent = m[1]!.length;
    const fields: Record<string, string> = {};
    let j = i + 1;
    for (; j < lines.length; j++) {
      const l = lines[j]!;
      if (l === `${" ".repeat(indent)}}`) break;
      const lead = l.length - l.trimStart().length;
      if (lead !== indent + 2) continue;
      const kv = /^ *([A-Za-z0-9]+): ?(.*)$/.exec(l);
      if (kv) fields[kv[1]!] = kv[2]!;
      const fl = /^ *([A-Za-z0-9]+) \[ \((0x[0-9A-Fa-f]+)\)$/.exec(l);
      if (fl) fields[fl[1]!] = fl[2]!;
    }
    out.push(fields);
    i = j;
  }
  return out;
}

const n = (s: string | undefined) => {
  if (s === undefined) throw new Error("llvm-readobj left out a field");
  return Number(s.trim());
};
const addr = (s: string | undefined) => `0x${BigInt(n(s)).toString(16)}`;
const paren = (s: string | undefined) => n(/\((0x[0-9A-Fa-f]+)\)\s*$/.exec(s ?? "")?.[1]);
/** `.dynsym (1)` or `.text (2E 74 ...)`: the name before its index or bytes. */
const nameOf = (s: string | undefined) => (s ?? "").replace(/\s*\((?:\d+|[0-9A-F]{2}(?: [0-9A-F]{2})*)\)$/, "").trim();

export function layoutKey(path: string, format: string): LayoutKey {
  if (format === "elf") {
    const [s] = slices(readobj(["--sections", "--program-headers"], path));
    return {
      slices: [
        {
          arch: s!.arch,
          sections: blocks(s!.text, "Section").map((f) => ({
            name: nameOf(f.Name),
            type: paren(f.Type),
            flags: n(f.Flags),
            addr: addr(f.Address),
            offset: n(f.Offset),
            size: n(f.Size),
          })),
          segments: blocks(s!.text, "ProgramHeader").map((f) => ({
            type: paren(f.Type),
            offset: n(f.Offset),
            addr: addr(f.VirtualAddress),
            fileSize: n(f.FileSize),
            size: n(f.MemSize),
            flags: n(f.Flags),
          })),
        },
      ],
    };
  }
  if (format === "pe") {
    const [s] = slices(readobj(["--sections"], path));
    return {
      slices: [
        {
          arch: s!.arch,
          sections: blocks(s!.text, "Section").map((f) => ({
            name: nameOf(f.Name),
            rva: addr(f.VirtualAddress),
            vsize: n(f.VirtualSize),
            rawSize: n(f.RawDataSize),
            rawPtr: n(f.PointerToRawData),
            flags: n(f.Characteristics),
          })),
          segments: [],
        },
      ],
    };
  }
  if (format === "macho" || format === "macho-fat") {
    const secs = slices(readobj(["--sections"], path));
    const segs = slices(readobj(["--macho-segment"], path));
    return {
      slices: secs.map((s, i) => ({
        arch: s.arch,
        sections: blocks(s.text, "Section").map((f) => ({
          name: nameOf(f.Name),
          segment: nameOf(f.Segment),
          addr: addr(f.Address),
          size: n(f.Size),
          offset: n(f.Offset),
          type: paren(f.Type),
          attributes: n(f.Attributes),
        })),
        segments: blocks(segs[i]!.text, "Segment").map((f) => ({
          name: (f.Name ?? "").trim(),
          addr: addr(f.vmaddr),
          size: n(f.vmsize),
          fileoff: n(f.fileoff),
          filesize: n(f.filesize),
          maxprot: (f.maxprot ?? "").trim(),
          initprot: (f.initprot ?? "").trim(),
        })),
      })),
    };
  }
  if (format === "wasm") {
    const [s] = slices(readobj(["--sections"], path));
    return {
      slices: [
        {
          arch: s!.arch,
          sections: blocks(s!.text, "Section").map((f) => ({
            type: paren(f.Type),
            size: n(f.Size),
            offset: n(f.Offset),
            ...(f.Name !== undefined ? { name: f.Name.trim() } : {}),
          })),
          segments: [],
        },
      ],
    };
  }
  throw new Error(`no layout key for format ${format}`);
}

/** File ranges [offset, size] of each section with bytes in the file, per slice, from the key. */
export function sectionRanges(key: LayoutKey, format: string, bases: number[]): [string, number, number][][] {
  return key.slices.map((s, i) =>
    s.sections.flatMap((r): [string, number, number][] => {
      if (format === "elf")
        return r.type === 8 || r.type === 0 || r.size === 0 ? [] : [[String(r.name), Number(r.offset), Number(r.size)]];
      if (format === "pe") return Number(r.rawSize) > 0 ? [[String(r.name), Number(r.rawPtr), Number(r.rawSize)]] : [];
      if (format === "wasm")
        return Number(r.size) > 0 ? [[String(r.name ?? r.type), Number(r.offset), Number(r.size)]] : [];
      const zerofill = [1, 12, 18].includes(Number(r.type));
      return zerofill || Number(r.size) === 0 ? [] : [[String(r.name), bases[i]! + Number(r.offset), Number(r.size)]];
    }),
  );
}

const PY = `
import json, math, sys
data = open(sys.argv[1], 'rb').read()
ranges = json.loads(sys.argv[2])
def h(b):
    if not b: return 0.0
    c = [0] * 256
    for x in b: c[x] += 1
    n = len(b)
    return round(-sum((k / n) * math.log2(k / n) for k in c if k), 9)
print(json.dumps({
  'size': len(data),
  'entropy': h(data),
  'blocks': [h(data[i:i + 4096]) for i in range(0, len(data), 4096)],
  'sections': [[[name, h(data[o:o + s])] for name, o, s in sl] for sl in ranges],
}))
`;

export function entropyKey(path: string, ranges: [string, number, number][][]) {
  const r = spawnSync("python3", ["-I", "-c", PY, path, JSON.stringify(ranges)], {
    encoding: "utf8",
    maxBuffer: 1 << 28,
  });
  if (r.error || r.status !== 0) throw new Error(`python3 entropy oracle: ${r.error?.message ?? r.stderr}`);
  return JSON.parse(r.stdout) as { size: number; entropy: number; blocks: number[]; sections: [string, number][][] };
}
