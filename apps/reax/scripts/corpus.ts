// A real-world corpus: native binaries that LearnHarness (github.com/amosblomqvist/learnharness)
// ships, pinned by its lockfile. Nothing from it is committed: the packages are fetched from the
// npm registry at test time, checked against the lockfile's sha512, cached, and only read, never
// run. What is committed is the list (bench/corpus/learnharness.json) and LLVM 18's reading of
// each file (bench/corpus/learnharness.facts.json), with export names summarised as a count, a
// sha256 of the sorted names and an even sample.
//
//   node scripts/corpus.ts manifest <learnharness checkout>   write the list from its lockfile
//   node scripts/corpus.ts fetch [dir]                        fetch, verify and unpack the files
//   node scripts/corpus.ts facts [--check]                    LLVM's reading (Linux, LLVM 18)
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { normalizeArch } from "@re4exa/core/probes/arch";
import { gunzipBounded, parseTar, tarEntryData } from "@re4exa/core/probes/builtin/archive";

const ROOT = join(import.meta.dirname, "..");
export const MANIFEST = join(ROOT, "bench", "corpus", "learnharness.json");
export const FACTS = join(ROOT, "bench", "corpus", "learnharness.facts.json");

export interface CorpusPackage {
  name: string;
  version: string;
  /** The lockfile's integrity, `sha512-<base64>`. */
  integrity: string;
  /** Paths inside the tarball to read. */
  files: string[];
}
export interface Manifest {
  _note: string;
  source: { repo: string; commit: string; release: string; lockfile: string };
  packages: CorpusPackage[];
}
export interface CorpusFile {
  /** `<name>@<version>/<path in the tarball>`: the key in the facts file. */
  key: string;
  pkg: CorpusPackage;
  path: string;
}
export interface Fact {
  format: string;
  arch: string[];
  /** ELF DT_SONAME, the PE export directory's DLL name, or the Mach-O install name (LC_ID_DYLIB). */
  ownName: string | null;
  links: string[];
  exports: { count: number; sha256: string; sample: string[] };
}

/** Runtime packages of LearnHarness's lockfile and the files to read in each: one per format, OS
 * and architecture it ships, plus its largest libraries. */
const PICK: [string, string[]][] = [
  ["@resvg/resvg-js-linux-x64-gnu", ["package/resvgjs.linux-x64-gnu.node"]],
  ["@resvg/resvg-js-linux-x64-musl", ["package/resvgjs.linux-x64-musl.node"]],
  ["@resvg/resvg-js-darwin-arm64", ["package/resvgjs.darwin-arm64.node"]],
  ["@resvg/resvg-js-win32-x64-msvc", ["package/resvgjs.win32-x64-msvc.node"]],
  ["@img/sharp-linux-x64", ["package/lib/sharp-linux-x64-0.35.5.node"]],
  ["@img/sharp-darwin-arm64", ["package/lib/sharp-darwin-arm64-0.35.5.node"]],
  [
    "@img/sharp-win32-x64",
    ["package/lib/sharp-win32-x64-0.35.5.node", "package/lib/libvips-42.dll", "package/lib/libvips-cpp-8.18.7.dll"],
  ],
  ["@img/sharp-libvips-linux-x64", ["package/lib/libvips-cpp.so.8.18.7"]],
  ["@img/sharp-libvips-darwin-arm64", ["package/lib/libvips-cpp.8.18.7.dylib"]],
  ["@napi-rs/canvas-linux-arm64-gnu", ["package/skia.linux-arm64-gnu.node"]],
  ["@img/sharp-wasm32", ["package/lib/sharp-wasm32-0.35.5.node.wasm"]],
];

export function loadManifest(): Manifest {
  return JSON.parse(readFileSync(MANIFEST, "utf8")) as Manifest;
}

export function corpusFiles(m = loadManifest()): CorpusFile[] {
  return m.packages.flatMap((pkg) =>
    pkg.files.map((path) => ({ key: `${pkg.name}@${pkg.version}/${path}`, pkg, path })),
  );
}

