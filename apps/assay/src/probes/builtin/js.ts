// js.imports (a census of every module-loading form), js.endpoints (URLs and hosts in string
// literals) and code.obfuscation (a stated heuristic). All work on tokens, never on raw text, so
// comments and string contents are not mistaken for code.

import type { ProbeContext } from "../../contracts.ts";
import type { Json } from "../../evidence/jcs.ts";
import { type Coverage, type Finding, findingKey } from "../../evidence/record.ts";
import { type AssayProbe, extOf, fail, numParam, params } from "../util.ts";
import { walkDir } from "../walk.ts";
import { familiesOf } from "./identify.ts";
import { type Tok, tokenize } from "./js-tokens.ts";

const ALL = ["linux", "darwin", "win32"] as ("linux" | "darwin" | "win32")[];
/** Bytes of one source file the JS probes read. */
export const JS_CAP = 4 * 1024 * 1024;
const JS_FILE_EXT = new Set([".js", ".mjs", ".cjs", ".jsx", ".ts", ".mts", ".cts", ".tsx"]);

export const FORMS = [
  "static-import",
  "export-from",
  "require",
  "dynamic-import",
  "worker-url",
  "import-meta-resolve",
  "create-require",
  "process-dlopen",
] as const;
export type Form = (typeof FORMS)[number];

export interface ImportSite {
  specifier: string;
  form: Form;
  line: number;
  file?: string;
}

export interface OpenSite {
  form: Form;
  line: number;
  snippet: string;
  file?: string;
}

export interface Census {
  imports: ImportSite[];
  unresolved: OpenSite[];
  unclaimed: OpenSite[];
  forms: Record<Form, { found: number; resolved: number }>;
}

const NODE_CORE = new Set(
  (
    "assert async_hooks buffer child_process cluster console constants crypto dgram diagnostics_channel dns domain " +
    "events fs http http2 https inspector module net os path perf_hooks process punycode querystring readline repl " +
    "stream string_decoder sys timers tls trace_events tty url util v8 vm wasi worker_threads zlib test sqlite sea"
  ).split(" "),
);

export function specifierKind(s: string): string {
  if (s.startsWith("./") || s.startsWith("../") || s === "." || s === "..") return "relative";
  if (s.startsWith("/")) return "absolute";
  if (/^[a-z][a-z0-9+.-]*:/i.test(s) && !s.startsWith("node:")) return "url";
  if (s.startsWith("node:") || NODE_CORE.has(s.split("/")[0]!)) return "node-builtin";
  return "bare";
}

function isP(t: Tok | undefined, v: string): boolean {
  return t !== undefined && t.t === "punct" && t.v === v;
}

function isI(t: Tok | undefined, v: string): boolean {
  return t !== undefined && t.t === "ident" && t.v === v;
}

function isLit(t: Tok | undefined): t is Tok {
  return t !== undefined && (t.t === "string" || (t.t === "template" && t.part === "whole"));
}

function closes(t: Tok | undefined): boolean {
  return isP(t, ")") || isP(t, ",");
}

