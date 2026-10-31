// The notes and Go answer keys (part of scripts/oracle.ts):
// - ELF notes from llvm-readobj 18 --notes;
// - Go build information and functions from Go's own debug/buildinfo and debug/gosym
//   (scripts/oracle-go, run with the installed Go toolchain).
import { spawnSync } from "node:child_process";
import { join } from "node:path";

export interface NoteKey {
  section: string;
  owner: string;
  dataSize: number;
  type: string;
  fields: Record<string, string>;
}

export function notesKey(path: string): NoteKey[] {
  let out = "";
  for (const bin of ["llvm-readobj-18", "llvm-readobj"]) {
    const r = spawnSync(bin, ["--notes", path], { encoding: "latin1", maxBuffer: 1 << 26 });
    if (r.error) continue;
    if (r.status !== 0) throw new Error(`${bin} --notes ${path}: ${r.stderr}`);
    out = r.stdout;
    break;
  }
  if (!out) throw new Error("llvm-readobj (LLVM 18) is not installed");
  const notes: NoteKey[] = [];
  let section = "";
  let cur: NoteKey | null = null;
  for (const line of out.split("\n")) {
    const sec = /^ {4}Name: (.*)$/.exec(line);
    if (sec) section = sec[1]!.trim();
    if (/^ {4}Note \{$/.test(line)) {
      cur = { section, owner: "", dataSize: 0, type: "", fields: {} };
      notes.push(cur);
      continue;
    }
    if (!cur) continue;
    if (/^ {4}\}$/.test(line)) {
      cur = null;
      continue;
    }
    const kv = /^ {6,8}([^:]+): (.*)$/.exec(line);
    if (!kv) continue;
    const [k, v] = [kv[1]!.trim(), kv[2]!.trim()];
    // a name is padded with NULs to its field's length; llvm-readobj prints them
    if (k === "Owner") cur.owner = v.replace(/\0+$/, "");
    else if (k === "Data size") cur.dataSize = Number(v);
    else if (k === "Type") cur.type = v.replace(/ \(.*\)$/, "");
    else cur.fields[k] = v;
  }
  return notes;
}

