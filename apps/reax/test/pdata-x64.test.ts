// The x64 .pdata walk stops at the bytes of the section that holds the table. The oracle is the
// crafted file's own construction: the expected procedures are computed from the builder's
// parameters below, never by calling reax code.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runOperation } from "../src/ops/registry.ts";

// biome-ignore lint/suspicious/noExplicitAny: operation data is JSON
type Any = any;

const BASE = 0x140000000n;
const TEXT_RAW = 0x400;
const PDATA_RAW = 0x600;

interface PdataOpts {
  /** Valid entries in .pdata's raw bytes. */
  n: number;
  /** Decoy entries at the start of .rdata, right after .pdata's raw bytes in the file. */
  decoys: number;
  /** .pdata's SizeOfRawData. */
  raw: number;
  /** Data directory 3's size. */
  dirSize: number;
}

/** A PE32+ x64 file with .text, .pdata and .rdata; .rdata's raw data follows .pdata's raw bytes. */
function buildPdataX64(o: PdataOpts): Buffer {
  const rdataRaw = PDATA_RAW + o.raw;
  const rdataSize = Math.max(0x200, 12 * o.decoys);
  const b = Buffer.alloc(rdataRaw + rdataSize);
  b.write("MZ", 0, "latin1");
  b.writeUInt32LE(0x80, 0x3c);
  b.write("PE\0\0", 0x80, "latin1");
  const coff = 0x84;
  b.writeUInt16LE(0x8664, coff);
  b.writeUInt16LE(3, coff + 2); // sections
  b.writeUInt16LE(240, coff + 16); // optional header size
  b.writeUInt16LE(0x0022, coff + 18);
  const opt = coff + 20;
  b.writeUInt16LE(0x20b, opt);
  b.writeUInt8(14, opt + 2);
  b.writeUInt32LE(0x1000, opt + 16); // entry point
  b.writeUInt32LE(0x1000, opt + 20); // base of code
  b.writeBigUInt64LE(BASE, opt + 24);
  const p = opt + 32;
  b.writeUInt32LE(0x1000, p); // section alignment
  b.writeUInt32LE(0x200, p + 4); // file alignment
  b.writeUInt16LE(6, p + 8);
  b.writeUInt16LE(6, p + 16);
  b.writeUInt32LE(0x4000, p + 24); // size of image
  b.writeUInt32LE(TEXT_RAW, p + 28); // size of headers
  b.writeUInt16LE(3, p + 36); // console
  b.writeUInt16LE(0x8160, p + 38);
  const ndirs = p + 40 + 32 + 4;
  b.writeUInt32LE(16, ndirs);
  const dirs = ndirs + 4;
  b.writeUInt32LE(0x2000, dirs + 3 * 8);
  b.writeUInt32LE(o.dirSize, dirs + 3 * 8 + 4);
  const sec = (i: number, name: string, vsize: number, rva: number, rawSize: number, rawPtr: number, ch: number) => {
    const h = dirs + 16 * 8 + i * 40;
    b.write(name, h, "latin1");
    b.writeUInt32LE(vsize, h + 8);
    b.writeUInt32LE(rva, h + 12);
    b.writeUInt32LE(rawSize, h + 16);
    b.writeUInt32LE(rawPtr, h + 20);
    b.writeUInt32LE(ch, h + 36);
  };
  sec(0, ".text", 0x200, 0x1000, 0x200, TEXT_RAW, 0x60000020);
  sec(1, ".pdata", Math.max(o.raw, o.dirSize), 0x2000, o.raw, PDATA_RAW, 0x40000040);
  sec(2, ".rdata", rdataSize, 0x3000, rdataSize, rdataRaw, 0x40000040);
  b.fill(0xc3, TEXT_RAW, TEXT_RAW + 0x200);
  for (let i = 0; i < o.n; i++) {
    b.writeUInt32LE(0x1000 + 0x10 * i, PDATA_RAW + 12 * i);
    b.writeUInt32LE(0x1000 + 0x10 * i + 8, PDATA_RAW + 12 * i + 4);
    b.writeUInt32LE(0, PDATA_RAW + 12 * i + 8);
  }
  // .pdata bytes past the valid entries but inside the section: 0xAB, so a straddling entry shows
  b.fill(0xab, PDATA_RAW + 12 * o.n, rdataRaw);
  for (let k = 0; k < o.decoys; k++) {
    b.writeUInt32LE(0xdead0000 + 0x10 * k, rdataRaw + 12 * k);
    b.writeUInt32LE(0xdead0000 + 0x10 * k + 8, rdataRaw + 12 * k + 4);
  }
  return b;
}

