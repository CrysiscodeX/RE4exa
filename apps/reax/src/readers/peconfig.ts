// PE load configuration: the IMAGE_LOAD_CONFIG_DIRECTORY (security cookie, SafeSEH and Control
// Flow Guard tables, guard flags, enclave and volatile-metadata pointers) and the header
// mitigation bits (ASLR, DEP, high-entropy VA, integrity checking). Checked against
// llvm-readobj --coff-load-config and --file-headers (bench/corpus/loadconfig.facts.json).
import type { LayoutSlice } from "./layout.ts";

export interface LoadConfig {
  /** The structure's own Size field: which Windows version's layout the linker wrote. */
  size: number;
  timeDateStamp: number;
  version: string;
  globalFlagsClear: number;
  globalFlagsSet: number;
  /** Pointers are virtual addresses (image base included), as the file stores them. */
  fields: Record<string, string>;
  seHandlerCount: number;
  guardCFFunctionCount: number;
  guardFlags: string[];
  /** The guard flags as the file stores them, unknown bits included. */
  guardFlagsRaw: number;
  /** Bits 28-31 of the guard flags: the stride of the CF function table's extra bytes. */
  guardCFFunctionStride: number;
}

export interface PeMitigations {
  dllCharacteristics: string[];
  aslr: boolean;
  highEntropyVa: boolean;
  dep: boolean;
  controlFlowGuard: boolean;
  safeSeh: boolean | null;
  noSeh: boolean;
  forceIntegrity: boolean;
  appContainer: boolean;
}

export interface PeSecurity {
  mitigations: PeMitigations;
  /** null when the image has no load configuration directory. */
  loadConfig: LoadConfig | null;
  notes: string[];
}

const DLL_CHARACTERISTICS: [number, string][] = [
  [0x20, "HIGH_ENTROPY_VA"],
  [0x40, "DYNAMIC_BASE"],
  [0x80, "FORCE_INTEGRITY"],
  [0x100, "NX_COMPAT"],
  [0x200, "NO_ISOLATION"],
  [0x400, "NO_SEH"],
  [0x800, "NO_BIND"],
  [0x1000, "APPCONTAINER"],
  [0x2000, "WDM_DRIVER"],
  [0x4000, "GUARD_CF"],
  [0x8000, "TERMINAL_SERVER_AWARE"],
];

const GUARD_FLAGS: [number, string][] = [
  [0x100, "CF_INSTRUMENTED"],
  [0x200, "CFW_INSTRUMENTED"],
  [0x400, "CF_FUNCTION_TABLE_PRESENT"],
  [0x800, "SECURITY_COOKIE_UNUSED"],
  [0x1000, "PROTECT_DELAYLOAD_IAT"],
  [0x2000, "DELAYLOAD_IAT_IN_ITS_OWN_SECTION"],
  [0x4000, "CF_EXPORT_SUPPRESSION_INFO_PRESENT"],
  [0x8000, "CF_ENABLE_EXPORT_SUPPRESSION"],
  [0x10000, "CF_LONGJUMP_TABLE_PRESENT"],
];

/** Field name and offset in the 32-bit and 64-bit layouts; `w` is the width (4 or 8), "p" a pointer. */
type F = [name: string, off32: number, off64: number, width: "p" | 4 | 2];
const FIELDS: F[] = [
  ["CriticalSectionDefaultTimeout", 0x14, 0x14, 4],
  ["DeCommitFreeBlockThreshold", 0x18, 0x18, "p"],
  ["DeCommitTotalFreeThreshold", 0x1c, 0x20, "p"],
  ["LockPrefixTable", 0x20, 0x28, "p"],
  ["MaximumAllocationSize", 0x24, 0x30, "p"],
  ["VirtualMemoryThreshold", 0x28, 0x38, "p"],
  ["ProcessHeapFlags", 0x2c, 0x48, 4],
  ["ProcessAffinityMask", 0x30, 0x40, "p"],
  ["CSDVersion", 0x34, 0x4c, 2],
  ["DependentLoadFlags", 0x36, 0x4e, 2],
  ["EditList", 0x38, 0x50, "p"],
  ["SecurityCookie", 0x3c, 0x58, "p"],
  ["SEHandlerTable", 0x40, 0x60, "p"],
  ["SEHandlerCount", 0x44, 0x68, "p"],
  ["GuardCFCheckFunction", 0x48, 0x70, "p"],
  ["GuardCFCheckDispatch", 0x4c, 0x78, "p"],
  ["GuardCFFunctionTable", 0x50, 0x80, "p"],
  ["GuardCFFunctionCount", 0x54, 0x88, "p"],
  ["GuardAddressTakenIatEntryTable", 0x68, 0xa0, "p"],
  ["GuardAddressTakenIatEntryCount", 0x6c, 0xa8, "p"],
  ["GuardLongJumpTargetTable", 0x70, 0xb0, "p"],
  ["GuardLongJumpTargetCount", 0x74, 0xb8, "p"],
  ["DynamicValueRelocTable", 0x78, 0xc0, "p"],
  ["CHPEMetadataPointer", 0x7c, 0xc8, "p"],
  ["GuardRFFailureRoutine", 0x80, 0xd0, "p"],
  ["GuardRFFailureRoutineFunctionPointer", 0x84, 0xd8, "p"],
  ["DynamicValueRelocTableOffset", 0x88, 0xe0, 4],
  ["DynamicValueRelocTableSection", 0x8c, 0xe4, 2],
  ["GuardRFVerifyStackPointerFunctionPointer", 0x90, 0xe8, "p"],
  ["HotPatchTableOffset", 0x94, 0xf0, 4],
  ["EnclaveConfigurationPointer", 0x9c, 0xf8, "p"],
  ["VolatileMetadataPointer", 0xa0, 0x100, "p"],
  ["GuardEHContinuationTable", 0xa4, 0x108, "p"],
  ["GuardEHContinuationCount", 0xa8, 0x110, "p"],
];