/** The resource tree as llvm-readobj --coff-resources lists it: type, name, language, RVA, size. */
export function resourceTree(path: string) {
  let out = "";
  for (const bin of ["llvm-readobj-18", "llvm-readobj"]) {
    const r = spawnSync(bin, ["--coff-resources", path], { encoding: "latin1", maxBuffer: 1 << 26 });
    if (r.error) continue;
    if (r.status !== 0) throw new Error(`${bin} --coff-resources ${path}: ${r.stderr}`);
    out = r.stdout;
    break;
  }
  const rows: { type: string; name: string; language: number; rva: number; size: number }[] = [];
  let type = "";
  let name = "";
  let language = 0;
  let rva = 0;
  // "Type: VERSIONINFO (ID 16) [", "Name: (ID 1) [", "Name: MYNAME [", "Language: (ID 1033) ["
  const label = (v: string) => /\(ID (\d+)\)/.exec(v)?.[1] ?? v.replace(/ \[$/, "").trim();
  for (const line of out.split("\n")) {
    const t = /^\s*Type: (.*)$/.exec(line);
    if (t) type = /^([A-Z_]+) \(ID \d+\)/.exec(t[1]!)?.[1] ?? label(t[1]!);
    const n = /^\s*Name: (.*)$/.exec(line);
    if (n) name = label(n[1]!);
    const l = /^\s*Language: (.*)$/.exec(line);
    if (l) language = Number(label(l[1]!));
    const r = /^\s*DataRVA: (0x[0-9A-Fa-f]+)$/.exec(line);
    if (r) rva = Number(r[1]);
    const z = /^\s*DataSize: (\d+)$/.exec(line);
    if (z) rows.push({ type, name, language, rva, size: Number(z[1]) });
  }
  return rows;
}

/** pefile's reading of version information, string tables and the manifest (scripts/oracle-pe.py). */
export function pefileKey(path: string): unknown {
  const lib = process.env.REAX_PYORACLE ?? "/tmp/reax-pyoracle";
  const script = join(import.meta.dirname, "oracle-pe.py");
  const r = spawnSync(
    "python3",
    [
      "-I",
      "-c",
      "import runpy,sys; sys.path.insert(0, sys.argv[1]); sys.argv = sys.argv[2:]; runpy.run_path(sys.argv[0], run_name='__main__')",
      lib,
      script,
      path,
    ],
    { encoding: "utf8", maxBuffer: 1 << 26 },
  );
  if (r.error || r.status !== 0)
    throw new Error(
      `pefile oracle on ${path} (install it with scripts/oracle-requirements.txt): ${r.error?.message ?? r.stderr}`,
    );
  return JSON.parse(r.stdout);
}

/** Each slice's header and load commands as llvm-objdump --macho --private-headers prints them. */
export function machoKey(path: string, fat: boolean) {
  let out = "";
  for (const bin of ["llvm-objdump-18", "llvm-objdump"]) {
    const r = spawnSync(bin, ["--macho", "--private-headers", ...(fat ? ["--arch=all"] : []), path], {
      encoding: "latin1",
      maxBuffer: 1 << 26,
    });
    if (r.error) continue;
    if (r.status !== 0) throw new Error(`${bin} --macho --private-headers ${path}: ${r.stderr}`);
    out = r.stdout;
    break;
  }
  return out
    .split(/^Mach header$/m)
    .slice(1)
    .map((text) => {
      const lines = text.split("\n");
      const tok = lines[2]!.trim().split(/\s+/);
      const cmds: { cmd: string; fields: Record<string, string> }[] = [];
      let cur: { cmd: string; fields: Record<string, string> } | null = null;
      for (const l of lines) {
        if (/^Load command \d+$/.test(l)) {
          cur = null;
          continue;
        }
        if (/^Section$/.test(l)) {
          cur = null;
          continue;
        }
        const c = /^\s*cmd (\S+)$/.exec(l);
        if (c) {
          cur = { cmd: c[1]!, fields: {} };
          cmds.push(cur);
          continue;
        }
        if (!cur) continue;
        const name = /^\s*name (.*) \(offset \d+\)$/.exec(l);
        if (name) cur.fields.name = name[1]!;
        const ver = /^\s*(current|compatibility) version (\S+)$/.exec(l);
        if (ver) cur.fields[`${ver[1]}Version`] = ver[2]!;
        const kv =
          /^\s*(segname|uuid|platform|sdk|minos|entryoff|stacksize|dataoff|datasize|symoff|nsyms|stroff|strsize|path|cryptoff|cryptsize|cryptid) (\S+)/.exec(
            l,
          );
        if (kv) cur.fields[kv[1]!] = kv[2]!;
        // LC_SOURCE_VERSION prints "version A.B..." (the build tools also print "version")
        const sv = /^\s*version (\S+)$/.exec(l);
        if (sv && cur.cmd === "LC_SOURCE_VERSION") cur.fields.version = sv[1]!;
      }
      return { filetype: tok[4]!, ncmds: Number(tok[5]), sizeofcmds: Number(tok[6]), flags: tok.slice(7), cmds };
    });
}

export function goKey(path: string): unknown {
  const r = spawnSync("go", ["run", ".", path], {
    cwd: join(import.meta.dirname, "oracle-go"),
    encoding: "utf8",
    maxBuffer: 1 << 28,
    env: { ...process.env, GOTOOLCHAIN: "local", GOFLAGS: "-mod=mod", CGO_ENABLED: "0" },
  });
  if (r.error || r.status !== 0) throw new Error(`go run scripts/oracle-go ${path}: ${r.error?.message ?? r.stderr}`);
  return JSON.parse(r.stdout);
}