export function sri(b: Uint8Array): string {
  return `sha512-${createHash("sha512").update(b).digest("base64")}`;
}

/** The cache directory: REAX_CORPUS_DIR, else one under the system temp directory. */
export function corpusDir(): string {
  return process.env.REAX_CORPUS_DIR ?? join(tmpdir(), "reax-corpus");
}

/** Where a corpus file lands once unpacked. */
export function localPath(dir: string, f: CorpusFile): string {
  return join(dir, "files", f.pkg.name.replace(/[@/]/g, "_"), basename(f.path));
}

/** Unpacks the wanted files from a verified tarball. A wrong hash is refused before anything is read. */
export function unpack(tgz: Uint8Array, pkg: CorpusPackage, dir: string): void {
  const got = sri(tgz);
  if (got !== pkg.integrity)
    throw new Error(`${pkg.name}@${pkg.version}: sha512 ${got} is not the lockfile's ${pkg.integrity}`);
  const tar = gunzipBounded(tgz);
  const listing = parseTar(tar, 100_000);
  for (const path of pkg.files) {
    const e = listing.entries.find((x) => x.name === path && x.type === "file");
    if (!e) throw new Error(`${pkg.name}@${pkg.version}: no file ${path} in the tarball`);
    const out = localPath(dir, { key: "", pkg, path });
    mkdirSync(join(out, ".."), { recursive: true });
    writeFileSync(out, tarEntryData(tar, e, e.size));
  }
}

/** Fetches each package once (npm pack: no install, no scripts), verifies it and unpacks it. */
export function fetchCorpus(dir = corpusDir()): CorpusFile[] {
  const m = loadManifest();
  mkdirSync(join(dir, "tgz"), { recursive: true });
  for (const pkg of m.packages) {
    const cached = join(dir, "tgz", `${createHash("sha256").update(pkg.integrity).digest("hex").slice(0, 32)}.tgz`);
    if (!existsSync(cached)) {
      const tmp = mkdtempSync(join(dir, "pack-"));
      try {
        const r = spawnSync("npm", ["pack", `${pkg.name}@${pkg.version}`, "--pack-destination", tmp, "--silent"], {
          encoding: "utf8",
          shell: process.platform === "win32",
          timeout: 300_000,
        });
        const name = r.stdout.trim().split("\n").pop()?.trim();
        if (r.status !== 0 || !name) throw new Error(`npm pack ${pkg.name}@${pkg.version} failed: ${r.stderr.trim()}`);
        const b = readFileSync(join(tmp, name));
        if (sri(b) !== pkg.integrity)
          throw new Error(
            `${pkg.name}@${pkg.version}: the registry's tarball is not the one LearnHarness's lockfile pins`,
          );
        writeFileSync(cached, b);
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    }
    unpack(readFileSync(cached), pkg, dir);
  }
  return corpusFiles(m);
}

// ---------------------------------------------------------------- LLVM's reading (the oracle) ----

function llvm(tool: string, args: string[]): string {
  for (const bin of [`${tool}-18`, tool]) {
    const r = spawnSync(bin, args, { encoding: "utf8", maxBuffer: 1 << 28 });
    if (!r.error) {
      if (r.status !== 0) throw new Error(`${bin} ${args.join(" ")}: ${r.stderr.trim()}`);
      return r.stdout;
    }
  }
  throw new Error(`${tool} (LLVM 18) is not installed`);
}

function summary(names: string[]): Fact["exports"] {
  const sorted = [...names].sort();
  const step = Math.max(1, Math.floor(sorted.length / 64));
  return {
    count: sorted.length,
    sha256: createHash("sha256").update(sorted.join("\n")).digest("hex"),
    sample: sorted.filter((_, i) => i % step === 0).slice(0, 64),
  };
}

/** Import module names from LLVM's dump of the wasm IMPORT section (decoded here, not by reax or core). */
function wasmImportModules(dump: string): string[] {
  const m = dump.match(/Type: IMPORT[\s\S]*?SectionData \(([\s\S]*?)\n\s*\)/);
  if (!m) return [];
  const bytes = [...m[1]!.matchAll(/^\s*[0-9a-f]+: ((?:[0-9a-f]{2,8} ?)+)/gim)].flatMap((x) =>
    x[1]!
      .trim()
      .split(/\s+/)
      .join("")
      .match(/../g)!
      .map((h) => Number.parseInt(h, 16)),
  );
  let p = 0;
  const leb = () => {
    let v = 0;
    let s = 0;
    for (;;) {
      const c = bytes[p++]!;
      v |= (c & 0x7f) << s;
      if (!(c & 0x80)) return v >>> 0;
      s += 7;
    }
  };
  const name = () => {
    const n = leb();
    const s = Buffer.from(bytes.slice(p, p + n)).toString("utf8");
    p += n;
    return s;
  };
  const mods = new Set<string>();
  const count = leb();
  for (let i = 0; i < count; i++) {
    mods.add(name());
    name();
    const kind = bytes[p++]!;
    if (kind === 0) leb();
    else if (kind === 1) {
      p++;
      const flags = leb();
      leb();
      if (flags & 1) leb();
    } else if (kind === 2) {
      const flags = leb();
      leb();
      if (flags & 1) leb();
    } else if (kind === 3) p += 2;
    else if (kind === 4) {
      p++;
      leb();
    }
  }
  return [...mods].sort();
}

const lines = (s: string) =>
  s
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);

