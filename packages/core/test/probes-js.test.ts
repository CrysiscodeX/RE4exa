import assert from "node:assert/strict";
import { test } from "node:test";
import {
  census,
  codeObfuscation,
  endpointsFrom,
  hostOf,
  jsEndpoints,
  jsImports,
  specifierKind,
} from "../src/probes/builtin/js.ts";
import { jsxFor, tokenize } from "../src/probes/builtin/js-tokens.ts";
import { APP_JS } from "../src/testing/gen.ts";
import { runOn } from "../src/testing/harness.ts";
import { lcg } from "../src/testing/helpers.ts";

const enc = new TextEncoder();
const specs = (src: string) => census(src, tokenize(src).tokens);

test("tokenizer: comments, strings, escapes, regex vs division, nested templates", () => {
  const src = [
    "// import('a') in a line comment",
    "/* require('b') in a block comment */",
    "const s = 'it\\'s \\x41\\u0042\\u{43}';",
    'const d = "a\\\\b";',
    "const r = /re[/]x\\//g.test(s) ? a / b / c : 0;",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: JavaScript source under test
    "const t = `outer ${`inner ${x + `deep`}`} done`;",
    "if (x) { y = 1 } /not-a-regex-after-brace/",
  ].join("\n");
  const { tokens, unterminated } = tokenize(src);
  const strings = tokens.filter((t) => t.t === "string").map((t) => t.v);
  assert.deepEqual(strings, ["it's ABC", "a\\b"]);
  const regex = tokens.filter((t) => t.t === "regex").map((t) => t.v);
  assert.deepEqual(regex, ["/re[/]x\\//g"]);
  const tmpl = tokens.filter((t) => t.t === "template").map((t) => [t.v, t.part]);
  assert.deepEqual(tmpl, [
    ["outer ", "head"],
    ["inner ", "head"],
    ["deep", "whole"],
    ["", "tail"],
    [" done", "tail"],
  ]);
  assert.ok(!tokens.some((t) => t.t === "ident" && (t.v === "import" || t.v === "require")));
  assert.deepEqual(unterminated, []);
  const line = tokens.find((t) => t.t === "template" && t.v === "outer ")!.line;
  assert.equal(line, 6);
});

test("tokenizer: JSX in .tsx/.jsx is read as JSX (found on LearnHarness: closing tags were read as regexes)", () => {
  const src = [
    'import { a } from "./a";',
    "export default function App({ children }) {",
    "  return (",
    '    <Shell title="x" href="https://docs.example.org/start" onClick={() => require("./clicked")}>',
    "      {/* a comment child */}",
    "      <>",
    '        <Item label={<Badge n={1} />} data-x="y" />',
    "        Text that says import x from 'not-an-import' and has a / slash",
    "      </>",
    "      <AppShell>{children}</AppShell>",
    "    </Shell>",
    "  );",
    "}",
    "const re = /a\\/b/g;",
  ].join("\n");
  const r = tokenize(src, undefined, { jsx: true });
  assert.deepEqual(r.unterminated, [], "no closing tag is read as a regex");
  assert.deepEqual(
    r.tokens.filter((t) => t.t === "regex").map((t) => t.v),
    ["/a\\/b/g"],
    "a real regex after the JSX is still a regex",
  );
  const strings = r.tokens.filter((t) => t.t === "string").map((t) => t.v);
  assert.ok(strings.includes("https://docs.example.org/start"), "attribute strings are string tokens");
  assert.ok(!strings.includes("not-an-import"), "JSX text is not code");
  const found = census(src, r.tokens)
    .imports.map((f) => f.specifier)
    .sort();
  assert.deepEqual(found, ["./a", "./clicked"], "code inside {...} is read; text is not");
  assert.ok(endpointsFrom(r.tokens).urls.some((u) => u.host === "docs.example.org"));
  assert.equal(r.tokens.find((t) => t.t === "regex")!.line, 14, "line numbers stay right through JSX");
});

