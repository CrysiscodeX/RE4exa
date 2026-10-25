// The predicates the verifier can re-run, with their parameter schemas. A `seen` claim names one
// of these in `predicate` and gives `params`; `path` is workspace-relative (it may also come from
// the claim's `subject.path`). Anything else is unverifiable, with the reason recorded.

import type { Json } from "../evidence/jcs.ts";

export interface ParamSpec {
  type: "string" | "number" | "string[]";
  required?: boolean;
  doc: string;
}

export interface PredicateSpec {
  predicate: string;
  summary: string;
  /** Probe(s) used to re-run the claim. */
  probes: string[];
  params: Record<string, ParamSpec>;
  /** Exactly one of each group must be present. */
  oneOf?: string[][];
  verified: string;
  refuted: string;
  unverifiable: string;
}

const path: ParamSpec = { type: "string", required: true, doc: "workspace-relative path of the subject" };

export const PREDICATES: Record<string, PredicateSpec> = {
  "file.contains": {
    predicate: "file.contains",
    summary: "The file contains the given text (UTF-8) or hex bytes, anywhere or at `offset`",
    probes: ["file.contains"],
    params: {
      path,
      text: { type: "string", doc: "UTF-8 text to find" },
      hex: { type: "string", doc: "hex bytes to find (spaces allowed)" },
      offset: { type: "number", doc: "byte offset where the needle must start" },
    },
    oneOf: [["text", "hex"]],
    verified: "the needle occurs (at the offset, if given)",
    refuted: "the whole file was scanned and the needle does not occur",
    unverifiable: "the file is larger than the scan cap and the needle was not found in the scanned part",
  },
  "file.identify": {
    predicate: "file.identify",
    summary: "The file has the given format (or a format in its family: jar is a zip, npm-tgz is a gzip)",
    probes: ["file.identify"],
    params: { path, format: { type: "string", required: true, doc: "format name as file.identify reports it" } },
    verified: "the identified format or one of its families equals `format`",
    refuted: "it does not",
    unverifiable: "never, unless the subject is missing",
  },
  "file.hash": {
    predicate: "file.hash",
    summary: "The file's sha256 equals the given value",
    probes: ["file.hash"],
    params: { path, sha256: { type: "string", required: true, doc: "64 hex digits, optional sha256: prefix" } },
    verified: "the digests are equal",
    refuted: "they differ",
    unverifiable: "the value is not a sha256 digest",
  },
  "pkg.has-dependency": {
    predicate: "pkg.has-dependency",
    summary: "The package declares a dependency on `name` (in any dependency scope, or in `scope`)",
    probes: ["pkg.manifest"],
    params: {
      path: { ...path, doc: "package directory, package.json or npm tarball" },
      name: { type: "string", required: true, doc: "dependency name" },
      scope: {
        type: "string",
        doc: "dependencies | optionalDependencies | peerDependencies | devDependencies",
      },
    },
    verified: "the manifest lists it",
    refuted: "the manifest does not list it",
    unverifiable: "no manifest could be read",
  },
  "pkg.has-install-script": {
    predicate: "pkg.has-install-script",
    summary: "The package runs code at install time (preinstall, install, postinstall, prepare, or implicit node-gyp)",
    probes: ["pkg.manifest"],
    params: {
      path: { ...path, doc: "package directory, package.json or npm tarball" },
      hook: { type: "string", doc: "one of preinstall, install, postinstall, prepare" },
    },
    verified: "the hook (or any hook) is present",
    refuted: "it is absent",
    unverifiable: "the subject is a lone package.json and the claim is about an implicit install (binding.gyp unseen)",
  },
  "js.imports": {
    predicate: "js.imports",
    summary: "The file (or directory) loads `specifier` by any loading form",
    probes: ["js.imports"],
    params: {
      path: { ...path, doc: "JS/TS file or directory" },
      specifier: { type: "string", required: true, doc: "module specifier as written" },
    },
    verified: "the census found the specifier",
    refuted: "the census is complete (no unresolved or unclaimed loads, nothing skipped) and did not find it",
    unverifiable: "the census is partial: an unresolved dynamic load could be the specifier",
  },
  "native.links": {
    predicate: "native.links",
    summary: "The ELF/PE/Mach-O binary links `library` (NEEDED, import table, LC_LOAD_DYLIB)",
    probes: ["file.identify", "elf.info", "pe.info", "macho.info"],
    params: {
      path,
      library: {
        type: "string",
        required: true,
        doc: "library name or path (basename match; case-insensitive for PE)",
      },
    },
    verified: "the library is in the static link list",
    refuted: "it is not (run-time dlopen/LoadLibrary is not covered by this predicate)",
    unverifiable: "the file is not a supported native binary",
  },
  "archive.contains": {
    predicate: "archive.contains",
    summary: "The archive (zip family, tar, tar.gz, ASAR) has an entry named `entry`",
    probes: ["archive.list"],
    params: { path, entry: { type: "string", required: true, doc: "entry name as stored (a leading ./ is ignored)" } },
    verified: "an entry has that name",
    refuted: "the listing is complete and no entry has it",
    unverifiable: "the listing was capped or truncated",
  },
  "endpoint.present": {
    predicate: "endpoint.present",
    summary: "The code names host `host` in a string literal (URL or bare host)",
    probes: ["js.endpoints", "file.contains"],
    params: {
      path: { ...path, doc: "JS/TS/JSON file or directory" },
      host: { type: "string", required: true, doc: "host name, case-insensitive" },
    },
    verified: "a literal names the host",
    refuted: "the host's text does not occur anywhere in the file's bytes",
    unverifiable: "the text occurs but not as an endpoint literal, or the subject is a directory",
  },
  "cmd.exit": {
    predicate: "cmd.exit",
    summary: "Running `program args` exits with `expect` (only through the approval-gated sandbox)",
    probes: [],
    params: {
      program: { type: "string", required: true, doc: "program name or path" },
      args: { type: "string[]", doc: "argv after the program" },
      expect: { type: "number", required: true, doc: "expected exit code" },
    },
    verified: "the exit code equals `expect`",
    refuted: "it differs",
    unverifiable: "no sandbox is wired (needs approval), or the person denied it",
  },
};

