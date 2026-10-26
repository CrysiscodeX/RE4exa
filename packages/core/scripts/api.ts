// Core's public API, as TypeScript declarations, pinned in api-snapshot.txt. A change to an
// exported signature shows up as a diff of this file in review, and CI fails until the snapshot
// is updated on purpose (pi-durable shipped API changes without notice).
//   node scripts/api.ts --write                 regenerate api-snapshot.txt
//   node scripts/api.ts --check [--snapshot f]  fail and name the changed modules on any difference
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

const root = join(import.meta.dirname, "..");
const snapshotArg = process.argv.indexOf("--snapshot");
const SNAPSHOT = snapshotArg > 0 ? process.argv[snapshotArg + 1]! : join(root, "api-snapshot.txt");

function declarations(): Map<string, string> {
  const out = mkdtempSync(join(tmpdir(), "core-api-"));
  try {
    const tsc = createRequire(import.meta.url).resolve("typescript/bin/tsc");
    const r = spawnSync(
      process.execPath,
      [
        tsc,
        "-p",
        "tsconfig.build.json",
        "--declaration",
        "--emitDeclarationOnly",
        "--sourceMap",
        "false",
        "--outDir",
        out,
      ],
      { cwd: root, encoding: "utf8" },
    );
    if (r.status !== 0) throw new Error(`tsc failed:\n${r.stdout}${r.stderr}`);
    const files = new Map<string, string>();
    const walk = (d: string) => {
      for (const f of readdirSync(d).sort()) {
        const p = join(d, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (f.endsWith(".d.ts"))
          files.set(relative(out, p).replaceAll("\\", "/"), readFileSync(p, "utf8").replaceAll("\r\n", "\n"));
      }
    };
    walk(out);
    return files;
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

function render(files: Map<string, string>): string {
  return [...files].map(([f, text]) => `//// ${f}\n${text.trimEnd()}\n`).join("\n");
}

function parse(text: string): Map<string, string> {
  const files = new Map<string, string>();
  for (const part of text
    .replaceAll("\r\n", "\n")
    .split(/^\/\/\/\/ /m)
    .slice(1)) {
    const nl = part.indexOf("\n");
    files.set(part.slice(0, nl), part.slice(nl + 1).trim());
  }
  return files;
}

const now = declarations();
if (process.argv.includes("--write")) {
  writeFileSync(SNAPSHOT, render(now));
  console.log(`${now.size} modules -> ${relative(root, SNAPSHOT)}`);
} else if (process.argv.includes("--check")) {
  const was = parse(readFileSync(SNAPSHOT, "utf8"));
  const changed: string[] = [];
  for (const [f, text] of now)
    if (!was.has(f)) changed.push(`added: ${f}`);
    else if (was.get(f) !== text.trim()) changed.push(`changed: ${f}`);
  for (const f of was.keys()) if (!now.has(f)) changed.push(`removed: ${f}`);
  for (const c of changed) console.error(c);
  console.log(
    changed.length
      ? `core's API differs from the snapshot in ${changed.length} modules; run node scripts/api.ts --write if intended`
      : `core's API matches the snapshot (${now.size} modules)`,
  );
  process.exit(changed.length ? 1 : 0);
} else {
  console.error("usage: api.ts --write | --check [--snapshot file]");
  process.exit(2);
}
