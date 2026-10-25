// pkg.manifest, pkg.native-addons and dir.inventory: package facts from a directory, a
// package.json, or an npm tarball (read in memory, never extracted).

import { lstatSync } from "node:fs";
import { join } from "node:path";
import type { ProbeContext } from "../../contracts.ts";
import type { Json } from "../../evidence/jcs.ts";
import { type Finding, findingKey } from "../../evidence/record.ts";
import { type AssayProbe, extOf, fail, isObject, type JsonObject, numParam, params, utf8 } from "../util.ts";
import { walkDir } from "../walk.ts";
import { ARCHIVE_CAP, type ArchiveEntry, gunzipBounded, parseTar, tarEntryData } from "./archive.ts";
import { identifyBytes } from "./identify.ts";

const ALL = ["linux", "darwin", "win32"] as ("linux" | "darwin" | "win32")[];
export const INSTALL_HOOKS = ["preinstall", "install", "postinstall", "prepare"] as const;
const DEP_SCOPES = ["dependencies", "optionalDependencies", "peerDependencies", "devDependencies"] as const;
const MANIFEST_CAP = 4 * 1024 * 1024;

interface PackageSource {
  json: unknown;
  where: string;
  files: string[] | null;
}

function isFile(p: string): boolean {
  try {
    return lstatSync(p).isFile();
  } catch {
    return false;
  }
}

function tarballEntries(b: Uint8Array): { tar: Uint8Array; entries: ArchiveEntry[] } {
  const tar = gunzipBounded(b);
  return { tar, entries: parseTar(tar, 100_000, "tar.gz").entries };
}

/** The package root inside a tarball: "package/" normally, else the single top-level directory. */
function tarballRoot(entries: ArchiveEntry[]): string {
  const pj = entries
    .filter((e) => e.type === "file" && /^[^/]+\/package\.json$/.test(e.name))
    .map((e) => e.name.split("/")[0]!);
  if (pj.includes("package")) return "package";
  if (pj.length > 0) return pj.sort()[0]!;
  return fail("npm tarball has no <root>/package.json");
}

function parseJsonText(b: Uint8Array, where: string): unknown {
  try {
    return JSON.parse(utf8(b).replace(/^﻿/, ""));
  } catch {
    return fail(`${where} is not valid JSON`);
  }
}

async function loadPackage(ctx: ProbeContext): Promise<PackageSource> {
  if (ctx.subject.kind === "directory") {
    const b = await ctx.read("package.json", MANIFEST_CAP);
    const files = isFile(join(ctx.subject.abs, "binding.gyp")) ? ["binding.gyp"] : [];
    return { json: parseJsonText(b, "package.json"), where: "package.json", files };
  }
  const b = await ctx.read(undefined, ARCHIVE_CAP);
  if (b[0] === 0x1f && b[1] === 0x8b) {
    const { tar, entries } = tarballEntries(b);
    const root = tarballRoot(entries);
    const pj = entries.find((e) => e.name === `${root}/package.json`)!;
    const files = entries.filter((e) => e.name.startsWith(`${root}/`)).map((e) => e.name.slice(root.length + 1));
    return { json: parseJsonText(tarEntryData(tar, pj, MANIFEST_CAP), pj.name), where: pj.name, files };
  }
  if (b.length > MANIFEST_CAP) fail(`package.json larger than ${MANIFEST_CAP} bytes`);
  return { json: parseJsonText(b, "package.json"), where: "package.json", files: null };
}