test("tokenizer: JSX mode is per extension, and TypeScript generics in .tsx are not taken for JSX", () => {
  assert.deepEqual(
    ["a.tsx", "a.jsx", "a.js", "a.mjs", "a.cjs", "a.ts", "a.mts", "a.cts", "a.json", "Makefile"].map(jsxFor),
    [true, true, true, true, true, false, false, false, false, false],
  );
  // .ts: <T>x is a type assertion, read as before
  const ts = tokenize("const v = <Foo>bar; const re = /x/;", undefined, { jsx: jsxFor("a.ts") });
  assert.deepEqual(ts.unterminated, []);
  // .tsx: a generic arrow (<T,>) fails fast; a constrained generic (<T extends ...>) runs to the
  // end and is rolled back; JSX after both is still read as JSX
  const tsx = [
    "const id = <T,>(x: T) => x;",
    "const first = <T extends unknown[]>(xs: T) => xs[0];",
    'const el = <div title="ok">a / b</div>;',
    "const re = /y\\/z/;",
  ].join("\n");
  const r = tokenize(tsx, undefined, { jsx: true });
  assert.deepEqual(r.unterminated, []);
  assert.deepEqual(
    r.tokens.filter((t) => t.t === "regex").map((t) => t.v),
    ["/y\\/z/"],
  );
  assert.ok(
    r.tokens.some((t) => t.t === "string" && t.v === "ok"),
    "the JSX after the generics was read as JSX",
  );
  assert.ok(
    r.tokens.some((t) => t.t === "ident" && t.v === "extends"),
    "the rolled-back generic was read as code",
  );
});

test("tokenizer: comments inside a JSX tag, and TypeScript's non-null assertion before a division (both from LearnHarness)", () => {
  const tag = [
    "const d = (",
    "  <div",
    '    role="dialog"',
    "    // a line comment between attributes",
    "    /* and a block one */",
    "    {...rest}",
    "  >",
    "    <p>{a}</p>",
    "  </div>",
    ");",
  ].join("\n");
  assert.deepEqual(tokenize(tag, undefined, { jsx: true }).unterminated, []);
  for (const jsx of [false, true]) {
    const r = tokenize(
      "const ux = sumX[ci]! / cnt[ci]! - px;\nconst a = img.data[i + 3]! / 255;\nconst re = !/x/.test(s);",
      undefined,
      { jsx },
    );
    assert.deepEqual(r.unterminated, [], `jsx ${jsx}`);
    assert.deepEqual(
      r.tokens.filter((t) => t.t === "regex").map((t) => t.v),
      ["/x/"],
      "a prefix ! still starts a regex",
    );
  }
});

test("tokenizer: hostile JSX-like input stays linear and never throws", () => {
  for (const unit of ["(<a>", "(<a b={", "<a {...", "=<a></", "(<T extends X>"]) {
    const src = unit.repeat(20_000);
    const t0 = performance.now();
    const r = tokenize(src, undefined, { jsx: true });
    const ms = performance.now() - t0;
    assert.ok(r.tokens.length > 0, unit);
    assert.ok(ms < 3000, `${JSON.stringify(unit)} x 20000 took ${Math.round(ms)} ms`);
  }
});

test("tokenizer: unterminated string, template and comment are reported, never thrown", () => {
  for (const [src, kind] of [
    ['const a = "abc\nnext()', "string"],
    ["const t = `abc ${x", "template"],
    ["/* open", "comment"],
  ] as const) {
    const r = tokenize(src);
    assert.equal(r.unterminated[0]?.kind, kind, src);
  }
  assert.equal(tokenize("#!/usr/bin/env node\nimport 'x'").tokens[0]?.v, "import");
});

