// Build the fixture corpus from fixtures/src with a pinned zig, and check it.
//   node scripts/fixtures.ts --write   rebuild, copy the outputs to fixtures/bin, write the manifest
//   node scripts/fixtures.ts --check   rebuild and fail unless every reproducible output has the
//                                      digest in fixtures/manifest.json (needs zig; Linux)
//   node scripts/fixtures.ts --verify  check only that fixtures/bin matches the manifest (no zig)
//
// Reproducible by construction: the sources are copied to one fixed absolute build root (debug
// info records it), the zig caches live inside that root and start empty, every object is
// compiled separately and given a fixed mtime before linking (Mach-O debug maps record it), and
// zig is pinned to one version. One normalisation follows the link: PE files get their COFF
// header and export directory TimeDateStamp set to 0, because zig's in-process lld writes the wall
// clock there for DLLs even with -Wl,/Brepro (normalisePE; each entry's command list says so).
//
// Debug builds are made only where they stay small and reproducible: glibc ELF and Mach-O. Static
// musl and wasm debug builds carry libc's debug info (about 1 MB each). PE with a PDB is left out
// because lld writes a fresh PDB GUID on every link under zig 0.15.2, also with -Wl,/Brepro, so it
// cannot be rebuilt byte-identical; a PDB fixture needs another route.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

export const ZIG_VERSION = "0.15.2";
/** The PyPI wheel CI installs zig from (pip install --require-hashes). manylinux x86_64. */
export const ZIG_WHEEL = {
  requirement: "ziglang==0.15.2",
  sha256: "806316453d1ede7174ed3fefb8e5348154629089c3bb5fe812dfd0e172fac130",
};
const BUILD_ROOT = "/tmp/reax-fixture-build";
/** zig's install path is recorded in debug info (its libc sources), so it is fixed too:
 * pip install --no-deps --require-hashes --target /tmp/reax-zig -r fixtures/zig-requirements.txt */
export const ZIG_PATH = "/tmp/reax-zig/ziglang/zig";
const REAX = join(import.meta.dirname, "..");
const FIX = join(REAX, "fixtures");
const BIN = join(FIX, "bin");
const MANIFEST = join(FIX, "manifest.json");

interface Build {
  id: string;
  src: string;
  target: string;
  kind: "exe" | "shared";
  debug: boolean;
}

const NATIVE = [
  "x86_64-linux-musl",
  "aarch64-linux-musl",
  "x86_64-linux-gnu.2.28",
  "x86_64-windows-gnu",
  "aarch64-macos",
  "x86_64-macos",
];
const builds: Build[] = [];
const DEBUG = new Set(["x86_64-linux-gnu.2.28", "aarch64-macos", "x86_64-macos"]);
for (const target of [...NATIVE, "wasm32-wasi"])
  for (const debug of DEBUG.has(target) ? [false, true] : [false])
    builds.push({ id: `hello-${target}-${debug ? "g" : "s"}`, src: "hello.c", target, kind: "exe", debug });
for (const target of ["x86_64-linux-gnu.2.28", "x86_64-windows-gnu", "aarch64-macos", "wasm32-freestanding"])
  builds.push({ id: `lib-${target}-s`, src: "lib.c", target, kind: "shared", debug: false });
for (const debug of [false, true])
  builds.push({
    id: `shapes-x86_64-linux-gnu.2.28-${debug ? "g" : "s"}`,
    src: "shapes.cpp",
    target: "x86_64-linux-gnu.2.28",
    kind: "exe",
    debug,
  });

export interface Output {
  file: string;
  bytes: number;
  sha256: string;
}
export interface Entry {
  id: string;
  src: string;
  target: string;
  kind: string;
  debug: boolean;
  command: string[];
  outputs: Output[];
}
export interface Manifest {
  _note: string;
  zig: { version: string; wheel: typeof ZIG_WHEEL };
  build_root: string;
  entries: Entry[];
}

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const ext = (b: Build) =>
  b.kind === "exe"
    ? b.target.includes("windows")
      ? ".exe"
      : b.target.startsWith("wasm")
        ? ".wasm"
        : ""
    : b.target.includes("windows")
      ? ".dll"
      : b.target.includes("macos")
        ? ".dylib"
        : b.target.startsWith("wasm")
          ? ".wasm"
          : ".so";

export function zig(z = process.env.ZIG ?? ZIG_PATH): string {
  const r = spawnSync(z, ["version"], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`zig not found at ${z}: ${r.error ?? r.stderr}`);
  if (r.stdout.trim() !== ZIG_VERSION) throw new Error(`zig ${r.stdout.trim()} found; the corpus needs ${ZIG_VERSION}`);
  if (z !== ZIG_PATH) throw new Error(`zig must be installed at ${ZIG_PATH} (its path is recorded in debug info)`);
  return z;
}

