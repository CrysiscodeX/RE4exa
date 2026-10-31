// Builds the extra fixtures: binaries whose features the zig corpus does not have (a GNU build ID
// and property note, Go build information with a module dependency). They are committed and
// pinned by digest in fixtures/extra/manifest.json; the answer keys are re-derived from the
// committed bytes in CI (scripts/oracle.ts), so a rebuild is never needed to check reax. This
// script records how they were made and is run by hand when one is added.
//   node scripts/extra-fixtures.ts           build into fixtures/extra and write the manifest
//   node scripts/extra-fixtures.ts --check   the committed files match the manifest
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REAX = join(import.meta.dirname, "..");
export const EXTRA = join(REAX, "fixtures", "extra");
export const EXTRA_MANIFEST = join(EXTRA, "manifest.json");

export interface ExtraFixture {
  sha256: string;
  size: number;
  format: string;
  made: string;
}

function sh(cmd: string, args: string[], opts: { cwd?: string; env?: Record<string, string> } = {}): string {
  const r = spawnSync(cmd, args, { encoding: "utf8", cwd: opts.cwd, env: { ...process.env, ...opts.env } });
  if (r.error || r.status !== 0) throw new Error(`${cmd} ${args.join(" ")}: ${r.error?.message ?? r.stderr}`);
  return r.stdout.trim();
}

const C_SRC = `#include <stdio.h>
#include <string.h>
const char reax_note_tag[] = "reax-extra-fixture";
int reax_len(const char *s) { return (int)strlen(s); }
int main(int argc, char **argv) { printf("%s %d\\n", reax_note_tag, reax_len(argc > 1 ? argv[1] : "")); return 0; }
`;

const GO_MAIN = `package main

import (
	"fmt"

	"example.com/reaxlib"
)

func main() { fmt.Println(reaxlib.Greet("reax")) }
`;
const GO_LIB = `package reaxlib

// Greet is the dependency's one function, so the binary links the module.
func Greet(who string) string { return "hello, " + who }
`;

function build(): Record<string, ExtraFixture> {
  mkdirSync(EXTRA, { recursive: true });
  const tmp = mkdtempSync(join(tmpdir(), "reax-extra-"));
  const out: Record<string, ExtraFixture> = {};
  try {
    // C with a SHA-1 build ID and the x86 IBT/SHSTK property note
    writeFileSync(join(tmp, "note.c"), C_SRC);
    const gcc = sh("gcc", ["--version"]).split("\n")[0]!;
    const cName = "c-notes-x86_64-linux-gnu";
    sh("gcc", ["-O1", "-fcf-protection=full", "-Wl,--build-id=sha1", "-o", join(EXTRA, cName), join(tmp, "note.c")]);
    out[cName] = { ...digest(cName), format: "elf", made: `${gcc}: gcc -O1 -fcf-protection=full -Wl,--build-id=sha1` };
    // Go with a module dependency (replaced by a local path), outside any VCS checkout
    mkdirSync(join(tmp, "go", "app"), { recursive: true });
    mkdirSync(join(tmp, "go", "reaxlib"), { recursive: true });
    writeFileSync(join(tmp, "go", "reaxlib", "go.mod"), "module example.com/reaxlib\n\ngo 1.24\n");
    writeFileSync(join(tmp, "go", "reaxlib", "lib.go"), GO_LIB);
    writeFileSync(
      join(tmp, "go", "app", "go.mod"),
      "module example.com/reaxgo\n\ngo 1.24\n\nrequire example.com/reaxlib v0.1.0\n\nreplace example.com/reaxlib => ../reaxlib\n",
    );
    writeFileSync(join(tmp, "go", "app", "main.go"), GO_MAIN);
    const gov = sh("go", ["version"]);
    for (const [goos, goarch, name] of [
      ["linux", "amd64", "go-hello-x86_64-linux"],
      ["windows", "amd64", "go-hello-x86_64-windows.exe"],
    ] as const) {
      sh("go", ["build", "-trimpath", "-ldflags=-s -w", "-o", join(EXTRA, name), "."], {
        cwd: join(tmp, "go", "app"),
        env: { CGO_ENABLED: "0", GOOS: goos, GOARCH: goarch, GOFLAGS: "-mod=mod", GOTOOLCHAIN: "local" },
      });
      out[name] = {
        ...digest(name),
        format: goos === "linux" ? "elf" : "pe",
        made: `${gov}: CGO_ENABLED=0 GOOS=${goos} GOARCH=${goarch} go build -trimpath -ldflags="-s -w"`,
      };
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  return out;
}

function digest(name: string): { sha256: string; size: number } {
  const b = readFileSync(join(EXTRA, name));
  return { sha256: createHash("sha256").update(b).digest("hex"), size: b.length };
}

export function extraManifest(dir = EXTRA): Record<string, ExtraFixture> {
  return JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")).files as Record<string, ExtraFixture>;
}

/** Every way the directory differs from its manifest: a changed, unlisted or missing file. */
export function checkExtra(dir = EXTRA): string[] {
  const m = extraManifest(dir);
  const files = readdirSync(dir).filter((f) => f !== "manifest.json");
  const sha = (f: string) =>
    createHash("sha256")
      .update(readFileSync(join(dir, f)))
      .digest("hex");
  return [
    ...files.filter((f) => !m[f]).map((f) => `${f} is not in the manifest`),
    ...files.filter((f) => m[f] && sha(f) !== m[f].sha256).map((f) => `${f} does not match its digest`),
    ...Object.keys(m)
      .filter((f) => !files.includes(f))
      .map((f) => `${f} is missing`),
  ];
}

if (import.meta.main) {
  if (process.argv.includes("--check")) {
    const problems = checkExtra();
    for (const p of problems) console.error(`fixtures/extra: ${p}`);
    if (problems.length) process.exit(1);
    console.log(`fixtures/extra matches its manifest (${Object.keys(extraManifest()).length} files)`);
  } else {
    const files = build();
    writeFileSync(
      EXTRA_MANIFEST,
      `${JSON.stringify({ note: "Built by scripts/extra-fixtures.ts; pinned by digest. Do not edit.", files }, null, 1)}\n`,
    );
    console.log(`wrote ${Object.keys(files).length} extra fixtures`);
  }
}
