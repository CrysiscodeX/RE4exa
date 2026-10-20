#!/usr/bin/env node
// Independent ground truth for REA's analysis of its own npm package.
// Built from file bytes, a Babel parse, and literal patterns; it never calls REA.
//
// usage: node answer-key.mjs <package-dir> <older-package-dir> <out.json>

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { execFileSync } from "node:child_process";

const [pkgDir, oldDir, outPath] = process.argv.slice(2).map((p) => resolve(p));
const { parse } = createRequire(join(pkgDir, "package.json"))("@babel/parser");

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const posix = (p) => p.split(sep).join("/");

function walk(root, skip = new Set(["node_modules"])) {
  const out = [];
  const visit = (dir) => {
    for (const name of readdirSync(dir)) {
      if (skip.has(name)) continue;
      const abs = join(dir, name);
      const st = statSync(abs);
      if (st.isDirectory()) visit(abs);
      else if (st.isFile()) out.push(abs);
    }
  };
  visit(root);
  return out.sort();
}

const kindOf = (rel) => {
  const ext = extname(rel);
  if ([".js", ".mjs", ".cjs"].includes(ext)) return "javascript";
  if (ext === ".node") return "native-addon";
  if ([".py", ".java", ".swift"].includes(ext)) return "bridge-source";
  if (ext === ".json") return "json";
  if (ext === ".map") return "source-map";
  if ([".md", ".txt", ""].includes(ext)) return "text";
  return ext.slice(1) || "other";
};

function inventory(root) {
  const files = {};
  for (const abs of walk(root)) {
    const rel = posix(relative(root, abs));
    const buf = readFileSync(abs);
    files[rel] = { sha256: sha256(buf), bytes: buf.length, kind: kindOf(rel) };
  }
  return files;
}

const files = inventory(pkgDir);
const oldFiles = inventory(oldDir);
const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));

// ---- module graph from a plain parse -------------------------------------------------
const jsFiles = Object.keys(files).filter((f) => files[f].kind === "javascript");
const edges = []; // {from, to, kind, line}
const externals = new Map(); // bare specifier package -> count
const spawnSites = [];
const resolveSites = [];
const urlRefs = []; // {from, target, line, base}
const parseFailures = [];

const resolveRelative = (fromRel, spec) => {
  const abs = resolve(pkgDir, dirname(fromRel), spec);
  const rel = posix(relative(pkgDir, abs));
  return files[rel] ? rel : null;
};
const bareName = (spec) =>
  spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0];

function walkAst(node, visit) {
  if (!node || typeof node.type !== "string") return;
  visit(node);
  for (const key of Object.keys(node)) {
    if (key === "loc" || key === "start" || key === "end") continue;
    const v = node[key];
    if (Array.isArray(v)) v.forEach((c) => c && typeof c.type === "string" && walkAst(c, visit));
    else if (v && typeof v.type === "string") walkAst(v, visit);
  }
}