function run(z: string, args: string[], cwd: string) {
  const r = spawnSync(z, args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      ZIG_GLOBAL_CACHE_DIR: join(BUILD_ROOT, ".zc"),
      ZIG_LOCAL_CACHE_DIR: join(BUILD_ROOT, ".zl"),
    },
  });
  if (r.status !== 0) throw new Error(`zig ${args.join(" ")} failed:\n${r.stderr}`);
}

/** Build every fixture into BUILD_ROOT/out/<id>/ and return what each produced. */
function buildAll(): Map<string, { entry: Omit<Entry, "outputs">; files: Map<string, Uint8Array> }> {
  const z = zig();
  rmSync(BUILD_ROOT, { recursive: true, force: true });
  mkdirSync(join(BUILD_ROOT, "src"), { recursive: true });
  for (const f of readdirSync(join(FIX, "src"))) copyFileSync(join(FIX, "src", f), join(BUILD_ROOT, "src", f));
  const out = new Map<string, { entry: Omit<Entry, "outputs">; files: Map<string, Uint8Array> }>();
  for (const b of builds) {
    const cc = b.src.endsWith(".cpp") ? "c++" : "cc";
    const obj = `obj/${b.id}.o`;
    const dir = join(BUILD_ROOT, "out", b.id);
    mkdirSync(dir, { recursive: true });
    mkdirSync(join(BUILD_ROOT, "obj"), { recursive: true });
    const compile = [
      cc,
      "-target",
      b.target,
      "-O2",
      ...(b.debug ? ["-g"] : []),
      ...(b.kind === "shared" && !b.target.startsWith("wasm") ? ["-fPIC"] : []),
      "-c",
      "-o",
      obj,
      `src/${b.src}`,
    ];
    run(z, compile, BUILD_ROOT);
    utimesSync(join(BUILD_ROOT, obj), 1, 1);
    const file = `${b.id}${ext(b)}`;
    const wasmLib =
      b.kind === "shared" && b.target.startsWith("wasm") ? ["-nostdlib", "-Wl,--no-entry", "-Wl,--export-dynamic"] : [];
    const link = [
      cc,
      "-target",
      b.target,
      ...(b.debug ? ["-g"] : ["-s"]),
      ...(b.kind === "shared" && !wasmLib.length ? ["-shared"] : []),
      ...wasmLib,
      "-o",
      `out/${b.id}/${file}`,
      obj,
    ];
    run(z, link, BUILD_ROOT);
    const files = new Map<string, Uint8Array>();
    const pe = /\.(exe|dll)$/.test(file);
    for (const f of readdirSync(dir).sort()) {
      const bytes = new Uint8Array(readFileSync(join(dir, f)));
      files.set(f, f === file && pe ? normalisePE(bytes) : bytes);
    }
    out.set(b.id, {
      entry: {
        id: b.id,
        src: b.src,
        target: b.target,
        kind: b.kind,
        debug: b.debug,
        command: [
          `zig ${compile.join(" ")}`,
          `touch -d @1 ${obj}`,
          `zig ${link.join(" ")}`,
          ...(pe ? [`normalisePE ${file}: COFF and export-directory TimeDateStamp = 0`] : []),
        ],
      },
      files,
    });
  }
  // A universal (fat) Mach-O from the two stripped macOS builds, assembled here: no lipo needed.
  const fat = fatMachO([
    out.get("hello-x86_64-macos-s")!.files.get("hello-x86_64-macos-s")!,
    out.get("hello-aarch64-macos-s")!.files.get("hello-aarch64-macos-s")!,
  ]);
  out.set("hello-universal-macos-s", {
    entry: {
      id: "hello-universal-macos-s",
      src: "hello.c",
      target: "x86_64-macos + aarch64-macos",
      kind: "exe",
      debug: false,
      command: ["fat Mach-O of hello-x86_64-macos-s and hello-aarch64-macos-s (scripts/fixtures.ts fatMachO)"],
    },
    files: new Map([["hello-universal-macos-s", fat]]),
  });
  return out;
}

/** Set the COFF header's and the export directory's TimeDateStamp to 0, in place. */
export function normalisePE(b: Uint8Array): Uint8Array {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (dv.getUint16(0, true) !== 0x5a4d) throw new Error("not a PE file (no MZ)");
  const pe = dv.getUint32(0x3c, true);
  if (dv.getUint32(pe, true) !== 0x4550) throw new Error("not a PE file (no PE signature)");
  const coff = pe + 4;
  dv.setUint32(coff + 4, 0, true);
  const nsect = dv.getUint16(coff + 2, true);
  const optSize = dv.getUint16(coff + 16, true);
  const opt = coff + 20;
  const magic = dv.getUint16(opt, true);
  const dirs = opt + (magic === 0x20b ? 112 : 96);
  const exportRva = dv.getUint32(dirs, true);
  if (exportRva) {
    const sections = opt + optSize;
    for (let i = 0; i < nsect; i++) {
      const sh = sections + 40 * i;
      const va = dv.getUint32(sh + 12, true);
      const size = Math.max(dv.getUint32(sh + 8, true), dv.getUint32(sh + 16, true));
      if (exportRva >= va && exportRva < va + size) {
        dv.setUint32(dv.getUint32(sh + 20, true) + (exportRva - va) + 4, 0, true);
        break;
      }
    }
  }
  return b;
}