export function census(src: string, toks: Tok[]): Census {
  const forms = Object.fromEntries(FORMS.map((f) => [f, { found: 0, resolved: 0 }])) as Census["forms"];
  const out: Census = { imports: [], unresolved: [], unclaimed: [], forms };
  const aliases = new Set<string>();
  const snippet = (t: Tok) => src.slice(t.s, t.s + 80).replace(/\s+/g, " ");
  const hit = (form: Form, spec: Tok, at: Tok) => {
    forms[form].found++;
    forms[form].resolved++;
    out.imports.push({ specifier: spec.v, form, line: at.line });
  };
  const open = (form: Form, at: Tok) => {
    forms[form].found++;
    out.unresolved.push({ form, line: at.line, snippet: snippet(at) });
  };
  /** A call whose first argument starts at index j. */
  const call = (form: Form, j: number, at: Tok) => {
    if (isLit(toks[j]) && closes(toks[j + 1])) hit(form, toks[j]!, at);
    else open(form, at);
  };
  /** `import … from "x"` / `export … from "x"`: scan forward to `from <literal>`. */
  const scanFrom = (form: Form, j: number, at: Tok) => {
    for (let k = j; k < toks.length && k < j + 400; k++) {
      const tk = toks[k]!;
      if (isI(tk, "from") && isLit(toks[k + 1])) {
        hit(form, toks[k + 1]!, at);
        return;
      }
      if (tk.t === "punct" && (tk.v === ";" || tk.v === "=" || tk.v === "(" || tk.v === ")")) return;
      if (tk.t === "string" || tk.t === "template") return;
      if (k > j && (isI(tk, "import") || isI(tk, "export"))) return;
    }
  };
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]!;
    if (t.t !== "ident") continue;
    const prev = toks[i - 1];
    const nx = toks[i + 1];
    const afterDot = isP(prev, ".") || isP(prev, "?.");
    switch (t.v) {
      case "import":
        if (afterDot) break;
        if (isP(nx, "(")) call("dynamic-import", i + 2, t);
        else if (isP(nx, ".")) {
          if (isI(toks[i + 2], "meta") && isP(toks[i + 3], ".") && isI(toks[i + 4], "resolve") && isP(toks[i + 5], "("))
            call("import-meta-resolve", i + 6, t);
        } else if (isLit(nx)) hit("static-import", nx, t);
        else scanFrom("static-import", i + 1, t);
        break;
      case "export":
        if (afterDot) break;
        if (isP(nx, "*") || isP(nx, "{") || (isI(nx, "type") && (isP(toks[i + 2], "{") || isP(toks[i + 2], "*"))))
          scanFrom("export-from", i + 1, t);
        break;
      case "require":
        if ((afterDot && !isI(toks[i - 2], "module")) || isI(prev, "function")) break;
        if (isP(nx, "(")) call("require", i + 2, t);
        else if (isP(nx, ".") && isI(toks[i + 2], "resolve") && isP(toks[i + 3], "(")) call("require", i + 4, t);
        break;
      case "createRequire": {
        if (!isP(nx, "(") || isI(prev, "function")) break;
        forms["create-require"].found++;
        let j = i;
        while (isP(toks[j - 1], ".") && toks[j - 2]?.t === "ident") j -= 2;
        const bound = isP(toks[j - 1], "=") && toks[j - 2]?.t === "ident" ? toks[j - 2]!.v : null;
        if (bound) {
          aliases.add(bound);
          forms["create-require"].resolved++;
        } else out.unclaimed.push({ form: "create-require", line: t.line, snippet: snippet(t) });
        break;
      }
      case "Worker":
      case "SharedWorker": {
        if (!isI(prev, "new") || !isP(nx, "(")) break;
        const j = i + 2;
        if (
          isI(toks[j], "new") &&
          isI(toks[j + 1], "URL") &&
          isP(toks[j + 2], "(") &&
          isLit(toks[j + 3]) &&
          closes(toks[j + 4])
        )
          hit("worker-url", toks[j + 3]!, t);
        else call("worker-url", j, t);
        break;
      }
      case "dlopen": {
        if (!afterDot || !isI(toks[i - 2], "process") || !isP(nx, "(")) break;
        let depth = 0;
        let arg = -1;
        for (let k = i + 2; k < toks.length && k < i + 400; k++) {
          const tk = toks[k]!;
          if (tk.t === "punct" && (tk.v === "(" || tk.v === "[" || tk.v === "{")) depth++;
          else if (tk.t === "punct" && (tk.v === ")" || tk.v === "]" || tk.v === "}")) {
            if (depth === 0) break;
            depth--;
          } else if (isP(tk, ",") && depth === 0) {
            arg = k + 1;
            break;
          }
        }
        if (arg > 0) call("process-dlopen", arg, t);
        else open("process-dlopen", t);
        break;
      }
      default:
        if (aliases.has(t.v) && !afterDot && isP(nx, "(") && !isI(prev, "function")) call("require", i + 2, t);
    }
  }
  return out;
}

interface FileCensus extends Census {
  skipped: { what: string; reason: string }[];
}

export function censusText(text: string, label: string, clipped: boolean): FileCensus & { tokens: Tok[] } {
  const tk = tokenize(text);
  const c = census(text, tk.tokens);
  const skipped: { what: string; reason: string }[] = [];
  if (clipped) skipped.push({ what: `${label} after ${JS_CAP} bytes`, reason: "size cap" });
  if (tk.truncated) skipped.push({ what: `${label} tail`, reason: "token cap" });
  for (const u of tk.unterminated)
    skipped.push({ what: `${label}:${u.line}`, reason: `unterminated ${u.kind}; the rest of the file may be misread` });
  return { ...c, skipped, tokens: tk.tokens };
}

function isJsLike(i: { format: string; kind: string }): boolean {
  const fam = (i as { families?: string[] }).families ?? familiesOf(i.format);
  return fam.includes("javascript") || fam.includes("typescript");
}

