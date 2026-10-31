// Mach-O depth: the header and every load command with its fields (dylibs with versions, rpaths,
// UUID, build version and tools, entry point, linkedit tables, encryption), and the code
// signature: the SuperBlob's blobs, each CodeDirectory (identifier, team, flags such as adhoc and
// linker-signed, hash type, page size) with its page hashes recomputed over the file, and the
// entitlements. Load commands are checked against llvm-objdump --macho --private-headers; the page
// hashes are checked against the bytes they cover, which needs no tool at all.
import { createHash } from "node:crypto";

export interface LoadCommand {
  index: number;
  cmd: string;
  cmdsize: number;
  fields: Record<string, string | number>;
}

export interface CodeDirectory {
  slot: number;
  version: string;
  flags: string[];
  identifier: string;
  team: string | null;
  hashType: string;
  pageSize: number;
  codeLimit: number;
  codeSlots: number;
  specialSlots: number;
  /** Code pages whose recorded hash equals the hash of the bytes they cover. */
  pagesVerified: number;
  /** Special slots recomputed (requirements, entitlements, DER entitlements) and whether they match. */
  special: { slot: string; matches: boolean }[];
}

export interface CodeSignature {
  offset: number;
  size: number;
  blobs: { type: string; offset: number; length: number }[];
  codeDirectories: CodeDirectory[];
  entitlements: string | null;
  derEntitlements: boolean;
  /** A CMS (certificate) signature is present: signed with an identity, not ad hoc. */
  cms: boolean;
}

export interface MachoDetail {
  arch: string;
  base: number;
  header: { filetype: string; flags: string[]; ncmds: number; sizeofcmds: number };
  loadCommands: LoadCommand[];
  signature: CodeSignature | null;
  notes: string[];
}

const LC: Record<number, string> = {
  1: "LC_SEGMENT",
  2: "LC_SYMTAB",
  11: "LC_DYSYMTAB",
  12: "LC_LOAD_DYLIB",
  13: "LC_ID_DYLIB",
  14: "LC_LOAD_DYLINKER",
  15: "LC_ID_DYLINKER",
  25: "LC_SEGMENT_64",
  27: "LC_UUID",
  29: "LC_CODE_SIGNATURE",
  30: "LC_SEGMENT_SPLIT_INFO",
  32: "LC_LAZY_LOAD_DYLIB",
  33: "LC_ENCRYPTION_INFO",
  34: "LC_DYLD_INFO",
  36: "LC_VERSION_MIN_MACOSX",
  37: "LC_VERSION_MIN_IPHONEOS",
  38: "LC_FUNCTION_STARTS",
  39: "LC_DYLD_ENVIRONMENT",
  41: "LC_DATA_IN_CODE",
  42: "LC_SOURCE_VERSION",
  43: "LC_DYLIB_CODE_SIGN_DRS",
  44: "LC_ENCRYPTION_INFO_64",
  45: "LC_LINKER_OPTION",
  46: "LC_LINKER_OPTIMIZATION_HINT",
  47: "LC_VERSION_MIN_TVOS",
  48: "LC_VERSION_MIN_WATCHOS",
  49: "LC_NOTE",
  50: "LC_BUILD_VERSION",
  2147483672: "LC_LOAD_WEAK_DYLIB",
  2147483676: "LC_RPATH",
  2147483679: "LC_REEXPORT_DYLIB",
  2147483682: "LC_DYLD_INFO_ONLY",
  2147483683: "LC_LOAD_UPWARD_DYLIB",
  2147483688: "LC_MAIN",
  2147483699: "LC_DYLD_EXPORTS_TRIE",
  2147483700: "LC_DYLD_CHAINED_FIXUPS",
};
const FILETYPE = [
  "",
  "OBJECT",
  "EXECUTE",
  "FVMLIB",
  "CORE",
  "PRELOAD",
  "DYLIB",
  "DYLINKER",
  "BUNDLE",
  "DYLIB_STUB",
  "DSYM",
  "KEXT_BUNDLE",
  "FILESET",
];
const MH_FLAGS: [number, string][] = [
  [0x1, "NOUNDEFS"],
  [0x2, "INCRLINK"],
  [0x4, "DYLDLINK"],
  [0x8, "BINDATLOAD"],
  [0x10, "PREBOUND"],
  [0x20, "SPLIT_SEGS"],
  [0x80, "TWOLEVEL"],
  [0x100, "FORCE_FLAT"],
  [0x200, "NOMULTIDEFS"],
  [0x800, "PREBINDABLE"],
  [0x8000, "WEAK_DEFINES"],
  [0x10000, "BINDS_TO_WEAK"],
  [0x20000, "ALLOW_STACK_EXECUTION"],
  [0x40000, "ROOT_SAFE"],
  [0x80000, "SETUID_SAFE"],
  [0x100000, "NO_REEXPORTED_DYLIBS"],
  [0x200000, "PIE"],
  [0x800000, "HAS_TLV_DESCRIPTORS"],
  [0x1000000, "NO_HEAP_EXECUTION"],
  [0x2000000, "APP_EXTENSION_SAFE"],
];
const PLATFORM = [
  "",
  "macos",
  "ios",
  "tvos",
  "watchos",
  "bridgeos",
  "maccatalyst",
  "iossimulator",
  "tvossimulator",
  "watchossimulator",
  "driverkit",
  "visionos",
  "visionossimulator",
];
const CS_FLAGS: [number, string][] = [
  [0x1, "valid"],
  [0x2, "adhoc"],
  [0x4, "get-task-allow"],
  [0x100, "hard"],
  [0x200, "kill"],
  [0x400, "check-expiration"],
  [0x800, "restrict"],
  [0x1000, "enforcement"],
  [0x2000, "library-validation"],
  [0x10000, "runtime"],
  [0x20000, "linker-signed"],
];
const HASH = ["none", "sha1", "sha256", "sha256-truncated", "sha384"];
const BLOB: Record<number, string> = {
  0: "CodeDirectory",
  1: "InfoSlot",
  2: "Requirements",
  3: "ResourceDir",
  4: "Application",
  5: "Entitlements",
  7: "DEREntitlements",
  65536: "CMSSignature",
};

