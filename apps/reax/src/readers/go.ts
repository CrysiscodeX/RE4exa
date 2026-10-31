// Go binaries: the build information the toolchain embeds (.go.buildinfo: Go version, main
// module, dependencies with replacements and sums, build settings) and the pclntab function
// table, which keeps every function's name and entry address even when the symbol table is
// stripped (-ldflags=-s). Checked against Go's own debug/buildinfo and debug/gosym
// (scripts/oracle-go, bench/oracle/go.json).
import { addressToOffset, type LayoutSlice } from "./layout.ts";

export interface GoModule {
  path: string;
  version: string;
  sum: string | null;
  replace: { path: string; version: string; sum: string | null } | null;
}

export interface GoBuildInfo {
  goVersion: string;
  path: string | null;
  main: GoModule | null;
  deps: GoModule[];
  settings: { key: string; value: string }[];
}

export interface GoFunc {
  name: string;
  entry: string;
}

const MAGIC = Buffer.from("\xff Go buildinf:", "latin1");
const utf8 = new TextDecoder("utf-8");

function uvarint(b: Uint8Array, o: number): { v: number; n: number } {
  let v = 0;
  let shift = 0;
  for (let i = 0; i < 10 && o + i < b.length; i++) {
    const x = b[o + i]!;
    v += (x & 0x7f) * 2 ** shift;
    if ((x & 0x80) === 0) return { v, n: i + 1 };
    shift += 7;
  }
  throw new Error("a varint runs past the build information");
}

function parseModinfo(text: string): Omit<GoBuildInfo, "goVersion"> {
  const out: Omit<GoBuildInfo, "goVersion"> = { path: null, main: null, deps: [], settings: [] };
  let last: GoModule | null = null;
  for (const line of text.split("\n")) {
    const f = line.split("\t");
    const mod = (): GoModule => ({ path: f[1] ?? "", version: f[2] ?? "", sum: f[3] || null, replace: null });
    if (f[0] === "path") out.path = f[1] ?? null;
    else if (f[0] === "mod") {
      out.main = mod();
      last = out.main;
    } else if (f[0] === "dep") {
      last = mod();
      out.deps.push(last);
    } else if (f[0] === "=>" && last) last.replace = { path: f[1] ?? "", version: f[2] ?? "", sum: f[3] || null };
    else if (f[0] === "build" && f[1]) {
      const eq = f[1].indexOf("=");
      // a value with spaces or quotes is quoted, as strconv.Quote writes it
      let value = eq >= 0 ? f[1].slice(eq + 1) : "";
      if (value.startsWith('"')) {
        try {
          value = JSON.parse(value) as string;
        } catch {
          // keep it as written
        }
      }
      out.settings.push({ key: eq >= 0 ? f[1].slice(0, eq) : f[1], value });
    }
  }
  return out;
}

/** The build information, or null when the file has none (not a Go binary, or Go before 1.13). */
export function goBuildInfo(b: Uint8Array, s: LayoutSlice | null): GoBuildInfo | null {
  const buf = Buffer.from(b.buffer, b.byteOffset, b.byteLength);
  // the header is 16-byte aligned in its section; search the whole file, as the loader may place
  // the section anywhere, and take the first header whose version string reads
  for (let at = buf.indexOf(MAGIC); at >= 0; at = buf.indexOf(MAGIC, at + 1)) {
    if (at + 32 > b.length) break;
    const ptrSize = b[at + 14]!;
    const flags = b[at + 15]!;
    try {
      if (flags & 2) {
        // Go 1.18+: the version and the module text follow inline, each with a varint length
        const v = uvarint(b, at + 32);
        const vs = at + 32 + v.n;
        const goVersion = new TextDecoder().decode(b.subarray(vs, vs + v.v));
        const m = uvarint(b, vs + v.v);
        const ms = vs + v.v + m.n;
        let mod = new TextDecoder().decode(b.subarray(ms, ms + m.v));
        // the module text is wrapped in 16-byte sentinels
        if (mod.length >= 33 && mod[mod.length - 17] === "\n") mod = mod.slice(16, -16);
        if (!goVersion.startsWith("go") && !goVersion.startsWith("devel")) continue;
        return { goVersion, ...parseModinfo(mod) };
      }
      // Go 1.13-1.17: pointers to two Go string headers (data pointer, length)
      if (!s || (ptrSize !== 4 && ptrSize !== 8)) continue;
      const big = (flags & 1) !== 0;
      const d = new DataView(b.buffer, b.byteOffset, b.byteLength);
      const ptr = (o: number) => (ptrSize === 8 ? d.getBigUint64(o, !big) : BigInt(d.getUint32(o, !big)));
      const str = (hdrAddr: bigint): string | null => {
        const ho = addressToOffset(s, hdrAddr).offset;
        if (ho === null) return null;
        const dataAddr = ptr(ho);
        const len = Number(ptr(ho + ptrSize));
        const dofs = addressToOffset(s, dataAddr).offset;
        return dofs === null || len > 1 << 20 ? null : new TextDecoder().decode(b.subarray(dofs, dofs + len));
      };
      const goVersion = str(ptr(at + 16));
      let mod = str(ptr(at + 16 + ptrSize)) ?? "";
      if (!goVersion) continue;
      if (mod.length >= 33 && mod[mod.length - 17] === "\n") mod = mod.slice(16, -16);
      return { goVersion, ...parseModinfo(mod) };
    } catch {
      // a false match of the magic: keep looking
    }
  }
  return null;
}