function strOrNull(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function strMap(v: unknown, cap: number): { map: Record<string, string>; dropped: number } {
  const map: Record<string, string> = {};
  let dropped = 0;
  if (!isObject(v)) return { map, dropped };
  for (const k of Object.keys(v).sort()) {
    const x = v[k];
    if (typeof x !== "string") continue;
    if (Object.keys(map).length >= cap) dropped++;
    else map[k] = x;
  }
  return { map, dropped };
}

function capJson(v: unknown, maxChars: number): Json {
  if (v === undefined) return null;
  const s = JSON.stringify(v);
  if (s === undefined) return null;
  return s.length > maxChars ? `<${s.length} chars, truncated>` : (JSON.parse(s) as Json);
}

export const pkgManifest: AssayProbe = {
  id: "pkg.manifest",
  version: "1",
  predicate: "pkg.manifest",
  summary: "package.json facts (name, version, entry points, bin, scripts, dependencies); flags install hooks",
  appliesTo: (i) => ["package-json", "npm-tgz", "npm-package"].includes(i.format),
  platforms: ALL,
  cost: "cheap",
  confidence: "observed",
  sweep: ["each"],
  async run(ctx) {
    const src = await loadPackage(ctx);
    const pj = src.json;
    if (!isObject(pj)) fail(`${src.where} is not a JSON object`);
    const limitations: string[] = [];
    const scripts = strMap(pj.scripts, 500).map;
    const deps: Record<string, Record<string, string>> = {};
    for (const scope of DEP_SCOPES) {
      const m = strMap(pj[scope], 5000);
      deps[scope] = m.map;
      if (m.dropped) limitations.push(`${m.dropped} ${scope} entries over the cap were dropped`);
    }
    let bin: Record<string, string> = {};
    if (typeof pj.bin === "string") {
      const n = typeof pj.name === "string" ? pj.name.replace(/^@[^/]+\//, "") : "bin";
      bin = { [n]: pj.bin };
    } else bin = strMap(pj.bin, 500).map;
    const hooks: { hook: string; command: string; implicit?: boolean }[] = [];
    for (const h of INSTALL_HOOKS) if (scripts[h] !== undefined) hooks.push({ hook: h, command: scripts[h]! });
    const hasGyp = src.files?.includes("binding.gyp") ?? false;
    if (hasGyp && scripts.install === undefined && scripts.preinstall === undefined && pj.gypfile !== false)
      hooks.push({ hook: "install", command: "node-gyp rebuild", implicit: true });
    if (src.files === null)
      limitations.push("read from a lone package.json: an implicit node-gyp install (binding.gyp) cannot be seen");
    const name = strOrNull(pj.name);
    const findings: Finding[] = [];
    for (const h of hooks)
      findings.push({
        key: findingKey("pkg.install-script", { hook: h.hook, command: h.command }),
        class: "pkg.install-script",
        label: `${h.hook}: ${h.command}${h.implicit ? " (implicit: binding.gyp)" : ""}`,
      });
    for (const scope of DEP_SCOPES)
      for (const [dep, range] of Object.entries(deps[scope]!))
        findings.push({
          key: findingKey("pkg.dependency", { scope, name: dep }),
          class: "pkg.dependency",
          label: `${dep}@${range} (${scope})`,
        });
    const result: JsonObject = {
      source: src.where,
      name,
      version: strOrNull(pj.version),
      type: strOrNull(pj.type),
      main: strOrNull(pj.main),
      module: strOrNull(pj.module),
      types: strOrNull(pj.types) ?? strOrNull(pj.typings),
      exports: capJson(pj.exports, 16_384),
      bin,
      scripts,
      dependencies: deps.dependencies!,
      optionalDependencies: deps.optionalDependencies!,
      peerDependencies: deps.peerDependencies!,
      devDependencies: deps.devDependencies!,
      installHooks: hooks as unknown as Json,
      gypfile: pj.gypfile === true || hasGyp,
    };
    return { result, findings, limitations };
  },
};

// ----------------------------------------------------------------------- native add-ons ----

const NATIVE_LOADERS = [
  "node-gyp-build",
  "node-pre-gyp",
  "@mapbox/node-pre-gyp",
  "prebuild-install",
  "bindings",
  "node-addon-api",
  "nan",
  "cmake-js",
  "@napi-rs/cli",
  "napi-build-utils",
];

export const pkgNativeAddons: AssayProbe = {
  id: "pkg.native-addons",
  version: "1",
  predicate: "pkg.native-addons",
  summary: "Native add-ons in a package: .node binaries, binding.gyp, prebuilds/, native loader dependencies",
  appliesTo: (i) => ["npm-package", "directory", "npm-tgz"].includes(i.format),
  platforms: ALL,
  cost: "cheap",
  confidence: "derived",
  sweep: ["root", "each"],
  async run(ctx) {
    const p = params(ctx.params);
    const maxFiles = numParam(p, "maxFiles", 5000, 1, 100_000);
    const addons: { path: string; format: string }[] = [];
    const gyp: string[] = [];
    const prebuilds: string[] = [];
    let pj: unknown = null;
    let skipped: { what: string; reason: string }[] = [];
    let examined = 0;
    if (ctx.subject.kind === "directory") {
      const w = walkDir(ctx.subject.abs, { maxFiles, maxDepth: 12 });
      skipped = w.skipped;
      examined = w.files.length;
      for (const f of w.files) {
        if (f.rel === "package.json") pj = parseJsonOrNull(await ctx.read("package.json", MANIFEST_CAP));
        if (extOf(f.rel) === ".node") {
          const head = await ctx.read(f.rel, 4096);
          addons.push({ path: f.rel, format: identifyBytes(head, f.rel, f.size).format });
        }
        if (f.rel.endsWith("binding.gyp") && (f.rel === "binding.gyp" || f.rel.endsWith("/binding.gyp")))
          gyp.push(f.rel);
        if (/(^|\/)prebuilds\//.test(f.rel)) prebuilds.push(f.rel);
      }
    } else {
      const b = await ctx.read(undefined, ARCHIVE_CAP);
      const { tar, entries } = tarballEntries(b);
      const root = tarballRoot(entries);
      examined = entries.length;
      for (const e of entries) {
        if (e.type !== "file" || !e.name.startsWith(`${root}/`)) continue;
        const rel = e.name.slice(root.length + 1);
        if (rel === "package.json") pj = parseJsonOrNull(tarEntryData(tar, e, MANIFEST_CAP));
        if (extOf(rel) === ".node")
          addons.push({ path: rel, format: identifyBytes(tarEntryData(tar, e, 4096), rel, e.size).format });
        if (rel === "binding.gyp" || rel.endsWith("/binding.gyp")) gyp.push(rel);
        if (/(^|\/)prebuilds\//.test(rel)) prebuilds.push(rel);
      }
    }
    const loaders: string[] = [];
    let gypfile = false;
    if (isObject(pj)) {
      gypfile = pj.gypfile === true;
      for (const scope of DEP_SCOPES) {
        const d = pj[scope];
        if (isObject(d))
          for (const n of NATIVE_LOADERS) if (d[n] !== undefined && !loaders.includes(n)) loaders.push(n);
      }
      if (isObject(pj.binary)) loaders.push("binary (node-pre-gyp config)");
    }
    const findings: Finding[] = [];
    for (const a of addons)
      findings.push({
        key: findingKey("native.addon", { path: a.path }),
        class: "native.addon",
        label: `${a.path} (${a.format})`,
      });
    for (const g of gyp)
      findings.push({
        key: findingKey("native.build", { path: g }),
        class: "native.build",
        label: `${g} (node-gyp build)`,
      });
    return {
      result: {
        addons,
        bindingGyp: gyp,
        prebuilds: prebuilds.slice(0, 500),
        loaders: loaders.sort(),
        gypfile,
        hasNative: addons.length > 0 || gyp.length > 0 || prebuilds.length > 0 || gypfile,
      },
      coverage: {
        status: skipped.length === 0 ? "complete" : "partial",
        examined,
        skipped,
        unresolved: 0,
        unclaimed: 0,
      },
      findings,
      limitations: [
        "add-ons downloaded at install time (prebuild-install, node-pre-gyp) are not in the package itself",
      ],
    };
  },
};

function parseJsonOrNull(b: Uint8Array): unknown {
  try {
    return JSON.parse(utf8(b));
  } catch {
    return null;
  }
}

// --------------------------------------------------------------------------- inventory ----

export const dirInventory: AssayProbe = {
  id: "dir.inventory",
  version: "1",
  predicate: "dir.inventory",
  summary: "Counts, sizes and extensions of the files in a directory (bounded walk; skipped parts listed)",
  appliesTo: (i) => i.kind === "directory",
  platforms: ALL,
  cost: "cheap",
  confidence: "derived",
  sweep: ["root"],
  async run(ctx) {
    if (ctx.subject.kind !== "directory") fail("dir.inventory needs a directory");
    const p = params(ctx.params);
    const maxFiles = numParam(p, "maxFiles", 2000, 1, 100_000);
    const maxDepth = numParam(p, "maxDepth", 8, 0, 64);
    const w = walkDir(ctx.subject.abs, { maxFiles, maxDepth });
    const byExt: Record<string, { files: number; bytes: number }> = {};
    let bytes = 0;
    for (const f of w.files) {
      const e = extOf(f.rel) || "(none)";
      byExt[e] ??= { files: 0, bytes: 0 };
      byExt[e].files++;
      byExt[e].bytes += f.size;
      bytes += f.size;
    }
    const sortedExt: Record<string, Json> = {};
    for (const k of Object.keys(byExt).sort()) sortedExt[k] = byExt[k]!;
    const largest = [...w.files]
      .sort((a, b) => b.size - a.size || (a.rel < b.rel ? -1 : 1))
      .slice(0, 10)
      .map((f) => ({ path: f.rel, size: f.size }));
    return {
      result: {
        files: w.files.length,
        dirs: w.dirs,
        bytes,
        byExtension: sortedExt,
        largest,
        paths: w.files.slice(0, 500).map((f) => f.rel),
        skipped: w.skipped,
      },
      coverage: {
        status: w.skipped.length === 0 ? "complete" : "partial",
        examined: w.files.length,
        skipped: w.skipped,
        unresolved: 0,
        unclaimed: 0,
      },
    };
  },
};