/** X.Y.Z from Mach-O's nibble-packed version (xxxx.yy.zz). */
export const xyz = (v: number) => `${v >>> 16}.${(v >>> 8) & 0xff}.${v & 0xff}`;

function hashOf(type: number, data: Uint8Array): Buffer | null {
  if (type === 1) return createHash("sha1").update(data).digest();
  if (type === 2) return createHash("sha256").update(data).digest();
  if (type === 3) return createHash("sha256").update(data).digest().subarray(0, 20);
  if (type === 4) return createHash("sha384").update(data).digest();
  return null;
}

function signature(slice: Uint8Array, at: number, size: number, notes: string[]): CodeSignature | null {
  if (at + 12 > slice.length) {
    notes.push("LC_CODE_SIGNATURE points past the end of the slice");
    return null;
  }
  const d = new DataView(slice.buffer, slice.byteOffset, slice.byteLength);
  if (d.getUint32(at, false) !== 0xfade0cc0) {
    notes.push("the code signature is not an embedded SuperBlob");
    return null;
  }
  const count = d.getUint32(at + 8, false);
  const cs: CodeSignature = {
    offset: at,
    size,
    blobs: [],
    codeDirectories: [],
    entitlements: null,
    derEntitlements: false,
    cms: false,
  };
  const blobData = new Map<number, Uint8Array>();
  for (let i = 0; i < Math.min(count, 64); i++) {
    const e = at + 12 + i * 8;
    if (e + 8 > slice.length) break;
    const type = d.getUint32(e, false);
    const off = at + d.getUint32(e + 4, false);
    if (off + 8 > slice.length) continue;
    const length = d.getUint32(off + 4, false);
    cs.blobs.push({
      type: BLOB[type] ?? (type >= 0x1000 && type < 0x1005 ? "AlternateCodeDirectory" : `0x${type.toString(16)}`),
      offset: off,
      length,
    });
    blobData.set(type, slice.subarray(off, Math.min(slice.length, off + length)));
    if (type === 5) cs.entitlements = new TextDecoder().decode(slice.subarray(off + 8, off + length));
    if (type === 7) cs.derEntitlements = true;
    if (type === 0x10000) cs.cms = length > 8;
  }
  for (const [type, blob] of blobData) {
    if (type !== 0 && !(type >= 0x1000 && type < 0x1005)) continue;
    const b = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
    if (b.getUint32(0, false) !== 0xfade0c02) continue;
    const version = b.getUint32(8, false);
    const flags = b.getUint32(12, false);
    const hashOffset = b.getUint32(16, false);
    const identOffset = b.getUint32(20, false);
    const nSpecial = b.getUint32(24, false);
    const nCode = b.getUint32(28, false);
    const codeLimit = b.getUint32(32, false);
    const hashSize = b.getUint8(36);
    const hashType = b.getUint8(37);
    const pageSize = b.getUint8(39) ? 2 ** b.getUint8(39) : 0;
    const teamOffset = version >= 0x20200 ? b.getUint32(48, false) : 0;
    const cstr = (o: number) => {
      let e = o;
      while (e < blob.length && blob[e] !== 0) e++;
      return new TextDecoder().decode(blob.subarray(o, e));
    };
    let verified = 0;
    for (let i = 0; i < nCode; i++) {
      const start = pageSize ? i * pageSize : 0;
      const end = pageSize ? Math.min(start + pageSize, codeLimit) : codeLimit;
      const h = hashOf(hashType, slice.subarray(start, end));
      const want = blob.subarray(hashOffset + i * hashSize, hashOffset + (i + 1) * hashSize);
      if (h && Buffer.compare(h.subarray(0, hashSize), Buffer.from(want)) === 0) verified++;
    }
    // special slots count down from the hash array: -2 requirements, -5 entitlements, -7 DER
    const special: CodeDirectory["special"] = [];
    for (const [slot, blobType, name] of [
      [2, 2, "requirements"],
      [5, 5, "entitlements"],
      [7, 7, "der-entitlements"],
    ] as const) {
      if (slot > nSpecial || !blobData.has(blobType)) continue;
      const want = blob.subarray(hashOffset - slot * hashSize, hashOffset - (slot - 1) * hashSize);
      const h = hashOf(hashType, blobData.get(blobType)!);
      special.push({ slot: name, matches: !!h && Buffer.compare(h.subarray(0, hashSize), Buffer.from(want)) === 0 });
    }
    cs.codeDirectories.push({
      slot: type,
      version: `0x${version.toString(16)}`,
      flags: CS_FLAGS.filter(([bit]) => flags & bit).map(([, n]) => n),
      identifier: cstr(identOffset),
      team: teamOffset ? cstr(teamOffset) : null,
      hashType: HASH[hashType] ?? `type ${hashType}`,
      pageSize,
      codeLimit,
      codeSlots: nCode,
      specialSlots: nSpecial,
      pagesVerified: verified,
      special,
    });
  }
  return cs;
}