/** fat_header + fat_arch entries (big-endian), each slice aligned to 2^14. */
export function fatMachO(slices: Uint8Array[]): Uint8Array {
  const ALIGN = 14;
  const headerSize = 8 + 20 * slices.length;
  let off = headerSize;
  const placed = slices.map((s) => {
    off = Math.ceil(off / 2 ** ALIGN) * 2 ** ALIGN;
    const at = off;
    off += s.length;
    return at;
  });
  const out = new Uint8Array(off);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0xcafebabe);
  dv.setUint32(4, slices.length);
  slices.forEach((s, i) => {
    const le = new DataView(s.buffer, s.byteOffset, s.byteLength);
    if (le.getUint32(0, true) !== 0xfeedfacf) throw new Error("fat slice is not a 64-bit Mach-O");
    const e = 8 + 20 * i;
    dv.setUint32(e, le.getUint32(4, true));
    dv.setUint32(e + 4, le.getUint32(8, true));
    dv.setUint32(e + 8, placed[i]!);
    dv.setUint32(e + 12, s.length);
    dv.setUint32(e + 16, ALIGN);
    out.set(s, placed[i]!);
  });
  return out;
}

function readManifest(): Manifest {
  return JSON.parse(readFileSync(MANIFEST, "utf8")) as Manifest;
}

/** Every committed fixture file has the size and digest the manifest records, and nothing else is in bin/. */
export function verifyCommitted(manifest = readManifest(), bin = BIN): string[] {
  const problems: string[] = [];
  const listed = new Set<string>();
  for (const e of manifest.entries)
    for (const o of e.outputs) {
      listed.add(o.file);
      const p = join(bin, o.file);
      if (!existsSync(p)) {
        problems.push(`${o.file}: missing`);
        continue;
      }
      const b = readFileSync(p);
      if (b.length !== o.bytes || sha(b) !== o.sha256) problems.push(`${o.file}: digest differs from the manifest`);
    }
  for (const f of existsSync(bin) ? readdirSync(bin) : [])
    if (!listed.has(f)) problems.push(`${f}: not in the manifest`);
  return problems;
}

if (import.meta.main) {
  const mode = process.argv[2];
  if (mode === "--verify") {
    const p = verifyCommitted();
    for (const x of p) console.error(x);
    console.log(p.length ? `${p.length} problems` : "fixtures/bin matches the manifest");
    process.exit(p.length ? 1 : 0);
  }
  if (mode !== "--write" && mode !== "--check") {
    console.error("usage: fixtures.ts --write | --check | --verify");
    process.exit(2);
  }
  const built = buildAll();
  if (mode === "--write") {
    rmSync(BIN, { recursive: true, force: true });
    mkdirSync(BIN, { recursive: true });
    const entries: Entry[] = [];
    for (const { entry, files } of built.values()) {
      const outputs: Output[] = [];
      for (const [f, b] of files) {
        writeFileSync(join(BIN, f), b);
        outputs.push({ file: f, bytes: b.length, sha256: sha(b) });
      }
      entries.push({ ...entry, outputs });
    }
    const m: Manifest = {
      _note: "Generated by scripts/fixtures.ts --write. Do not edit. Sources: fixtures/src (written for reax).",
      zig: { version: ZIG_VERSION, wheel: ZIG_WHEEL },
      build_root: BUILD_ROOT,
      entries,
    };
    writeFileSync(MANIFEST, `${JSON.stringify(m, null, 1)}\n`);
    const total = entries.flatMap((e) => e.outputs).reduce((a, o) => a + o.bytes, 0);
    console.log(`${entries.length} fixtures, ${entries.flatMap((e) => e.outputs).length} files, ${total} bytes`);
  } else {
    const m = readManifest();
    const problems: string[] = [];
    for (const e of m.entries) {
      const b = built.get(e.id);
      if (!b) {
        problems.push(`${e.id}: no longer built`);
        continue;
      }
      for (const o of e.outputs) {
        const got = b.files.get(o.file);
        if (!got) problems.push(`${o.file}: not produced`);
        else if (sha(got) !== o.sha256)
          problems.push(`${o.file}: rebuilt digest ${sha(got).slice(0, 12)} != ${o.sha256.slice(0, 12)}`);
      }
    }
    for (const id of built.keys())
      if (!m.entries.some((e) => e.id === id)) problems.push(`${id}: built but not in the manifest`);
    for (const x of problems) console.error(x);
    console.log(
      problems.length ? `${problems.length} problems` : `${m.entries.length} fixtures rebuilt byte-identical`,
    );
    process.exit(problems.length ? 1 : 0);
  }
}
