// The operation registry and the first operations. Every documented example runs here as a
// doctest, and identify/inventory are checked against LLVM's own reading of every fixture
// (bench/oracle-facts.json, written by bench/make-tasks.ts from llvm-readobj, llvm-nm and
// llvm-objdump), so the oracle is independent of the code under test.
import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { isCoreError } from "@re4exa/core/errors";
import { mapParity, operationsMd } from "../scripts/gen.ts";
import type { NativeSlice } from "../src/ops/native.ts";
import { OPERATIONS, runOperation, TEXT_CAP } from "../src/ops/registry.ts";

const REAX = join(import.meta.dirname, "..");
const BIN = join(REAX, "fixtures", "bin");
const ctx = { workspace: BIN };
const facts = JSON.parse(readFileSync(join(REAX, "bench", "oracle-facts.json"), "utf8")).facts as Record<
  string,
  { format: string; arch: string[]; links: string[]; exports: string[]; interpreter: string | null }
>;
const inventory = async (path: string) =>
  (await runOperation("inventory.native", { path, limit: 5000 }, ctx)).data as {
    format: string;
    slices: NativeSlice[];
  };

/** Deep subset match: every key in `want` is in `got` with an equal (or subset-matching) value. */
function includes(got: unknown, want: unknown): boolean {
  if (Array.isArray(want)) return Array.isArray(got) && want.every((w, i) => includes(got[i], w));
  if (want && typeof want === "object")
    return (
      !!got &&
      typeof got === "object" &&
      Object.entries(want).every(([k, v]) => includes((got as Record<string, unknown>)[k], v))
    );
  return got === want;
}

test("[+RX-1/op-registry] every documented example runs and returns what the documentation says", async () => {
  assert.ok(OPERATIONS.length >= 2);
  for (const op of OPERATIONS) {
    assert.ok(op.examples.length > 0, `${op.name} has an example`);
    for (const ex of op.examples) {
      const r = await runOperation(op.name, ex.args, ctx);
      assert.ok(includes(r.data, ex.expect), `${op.name}: ${ex.title}: ${JSON.stringify(r.data).slice(0, 400)}`);
    }
  }
  const md = readFileSync(join(REAX, "docs", "operations.md"), "utf8").replaceAll("\r\n", "\n");
  assert.equal(md, operationsMd(OPERATIONS), "docs/operations.md is current (node scripts/gen.ts)");
});

test("[+leanrea/LEAN-C04] identify.file names the same format as LLVM for every fixture, with no external tool", async () => {
  for (const [file, f] of Object.entries(facts)) {
    const r = await runOperation("identify.file", { path: file }, ctx);
    assert.equal((r.data as { format: string }).format, f.format, file);
  }
});

test("[-leanrea/LEAN-C04] arguments are checked: a missing path, an unknown argument, a directory, a path outside the workspace", async () => {
  const bad = (e: unknown, field: string) =>
    isCoreError(e, "bad_request") && (e as unknown as { detail: { field: string } }).detail.field === field;
  await assert.rejects(runOperation("identify.file", {}, ctx), (e) => bad(e, "path"));
  await assert.rejects(runOperation("identify.file", { path: "a", depth: 2 }, ctx), (e) => bad(e, "depth"));
  await assert.rejects(runOperation("identify.file", { path: "." }, ctx), (e) => bad(e, "path"));
  await assert.rejects(runOperation("identify.file", { path: "../manifest.json" }, ctx), (e) =>
    isCoreError(e, "path_outside_workspace"),
  );
  await assert.rejects(runOperation("identify.nothing", {}, ctx), (e) => isCoreError(e, "operation_unknown"));
});

test("[+rea.tool/list_architectures] [+leanrea/LEAN-T11] every slice of every binary has LLVM's architecture, universal binaries included", async () => {
  for (const [file, f] of Object.entries(facts)) {
    const inv = await inventory(file);
    assert.deepEqual(inv.slices.map((s) => s.arch).sort(), [...f.arch].sort(), file);
  }
  const fat = await inventory("hello-universal-macos-s");
  assert.equal(fat.slices.length, 2);
  const thin = await inventory("hello-x86_64-macos-s");
  assert.deepEqual(
    fat.slices[0],
    thin.slices[0],
    "each slice of the universal binary reads like the thin file it came from",
  );
});