/** One thin slice (`b` is the slice's own bytes). */
export function machoDetail(b: Uint8Array, arch: string, base: number): MachoDetail {
  const notes: string[] = [];
  const be = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const magic = be.getUint32(0, false);
  const le = magic === 0xcefaedfe || magic === 0xcffaedfe;
  const is64 = magic === 0xcffaedfe || magic === 0xfeedfacf;
  const d = be;
  const u32 = (o: number) => d.getUint32(o, le);
  const u64 = (o: number) => Number(d.getBigUint64(o, le));
  const ncmds = u32(16);
  const sizeofcmds = u32(20);
  const flags = u32(24);
  const filetype = u32(12);
  const str = (o: number, end: number) => {
    let e = o;
    while (e < end && e < b.length && b[e] !== 0) e++;
    return new TextDecoder().decode(b.subarray(o, e));
  };
  const loadCommands: LoadCommand[] = [];
  let signatureAt: { off: number; size: number } | null = null;
  let o = is64 ? 32 : 28;
  for (let i = 0; i < ncmds; i++) {
    if (o + 8 > b.length) {
      notes.push(`the load commands are cut after ${i} of ${ncmds}`);
      break;
    }
    const cmd = u32(o);
    const cmdsize = u32(o + 4);
    if (cmdsize < 8 || o + cmdsize > b.length) {
      notes.push(`load command ${i} has an impossible size ${cmdsize}`);
      break;
    }
    const name = LC[cmd] ?? `0x${cmd.toString(16)}`;
    const f: Record<string, string | number> = {};
    const end = o + cmdsize;
    switch (cmd) {
      case 0x1:
      case 0x19:
        f.segname = str(o + 8, o + 24);
        break;
      case 0xc:
      case 0xd:
      case 0x20:
      case 0x80000018:
      case 0x8000001f:
      case 0x80000023:
        f.name = str(o + u32(o + 8), end);
        f.timestamp = u32(o + 12);
        f.currentVersion = xyz(u32(o + 16));
        f.compatibilityVersion = xyz(u32(o + 20));
        break;
      case 0xe:
      case 0xf:
      case 0x27:
        f.name = str(o + u32(o + 8), end);
        break;
      case 0x8000001c:
        f.path = str(o + u32(o + 8), end);
        break;
      case 0x1b: {
        const h = Buffer.from(b.subarray(o + 8, o + 24))
          .toString("hex")
          .toUpperCase();
        f.uuid = `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
        break;
      }
      case 0x32: {
        f.platform = PLATFORM[u32(o + 8)] ?? `platform ${u32(o + 8)}`;
        f.minos = xyz(u32(o + 12));
        f.sdk = xyz(u32(o + 16));
        const ntools = u32(o + 20);
        f.ntools = ntools;
        for (let t = 0; t < ntools && o + 24 + t * 8 + 8 <= end; t++)
          f[`tool${t}`] = `${u32(o + 24 + t * 8)} ${xyz(u32(o + 28 + t * 8))}`;
        break;
      }
      case 0x24:
      case 0x25:
      case 0x2f:
      case 0x30:
        f.version = xyz(u32(o + 8));
        f.sdk = xyz(u32(o + 12));
        break;
      case 0x80000028:
        f.entryoff = u64(o + 8);
        f.stacksize = u64(o + 16);
        break;
      case 0x2a: {
        const v = d.getBigUint64(o + 8, le);
        f.version = [v >> 40n, (v >> 30n) & 0x3ffn, (v >> 20n) & 0x3ffn, (v >> 10n) & 0x3ffn, v & 0x3ffn].join(".");
        break;
      }
      case 0x2:
        f.symoff = u32(o + 8);
        f.nsyms = u32(o + 12);
        f.stroff = u32(o + 16);
        f.strsize = u32(o + 20);
        break;
      case 0x1d:
      case 0x1e:
      case 0x26:
      case 0x29:
      case 0x2b:
      case 0x2e:
      case 0x80000033:
      case 0x80000034:
        f.dataoff = u32(o + 8);
        f.datasize = u32(o + 12);
        if (cmd === 0x1d) signatureAt = { off: u32(o + 8), size: u32(o + 12) };
        break;
      case 0x22:
      case 0x80000022:
        for (const [k, at] of [
          ["rebase", 8],
          ["bind", 16],
          ["weakBind", 24],
          ["lazyBind", 32],
          ["export", 40],
        ] as const) {
          f[`${k}Off`] = u32(o + at);
          f[`${k}Size`] = u32(o + at + 4);
        }
        break;
      case 0x21:
      case 0x2c:
        f.cryptoff = u32(o + 8);
        f.cryptsize = u32(o + 12);
        f.cryptid = u32(o + 16);
        break;
      default:
        break;
    }
    loadCommands.push({ index: i, cmd: name, cmdsize, fields: f });
    o = end;
  }
  if (o - (is64 ? 32 : 28) !== sizeofcmds && !notes.length)
    notes.push(`the load commands take ${o - (is64 ? 32 : 28)} bytes; the header says ${sizeofcmds}`);
  const sig = signatureAt as { off: number; size: number } | null;
  return {
    arch,
    base,
    header: {
      filetype: FILETYPE[filetype] ?? `0x${filetype.toString(16)}`,
      flags: MH_FLAGS.filter(([bit]) => flags & bit).map(([, n]) => n),
      ncmds,
      sizeofcmds,
    },
    loadCommands,
    signature: sig ? signature(b, sig.off, sig.size, notes) : null,
    notes,
  };
}