export function llvmFact(path: string): Fact {
  const head = llvm("llvm-readobj", ["--file-headers", path]);
  const fmt = /Format: (\S+)/.exec(head)?.[1] ?? "";
  if (/^elf/i.test(fmt)) {
    const needed = /NeededLibraries \[([^\]]*)\]/.exec(llvm("llvm-readobj", ["--needed-libs", path]))?.[1] ?? "";
    return {
      format: "elf",
      arch: [normalizeArch(/Arch: (\S+)/.exec(head)![1]!)],
      ownName: /Library soname: \[(.+)\]/.exec(llvm("llvm-readobj", ["--dynamic-table", path]))?.[1] ?? null,
      links: lines(needed).sort(),
      exports: summary(lines(llvm("llvm-nm", ["-D", "--defined-only", "--format=just-symbols", path]))),
    };
  }
  if (/^COFF/i.test(fmt)) {
    const imports = llvm("llvm-readobj", ["--coff-imports", path]);
    const exports = llvm("llvm-readobj", ["--coff-exports", path]);
    return {
      format: "pe",
      arch: [normalizeArch(/Arch: (\S+)/.exec(head)![1]!)],
      ownName: /^Export Table:\n DLL name: (.+)$/m.exec(llvm("llvm-objdump", ["-p", path]))?.[1]?.trim() ?? null,
      // regular and delay-load imports both: Node addons delay-load node.exe
      links: [...new Set([...imports.matchAll(/^ {2}Name: (.+)$/gm)].map((x) => x[1]!.trim()))].sort(),
      exports: summary([...exports.matchAll(/^ {2}Name: (.+)$/gm)].map((x) => x[1]!.trim()).filter(Boolean)),
    };
  }
  if (/^Mach-O/i.test(fmt)) {
    const id = lines(llvm("llvm-objdump", ["--macho", "--dylib-id", path])).slice(1)[0];
    const used = lines(llvm("llvm-objdump", ["--macho", "--dylibs-used", path]))
      .slice(1)
      .map((x) => x.replace(/ \(compatibility version.*$/, ""));
    return {
      format: "macho",
      arch: [normalizeArch(/Arch: (\S+)/.exec(head)![1]!)],
      ownName: id ?? null,
      // a library's own install name (LC_ID_DYLIB) is listed by --dylibs-used but is not a link
      links: used.filter((x) => x !== id).sort(),
      exports: summary(lines(llvm("llvm-nm", ["--defined-only", "--extern-only", "--format=just-symbols", path]))),
    };
  }
  if (/wasm/i.test(fmt)) {
    return {
      format: "wasm",
      arch: ["wasm32"],
      ownName: null,
      links: wasmImportModules(llvm("llvm-readobj", ["--sections", "--section-data", path])),
      exports: summary(lines(llvm("llvm-nm", ["--defined-only", "--extern-only", "--format=just-symbols", path]))),
    };
  }
  throw new Error(`${path}: LLVM reports format ${fmt}`);
}

