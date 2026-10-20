#!/usr/bin/env node
// JS/TS extractor for dissect. Reads absolute file paths (one per line) on stdin
// and writes one JSON object per file on stdout. Parsing is inert: no code runs.

import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { parse } from "@babel/parser";

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_CALLS = 400;
const LIFECYCLE = /^(start|stop|close|dispose|cleanup|shutdown|teardown|setup|init|initialize|open|resume|retry|restart|reconnect|heartbeat|checkpoint|commit|rollback|abort|cancel|drain|flush|claim|release|acquire|spawn|kill|terminate|attach|detach|connect|disconnect|recover|restore|migrate|compact|expire|evict|schedule|tick|poll|run|serve|listen|watch)/i;
const STATE_WORDS = new Set(["pending", "running", "completed", "failed", "cancelled", "canceled", "sleeping", "queued", "succeeded", "aborted", "timeout", "timed_out", "open", "closed", "resolved", "blocked", "investigating", "contradicted", "idle", "busy", "active", "parked", "faulted", "suspended", "draining", "ready", "starting", "stopping", "stopped", "exited", "expired", "retrying"]);

const plugins = (path) => {
  const ts = /\.(c|m)?tsx?$/.test(path);
  const jsx = /\.(t|j)sx$/.test(path) || /\.jsx?$/.test(path);
  return [ts ? ["typescript", { dts: path.endsWith(".d.ts") }] : null, jsx && !path.endsWith(".ts") ? "jsx" : null, "importAttributes", "decorators-legacy", "explicitResourceManagement"].filter(Boolean);
};

const firstDocLine = (node) => {
  const c = node?.leadingComments?.at(-1);
  if (!c) return null;
  const text = c.value.replace(/^\*+/, "").split("\n").map((l) => l.replace(/^\s*\*\s?/, "").trim()).filter(Boolean)[0];
  return text ? text.slice(0, 240) : null;
};
const calleeName = (c) => {
  if (!c) return null;
  if (c.type === "Identifier") return c.name;
  if (c.type === "MemberExpression" || c.type === "OptionalMemberExpression") {
    const p = c.property?.type === "Identifier" ? c.property.name : c.property?.type === "StringLiteral" ? c.property.value : null;
    const o = c.object?.type === "Identifier" ? c.object.name : c.object?.type === "ThisExpression" ? "this" : c.object?.type === "MemberExpression" ? calleeName(c.object) : null;
    return p ? (o ? `${o}.${p}` : p) : null;
  }
  return null;
};
const str = (n) => (n?.type === "StringLiteral" ? n.value : n?.type === "TemplateLiteral" && n.expressions.length === 0 ? n.quasis[0].value.cooked : null);