const CHILD_PROCESS_FNS = new Set(["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]);

for (const rel of jsFiles) {
  const source = readFileSync(join(pkgDir, rel), "utf8");
  let ast;
  try {
    ast = parse(source, {
      sourceType: rel.endsWith(".cjs") ? "script" : "module",
      errorRecovery: true,
      plugins: ["importAttributes"],
    });
  } catch (error) {
    parseFailures.push({ file: rel, message: String(error.message).slice(0, 200) });
    continue;
  }
  const cpBindings = new Map(); // local name -> imported fn
  const cpNamespaces = new Set();
  const addSpec = (spec, kind, line) => {
    if (spec.startsWith(".") || spec.startsWith("/")) {
      const to = resolveRelative(rel, spec);
      edges.push({ from: rel, to, spec, kind, line });
    } else if (spec.startsWith("#")) {
      const target = pkg.imports?.[spec];
      edges.push({ from: rel, to: target ? posix(target.replace(/^\.\//, "")) : null, spec, kind: `${kind}-subpath`, line });
    } else if (!spec.startsWith("node:")) {
      const name = bareName(spec);
      externals.set(name, (externals.get(name) ?? 0) + 1);
    }
  };
  walkAst(ast.program, (n) => {
    const line = n.loc?.start.line;
    if ((n.type === "ImportDeclaration" || n.type === "ExportNamedDeclaration" || n.type === "ExportAllDeclaration") && n.source) {
      if (n.importKind === "type" || n.exportKind === "type") return;
      addSpec(n.source.value, "static", line);
      if (n.type === "ImportDeclaration" && /^(node:)?child_process$/.test(n.source.value)) {
        for (const s of n.specifiers) {
          if (s.type === "ImportSpecifier") cpBindings.set(s.local.name, s.imported.name ?? s.imported.value);
          else cpNamespaces.add(s.local.name);
        }
      }
    }
    if (n.type === "ImportExpression" || (n.type === "CallExpression" && n.callee.type === "Import")) {
      const arg = n.source ?? n.arguments?.[0];
      if (arg?.type === "StringLiteral") addSpec(arg.value, "dynamic", line);
      else edges.push({ from: rel, to: null, spec: null, kind: "dynamic-nonliteral", line });
    }
    if (n.type === "CallExpression") {
      const c = n.callee;
      // import.meta.resolve("x")
      if (c.type === "MemberExpression" && c.object.type === "MetaProperty" && c.property.name === "resolve") {
        const arg = n.arguments[0];
        if (arg?.type === "StringLiteral") {
          resolveSites.push({ file: rel, spec: arg.value, line });
          if (arg.value.startsWith("#")) addSpec(arg.value, "import-meta-resolve", line);
        }
      }
      // require("x") (CommonJS files)
      if (c.type === "Identifier" && c.name === "require" && n.arguments[0]?.type === "StringLiteral")
        addSpec(n.arguments[0].value, "require", line);
      // child_process calls bound from an import
      let fn;
      if (c.type === "Identifier" && cpBindings.has(c.name)) fn = cpBindings.get(c.name);
      if (c.type === "MemberExpression" && c.object.type === "Identifier" && cpNamespaces.has(c.object.name) && c.property.type === "Identifier") fn = c.property.name;
      if (fn && CHILD_PROCESS_FNS.has(fn)) {
        const a0 = n.arguments[0];
        spawnSites.push({ file: rel, fn, line, literal_command: a0?.type === "StringLiteral" ? a0.value : null });
      }
    }
    // new URL("lit", import.meta.url) or new URL("lit", new URL("lit2", import.meta.url).href)
    if (n.type === "NewExpression" && n.callee.type === "Identifier" && n.callee.name === "URL" && n.arguments[0]?.type === "StringLiteral") {
      const base = n.arguments[1];
      let baseRel = null;
      if (base?.type === "MemberExpression" && base.object.type === "MetaProperty") baseRel = rel;
      if (base?.type === "MemberExpression" && base.object.type === "NewExpression" && base.object.arguments[0]?.type === "StringLiteral" && base.object.arguments[1]?.type === "MemberExpression" && base.object.arguments[1].object.type === "MetaProperty")
        baseRel = posix(relative(pkgDir, resolve(pkgDir, dirname(rel), base.object.arguments[0].value)));
      if (baseRel !== null) {
        const target = posix(relative(pkgDir, resolve(pkgDir, dirname(baseRel), n.arguments[0].value)));
        urlRefs.push({ from: rel, target, exists: Boolean(files[target]), line, logical_base: baseRel });
      }
    }
  });
}

// Module files reached only through new URL("x.js", import.meta.url) (worker and child entry points).
for (const r of urlRefs)
  if (r.exists && /\.(m|c)?js$/.test(r.target)) edges.push({ from: r.from, to: r.target, spec: r.target, kind: "url-module", line: r.line });

// ---- reachability from the declared bin entry ---------------------------------------
const reach = (seeds, kinds) => {
  const seen = new Set(seeds);
  const queue = [...seeds];
  while (queue.length) {
    const cur = queue.shift();
    for (const e of edges) if (e.from === cur && e.to && kinds.has(e.kind) && !seen.has(e.to)) { seen.add(e.to); queue.push(e.to); }
  }
  return seen;
};
const binEntries = [...new Set(Object.values(pkg.bin ?? {}))].map((p) => posix(p.replace(/^\.\//, "")));
const importKinds = new Set(["static", "dynamic", "require"]);
const reachImports = reach(binEntries, importKinds);
const reachAll = reach(binEntries, new Set([...importKinds, "import-meta-resolve-subpath", "static-subpath", "dynamic-subpath", "url-module"]));
const unreachedJs = jsFiles.filter((f) => !reachAll.has(f) && f.startsWith("dist/"));

// ---- literal checks REA's own patterns would hit ------------------------------------
const vendorPatterns = {
  webpack: ["__webpack_require__", "webpackChunk"], Rspack: ["__webpack_require__.f", "rspackChunk"],
  Vite: ["__vite__", "import.meta.hot"], Rollup: ["ROLLUP_FILE_URL", "import.meta.ROLLUP"],
  esbuild: ["__commonJS", "__esm"], React: ["React.createElement", "react/jsx-runtime"],
  Vue: ["__VUE__", "createApp("], "Next.js": ["__NEXT_DATA__", "/_next/"], Angular: ["ɵɵdefineComponent"], Svelte: ["svelte/internal"],
};
const vendorSubstringHits = {};
for (const rel of jsFiles) {
  const src = readFileSync(join(pkgDir, rel), "utf8");
  for (const [name, pats] of Object.entries(vendorPatterns)) if (pats.some((p) => src.includes(p))) (vendorSubstringHits[name] ??= []).push(rel);
}
const sourceMappingComments = jsFiles.filter((rel) => /\/[/*][#@]\s*sourceMappingURL=/.test(readFileSync(join(pkgDir, rel), "utf8")));

// ---- native payloads (objdump / nm / manifest) --------------------------------------
const run = (cmd, args) => { try { return execFileSync(cmd, args, { encoding: "utf8", maxBuffer: 64 << 20 }); } catch (e) { return `ERROR ${e.message}`; } };
const winRel = "native/windows/build/rea-windows-x64.node";
const manifestPath = join(pkgDir, "native/windows/build/manifest.json");
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : null;
const ptyAbs = join(pkgDir, "node_modules/@lydell/node-pty-linux-x64/pty.node");
const native = {
  windows_addon: {
    path: winRel,
    sha256: files[winRel]?.sha256 ?? null,
    manifest,
    objdump_file_format: run("objdump", ["-f", join(pkgDir, winRel)]).trim().split("\n").slice(-3),
    pe_exports: (run("objdump", ["-p", join(pkgDir, winRel)]).match(/\[Ordinal\/Name Pointer\] Table[\s\S]*?\n\n/)?.[0] ?? "").trim().split("\n").slice(1).map((l) => l.trim()),
    pe_dll_imports: [...run("objdump", ["-p", join(pkgDir, winRel)]).matchAll(/DLL Name: (\S+)/g)].map((m) => m[1]),
    has_resource_section: /\.rsrc/.test(run("objdump", ["-h", join(pkgDir, winRel)])),
  },
  node_pty_linux_x64: existsSync(ptyAbs) ? {
    path: posix(relative(pkgDir, ptyAbs)),
    sha256: sha256(readFileSync(ptyAbs)),
    elf_header: run("readelf", ["-h", ptyAbs]).split("\n").filter((l) => /Class|Machine|Type/.test(l)).map((l) => l.trim()),
    dynamic_exports: run("nm", ["-D", "--defined-only", ptyAbs]).trim().split("\n").map((l) => l.split(" ").pop()).filter(Boolean),
    needed: [...run("readelf", ["-d", ptyAbs]).matchAll(/\(NEEDED\).*\[(.+)\]/g)].map((m) => m[1]),
    has_go_buildinfo: /\.go\.buildinfo/.test(run("readelf", ["-S", ptyAbs])),
    has_rust_dep_v0: /\.dep-v0/.test(run("readelf", ["-S", ptyAbs])),
  } : null,
};

// ---- version diff truth -------------------------------------------------------------
const all = new Set([...Object.keys(files), ...Object.keys(oldFiles)]);
const diff = { added: [], removed: [], changed: [], unchanged: [] };
for (const f of [...all].sort()) {
  if (!oldFiles[f]) diff.added.push(f);
  else if (!files[f]) diff.removed.push(f);
  else if (oldFiles[f].sha256 !== files[f].sha256) diff.changed.push(f);
  else diff.unchanged.push(f);
}
const jsOnly = (list) => list.filter((f) => kindOf(f) === "javascript");

const kinds = {};
for (const f of Object.values(files)) kinds[f.kind] = (kinds[f.kind] ?? 0) + 1;

const out = {
  package: { name: pkg.name, version: pkg.version, main: pkg.main ?? null, bin: pkg.bin, imports: pkg.imports ?? null, exports: pkg.exports ?? null },
  inventory: { file_count: Object.keys(files).length, by_kind: kinds, total_bytes: Object.values(files).reduce((a, f) => a + f.bytes, 0) },
  javascript: {
    file_count: jsFiles.length,
    parse_failures: parseFailures,
    edge_counts: Object.fromEntries([...new Set(edges.map((e) => e.kind))].map((k) => [k, edges.filter((e) => e.kind === k).length])),
    unresolved_relative_edges: edges.filter((e) => e.to === null && e.spec && e.spec.startsWith(".")),
    bin_entries: binEntries,
    bin_entry_edges: edges.filter((e) => binEntries.includes(e.from)),
    subpath_edges: edges.filter((e) => e.kind.endsWith("-subpath")),
    reachable_from_bin_via_imports: reachImports.size,
    reachable_from_bin_incl_subpath_and_url_modules: reachAll.size,
    url_module_edges: edges.filter((e) => e.kind === "url-module").map(({ from, to, line }) => ({ from, to, line })),
    dist_js_unreachable_from_bin: { count: unreachedJs.length, bytes: unreachedJs.reduce((a, f) => a + files[f].bytes, 0), sample: unreachedJs.slice(0, 15) },
    external_packages: Object.fromEntries([...externals.entries()].sort((a, b) => b[1] - a[1])),
    declared_dependencies: Object.keys(pkg.dependencies ?? {}),
    import_meta_resolve_sites: resolveSites,
    child_process_call_sites: { count: spawnSites.length, literal_command: spawnSites.filter((s) => s.literal_command).length, sites: spawnSites },
    url_refs_to_bridges: urlRefs.filter((r) => r.target.startsWith("bridge/")),
    url_refs_to_native_addon: urlRefs.filter((r) => r.target.startsWith("native/")),
    bridge_files_shipped: Object.keys(files).filter((f) => files[f].kind === "bridge-source"),
    source_mapping_url_comments: sourceMappingComments,
    source_map_files: Object.keys(files).filter((f) => f.endsWith(".map")),
    vendor_substring_hits: Object.fromEntries(Object.entries(vendorSubstringHits).map(([k, v]) => [k, { files: v.length, sample: v.slice(0, 5) }])),
  },
  native,
  version_diff_vs_older: {
    older_version: JSON.parse(readFileSync(join(oldDir, "package.json"), "utf8")).version,
    counts: Object.fromEntries(Object.entries(diff).map(([k, v]) => [k, v.length])),
    javascript_counts: Object.fromEntries(Object.entries(diff).map(([k, v]) => [k, jsOnly(v).length])),
    added_sample: diff.added.slice(0, 20),
    removed_sample: diff.removed.slice(0, 20),
  },
  file_digests: files,
};
writeFileSync(outPath, JSON.stringify(out, null, 1));
const { file_digests, ...summary } = out;
console.log(JSON.stringify(summary, (k, v) => (Array.isArray(v) && v.length > 8 ? [...v.slice(0, 8), `…(${v.length})`] : v), 1));
