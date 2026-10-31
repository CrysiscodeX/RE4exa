// The symbols, procedures and entry-point answer keys (part of scripts/oracle.ts), from LLVM 18:
// - ELF: llvm-nm --format=sysv (.symtab) and llvm-nm -D --format=sysv (.dynsym, with versions);
//   llvm-dwarfdump --eh-frame for each FDE's range; llvm-readobj --file-headers for the entry;
// - Mach-O: llvm-nm -n per architecture; llvm-objdump --macho --private-headers for LC_MAIN;
// - PE: llvm-readobj --coff-exports, --coff-imports and --unwind (.pdata), --file-headers;
// - wasm: llvm-readobj --symbols and llvm-nm.
import { spawnSync } from "node:child_process";

function llvm(tool: string, args: string[]): string {
  for (const bin of [`${tool}-18`, tool]) {
    const r = spawnSync(bin, args, { encoding: "latin1", maxBuffer: 1 << 28 });
    if (r.error) continue;
    if (r.status !== 0) throw new Error(`${bin} ${args.join(" ")}: ${r.stderr.trim()}`);
    return r.stdout;
  }
  throw new Error(`${tool} (LLVM 18) is not installed`);
}

const hex = (s: string) => `0x${BigInt(`0x${s}`).toString(16)}`;

/** llvm-nm --format=sysv rows: name, value, class letter, type, size, section. */
function sysv(out: string) {
  return out
    .split("\n")
    .filter((l) => l.includes("|"))
    .map((l) => l.split("|").map((x) => x.trim()))
    .filter((f) => f[0] !== "Name" && f.length >= 7)
    .map(([name, value, cls, type, size, , section]) => ({
      name: name!,
      addr: value ? hex(value) : null,
      cls: cls!,
      type: type!,
      size: size ? Number(BigInt(`0x${size}`)) : null,
      section: section!,
    }));
}

/** llvm-nm (bsd format) rows: value (or null when undefined), class letter, name. */
function bsd(out: string) {
  const rows: { addr: string | null; cls: string; name: string }[] = [];
  for (const l of out.split("\n")) {
    const m = /^([0-9a-f]+)? +([A-Za-z?-]) (.*)$/.exec(l);
    if (m) rows.push({ addr: m[1] ? hex(m[1]) : null, cls: m[2]!, name: m[3]! });
  }
  return rows;
}

/** Each `<kind> {` block's direct fields (as in oracle-layout.ts); repeated keys are collected. */
function blocks(text: string, kind: string): Record<string, string[]>[] {
  const lines = text.split("\n");
  const out: Record<string, string[]>[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = new RegExp(`^( *)${kind} \\{$`).exec(lines[i]!);
    if (!m) continue;
    const indent = m[1]!.length;
    const f: Record<string, string[]> = {};
    let j = i + 1;
    for (; j < lines.length && lines[j] !== `${" ".repeat(indent)}}`; j++) {
      const kv = /^ *([A-Za-z0-9]+): (.*)$/.exec(lines[j]!);
      if (kv && lines[j]!.length - lines[j]!.trimStart().length === indent + 2) {
        f[kv[1]!] ??= [];
        f[kv[1]!]!.push(kv[2]!.trim());
      }
    }
    out.push(f);
    i = j;
  }
  return out;
}

const LLVM_ARCH: Record<string, string> = { aarch64: "arm64", x86_64: "x86_64", x86: "i386" };

export function symbolsKey(path: string, format: string, arches: string[]) {
  if (format === "elf") {
    let symtab: ReturnType<typeof sysv> = [];
    try {
      symtab = sysv(llvm("llvm-nm", ["--format=sysv", path]));
    } catch {
      // "no symbols": a stripped file
    }
    const dynsym = sysv(llvm("llvm-nm", ["-D", "--format=sysv", path]));
    const fdes = [
      ...llvm("llvm-dwarfdump", ["--eh-frame", path]).matchAll(/FDE cie=[0-9a-f]+ pc=([0-9a-f]+)\.\.\.([0-9a-f]+)/g),
    ].map((m) => ({ addr: hex(m[1]!), size: Number(BigInt(`0x${m[2]}`) - BigInt(`0x${m[1]}`)) }));
    const entry = /^\s*Entry: (0x[0-9A-Fa-f]+)$/m.exec(llvm("llvm-readobj", ["--file-headers", path]))?.[1];
    return { slices: [{ symtab, dynsym, fdes, entry: entry && BigInt(entry) ? hex(entry.slice(2)) : null }] };
  }
  if (format === "macho" || format === "macho-fat") {
    const headers = llvm("llvm-objdump", [
      "--macho",
      "--private-headers",
      ...(format === "macho-fat" ? ["--arch=all"] : []),
      path,
    ]);
    const entryoffs = [...headers.matchAll(/cmd LC_MAIN\n.*\n\s*entryoff (\d+)/g)].map((m) => Number(m[1]));
    return {
      slices: arches.map((a, i) => ({
        nm: bsd(llvm("llvm-nm", ["-n", ...(format === "macho-fat" ? [`--arch=${LLVM_ARCH[a] ?? a}`] : []), path])),
        entryoff: entryoffs[i] ?? null,
      })),
    };
  }
  if (format === "pe") {
    const exportsOut = llvm("llvm-readobj", ["--coff-exports", path]);
    const importsOut = llvm("llvm-readobj", ["--coff-imports", path]);
    const unwind = llvm("llvm-readobj", ["--unwind", path]);
    const head = llvm("llvm-readobj", ["--file-headers", path]);
    const base = BigInt(/ImageBase: (0x[0-9A-Fa-f]+)/.exec(head)![1]!);
    const ep = BigInt(/AddressOfEntryPoint: (0x[0-9A-Fa-f]+)/.exec(head)![1]!);
    const imports = [...blocks(importsOut, "Import"), ...blocks(importsOut, "DelayImport")].flatMap((b) =>
      (b.Symbol ?? []).map((s) => ({ dll: b.Name![0]!, name: s.replace(/ \(\d+\)$/, "") })),
    );
    return {
      slices: [
        {
          exports: blocks(exportsOut, "Export").map((b) => ({
            name: b.Name?.[0] ?? null,
            ordinal: Number(b.Ordinal![0]),
            rva: `0x${BigInt(b.RVA![0]!).toString(16)}`,
          })),
          imports,
          pdata: blocks(unwind, "RuntimeFunction").map((b) => {
            const s = BigInt(/\((0x[0-9A-Fa-f]+)\)/.exec(b.StartAddress![0]!)![1]!);
            const e = BigInt(/\((0x[0-9A-Fa-f]+)\)/.exec(b.EndAddress![0]!)![1]!);
            return { addr: `0x${s.toString(16)}`, size: Number(e - s) };
          }),
          entry: ep ? `0x${(base + ep).toString(16)}` : null,
          imageBase: `0x${base.toString(16)}`,
        },
      ],
    };
  }
  if (format === "wasm") {
    const syms = blocks(llvm("llvm-readobj", ["--symbols", path]), "Symbol").map((b) => ({
      name: b.Name![0]!,
      type: b.Type![0]!.replace(/ \(.*\)$/, ""),
      index: b.ElementIndex ? Number(b.ElementIndex[0]) : null,
    }));
    return { slices: [{ symbols: syms, nm: bsd(llvm("llvm-nm", ["-n", path])) }] };
  }
  throw new Error(`no symbols key for format ${format}`);
}