function extract(path) {
  const out = { path, symbols: [], imports: [], calls: [], env: [], signals: [], events: [], timers: 0, schemas: [], tools: [], commands: [], states: [], lifecycle: [], errors: null };
  let source;
  try { source = readFileSync(path, "utf8"); } catch (e) { out.errors = e.code; return out; }
  if (source.length > MAX_BYTES) { out.errors = "too-large"; return out; }
  let ast;
  try { ast = parse(source, { sourceType: "unambiguous", errorRecovery: true, attachComment: true, plugins: plugins(path) }); }
  catch (e) { out.errors = `parse: ${String(e.message).slice(0, 120)}`; return out; }
  const stack = [];
  const exported = new Set();
  const pushSym = (kind, name, node, extra = {}) => {
    if (!name) return;
    const sym = { kind, name, line: node.loc?.start.line ?? null, end: node.loc?.end.line ?? null, doc: firstDocLine(node), parent: stack.at(-1) ?? null, ...extra };
    out.symbols.push(sym);
    if ((kind === "function" || kind === "method") && LIFECYCLE.test(name)) out.lifecycle.push({ name, line: sym.line, owner: sym.parent });
  };
  const visit = (node, parent) => {
    if (!node || typeof node.type !== "string") return;
    let pushed = false;
    switch (node.type) {
      case "ImportDeclaration": if (node.importKind !== "type") out.imports.push(node.source.value); break;
      case "ExportNamedDeclaration": case "ExportAllDeclaration":
        if (node.source) out.imports.push(node.source.value);
        if (node.declaration?.id?.name) exported.add(node.declaration.id.name);
        for (const d of node.declaration?.declarations ?? []) if (d.id?.name) exported.add(d.id.name);
        for (const s of node.specifiers ?? []) exported.add(s.exported?.name ?? s.exported?.value);
        break;
      case "ExportDefaultDeclaration": exported.add(node.declaration?.id?.name ?? "default"); break;
      case "FunctionDeclaration": pushSym("function", node.id?.name, parent?.type?.startsWith("Export") ? parent : node, { params: node.params.length, async: node.async }); stack.push(node.id?.name); pushed = true; break;
      case "ClassDeclaration": case "ClassExpression": pushSym("class", node.id?.name, parent?.type?.startsWith("Export") ? parent : node); stack.push(node.id?.name); pushed = true; break;
      case "ClassMethod": case "ClassPrivateMethod": case "TSDeclareMethod": {
        const n = node.key?.name ?? node.key?.id?.name ?? str(node.key);
        pushSym("method", n, node, { params: node.params?.length ?? 0, async: node.async }); break;
      }
      case "TSInterfaceDeclaration": pushSym("interface", node.id?.name, parent?.type?.startsWith("Export") ? parent : node); break;
      case "TSTypeAliasDeclaration": pushSym("type", node.id?.name, parent?.type?.startsWith("Export") ? parent : node); break;
      case "TSEnumDeclaration": pushSym("enum", node.id?.name, node); break;
      case "VariableDeclarator": {
        const init = node.init;
        const name = node.id?.name;
        if (name && init && (init.type === "ArrowFunctionExpression" || init.type === "FunctionExpression")) {
          pushSym("function", name, parent?.declarations?.length === 1 ? parent : node, { params: init.params.length, async: init.async }); stack.push(name); pushed = true;
        }
        if (name && init?.type === "CallExpression") {
          const c = calleeName(init.callee) ?? "";
          if (/^z\.(object|strictObject|looseObject|discriminatedUnion|union|enum)$/.test(c) || /\bz\.(object|strictObject)$/.test(c)) out.schemas.push({ name, lib: "zod", line: node.loc?.start.line });
          if (/^(Type\.Object|t\.Object|v\.object|yup\.object|Joi\.object)$/.test(c)) out.schemas.push({ name, lib: c.split(".")[0], line: node.loc?.start.line });
        }
        break;
      }
      case "MemberExpression": {
        // process.env.NAME / process.env["NAME"]
        if (node.object?.type === "MemberExpression" && node.object.object?.name === "process" && node.object.property?.name === "env") {
          const n = node.property?.type === "Identifier" && !node.computed ? node.property.name : str(node.property);
          if (n) out.env.push(n);
        }
        break;
      }
      case "CallExpression": case "OptionalCallExpression": {
        const name = calleeName(node.callee);
        const a0 = str(node.arguments?.[0]);
        if (name) {
          if (out.calls.length < MAX_CALLS) out.calls.push({ from: stack.at(-1) ?? null, to: name, line: node.loc?.start.line });
          const last = name.split(".").at(-1);
          if (/^(process\.on|process\.once)$/.test(name) && a0 && /^SIG/.test(a0)) out.signals.push(a0);
          else if (/^(on|once|addListener|addEventListener|off|removeListener|emit|dispatchEvent)$/.test(last) && a0 && a0.length < 80) out.events.push({ op: last, name: a0 });
          if (/^(setInterval|setTimeout|setImmediate)$/.test(last)) out.timers++;
          if (/^(registerTool|tool|addTool)$/.test(last) && a0 && /^[a-z][a-z0-9_.-]{1,63}$/i.test(a0)) out.tools.push(a0);
          if (/^(command|addCommand|subcommand)$/.test(last) && a0 && /^[a-z][\w:-]{0,40}( |$)/i.test(a0)) out.commands.push(a0.split(" ")[0]);
          if (name === "require" && a0) out.imports.push(a0);
          if (node.callee?.type === "Import" && a0) out.imports.push(a0);
        }
        break;
      }
      case "ImportExpression": { const s = str(node.source); if (s) out.imports.push(s); break; }
      case "StringLiteral": if (STATE_WORDS.has(node.value) && parent?.type !== "ImportDeclaration") out.states.push(node.value); break;
      case "TSLiteralType": { const v = node.literal?.value; if (typeof v === "string" && STATE_WORDS.has(v)) out.states.push(v); break; }
    }
    for (const key of Object.keys(node)) {
      if (key === "loc" || key === "leadingComments" || key === "trailingComments" || key === "innerComments" || key === "extra") continue;
      const v = node[key];
      if (Array.isArray(v)) { for (const c of v) if (c && typeof c.type === "string") visit(c, node); }
      else if (v && typeof v.type === "string") visit(v, node);
    }
    if (pushed) stack.pop();
  };
  visit(ast.program, null);
  for (const s of out.symbols) s.exported = exported.has(s.name);
  out.env = [...new Set(out.env)];
  out.signals = [...new Set(out.signals)];
  out.states = [...new Set(out.states)];
  out.tools = [...new Set(out.tools)];
  out.commands = [...new Set(out.commands)];
  out.imports = [...new Set(out.imports)];
  return out;
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of rl) {
  const path = line.trim();
  if (path) process.stdout.write(JSON.stringify(extract(path)) + "\n");
}