/** The procedures the construction puts in .pdata: the first `count` entries. */
const expected = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    addr: `0x${(BASE + 0x1000n + 0x10n * BigInt(i)).toString(16)}`,
    size: 8,
  }));

async function procedures(b: Buffer) {
  const ws = mkdtempSync(join(tmpdir(), "reax-pdata-"));
  try {
    writeFileSync(join(ws, "crafted.exe"), b);
    const r = await runOperation(
      "inventory.procedures",
      { path: "crafted.exe", offset: 0, limit: 1000 },
      { workspace: ws },
    );
    const d = r.data as Any;
    assert.equal(d.page.next, null);
    return {
      items: (d.items as Any[]).map((x) => ({ addr: x.addr as string, size: x.size as number, sources: x.sources })),
      notes: r.limitations.filter((x) => /x64 \.pdata/.test(x)),
      coverage: r.coverage,
    };
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
}

const N = 5;
const D = 3;
const overrun = (listed: number, n: number) =>
  `the x64 .pdata directory (${listed} entries) runs past its section's bytes in the file; ${n} entries read, the rest could not be`;
const noDecoy = (items: { addr: string }[]) =>
  assert.ok(
    items.every((x) => BigInt(x.addr) < BASE + 0xdead0000n),
    "no address from the decoys",
  );

test("[+rea.tool/list_procedures] an x64 .pdata table inside its section gives exactly its entries, with no overrun note", async () => {
  const r = await procedures(buildPdataX64({ n: N, decoys: D, raw: 0x200, dirSize: 12 * N }));
  assert.deepEqual(
    r.items.map(({ addr, size }) => ({ addr, size })),
    expected(N),
  );
  assert.ok(r.items.every((x) => x.sources.length === 1 && x.sources[0] === "pdata"));
  assert.deepEqual(r.notes, []);
});

test("[-rea.tool/list_procedures] an x64 .pdata directory longer than its section stops at the section's bytes, and says so", async () => {
  // aligned: the section ends exactly after the N entries; the directory lists N + D
  const a = await procedures(buildPdataX64({ n: N, decoys: D, raw: 12 * N, dirSize: 12 * (N + D) }));
  assert.deepEqual(
    a.items.map(({ addr, size }) => ({ addr, size })),
    expected(N),
  );
  noDecoy(a.items);
  assert.deepEqual(a.notes, [overrun(N + D, N)]);
  assert.equal(a.coverage, "partial");
  // unaligned: 3 more section bytes (0xAB) that do not make a whole entry are not read as one
  const u = await procedures(buildPdataX64({ n: N, decoys: D, raw: 12 * N + 3, dirSize: 12 * (N + D) }));
  assert.deepEqual(
    u.items.map(({ addr, size }) => ({ addr, size })),
    expected(N),
  );
  noDecoy(u.items);
  assert.ok(
    u.items.every((x) => (BigInt(x.addr) & 0xffffffn) !== 0xabababn),
    "no address from the straddling bytes",
  );
  assert.deepEqual(u.notes, [overrun(N + D, N)]);
  assert.equal(u.coverage, "partial");
});

test("[-rea.tool/list_procedures] an x64 .pdata section whose raw size runs past the end of the file is cut there, and says so", async () => {
  // the section and the directory agree on N entries; the file ends 5 bytes into entry K
  const K = 3;
  const full = buildPdataX64({ n: N, decoys: D, raw: 12 * N, dirSize: 12 * N });
  const r = await procedures(full.subarray(0, PDATA_RAW + 12 * K + 5));
  assert.deepEqual(
    r.items.map(({ addr, size }) => ({ addr, size })),
    expected(K),
  );
  assert.deepEqual(r.notes, [`the x64 .pdata table is cut by the end of the file after ${K} of ${N} entries`]);
  assert.equal(r.coverage, "partial");
});