/** Header mitigation names that are set, as LLVM prints them without the IMAGE_DLLCHARACTERISTICS prefix. */
export function dllCharacteristics(bits: number): string[] {
  return DLL_CHARACTERISTICS.filter(([m]) => bits & m).map(([, n]) => n);
}

export function guardFlagNames(flags: number): string[] {
  const names = GUARD_FLAGS.filter(([m]) => flags & m).map(([, n]) => n);
  // bits 28-31 are a count of extra bytes after each 4-byte RVA in the CF function table
  const stride = (flags >>> 28) & 0xf;
  if (stride) names.push(`CF_FUNCTION_TABLE_SIZE_${stride + 4}BYTES`);
  return names;
}

export function peSecurity(b: Uint8Array, s: LayoutSlice): PeSecurity {
  const d = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const notes: string[] = [];
  const pe = d.getUint32(0x3c, true);
  const opt = pe + 24;
  const plus = d.getUint16(opt, true) === 0x20b;
  const dllBits = d.getUint16(opt + 70, true);
  const dirs = opt + (plus ? 112 : 96);
  const base = BigInt(s.imageBase ?? "0x0");
  const off = (rva: number): number | null => {
    for (const x of s.sections) {
      if (x.addr === null || x.offset === null) continue;
      const start = Number(BigInt(x.addr) - base);
      if (rva >= start && rva < start + x.fileSize) return x.offset + (rva - start);
    }
    return null;
  };
  const mitigations: PeMitigations = {
    dllCharacteristics: dllCharacteristics(dllBits),
    aslr: !!(dllBits & 0x40),
    highEntropyVa: !!(dllBits & 0x20),
    dep: !!(dllBits & 0x100),
    controlFlowGuard: !!(dllBits & 0x4000),
    safeSeh: null,
    noSeh: !!(dllBits & 0x400),
    forceIntegrity: !!(dllBits & 0x80),
    appContainer: !!(dllBits & 0x1000),
  };
  const out: PeSecurity = { mitigations, loadConfig: null, notes };
  const nDirs = d.getUint32(opt + (plus ? 108 : 92), true);
  if (nDirs <= 10) return out;
  const rva = d.getUint32(dirs + 80, true);
  const dirSize = d.getUint32(dirs + 84, true);
  if (!rva || !dirSize) return out;
  const o = off(rva);
  if (o === null || o + 4 > b.length) {
    notes.push("the load configuration directory maps to no bytes in the file");
    return out;
  }
  // the structure's own Size is what the linker wrote; the directory's size is the same in practice
  const size = Math.min(d.getUint32(o, true), b.length - o);
  const pw = plus ? 8 : 4;
  const read = (rel: number, w: number): bigint | null => {
    if (rel + w > size) return null;
    return w === 8
      ? d.getBigUint64(o + rel, true)
      : BigInt(w === 4 ? d.getUint32(o + rel, true) : d.getUint16(o + rel, true));
  };
  const fields: Record<string, string> = {};
  for (const [name, o32, o64, w] of FIELDS) {
    const v = read(plus ? o64 : o32, w === "p" ? pw : w);
    if (v !== null) fields[name] = `0x${v.toString(16).toUpperCase()}`;
  }
  const ptr = (rel32: number, rel64: number) => read(plus ? rel64 : rel32, pw);
  const seCount = ptr(0x44, 0x68);
  const cfCount = ptr(0x54, 0x88);
  const gf = read(plus ? 0x90 : 0x58, 4);
  const flags = Number(gf ?? 0n);
  out.loadConfig = {
    size,
    timeDateStamp: Number(read(4, 4) ?? 0n),
    version: `${read(8, 2) ?? 0n}.${read(10, 2) ?? 0n}`,
    globalFlagsClear: Number(read(12, 4) ?? 0n),
    globalFlagsSet: Number(read(16, 4) ?? 0n),
    fields,
    seHandlerCount: Number(seCount ?? 0n),
    guardCFFunctionCount: Number(cfCount ?? 0n),
    guardFlags: guardFlagNames(flags),
    guardFlagsRaw: flags,
    guardCFFunctionStride: (flags >>> 28) & 0xf,
  };
  // SafeSEH is a 32-bit feature: a handler table with entries, and SEH not disabled
  if (!plus) mitigations.safeSeh = !mitigations.noSeh && (seCount ?? 0n) > 0n && (ptr(0x40, 0x60) ?? 0n) !== 0n;
  if (size < dirSize) notes.push(`the structure's Size (${size}) is smaller than the directory (${dirSize})`);
  return out;
}