/** Null when the params fit the schema, else the reason they do not. */
export function checkParams(spec: PredicateSpec, params: Record<string, Json>): string | null {
  for (const [name, p] of Object.entries(spec.params)) {
    const v = params[name];
    if (v === undefined || v === null) {
      if (p.required) return `missing param ${name}`;
      continue;
    }
    if (p.type === "string" && (typeof v !== "string" || v.length === 0))
      return `param ${name} must be a non-empty string`;
    if (p.type === "number" && (typeof v !== "number" || !Number.isFinite(v))) return `param ${name} must be a number`;
    if (p.type === "string[]" && (!Array.isArray(v) || v.some((x) => typeof x !== "string")))
      return `param ${name} must be an array of strings`;
  }
  for (const group of spec.oneOf ?? []) {
    const present = group.filter((g) => params[g] !== undefined && params[g] !== null);
    if (present.length !== 1) return `give exactly one of ${group.join(", ")}`;
  }
  return null;
}

// Agents name parameters loosely (the live benchmark saw `lib` for `library` and regex `pattern`
// for literal text). Map the common aliases onto the schema before checking; the original params
// stay in the stored claim.
const ALIASES: Record<string, Record<string, string[]>> = {
  "*": { path: ["file", "filePath", "file_path", "subject"] },
  "native.links": { library: ["lib", "dll", "dylib", "so", "name", "needed"] },
  "pkg.has-dependency": { name: ["dependency", "package", "pkg", "dep"] },
  "pkg.has-install-script": { hook: ["script", "lifecycle"] },
  "js.imports": { specifier: ["module", "import", "from", "source"] },
  "endpoint.present": { host: ["hostname", "domain", "url"] },
  "archive.contains": { entry: ["file", "member", "name", "entryName"] },
  "file.identify": { format: ["type", "kind"] },
  "file.contains": { text: ["string", "needle", "pattern", "substring"] },
};

const REGEX_META = /[.*+?()[\]{}|^$\\]/;

/** A regex that only escapes metacharacters is literal text; anything else is not re-run. */
export function literalFromPattern(pattern: string): string | null {
  const unescaped = pattern.replace(/\\([.*+?()[\]{}|^$\\/-])/g, "$1");
  const rest = pattern.replace(/\\[.*+?()[\]{}|^$\\/-]/g, "");
  return REGEX_META.test(rest) ? null : unescaped;
}

export function normalizeParams(predicate: string, params: Record<string, Json>): Record<string, Json> {
  const out: Record<string, Json> = { ...params };
  const maps = { ...(ALIASES["*"] ?? {}), ...(ALIASES[predicate] ?? {}) };
  for (const [canonical, aliases] of Object.entries(maps)) {
    if (out[canonical] !== undefined && out[canonical] !== null) continue;
    for (const a of aliases) {
      if (out[a] === undefined || out[a] === null) continue;
      let v = out[a]!;
      if (predicate === "endpoint.present" && a === "url" && typeof v === "string") {
        try {
          v = new URL(v).hostname;
        } catch {
          continue;
        }
      }
      if (predicate === "file.contains" && a === "pattern" && typeof v === "string") {
        const lit = literalFromPattern(v);
        if (lit === null) continue;
        v = lit;
      }
      out[canonical] = v;
      delete out[a];
      break;
    }
  }
  return out;
}

/** One line per predicate, for the claim tool's description: `native.links{path,library}`. */
export function predicateCatalog(): string {
  return Object.values(PREDICATES)
    .map((p) => {
      const names = Object.entries(p.params).map(([k, v]) => (v.required ? k : `${k}?`));
      const groups = (p.oneOf ?? []).map((g) => g.join("|"));
      const shown = names.filter((n) => !(p.oneOf ?? []).flat().includes(n.replace("?", "")));
      return `${p.predicate}{${[...shown, ...groups].join(",")}}`;
    })
    .join(" ")
    .concat(' | any predicate: negate:true when the text states an absence ("does not use eval")');
}