/** Files to examine: the subject itself, or the JS/TS files of a directory (bounded walk). */
async function sources(
  ctx: ProbeContext,
  maxFiles: number,
  extra: Set<string> = new Set(),
): Promise<{
  files: { rel: string | undefined; label: string; text: string; clipped: boolean }[];
  skipped: Coverage["skipped"];
}> {
  const decode = (b: Uint8Array) => new TextDecoder().decode(b.subarray(0, JS_CAP));
  if (ctx.subject.kind === "file") {
    const b = await ctx.read(undefined, JS_CAP + 1);
    return {
      files: [{ rel: undefined, label: ctx.subject.path, text: decode(b), clipped: b.length > JS_CAP }],
      skipped: [],
    };
  }
  const w = walkDir(ctx.subject.abs, {
    maxFiles,
    filter: (rel) => JS_FILE_EXT.has(extOf(rel)) || extra.has(extOf(rel)),
  });
  const files = [];
  for (const f of w.files) {
    const b = await ctx.read(f.rel, JS_CAP + 1);
    files.push({ rel: f.rel, label: f.rel, text: decode(b), clipped: b.length > JS_CAP });
  }
  return { files, skipped: w.skipped };
}

export const jsImports: AssayProbe = {
  id: "js.imports",
  version: "1",
  predicate: "js.imports",
  summary:
    "Census of module loading: import/export-from, require, dynamic import, worker URLs, import.meta.resolve, createRequire, process.dlopen",
  appliesTo: (i) => i.kind === "directory" || isJsLike(i),
  platforms: ALL,
  cost: "cheap",
  confidence: "derived",
  sweep: ["each"],
  async run(ctx) {
    const p = params(ctx.params);
    const maxFiles = numParam(p, "maxFiles", 2000, 1, 20_000);
    const src = await sources(ctx, maxFiles);
    const forms = Object.fromEntries(FORMS.map((f) => [f, { found: 0, resolved: 0 }])) as Census["forms"];
    const imports: ImportSite[] = [];
    const unresolved: OpenSite[] = [];
    const unclaimed: OpenSite[] = [];
    const skipped = [...src.skipped];
    for (const f of src.files) {
      const c = censusText(f.text, f.label, f.clipped);
      for (const k of FORMS) {
        forms[k].found += c.forms[k].found;
        forms[k].resolved += c.forms[k].resolved;
      }
      const tag = <T extends { file?: string }>(x: T): T => (f.rel === undefined ? x : { ...x, file: f.rel });
      imports.push(...c.imports.map(tag));
      unresolved.push(...c.unresolved.map(tag));
      unclaimed.push(...c.unclaimed.map(tag));
      skipped.push(...c.skipped);
    }
    const specs = new Map<string, Set<string>>();
    for (const s of imports) {
      if (!specs.has(s.specifier)) specs.set(s.specifier, new Set());
      specs.get(s.specifier)!.add(s.form);
    }
    const findings: Finding[] = [...specs.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .slice(0, 2000)
      .map(([spec, fs]) => ({
        key: findingKey("js.import", { specifier: spec }),
        class: "js.import",
        label: `${spec} (${[...fs].sort().join(", ")})`,
      }));
    const coverage: Coverage = {
      status: unresolved.length === 0 && unclaimed.length === 0 && skipped.length === 0 ? "complete" : "partial",
      examined: src.files.length,
      skipped,
      unresolved: unresolved.length,
      unclaimed: unclaimed.length,
      forms,
    };
    return {
      result: {
        imports: imports.slice(0, 2000).map((s) => ({ ...s, kind: specifierKind(s.specifier) })) as unknown as Json,
        specifiers: [...specs.keys()].sort().slice(0, 2000),
        forms: forms as unknown as Json,
        unresolved: unresolved.slice(0, 200) as unknown as Json,
        unclaimed: unclaimed.slice(0, 200) as unknown as Json,
        truncated: imports.length > 2000 || unresolved.length > 200,
      },
      coverage,
      findings,
      limitations: [
        "eval, new Function and string-built code are not followed",
        "loads through a variable alias of require (other than a createRequire binding) are not seen",
        "JSX text containing quotes can be misread as a string literal",
      ],
    };
  },
};

// ---------------------------------------------------------------------------- endpoints ----

const URL_RE = /\b(https?|wss?|ftp):\/\/([^\s"'`<>\\/?#]*)([^\s"'`<>\\]*)/gi;
const BARE_HOST_RE =
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|net|org|io|dev|app|ai|co|cloud|xyz|me|info|biz|us|uk|de|ru|cn|jp|tech|site|online|sh|gg|so|to|ly)$/i;

export function hostOf(authority: string): string | null {
  let a = authority.slice(authority.lastIndexOf("@") + 1);
  if (a.startsWith("[")) {
    const e = a.indexOf("]");
    return e > 0 ? a.slice(0, e + 1).toLowerCase() : null;
  }
  a = a.split(":")[0]!.toLowerCase().replace(/\.$/, "");
  return /^[a-z0-9_-]+(\.[a-z0-9_-]+)*$/.test(a) ? a : null;
}

export interface UrlHit {
  url: string;
  host: string;
  scheme: string | null;
  line: number;
  file?: string;
}

export function endpointsFrom(toks: Tok[]): { urls: UrlHit[]; dynamic: number } {
  const urls: UrlHit[] = [];
  let dynamic = 0;
  for (const t of toks) {
    if (t.t !== "string" && t.t !== "template") continue;
    const v = t.v;
    if (t.t === "template" && t.sub && /(https?|wss?):\/\/[^\s/]*$/i.test(v)) dynamic++;
    if (v.includes("://")) {
      URL_RE.lastIndex = 0;
      let m = URL_RE.exec(v);
      while (m) {
        const host = hostOf(m[2]!);
        if (host) urls.push({ url: m[0].slice(0, 300), host, scheme: m[1]!.toLowerCase(), line: t.line });
        m = URL_RE.exec(v);
      }
    } else if (v.length <= 253 && BARE_HOST_RE.test(v)) {
      urls.push({ url: v, host: v.toLowerCase(), scheme: null, line: t.line });
    }
  }
  return { urls, dynamic };
}

function endpointLike(i: { format: string; kind: string }): boolean {
  if (i.kind === "directory") return true;
  const fam = (i as { families?: string[] }).families ?? familiesOf(i.format);
  return fam.includes("javascript") || fam.includes("typescript") || fam.includes("json");
}

export const jsEndpoints: AssayProbe = {
  id: "js.endpoints",
  version: "1",
  predicate: "js.endpoints",
  summary: "URLs and host names in string and template literals (capped), one finding per host",
  appliesTo: endpointLike,
  platforms: ALL,
  cost: "cheap",
  confidence: "derived",
  sweep: ["each"],
  async run(ctx) {
    const p = params(ctx.params);
    const maxFiles = numParam(p, "maxFiles", 2000, 1, 20_000);
    const src = await sources(ctx, maxFiles, new Set([".json"]));
    const urls: UrlHit[] = [];
    let dynamic = 0;
    const skipped = [...src.skipped];
    for (const f of src.files) {
      const tk = tokenize(f.text);
      const e = endpointsFrom(tk.tokens);
      dynamic += e.dynamic;
      urls.push(...e.urls.map((u) => (f.rel === undefined ? u : { ...u, file: f.rel })));
      if (f.clipped) skipped.push({ what: `${f.label} after ${JS_CAP} bytes`, reason: "size cap" });
      if (tk.truncated) skipped.push({ what: `${f.label} tail`, reason: "token cap" });
    }
    const hosts = new Map<string, { count: number; schemes: Set<string> }>();
    for (const u of urls) {
      const h = hosts.get(u.host) ?? { count: 0, schemes: new Set<string>() };
      h.count++;
      if (u.scheme) h.schemes.add(u.scheme);
      hosts.set(u.host, h);
    }
    const hostList = [...hosts.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([host, h]) => ({ host, count: h.count, schemes: [...h.schemes].sort() }));
    const findings: Finding[] = hostList
      .slice(0, 1000)
      .map((h) => ({ key: findingKey("net.host", { host: h.host }), class: "net.host", label: h.host }));
    return {
      result: {
        urls: urls.slice(0, 1000) as unknown as Json,
        hosts: hostList.slice(0, 1000),
        dynamicUrls: dynamic,
        truncated: urls.length > 1000,
      },
      coverage: {
        status: dynamic === 0 && skipped.length === 0 ? "complete" : "partial",
        examined: src.files.length,
        skipped,
        unresolved: dynamic,
        unclaimed: 0,
      },
      findings,
      limitations: [
        "only string literals are scanned: hosts assembled at run time (concatenation, config, environment) are not seen",
        "a host in a literal is not proof that the program contacts it",
      ],
    };
  },
};

// -------------------------------------------------------------------------- obfuscation ----

export function obfuscationMetrics(text: string, toks: Tok[]) {
  const bytes = Buffer.from(text, "utf8");
  const counts = new Array<number>(256).fill(0);
  for (const b of bytes) counts[b]!++;
  let entropy = 0;
  for (const c of counts) if (c > 0) entropy -= (c / bytes.length) * Math.log2(c / bytes.length);
  const lines = text.split("\n");
  let maxLine = 0;
  let longChars = 0;
  for (const l of lines) {
    if (l.length > maxLine) maxLine = l.length;
    if (l.length > 1000) longChars += l.length;
  }
  const hexEsc = (text.match(/\\x[0-9a-fA-F]{2}/g) ?? []).length;
  const uniEsc = (text.match(/\\u[0-9a-fA-F]{4}/g) ?? []).length;
  let idents = 0;
  let hexIdents = 0;
  let evalLike = 0;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]!;
    if (t.t !== "ident") continue;
    idents++;
    if (/^_0x[0-9a-f]{3,}$/i.test(t.v)) hexIdents++;
    if ((t.v === "eval" || t.v === "Function" || t.v === "atob") && isP(toks[i + 1], "(")) evalLike++;
    if (t.v === "fromCharCode") evalLike++;
  }
  const kib = Math.max(1, bytes.length / 1024);
  const round = (x: number) => Math.round(x * 1000) / 1000;
  return {
    bytes: bytes.length,
    lines: lines.length,
    maxLineLength: maxLine,
    longLineShare: round(bytes.length ? longChars / bytes.length : 0),
    entropy: round(entropy),
    escapesPerKiB: round((hexEsc + uniEsc) / kib),
    escapes: hexEsc + uniEsc,
    identifiers: idents,
    hexIdentifierShare: round(idents ? hexIdents / idents : 0),
    hexIdentifiers: hexIdents,
    evalLike,
  };
}

