import assert from "node:assert/strict";
import { test } from "node:test";
import { isCoreError } from "../src/errors.ts";
import { findingKey } from "../src/evidence/record.ts";
import { elfInfo, parseElf } from "../src/probes/builtin/elf.ts";
import { machoInfo, parseMachO } from "../src/probes/builtin/macho.ts";
import { parsePe, peInfo } from "../src/probes/builtin/pe.ts";
import { parseWasm, wasmInfo } from "../src/probes/builtin/wasm.ts";
import { makeElf64, makeFat, makeMachO, makePe64, makeWasm } from "../src/testing/gen.ts";
import { runOn } from "../src/testing/harness.ts";

test("elf.info: class, machine, type, interpreter, NEEDED, SONAME, RUNPATH, dynamic symbols", async () => {
  const b = makeElf64({
    needed: ["libssl.so.3", "libc.so.6"],
    soname: "libx.so.1",
    runpath: "$ORIGIN/lib",
    exports: ["a_fn", "b_fn"],
    imports: ["puts", "malloc"],
  });
  const i = parseElf(b);
  assert.equal(i.bits, 64);
  assert.equal(i.endian, "little");
  assert.equal(i.machine, "x86-64");
  assert.equal(i.type, "pie");
  assert.equal(i.interpreter, "/lib64/ld-linux-x86-64.so.2");
  assert.deepEqual(i.needed, ["libssl.so.3", "libc.so.6"]);
  assert.equal(i.soname, "libx.so.1");
  assert.equal(i.runpath, "$ORIGIN/lib");
  assert.deepEqual(i.exports, { count: 2, first: ["a_fn", "b_fn"] });
  assert.deepEqual(i.imports, { count: 2, first: ["puts", "malloc"] });
  assert.ok(i.sections.includes(".dynamic"));
  const out = await runOn(elfInfo, b, "x.so");
  assert.deepEqual(
    out.findings?.map((f) => f.key),
    ["libc.so.6", "libssl.so.3"].map((lib) => findingKey("native.lib", { lib })),
  );
  assert.equal(out.findings?.[0]?.class, "native.lib");
});

test("elf.info: shared object without interpreter, Go and Rust section markers", () => {
  const so = parseElf(makeElf64({ needed: ["libuv.so.1"], interp: null }));
  assert.equal(so.type, "dyn");
  assert.equal(so.interpreter, null);
  const go = parseElf(makeElf64({ extraSections: [".go.buildinfo", ".dep-v0"] }));
  assert.deepEqual(go.markers, ["go-buildinfo", "rust-cargo-auditable"]);
});

test("elf.info: header-only and garbage input fail with probe_failed, never a raw error", () => {
  const b = makeElf64();
  for (const cut of [4, 16, 40, 63, 64, 200]) {
    try {
      parseElf(b.subarray(0, cut));
    } catch (e) {
      assert.ok(isCoreError(e, "probe_failed"), `cut ${cut}: ${e}`);
    }
  }
  assert.throws(
    () => parseElf(new Uint8Array(10)),
    (e) => isCoreError(e, "probe_failed"),
  );
});

test("pe.info: machine, subsystem, timestamp, imports with functions, exports, kind", async () => {
  const exe = parsePe(
    makePe64({
      imports: { "KERNEL32.dll": ["CreateFileW", "ReadFile"], "WS2_32.dll": ["connect"] },
      timestamp: 0x60000000,
      subsystem: 2,
    }),
  );
  assert.equal(exe.machine, "amd64");
  assert.equal(exe.bits, 64);
  assert.equal(exe.kind, "exe");
  assert.equal(exe.subsystem, "windows-gui");
  assert.equal(exe.timestamp, 0x60000000);
  assert.equal(exe.timestampIso, "2021-01-14T08:25:36.000Z");
  assert.deepEqual(exe.imports, [
    { dll: "KERNEL32.dll", functions: ["CreateFileW", "ReadFile"] },
    { dll: "WS2_32.dll", functions: ["connect"] },
  ]);
  assert.deepEqual(exe.sections, [".text", ".idata"]);
  const dll = parsePe(makePe64({ dll: true, exports: ["Zed", "Alpha"], dllName: "x.dll", clr: true }));
  assert.equal(dll.kind, "dll");
  assert.deepEqual(dll.exports, { dll: "x.dll", count: 2, names: ["Alpha", "Zed"] });
  assert.deepEqual(dll.markers, ["dotnet-clr"]);
  const out = await runOn(peInfo, makePe64({ imports: { "ADVAPI32.dll": ["RegOpenKeyW"] } }), "a.exe");
  assert.deepEqual(out.findings?.[0], {
    key: findingKey("native.lib", { lib: "advapi32.dll" }),
    class: "native.lib",
    label: "advapi32.dll",
  });
});

test("pe.info: a bad optional header magic or a missing PE signature is probe_failed", () => {
  const b = makePe64();
  const bad = Uint8Array.from(b);
  bad[0x58] = 0x99;
  assert.throws(
    () => parsePe(bad),
    (e) => isCoreError(e, "probe_failed"),
  );
  const nosig = Uint8Array.from(b);
  nosig[0x40] = 0;
  assert.throws(
    () => parsePe(nosig),
    (e) => isCoreError(e, "probe_failed"),
  );
});