test("census: every loading form, resolved and unresolved", () => {
  const src = `
import a from "./a.js";
import "./side.js";
import * as ns from "node:fs";
import { x as y, z } from 'pkg/sub';
import type { T } from "./types.ts";
export * from "./re.js";
export { q } from "./q.js";
export { local };
const r1 = require("dep");
const r2 = require(name);
const r3 = require.resolve("resolved-dep");
const m = module.require("mod-req");
const d1 = await import("./lazy.js");
const d2 = await import(\`./tpl.js\`);
const d3 = await import("./plugins/" + id);
const d4 = await import(\`./x/\${id}.js\`);
const w1 = new Worker(new URL("./worker.js", import.meta.url));
const w2 = new SharedWorker(url);
const res = import.meta.resolve("./res.js");
import { createRequire } from "node:module";
const req = createRequire(import.meta.url);
const viaAlias = req("aliased");
createRequire(import.meta.url)("lost");
process.dlopen(module, "./native.node");
process.dlopen(module, path);
obj.import("no"); obj.require("no"); function require(x) {}
`;
  const c = specs(src);
  const got = c.imports.map((i) => `${i.form}:${i.specifier}`);
  assert.deepEqual(got, [
    "static-import:./a.js",
    "static-import:./side.js",
    "static-import:node:fs",
    "static-import:pkg/sub",
    "static-import:./types.ts",
    "export-from:./re.js",
    "export-from:./q.js",
    "require:dep",
    "require:resolved-dep",
    "require:mod-req",
    "dynamic-import:./lazy.js",
    "dynamic-import:./tpl.js",
    "worker-url:./worker.js",
    "import-meta-resolve:./res.js",
    "static-import:node:module",
    "require:aliased",
    "process-dlopen:./native.node",
  ]);
  assert.deepEqual(
    c.unresolved.map((u) => u.form),
    ["require", "dynamic-import", "dynamic-import", "worker-url", "process-dlopen"],
  );
  assert.equal(c.unclaimed.length, 1);
  assert.deepEqual(c.forms["create-require"], { found: 2, resolved: 1 });
  assert.deepEqual(c.forms["dynamic-import"], { found: 4, resolved: 2 });
  assert.deepEqual(c.forms.require, { found: 5, resolved: 4 });
});

test("census ignores loads inside comments, strings and plain template text", () => {
  const c = specs(APP_JS);
  assert.deepEqual(
    c.imports.map((i) => i.specifier),
    ["node:fs", "./lib/helper.js", "./reexport.js", "./config.json", "./worker.js", "./lazy.js"],
  );
  assert.equal(c.unresolved.length, 0);
  // biome-ignore lint/suspicious/noTemplateCurlyInString: JavaScript source under test
  const tpl = specs("const s = `import('./x.js') ${import('./real.js')}`;");
  assert.deepEqual(
    tpl.imports.map((i) => i.specifier),
    ["./real.js"],
  );
});

test("specifier kinds", () => {
  assert.equal(specifierKind("./a"), "relative");
  assert.equal(specifierKind("/abs"), "absolute");
  assert.equal(specifierKind("https://x/y.js"), "url");
  assert.equal(specifierKind("node:fs"), "node-builtin");
  assert.equal(specifierKind("fs/promises"), "node-builtin");
  assert.equal(specifierKind("@scope/pkg"), "bare");
});

test("js.imports probe: coverage, forms, one finding per specifier", async () => {
  const out = await runOn(jsImports, enc.encode(APP_JS), "src/app.js");
  assert.equal(out.coverage?.status, "complete");
  assert.equal(out.coverage?.examined, 1);
  assert.equal(out.findings?.length, 6);
  assert.ok(out.findings?.every((f) => f.class === "js.import"));
  assert.deepEqual(out.coverage?.forms?.["worker-url"], { found: 1, resolved: 1 });
});

