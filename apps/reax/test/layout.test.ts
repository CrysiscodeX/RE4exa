// inventory.segments, read.address and read.entropy against answer keys from independent tools
// (bench/oracle/layout.json from llvm-readobj 18, bench/oracle/entropy.json from Python), written
// by scripts/oracle.ts and re-derived in CI's fixtures job.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { isCoreError } from "@re4exa/core/errors";
import { runOperation } from "../src/ops/registry.ts";
import type { LayoutSlice, Region } from "../src/readers/layout.ts";

const REAX = join(import.meta.dirname, "..");
const BIN = join(REAX, "fixtures", "bin");
type Rec = Record<string, string | number>;
const LAYOUT = JSON.parse(readFileSync(join(REAX, "bench", "oracle", "layout.json"), "utf8")).files as Record<
  string,
  { format: string; bases: number[]; slices: { arch: string; sections: Rec[]; segments: Rec[] }[] }
>;
const ENTROPY = JSON.parse(readFileSync(join(REAX, "bench", "oracle", "entropy.json"), "utf8")).files as Record<
  string,
  { size: number; entropy: number; blocks: number[]; sections: [string, number][][] }
>;
const ctx = { workspace: BIN };
const refused = (e: unknown) => isCoreError(e) && e.code === "bad_request";

const segs = async (path: string, workspace = BIN) =>
  (await runOperation("inventory.segments", { path }, { workspace })) as {
    data: { format: string; slices: LayoutSlice[] };
    coverage: string;
    limitations: string[];
  };

const prot = (p: number) => `${p & 1 ? "r" : "-"}${p & 2 ? "w" : "-"}${p & 4 ? "x" : "-"}`;

/** reax's regions in the shape of llvm-readobj's fields, for one format. A region with no bytes in
 * the file has offset null in reax, so the key's offset is not compared for it. */
function asKey(format: string, s: LayoutSlice, base: number): { sections: Rec[]; segments: Rec[] } {
  const sec = (g: Region): Rec => {
    switch (format) {
      case "elf":
        return { name: g.name, type: g.type, flags: g.flags, addr: g.addr!, offset: g.offset ?? -1, size: g.size };
      case "pe":
        return {
          name: g.name,
          rva: `0x${(BigInt(g.addr!) - BigInt(s.imageBase!)).toString(16)}`,
          vsize: g.size,
          rawSize: g.fileSize,
          rawPtr: g.offset ?? -1,
          flags: g.flags,
        };
      case "wasm":
        return { type: g.type, size: g.size, offset: g.offset!, ...(g.type === 0 ? { name: g.name } : {}) };
      default:
        return {
          name: g.name,
          segment: g.segment!,
          addr: g.addr!,
          size: g.size,
          offset: g.offset === null ? -1 : g.offset - base,
          type: g.type,
          attributes: g.flags,
        };
    }
  };
  const seg = (g: Region): Rec =>
    format === "elf"
      ? { type: g.type, offset: g.offset ?? -1, addr: g.addr!, fileSize: g.fileSize, size: g.size, flags: g.flags }
      : {
          name: g.name,
          addr: g.addr!,
          size: g.size,
          fileoff: g.offset === null ? -1 : g.offset - base,
          filesize: g.fileSize,
          maxprot: prot(g.type),
          initprot: g.perms!,
        };
  return { sections: s.sections.map(sec), segments: s.segments.map(seg) };
}

/** The key with the offsets reax reports as null (no bytes in the file) set to -1 too. */
function keyed(format: string, k: { sections: Rec[]; segments: Rec[] }): { sections: Rec[]; segments: Rec[] } {
  const sections = k.sections.map((r) => {
    if (format === "elf" && r.type === 8) return { ...r, offset: -1 };
    if (format === "pe" && r.rawSize === 0) return { ...r, rawPtr: -1 };
    if ((format === "macho" || format === "macho-fat") && [1, 12, 18].includes(Number(r.type)))
      return { ...r, offset: -1 };
    return r;
  });
  const segments = k.segments.map((r) => {
    if (format === "elf" && r.fileSize === 0) return { ...r, offset: -1 };
    if ((format === "macho" || format === "macho-fat") && r.filesize === 0) return { ...r, fileoff: -1 };
    return r;
  });
  return { sections, segments };
}