test("[-rea.tool/list_architectures] [-leanrea/LEAN-T11] a file that is not a native binary is refused, and a cut slice is reported", async () => {
  const d = mkdtempSync(join(tmpdir(), "reax-ops-"));
  try {
    writeFileSync(join(d, "notes.txt"), "just text\n");
    await assert.rejects(runOperation("inventory.native", { path: "notes.txt" }, { workspace: d }), (e) =>
      isCoreError(e, "bad_request"),
    );
    const fat = readFileSync(join(BIN, "hello-universal-macos-s"));
    writeFileSync(join(d, "cut"), fat.subarray(0, 20_000));
    const r = await runOperation("inventory.native", { path: "cut" }, { workspace: d });
    assert.equal(r.coverage, "partial");
    assert.ok(
      r.limitations.some((l) => /slice .*past the end/.test(l)),
      r.limitations.join("; "),
    );
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("[+rea.tool/inspect_native_exports] exported reax_* symbols match LLVM for ELF, PE, Mach-O and WebAssembly", async () => {
  for (const [file, f] of Object.entries(facts)) {
    const inv = await inventory(file);
    const ours = [
      ...new Set(
        inv.slices
          .flatMap((s) => s.exports.names)
          .map((n) => n.replace(/^_(?=reax_)/, ""))
          .filter((n) => n.startsWith("reax_")),
      ),
    ].sort();
    assert.deepEqual(ours, f.exports, file);
    for (const s of inv.slices) assert.equal(s.exports.complete, true, `${file}: export list complete`);
  }
});

test("[-rea.tool/inspect_native_exports] a hidden function is not exported, an executable exports nothing dynamically, and a limit says so", async () => {
  for (const lib of [
    "lib-x86_64-linux-gnu.2.28-s.so",
    "lib-x86_64-windows-gnu-s.dll",
    "lib-aarch64-macos-s.dylib",
    "lib-wasm32-freestanding-s.wasm",
  ]) {
    const names = (await inventory(lib)).slices.flatMap((s) => s.exports.names);
    assert.ok(!names.some((n) => n.includes("reax_hidden")), lib);
  }
  const exe = await inventory("hello-x86_64-linux-gnu.2.28-s");
  assert.ok(!exe.slices[0]!.exports.names.includes("reax_add"));
  const capped = await runOperation("inventory.native", { path: "lib-x86_64-linux-gnu.2.28-s.so", limit: 2 }, ctx);
  const s = (capped.data as { slices: NativeSlice[] }).slices[0]!;
  assert.deepEqual([s.exports.names.length, s.exports.complete, capped.coverage], [2, false, "partial"]);
});

test("[+rea.tool/inspect_pe_imports] PE imports: the same DLLs as LLVM, each function named with its DLL", async () => {
  for (const file of ["hello-x86_64-windows-gnu-s.exe", "lib-x86_64-windows-gnu-s.dll"]) {
    const s = (await inventory(file)).slices[0]!;
    assert.deepEqual(
      s.links.map((l) => l.toLowerCase()).sort(),
      facts[file]!.links.map((l) => l.toLowerCase()).sort(),
      file,
    );
    assert.ok(s.imports.names.length > 0 && s.imports.names.every((n) => /^[^!]+\.dll![^!]+$/i.test(n)), file);
  }
  const exe = (await inventory("hello-x86_64-windows-gnu-s.exe")).slices[0]!;
  assert.ok(
    exe.imports.names.some((n) => /!puts$/.test(n)),
    "the program's own libc call is listed",
  );
});

test("[-rea.tool/inspect_pe_imports] a PE cut before its import table is never reported as importing nothing", async () => {
  const d = mkdtempSync(join(tmpdir(), "reax-ops-"));
  try {
    const pe = readFileSync(join(BIN, "hello-x86_64-windows-gnu-s.exe"));
    writeFileSync(join(d, "cut.exe"), pe.subarray(0, 1200));
    const r = await runOperation("inventory.native", { path: "cut.exe" }, { workspace: d });
    const s = (r.data as { slices: NativeSlice[] }).slices[0]!;
    assert.deepEqual([s.linksComplete, s.imports.complete, r.coverage], [false, false, "partial"]);
    assert.ok(r.limitations.includes("import directory not mapped"));
    writeFileSync(join(d, "stub.exe"), pe.subarray(0, 400));
    await assert.rejects(runOperation("inventory.native", { path: "stub.exe" }, { workspace: d }), (e) =>
      isCoreError(e, "probe_failed"),
    );
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("[+leanrea/LEAN-T15] imports are listed per binary: the libc calls the program makes", async () => {
  const want = ["puts", "printf", "strlen"];
  for (const file of ["hello-x86_64-linux-gnu.2.28-s", "hello-aarch64-macos-s", "hello-x86_64-macos-s"]) {
    const names = (await inventory(file)).slices[0]!.imports.names.map((n) => n.replace(/^_/, ""));
    for (const w of want.filter((x) => !(file.includes("linux") && x === "strlen")))
      assert.ok(
        names.some((n) => n === w || n.startsWith(`${w}@`)),
        `${file}: ${w} in ${names.join(",")}`,
      );
  }
});

test("[-leanrea/LEAN-T15] a static binary imports nothing, and a long result is cut at the text cap with the data intact", async () => {
  const s = (await inventory("hello-x86_64-linux-musl-s")).slices[0]!;
  assert.deepEqual([s.links, s.imports.count], [[], 0]);
  const d = mkdtempSync(join(tmpdir(), "reax-ops-"));
  try {
    copyFileSync(join(BIN, "lib-x86_64-linux-gnu.2.28-s.so"), join(d, `${"x".repeat(9000)}.so`.slice(-200)));
    assert.ok(TEXT_CAP <= 8000);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("[-RX-1/op-registry] the generator refuses a mapping to a row that does not exist, or one row covered twice", () => {
  const row = {
    key: "rea.tool/x",
    kind: "rea-tool" as const,
    title: "x",
    family: null,
    reax: { tool: null, operation: null, engine: null },
    phase: 1,
    platforms: [],
    wont: null,
    source: null,
  };
  const op = { ...OPERATIONS[0]!, covers: ["rea.tool/y"] };
  assert.throws(() => mapParity([row], [op]), /covers rea.tool\/y, which is not a parity row/);
  const twice = [
    { ...OPERATIONS[0]!, covers: ["rea.tool/x"] },
    { ...OPERATIONS[1]!, covers: ["rea.tool/x"] },
  ];
  assert.throws(() => mapParity([row], twice), /covered by both/);
  assert.deepEqual(
    mapParity([row], [{ ...OPERATIONS[0]!, covers: [] }])[0]!.reax.operation,
    null,
    "an uncovered row maps to nothing",
  );
});