test("M9 coverage honesty: an ablation corpus with expression loads is never complete", async () => {
  const rnd = lcg(9);
  const literal = [
    'import a from "./a.js";',
    'const b = require("b");',
    'export * from "./c.js";',
    'await import("./d.js");',
  ];
  const dynamic = [
    "await import(name);",
    'await import("./p/" + name);',
    // biome-ignore lint/suspicious/noTemplateCurlyInString: JavaScript source under test
    "await import(`./p/${name}.js`);",
    "require(variable);",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: JavaScript source under test
    "require(`./${x}`);",
    "new Worker(workerUrl);",
    "import.meta.resolve(spec);",
    "process.dlopen(module, nativePath);",
    "const r = makeIt(createRequire(import.meta.url));",
  ];
  let partial = 0;
  let complete = 0;
  for (let i = 0; i < 300; i++) {
    const lines = Array.from({ length: 2 + Math.floor(rnd() * 5) }, () => literal[Math.floor(rnd() * literal.length)]!);
    const inject = i % 3 !== 0;
    if (inject) lines.splice(Math.floor(rnd() * lines.length), 0, dynamic[i % dynamic.length]!);
    // decoys that must not change the verdict: loads inside comments and strings
    lines.push(
      `// ${dynamic[(i + 1) % dynamic.length]}`,
      `const s = ${JSON.stringify(dynamic[(i + 2) % dynamic.length])};`,
    );
    const out = await runOn(jsImports, enc.encode(lines.join("\n")), `f${i}.js`);
    if (inject) {
      assert.notEqual(out.coverage?.status, "complete", lines.join("\n"));
      assert.ok((out.coverage?.unresolved ?? 0) + (out.coverage?.unclaimed ?? 0) > 0);
      partial++;
    } else {
      assert.equal(out.coverage?.status, "complete", lines.join("\n"));
      complete++;
    }
  }
  assert.equal(partial, 200);
  assert.equal(complete, 100);
  // a truncated (unterminated) file is never complete either
  const cut = await runOn(jsImports, enc.encode('import a from "./a.js";\nconst t = `unterminated'), "cut.js");
  assert.equal(cut.coverage?.status, "partial");
});

test("js.endpoints: URLs and bare hosts in literals, one finding per host, dynamic URL templates counted", async () => {
  const src = `
const a = "https://api.example.com/v1?x=1";
const b = 'wss://user:pw@live.example.org:8443/socket';
const c = \`https://\${host}/path\`;
const d = "cdn.example.net";
const e = "index.js";
// https://comment.example.com is not code
const f = "http://[::1]:8080/x";
`;
  const { urls, dynamic } = endpointsFrom(tokenize(src).tokens);
  assert.deepEqual(
    urls.map((u) => [u.host, u.scheme]),
    [
      ["api.example.com", "https"],
      ["live.example.org", "wss"],
      ["cdn.example.net", null],
      ["[::1]", "http"],
    ],
  );
  assert.equal(dynamic, 1);
  assert.equal(hostOf("User@Example.COM:443"), "example.com");
  // biome-ignore lint/suspicious/noTemplateCurlyInString: JavaScript source under test
  assert.equal(hostOf("${x}"), null);
  const out = await runOn(jsEndpoints, enc.encode(src), "a.js");
  assert.equal(out.findings?.length, 4);
  assert.ok(out.findings?.every((f) => f.class === "net.host"));
  assert.equal(out.coverage?.status, "partial");
  assert.equal(jsEndpoints.confidence, "derived");
});

test("code.obfuscation: plain, minified and obfuscated samples; confidence inferred with limitations", async () => {
  const plain = await runOn(codeObfuscation, enc.encode(APP_JS), "a.js");
  assert.equal((plain.result as { verdict: string }).verdict, "plain");
  const minified = `${Array.from({ length: 400 }, (_, i) => `function f${i}(a,b){return a+b*${i}}`).join(";")}\n`;
  const m = await runOn(codeObfuscation, enc.encode(minified), "m.js");
  assert.equal((m.result as { verdict: string }).verdict, "minified");
  assert.equal(m.findings?.length, 0);
  const ids = Array.from({ length: 60 }, (_, i) => `_0x${(0x1a2b + i * 7).toString(16)}`);
  const obf = `var ${ids[0]}=['\\x68\\x65\\x6c\\x6c\\x6f','\\x77\\x6f\\x72\\x6c\\x64'];${ids
    .map(
      (id, i) =>
        `function ${id}(${ids[(i + 1) % 60]}){return ${ids[0]}[${ids[(i + 2) % 60]}-0x${i.toString(16)}]+'\\x2e\\x2f\\x78';}`,
    )
    .join("")}`;
  const o = await runOn(codeObfuscation, enc.encode(obf), "o.js");
  const r = o.result as { verdict: string; signals: string[] };
  assert.equal(r.verdict, "likely-obfuscated");
  assert.ok(r.signals.includes("hex-identifiers"));
  assert.equal(o.findings?.[0]?.class, "code.obfuscated");
  assert.equal(codeObfuscation.confidence, "inferred");
  assert.ok((o.limitations ?? []).some((l) => l.includes("heuristic")));
});