test("[+rea.tool/list_segments] [+rea.tool/inspect_binary_layout] every slice's sections and segments equal llvm-readobj's, for ELF, PE, Mach-O (thin and universal) and wasm", async () => {
  let regions = 0;
  for (const [file, key] of Object.entries(LAYOUT)) {
    const r = await segs(file);
    assert.equal(r.data.format, key.format, file);
    assert.equal(r.data.slices.length, key.slices.length, `${file}: slices`);
    for (const [i, s] of r.data.slices.entries()) {
      const k = key.slices[i]!;
      assert.equal(s.arch, k.arch, `${file}: arch`);
      assert.equal(s.base, key.bases[i] ?? 0, `${file}: slice base`);
      const got = asKey(key.format, s, s.base);
      const want = keyed(key.format, k);
      assert.deepStrictEqual(got.sections, want.sections, `${file} ${s.arch}: sections`);
      assert.deepStrictEqual(got.segments, want.segments, `${file} ${s.arch}: segments`);
      regions += got.sections.length + got.segments.length;
    }
    assert.equal(r.coverage, "complete", `${file}: ${r.limitations.join("; ")}`);
  }
  assert.equal(Object.keys(LAYOUT).length, 17);
  assert.ok(regions > 300, `${regions} regions compared`);
});