function facts(check: boolean): void {
  const dir = corpusDir();
  const files = fetchCorpus(dir);
  const out: Record<string, Fact> = {};
  for (const f of files) out[f.key] = llvmFact(localPath(dir, f));
  const body = `${JSON.stringify(
    {
      _note:
        "Generated by scripts/corpus.ts facts from LLVM 18 tool output on the files bench/corpus/learnharness.json pins. Do not edit.",
      commands: [
        "llvm-readobj --file-headers",
        "own name: ELF llvm-readobj --dynamic-table (SONAME); PE llvm-objdump -p (Export Table DLL name); Mach-O llvm-objdump --macho --dylib-id",
        "ELF: llvm-readobj --needed-libs; llvm-nm -D --defined-only --format=just-symbols",
        "PE: llvm-readobj --coff-imports (regular and delay-load); llvm-readobj --coff-exports",
        "Mach-O: llvm-objdump --macho --dylibs-used, without --dylib-id; llvm-nm --defined-only --extern-only --format=just-symbols",
        "wasm: llvm-readobj --sections --section-data (IMPORT module names); llvm-nm --defined-only --extern-only --format=just-symbols",
      ],
      facts: out,
    },
    null,
    1,
  )}\n`;
  if (check) {
    if (readFileSync(FACTS, "utf8") !== body) {
      console.error(
        "bench/corpus/learnharness.facts.json is not LLVM's current reading; run node scripts/corpus.ts facts",
      );
      process.exit(1);
    }
    console.log(`LLVM's reading matches the committed facts (${files.length} files)`);
  } else {
    writeFileSync(FACTS, body);
    console.log(`wrote ${FACTS} (${files.length} files)`);
  }
}

function manifest(checkout: string): void {
  const lock = JSON.parse(readFileSync(join(checkout, "package-lock.json"), "utf8")) as {
    packages: Record<string, { version: string; integrity: string; dev?: boolean }>;
  };
  const head = spawnSync("git", ["-C", checkout, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();
  const release = (JSON.parse(readFileSync(join(checkout, "package.json"), "utf8")) as { version: string }).version;
  const packages = PICK.map(([name, files]) => {
    const p = lock.packages[`node_modules/${name}`];
    if (!p) throw new Error(`${name} is not in the lockfile`);
    if (p.dev) throw new Error(`${name} is a dev dependency; the corpus holds what the app ships`);
    return { name, version: p.version, integrity: p.integrity, files };
  });
  const m: Manifest = {
    _note:
      "Native binaries LearnHarness ships, pinned by its lockfile. Fetched at test time with npm pack, checked against the sha512 below, never run, never committed. Regenerate with node scripts/corpus.ts manifest <learnharness checkout>.",
    source: {
      repo: "https://github.com/amosblomqvist/learnharness",
      commit: head,
      release,
      lockfile: "package-lock.json",
    },
    packages,
  };
  mkdirSync(join(MANIFEST, ".."), { recursive: true });
  writeFileSync(MANIFEST, `${JSON.stringify(m, null, 1)}\n`);
  console.log(`wrote ${MANIFEST} (${packages.length} packages, LearnHarness ${release} at ${head.slice(0, 7)})`);
}

if (import.meta.main) {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === "manifest" && arg) manifest(arg);
  else if (cmd === "fetch") console.log(`${fetchCorpus(arg ?? corpusDir()).length} files in ${arg ?? corpusDir()}`);
  else if (cmd === "facts") facts(arg === "--check");
  else {
    console.error("usage: corpus.ts manifest <learnharness checkout> | fetch [dir] | facts [--check]");
    process.exit(2);
  }
}
