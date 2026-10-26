import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  fatMachO,
  type Manifest,
  normalisePE,
  verifyCommitted,
  ZIG_PATH,
  ZIG_VERSION,
  ZIG_WHEEL,
  zig,
} from "../scripts/fixtures.ts";

const REAX = join(import.meta.dirname, "..");
const FIX = join(REAX, "fixtures");
const manifest = JSON.parse(readFileSync(join(FIX, "manifest.json"), "utf8")) as Manifest;
const bin = (f: string) => new Uint8Array(readFileSync(join(FIX, "bin", f)));

test("[+RX-0c/fixtures-pinned] every committed fixture matches its manifest digest, and the pins agree", () => {
  assert.deepEqual(verifyCommitted(), []);
  assert.ok(manifest.entries.length >= 17);
  for (const e of manifest.entries)
    assert.ok(existsSync(join(FIX, "src", e.src)), `${e.id}: source ${e.src} is missing`);
  assert.equal(manifest.zig.version, ZIG_VERSION);
  const req = readFileSync(join(FIX, "zig-requirements.txt"), "utf8");
  assert.ok(
    req.includes(`${ZIG_WHEEL.requirement} --hash=sha256:${ZIG_WHEEL.sha256}`),
    "zig-requirements.txt pins the same wheel",
  );
  const total = manifest.entries.flatMap((e) => e.outputs).reduce((a, o) => a + o.bytes, 0);
  assert.ok(total < 1_000_000, `the corpus stays under 1 MB (is ${total})`);
});