test("[-rea.tool/list_segments] [-rea.tool/inspect_binary_layout] a file that is not a binary is refused; a cut section table is reported, not hidden", async () => {
  const dir = mkdtempSync(join(tmpdir(), "reax-layout-"));
  try {
    writeFileSync(join(dir, "notes.txt"), "just text\n");
    await assert.rejects(runOperation("inventory.segments", { path: "notes.txt" }, { workspace: dir }), refused);
    await assert.rejects(runOperation("inventory.segments", { path: "." }, ctx), refused);
    // keep the headers and four section headers, cut the rest
    const elf = readFileSync(join(BIN, "lib-x86_64-linux-gnu.2.28-s.so"));
    const shoff = Number(elf.readBigUInt64LE(40));
    writeFileSync(join(dir, "cut.so"), elf.subarray(0, shoff + 4 * 64 + 10));
    const r = await segs("cut.so", dir);
    assert.equal(r.coverage, "partial");
    assert.match(r.limitations.join(" "), /section table is cut after 4 of 17/);
    assert.equal(r.data.slices[0]!.sections.length, 4);
    assert.equal(r.data.slices[0]!.segments.length, 9, "the program headers are whole");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("[+rea.tool/address_to_file_offset] each section's start address maps to its file offset and back, as llvm-readobj places them", async () => {
  let checked = 0;
  for (const [file, key] of Object.entries(LAYOUT)) {
    if (key.format === "wasm") continue;
    const inv = await segs(file);
    for (const [i, s] of inv.data.slices.entries()) {
      for (const [j, g] of s.sections.entries()) {
        // allocated sections with bytes in the file: ELF SHF_ALLOC, every PE and Mach-O section
        if (g.offset === null || g.fileSize === 0 || g.addr === null) continue;
        if (key.format === "elf" && (g.flags & 2) === 0) continue;
        const k = key.slices[i]!.sections[j]!;
        const wantOffset =
          key.format === "elf"
            ? Number(k.offset)
            : key.format === "pe"
              ? Number(k.rawPtr)
              : key.bases[i]! + Number(k.offset);
        const there = (await runOperation("read.address", { path: file, address: g.addr, arch: s.arch }, ctx)).data as {
          offset: number;
          section: string;
        };
        assert.equal(there.offset, wantOffset, `${file} ${s.arch} ${g.name}`);
        const back = (await runOperation("read.address", { path: file, offset: wantOffset, arch: s.arch }, ctx))
          .data as {
          address: string;
        };
        assert.equal(back.address, g.addr, `${file} ${s.arch} ${g.name} back`);
        checked++;
      }
    }
  }
  assert.ok(checked > 150, `${checked} sections mapped`);
});

test("[-rea.tool/address_to_file_offset] memory-only and unmapped addresses say why; wasm, bad input and unknown slices are refused", async () => {
  const so = "lib-x86_64-linux-gnu.2.28-s.so";
  // the last PT_LOAD holds 216 bytes in the file and 2736 in memory: its tail is .bss
  const bss = (await runOperation("read.address", { path: so, address: "0x2650" }, ctx)).data as {
    offset: number | null;
    why: string;
  };
  assert.equal(bss.offset, null);
  assert.match(bss.why, /only in memory/);
  const none = (await runOperation("read.address", { path: so, address: "0x7fffffff0000" }, ctx)).data as {
    offset: null;
    why: string;
  };
  assert.match(none.why, /no segment loads/);
  for (const bad of [
    { path: so },
    { path: so, address: "0x10", offset: 1 },
    { path: so, address: "zz" },
    { path: so, address: "0x10", arch: "mips" },
    { path: "lib-wasm32-freestanding-s.wasm", offset: 10 },
  ])
    await assert.rejects(runOperation("read.address", bad, ctx), refused, JSON.stringify(bad));
});

test("[+rea.tool/inspect_byte_entropy] whole-file, per-block and per-section entropy equal Python's on every fixture", async () => {
  let n = 0;
  for (const [file, key] of Object.entries(ENTROPY)) {
    const all: number[] = [];
    let offset: number | null = 0;
    let d!: { size: number; entropy: number; sections: { entropy: number }[] };
    while (offset !== null) {
      const r = await runOperation("read.entropy", { path: file, offset, limit: 1000 }, ctx);
      d = r.data as typeof d & { items: { entropy: number }[]; page: { next: number | null } };
      all.push(...(r.data as { items: { entropy: number }[] }).items.map((b) => b.entropy));
      offset = (r.data as { page: { next: number | null } }).page.next;
    }
    assert.equal(d.size, key.size, file);
    assert.ok(Math.abs(d.entropy - key.entropy) < 1e-6, `${file}: ${d.entropy} vs ${key.entropy}`);
    assert.equal(all.length, key.blocks.length, `${file}: blocks`);
    for (const [i, h] of all.entries()) assert.ok(Math.abs(h - key.blocks[i]!) < 1e-6, `${file} block ${i}`);
    const want = key.sections.flat().map(([, h]) => h);
    assert.equal(d.sections.length, want.length, `${file}: sections`);
    for (const [i, s] of d.sections.entries()) assert.ok(Math.abs(s.entropy - want[i]!) < 1e-6, `${file} section ${i}`);
    n += all.length + want.length;
  }
  assert.ok(n > 300, `${n} values compared`);
});

test("[-rea.tool/inspect_byte_entropy] an empty file has entropy 0 and no blocks; a block size out of range is refused", async () => {
  const dir = mkdtempSync(join(tmpdir(), "reax-entropy-"));
  try {
    writeFileSync(join(dir, "empty"), "");
    writeFileSync(join(dir, "same"), Buffer.alloc(10_000, 0x41));
    const e = (await runOperation("read.entropy", { path: "empty" }, { workspace: dir })).data as {
      entropy: number;
      page: { total: number };
    };
    assert.equal(e.entropy, 0);
    assert.equal(e.page.total, 0);
    const s = (await runOperation("read.entropy", { path: "same" }, { workspace: dir })).data as { entropy: number };
    assert.equal(s.entropy, 0, "one repeated byte carries no information");
    for (const block of [255, (1 << 20) + 1])
      await assert.rejects(runOperation("read.entropy", { path: "same", block }, { workspace: dir }), refused);
    const rnd = Buffer.alloc(1 << 16);
    for (let i = 0; i < rnd.length; i++) rnd[i] = (i * 2654435761) >>> 24;
    writeFileSync(join(dir, "mixed"), rnd);
    const m = (await runOperation("read.entropy", { path: "mixed" }, { workspace: dir })).data as {
      entropy: number;
    };
    assert.ok(m.entropy > 7.9 && m.entropy <= 8, `${m.entropy}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