test("macho.info: thin 64-bit with dylibs, weak dylib, rpath, id, code signature, build version", async () => {
  const b = makeMachO({
    dylibs: ["/usr/lib/libSystem.B.dylib", "@rpath/libfoo.dylib"],
    weak: ["/usr/lib/libweak.dylib"],
    rpaths: ["@executable_path/../Frameworks"],
    id: "@rpath/libself.dylib",
    codeSignature: true,
    sections: ["__text", "__go_buildinfo"],
  });
  const m = parseMachO(b);
  assert.equal(m.fat, false);
  const s = m.slices[0]!;
  assert.equal(s.cpu, "x86_64");
  assert.equal(s.filetype, "dylib");
  assert.equal(s.id, "@rpath/libself.dylib");
  assert.deepEqual(
    s.dylibs.map((d) => [d.name, d.kind]),
    [
      ["/usr/lib/libSystem.B.dylib", "load"],
      ["@rpath/libfoo.dylib", "load"],
      ["/usr/lib/libweak.dylib", "weak"],
    ],
  );
  assert.equal(s.dylibs[0]!.current, "1300.0.0");
  assert.deepEqual(s.rpaths, ["@executable_path/../Frameworks"]);
  assert.equal(s.codeSignature, true);
  assert.equal(s.platform, "macos");
  assert.equal(s.minOs, "11.0.0");
  assert.deepEqual(s.markers, ["go-buildinfo"]);
  const out = await runOn(machoInfo, b, "lib.dylib");
  assert.equal(out.findings?.length, 3);
});

test("macho.info: 32-bit and big-endian thin files, and fat binaries with per-slice errors", () => {
  for (const [bits, le, cpu] of [
    [32, true, "x86"],
    [32, false, "ppc"],
    [64, false, "x86_64"],
  ] as const) {
    const s = parseMachO(makeMachO({ bits, le, cpu, dylibs: ["/usr/lib/libc.dylib"] })).slices[0]!;
    assert.equal(s.bits, bits);
    assert.equal(s.endian, le ? "little" : "big");
    assert.equal(s.cpu, cpu);
    assert.deepEqual(
      s.dylibs.map((d) => d.name),
      ["/usr/lib/libc.dylib"],
    );
  }
  const a = makeMachO({ dylibs: ["/usr/lib/libA.dylib"] });
  const b = makeMachO({ cpu: "arm64", dylibs: ["/usr/lib/libB.dylib"] });
  const fat = makeFat([
    { cpu: "x86_64", bytes: a },
    { cpu: "arm64", bytes: b },
  ]);
  const m = parseMachO(fat);
  assert.equal(m.fat, true);
  assert.deepEqual(
    m.slices.map((s) => [s.cpu, s.dylibs[0]?.name]),
    [
      ["x86_64", "/usr/lib/libA.dylib"],
      ["arm64", "/usr/lib/libB.dylib"],
    ],
  );
  // corrupt the second slice's magic: the first still parses, the second reports an error
  const broken = Uint8Array.from(fat);
  const off = new DataView(broken.buffer).getUint32(8 + 20 + 8, false);
  broken[off] = 0;
  const mb = parseMachO(broken);
  assert.equal(mb.slices[0]!.error, undefined);
  assert.match(mb.slices[1]!.error ?? "", /not a Mach-O/);
});

test("wasm.info: sections, imports and exports; components and bad sections are probe_failed", async () => {
  const w = parseWasm(
    makeWasm({
      imports: [
        { module: "env", name: "log" },
        { module: "wasi_snapshot_preview1", name: "fd_write" },
      ],
      exports: ["run", "init"],
    }),
  );
  assert.equal(w.version, 1);
  assert.deepEqual(w.imports, [
    { module: "env", name: "log", kind: "func" },
    { module: "wasi_snapshot_preview1", name: "fd_write", kind: "func" },
  ]);
  assert.deepEqual(w.exports, [
    { name: "run", kind: "func" },
    { name: "init", kind: "func" },
    { name: "memory", kind: "memory" },
  ]);
  assert.deepEqual(w.customSections, ["producers"]);
  assert.deepEqual(
    w.sections.map((s) => s.name),
    ["type", "import", "function", "memory", "export", "code", "custom"],
  );
  const out = await runOn(wasmInfo, makeWasm(), "m.wasm");
  assert.equal(out.findings?.[0]?.class, "wasm.import");
  const comp = Uint8Array.from([0, 0x61, 0x73, 0x6d, 0x0d, 0, 1, 0]);
  assert.throws(
    () => parseWasm(comp),
    (e) => isCoreError(e, "probe_failed"),
  );
  const trunc = makeWasm().subarray(0, 20);
  assert.throws(
    () => parseWasm(trunc),
    (e) => isCoreError(e, "probe_failed"),
  );
});
