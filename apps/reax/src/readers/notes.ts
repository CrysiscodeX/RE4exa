// ELF notes: the note sections (or, without section headers, the PT_NOTE segments) and what the
// well-known ones say: the GNU build ID, ABI tag and property note (x86 IBT/SHSTK and ISA level,
// AArch64 BTI/PAC), the Go build ID, and FDO packaging metadata. Checked against llvm-readobj
// --notes (bench/oracle/notes.json).
import type { LayoutSlice } from "./layout.ts";

export interface Note {
  /** The section that holds it, or "PT_NOTE" for a segment-only file. */
  in: string;
  offset: number;
  owner: string;
  type: number;
  /** The type's name for this owner, or null when reax does not know it. */
  typeName: string | null;
  descSize: number;
  /** The first 256 bytes of the descriptor, as hex. */
  desc: string;
  buildId?: string;
  abi?: { os: string; version: string };
  properties?: { type: string; values: string[] }[];
  goBuildId?: string;
  packaging?: string;
}

const GNU_TYPES: Record<number, string> = {
  1: "NT_GNU_ABI_TAG",
  2: "NT_GNU_HWCAP",
  3: "NT_GNU_BUILD_ID",
  4: "NT_GNU_GOLD_VERSION",
  5: "NT_GNU_PROPERTY_TYPE_0",
};
const ABI_OS = ["Linux", "Hurd", "Solaris", "FreeBSD", "NetBSD", "Syllable", "NaCl"];
const X86_FEATURES: [number, string][] = [
  [1, "IBT"],
  [2, "SHSTK"],
];
const X86_ISA: [number, string][] = [
  [1, "x86-64-baseline"],
  [2, "x86-64-v2"],
  [4, "x86-64-v3"],
  [8, "x86-64-v4"],
];
const AARCH64_FEATURES: [number, string][] = [
  [1, "BTI"],
  [2, "PAC"],
  [4, "GCS"],
];

const bits = (v: number, names: [number, string][]) => names.filter(([b]) => (v & b) !== 0).map(([, n]) => n);

function properties(d: DataView, is64: boolean): { type: string; values: string[] }[] {
  const out: { type: string; values: string[] }[] = [];
  const align = is64 ? 8 : 4;
  let o = 0;
  while (o + 8 <= d.byteLength) {
    const type = d.getUint32(o, true);
    const size = d.getUint32(o + 4, true);
    const v = size >= 4 && o + 12 <= d.byteLength ? d.getUint32(o + 8, true) : 0;
    if (type === 0xc0000002) out.push({ type: "x86 feature", values: bits(v, X86_FEATURES) });
    else if (type === 0xc0008002) out.push({ type: "x86 ISA needed", values: bits(v, X86_ISA) });
    else if (type === 0xc0010001 || type === 0xc0008001) out.push({ type: "x86 ISA used", values: bits(v, X86_ISA) });
    else if (type === 0xc0000000) out.push({ type: "aarch64 feature", values: bits(v, AARCH64_FEATURES) });
    else out.push({ type: `0x${type.toString(16)}`, values: [] });
    o += 8 + Math.ceil(size / align) * align;
  }
  return out;
}

/** Notes in [start, start+size) of the file. */
function parse(b: Uint8Array, start: number, size: number, where: string, le: boolean, is64: boolean): Note[] {
  const d = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const out: Note[] = [];
  let o = start;
  const end = Math.min(b.length, start + size);
  while (o + 12 <= end) {
    const namesz = d.getUint32(o, le);
    const descsz = d.getUint32(o + 4, le);
    const type = d.getUint32(o + 8, le);
    const nameAt = o + 12;
    // the property note is 8-aligned in 64-bit files; other notes are 4-aligned
    const descAt = nameAt + Math.ceil(namesz / 4) * 4;
    if (descAt + descsz > end) break;
    let owner = "";
    for (let i = 0; i < namesz && b[nameAt + i] !== 0; i++) owner += String.fromCharCode(b[nameAt + i]!);
    const desc = b.subarray(descAt, descAt + descsz);
    const dd = new DataView(desc.buffer, desc.byteOffset, desc.byteLength);
    const note: Note = {
      in: where,
      offset: o,
      owner,
      type,
      typeName:
        owner === "GNU"
          ? (GNU_TYPES[type] ?? null)
          : owner === "Go" && type === 4
            ? "NT_GO_BUILD_ID"
            : owner === "FDO" && type === 0xcafe1a7e
              ? "NT_FDO_PACKAGING_METADATA"
              : null,
      descSize: descsz,
      desc: Buffer.from(desc.subarray(0, 256)).toString("hex"),
    };
    if (owner === "GNU" && type === 3) note.buildId = Buffer.from(desc).toString("hex");
    if (owner === "GNU" && type === 1 && descsz >= 16)
      note.abi = {
        os: ABI_OS[dd.getUint32(0, le)] ?? `os ${dd.getUint32(0, le)}`,
        version: `${dd.getUint32(4, le)}.${dd.getUint32(8, le)}.${dd.getUint32(12, le)}`,
      };
    if (owner === "GNU" && type === 5) note.properties = properties(dd, is64);
    if (owner === "Go" && type === 4) note.goBuildId = new TextDecoder().decode(desc);
    if (owner === "FDO" && type === 0xcafe1a7e) note.packaging = new TextDecoder().decode(desc).replace(/\0+$/, "");
    out.push(note);
    o =
      descAt +
      Math.ceil(descsz / (type === 5 && owner === "GNU" && is64 ? 8 : 4)) *
        (type === 5 && owner === "GNU" && is64 ? 8 : 4);
  }
  return out;
}

export function elfNotes(b: Uint8Array, s: LayoutSlice): Note[] {
  const le = b[5] !== 2;
  const is64 = b[4] === 2;
  const secs = s.sections.filter((x) => x.type === 7 && x.offset !== null);
  if (secs.length) return secs.flatMap((x) => parse(b, x.offset!, x.fileSize, x.name, le, is64));
  return s.segments
    .filter((g) => g.type === 4 && g.offset !== null)
    .flatMap((g) => parse(b, g.offset!, g.fileSize, "PT_NOTE", le, is64));
}