test("[-RX-0c/fixtures-pinned] a changed byte, a missing file and an unlisted file are each reported", () => {
  const d = mkdtempSync(join(tmpdir(), "reax-fix-"));
  try {
    cpSync(join(FIX, "bin"), d, { recursive: true });
    const one = join(d, "hello-x86_64-linux-gnu.2.28-s");
    const b = readFileSync(one);
    b[100] = b[100]! ^ 0xff;
    writeFileSync(one, b);
    unlinkSync(join(d, "lib-wasm32-freestanding-s.wasm"));
    writeFileSync(join(d, "stray.bin"), "x");
    const p = verifyCommitted(manifest, d).sort();
    assert.deepEqual(p, [
      "hello-x86_64-linux-gnu.2.28-s: digest differs from the manifest",
      "lib-wasm32-freestanding-s.wasm: missing",
      "stray.bin: not in the manifest",
    ]);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

interface Shape {
  format: string;
  machine: string;
  bits: number;
  library: boolean;
}

/** Read just enough of each container's header to say what it is. */
function shapeOf(b: Uint8Array): Shape {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (dv.getUint32(0) === 0x7f454c46) {
    const m = dv.getUint16(18, true);
    const dynamic = dv.getUint16(16, true) === 3;
    return {
      format: "elf",
      machine: m === 62 ? "x86_64" : m === 183 ? "aarch64" : `${m}`,
      bits: b[4] === 2 ? 64 : 32,
      library: dynamic && !hasInterp(b),
    };
  }
  if (dv.getUint16(0, true) === 0x5a4d) {
    const pe = dv.getUint32(0x3c, true);
    const m = dv.getUint16(pe + 4, true);
    const ch = dv.getUint16(pe + 22, true);
    const magic = dv.getUint16(pe + 24, true);
    return {
      format: "pe",
      machine: m === 0x8664 ? "x86_64" : `${m}`,
      bits: magic === 0x20b ? 64 : 32,
      library: (ch & 0x2000) !== 0,
    };
  }
  if (dv.getUint32(0, true) === 0xfeedfacf) {
    const cpu = dv.getUint32(4, true);
    return {
      format: "macho",
      machine: cpu === 0x01000007 ? "x86_64" : cpu === 0x0100000c ? "aarch64" : `${cpu}`,
      bits: 64,
      library: dv.getUint32(12, true) === 6,
    };
  }
  if (dv.getUint32(0) === 0xcafebabe)
    return { format: "fat", machine: `${dv.getUint32(4)} slices`, bits: 64, library: false };
  if (dv.getUint32(0) === 0x0061736d) return { format: "wasm", machine: "wasm32", bits: 32, library: false };
  if (new TextDecoder().decode(b.subarray(0, 8)) === "!<arch>\n")
    return { format: "ar", machine: "-", bits: 0, library: true };
  return { format: "unknown", machine: "-", bits: 0, library: false };
}

/** An ELF with a PT_INTERP program header is an executable even when its type is ET_DYN (PIE). */
function hasInterp(b: Uint8Array): boolean {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const phoff = Number(dv.getBigUint64(32, true));
  const size = dv.getUint16(54, true);
  const n = dv.getUint16(56, true);
  for (let i = 0; i < n; i++) if (dv.getUint32(phoff + i * size, true) === 3) return true;
  return false;
}

test("[+RX-0c/fixtures-shape] each fixture's header matches its target", () => {
  for (const e of manifest.entries)
    for (const o of e.outputs) {
      const s = shapeOf(bin(o.file));
      const t = e.target;
      if (o.file.endsWith(".lib")) assert.equal(s.format, "ar", o.file);
      else if (t.includes("+")) assert.deepEqual([s.format, s.machine], ["fat", "2 slices"], o.file);
      else if (t.startsWith("wasm")) assert.equal(s.format, "wasm", o.file);
      else {
        const format = t.includes("linux") ? "elf" : t.includes("windows") ? "pe" : "macho";
        const machine = t.startsWith("aarch64") ? "aarch64" : "x86_64";
        assert.deepEqual(
          { format: s.format, machine: s.machine, bits: s.bits, library: s.library },
          { format, machine, bits: 64, library: e.kind === "shared" },
          o.file,
        );
      }
      if (e.src === "hello.c")
        assert.ok(Buffer.from(bin(o.file)).includes("reax-fixture-tag-7f3a"), `${o.file} keeps its string data`);
    }
});

test("[-RX-0c/fixtures-shape] the fat and PE helpers refuse input that is not what they need", () => {
  const elf = bin("hello-x86_64-linux-gnu.2.28-s");
  assert.throws(() => fatMachO([elf]), /not a 64-bit Mach-O/);
  assert.throws(() => normalisePE(elf.slice()), /not a PE file/);
  const pe = bin("lib-x86_64-windows-gnu-s.dll");
  const dv = new DataView(pe.buffer, pe.byteOffset, pe.byteLength);
  assert.equal(dv.getUint32(dv.getUint32(0x3c, true) + 8, true), 0, "the committed DLL has a zero COFF TimeDateStamp");
});

const rebuild = process.platform === "linux" && existsSync(ZIG_PATH) && process.env.REAX_FIXTURES_REBUILD === "1";
test("[+RX-0c/fixtures-reproducible] a rebuild with the pinned zig is byte-identical to the committed corpus", {
  skip: rebuild ? false : "needs Linux, zig at /tmp/reax-zig and REAX_FIXTURES_REBUILD=1 (CI fixtures lane)",
}, () => {
  const r = spawnSync(
    process.execPath,
    ["--disable-warning=ExperimentalWarning", join(REAX, "scripts", "fixtures.ts"), "--check"],
    {
      encoding: "utf8",
      env: { ...process.env, ZIG: ZIG_PATH },
    },
  );
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /fixtures rebuilt byte-identical/);
});

test("[-RX-0c/fixtures-reproducible] a zig of another version, or at another path, is refused", {
  skip: process.platform === "win32" ? "uses a shell script as a fake zig" : false,
}, () => {
  const d = mkdtempSync(join(tmpdir(), "reax-zig-"));
  try {
    const fake = (v: string) => {
      const p = join(d, `zig-${v}`);
      writeFileSync(p, `#!/bin/sh\necho ${v}\n`);
      chmodSync(p, 0o755);
      return p;
    };
    assert.throws(() => zig(fake("0.14.0")), /zig 0\.14\.0 found; the corpus needs 0\.15\.2/);
    assert.throws(() => zig(fake(ZIG_VERSION)), /must be installed at \/tmp\/reax-zig/);
    assert.throws(() => zig(join(d, "absent")), /zig not found/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
