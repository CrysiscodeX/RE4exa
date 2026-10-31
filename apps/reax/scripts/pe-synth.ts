// Minimal synthetic PE files for the load configuration checks: one .rdata section whose load
// configuration directory holds a distinct byte pattern in every field, so a wrong offset or width
// in a reader shows. Not runnable programs; they exist so llvm-readobj and reax read the same bytes.
export interface SynthPe {
  name: string;
  plus: boolean;
  /** The load configuration's own Size field. */
  size: number;
  /** All known guard flags and a stride of 5 in bits 28-31. */
  guardFlags: number;
  dllCharacteristics: number;
}

export const SYNTH: SynthPe[] = [
  { name: "synth-pe32plus-full", plus: true, size: 0x118, guardFlags: 0x5001ff00, dllCharacteristics: 0xc1e0 },
  { name: "synth-pe32-full", plus: false, size: 0xac, guardFlags: 0x5001ff00, dllCharacteristics: 0x4140 },
  { name: "synth-pe32-short", plus: false, size: 0x5c, guardFlags: 0x00000500, dllCharacteristics: 0x0540 },
];

const SECTION_RVA = 0x1000;
const RAW = 0x200;

export function buildSynth(c: SynthPe): Buffer {
  const b = Buffer.alloc(RAW + 0x400);
  b.write("MZ", 0, "latin1");
  b.writeUInt32LE(0x80, 0x3c);
  b.write("PE\0\0", 0x80, "latin1");
  const coff = 0x84;
  b.writeUInt16LE(c.plus ? 0x8664 : 0x14c, coff);
  b.writeUInt16LE(1, coff + 2);
  b.writeUInt16LE(c.plus ? 240 : 224, coff + 16);
  b.writeUInt16LE(c.plus ? 0x2022 : 0x2102, coff + 18);
  const opt = coff + 20;
  b.writeUInt16LE(c.plus ? 0x20b : 0x10b, opt);
  b.writeUInt8(14, opt + 2);
  b.writeUInt32LE(SECTION_RVA, opt + 16); // entry point
  b.writeUInt32LE(SECTION_RVA, opt + 20); // base of code
  let p = opt + 24;
  if (c.plus) {
    b.writeBigUInt64LE(0x140000000n, p);
    p += 8;
  } else {
    b.writeUInt32LE(SECTION_RVA, p); // base of data
    b.writeUInt32LE(0x400000, p + 4);
    p += 8;
  }
  b.writeUInt32LE(0x1000, p); // section alignment
  b.writeUInt32LE(0x200, p + 4); // file alignment
  b.writeUInt16LE(6, p + 8); // OS version
  b.writeUInt16LE(6, p + 16); // subsystem version
  b.writeUInt32LE(0x2000, p + 24); // size of image
  b.writeUInt32LE(RAW, p + 28); // size of headers
  b.writeUInt16LE(3, p + 36); // subsystem: console
  b.writeUInt16LE(c.dllCharacteristics, p + 38);
  p += 40;
  p += c.plus ? 32 : 16; // stack and heap reserve and commit
  p += 4; // loader flags
  b.writeUInt32LE(16, p); // number of data directories
  const dirs = p + 4;
  b.writeUInt32LE(SECTION_RVA, dirs + 10 * 8);
  b.writeUInt32LE(c.size, dirs + 10 * 8 + 4);
  const sec = dirs + 16 * 8;
  b.write(".rdata", sec, "latin1");
  b.writeUInt32LE(0x400, sec + 8); // virtual size
  b.writeUInt32LE(SECTION_RVA, sec + 12);
  b.writeUInt32LE(0x400, sec + 16); // raw size
  b.writeUInt32LE(RAW, sec + 20);
  b.writeUInt32LE(0x40000040, sec + 36);
  // a different byte in every position of the configuration, then the fields that need real values
  for (let i = 0; i < c.size; i++) b[RAW + i] = (i * 37 + 11) & 0xff;
  const pw = c.plus ? 8 : 4;
  const base = c.plus ? 0x140000000n : 0x400000n;
  const put = (off: number, v: bigint, w: number) => {
    if (off + w > c.size) return;
    if (w === 8) b.writeBigUInt64LE(v, RAW + off);
    else b.writeUInt32LE(Number(v), RAW + off);
  };
  // llvm-readobj follows the table pointers: each points into a zeroed area of the section, at a
  // different address, and its count is a small different number
  const tables: [number, number, number, number][] = [
    [0x40, 0x60, 0x44, 0x68], // SEHandlerTable, SEHandlerCount
    [0x50, 0x80, 0x54, 0x88], // GuardCFFunctionTable, GuardCFFunctionCount
    [0x68, 0xa0, 0x6c, 0xa8], // GuardAddressTakenIatEntryTable and its count
    [0x70, 0xb0, 0x74, 0xb8], // GuardLongJumpTargetTable and its count
    [0xa4, 0x108, 0xa8, 0x110], // GuardEHContinuationTable and its count
  ];
  b.fill(0, RAW + 0x300, RAW + 0x400);
  tables.forEach(([t32, t64, c32, c64], k) => {
    put(c.plus ? t64 : t32, base + BigInt(SECTION_RVA + 0x300 + 0x10 * (k + 1)), pw);
    put(c.plus ? c64 : c32, BigInt(k + 1), pw);
  });
  for (const [o32, o64, w] of [
    [0x78, 0xc0, pw], // DynamicValueRelocTable
    [0x7c, 0xc8, pw], // CHPEMetadataPointer
    [0x88, 0xe0, 4], // DynamicValueRelocTableOffset
    [0x8c, 0xe4, 4], // its section (and the reserved word after it)
  ] as [number, number, number][])
    put(c.plus ? o64 : o32, 0n, w);
  put(c.plus ? 0x100 : 0xa0, base + BigInt(SECTION_RVA + 0x380), pw); // VolatileMetadataPointer
  put(c.plus ? 0xf8 : 0x9c, base + BigInt(SECTION_RVA + 0x390), pw); // EnclaveConfigurationPointer
  b.writeUInt32LE(c.size, RAW);
  b.writeUInt32LE(c.guardFlags, RAW + (c.plus ? 0x90 : 0x58));
  return b;
}