/** Where the pclntab starts: a named section, else a scan for its header. */
function findPclntab(b: Uint8Array, s: LayoutSlice): number | null {
  const named = s.sections.find((x) => (x.name === ".gopclntab" || x.name === "__gopclntab") && x.offset !== null);
  if (named) return named.offset;
  const d = new DataView(b.buffer, b.byteOffset, b.byteLength);
  for (let o = 0; o + 16 <= b.length; o += 4) {
    const m = d.getUint32(o, true);
    if (m !== 0xfffffff1 && m !== 0xfffffff0 && m !== 0xfffffffa) continue;
    if (b[o + 4] !== 0 || b[o + 5] !== 0) continue;
    if (![1, 2, 4].includes(b[o + 6]!) || ![4, 8].includes(b[o + 7]!)) continue;
    return o;
  }
  return null;
}

/** Every function in the pclntab (Go 1.16+), in table order. */
export function goFunctions(b: Uint8Array, s: LayoutSlice): { funcs: GoFunc[]; version: string } | null {
  const at = findPclntab(b, s);
  if (at === null) return null;
  const d = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const magic = d.getUint32(at, true);
  const ptrSize = b[at + 7]!;
  const word = (i: number) => {
    const o = at + 8 + i * ptrSize;
    return ptrSize === 8 ? Number(d.getBigUint64(o, true)) : d.getUint32(o, true);
  };
  const v118 = magic === 0xfffffff1 || magic === 0xfffffff0;
  const nfunc = word(0);
  // 1.18+: nfunc, nfiles, textStart, funcnameOffset, cuOffset, filetabOffset, pctabOffset, pclnOffset
  // 1.16-1.17: nfunc, nfiles, funcnameOffset, cuOffset, filetabOffset, pctabOffset, pclnOffset
  const textStart = v118
    ? BigInt(ptrSize === 8 ? d.getBigUint64(at + 8 + 2 * ptrSize, true) : d.getUint32(at + 8 + 2 * ptrSize, true))
    : 0n;
  const funcname = at + word(v118 ? 3 : 2);
  const functab = at + word(v118 ? 7 : 6);
  if (nfunc > 4_000_000 || functab >= b.length || funcname >= b.length) return null;
  const funcs: GoFunc[] = [];
  const entSize = v118 ? 8 : 2 * ptrSize;
  for (let i = 0; i < nfunc; i++) {
    const e = functab + i * entSize;
    if (e + entSize > b.length) break;
    const entry = v118
      ? textStart + BigInt(d.getUint32(e, true))
      : BigInt(ptrSize === 8 ? d.getBigUint64(e, true) : d.getUint32(e, true));
    const funcoff = v118
      ? d.getUint32(e + 4, true)
      : ptrSize === 8
        ? Number(d.getBigUint64(e + ptrSize, true))
        : d.getUint32(e + ptrSize, true);
    const fo = functab + funcoff;
    // the _func record: entry (u32 offset in 1.18+, uintptr before), then nameOff (i32)
    const nameOff = d.getInt32(fo + (v118 ? 4 : ptrSize), true);
    // names are UTF-8 (Go writes "·" in some generated names)
    const start = funcname + nameOff;
    let end = start;
    while (end < b.length && b[end] !== 0 && end - start < 4096) end++;
    funcs.push({ name: utf8.decode(b.subarray(start, end)), entry: `0x${entry.toString(16)}` });
  }
  return { funcs, version: magic === 0xfffffff1 ? "1.20+" : magic === 0xfffffff0 ? "1.18-1.19" : "1.16-1.17" };
}