export function obfuscationVerdict(m: ReturnType<typeof obfuscationMetrics>): { verdict: string; signals: string[] } {
  const signals: string[] = [];
  if (m.hexIdentifiers >= 10 && m.hexIdentifierShare > 0.05) signals.push("hex-identifiers");
  if (m.escapes >= 20 && m.escapesPerKiB > 8) signals.push("escape-density");
  if (m.entropy > 5.6 && m.bytes >= 4096) signals.push("high-entropy");
  if (m.evalLike >= 3) signals.push("eval-like");
  if (m.longLineShare > 0.5) signals.push("long-lines");
  const obf =
    signals.includes("hex-identifiers") ||
    signals.includes("escape-density") ||
    (signals.includes("high-entropy") && signals.includes("eval-like"));
  return { verdict: obf ? "likely-obfuscated" : signals.includes("long-lines") ? "minified" : "plain", signals };
}

export const codeObfuscation: AssayProbe = {
  id: "code.obfuscation",
  version: "1",
  predicate: "code.obfuscation",
  summary: "Heuristic obfuscation signals: long lines, byte entropy, escape density, _0x identifiers, eval-like calls",
  appliesTo: (i) => i.kind === "file" && isJsLike(i),
  platforms: ALL,
  cost: "cheap",
  confidence: "inferred",
  sweep: ["each"],
  async run(ctx) {
    if (ctx.subject.kind !== "file") fail("code.obfuscation needs a file");
    const b = await ctx.read(undefined, JS_CAP + 1);
    const text = new TextDecoder().decode(b.subarray(0, JS_CAP));
    const m = obfuscationMetrics(text, tokenize(text).tokens);
    const v = obfuscationVerdict(m);
    const findings: Finding[] =
      v.verdict === "likely-obfuscated"
        ? [
            {
              key: findingKey("code.obfuscated", { signals: v.signals }),
              class: "code.obfuscated",
              label: `likely obfuscated (${v.signals.join(", ")})`,
            },
          ]
        : [];
    return {
      result: { verdict: v.verdict, signals: v.signals, metrics: m },
      findings,
      limitations: [
        "heuristic: thresholds are set by hand, not calibrated on a labelled corpus",
        "minified is not obfuscated: a minified verdict says nothing about intent",
        "packed or encrypted payloads inside strings are not decoded",
        ...(b.length > JS_CAP ? [`only the first ${JS_CAP} bytes were measured`] : []),
      ],
    };
  },
};
