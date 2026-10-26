// Differential tests against the system `file` and `readelf -d`, when present.

import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { getEvidence } from "../src/evidence/store.ts";
import { createProbeEngine } from "../src/probes/engine.ts";
import { which } from "../src/probes/router.ts";
import { fixtureSet } from "../src/testing/gen.ts";
import { openTemp, tmp } from "../src/testing/helpers.ts";
import { runProcess } from "../src/vendor/orca-process-host/run-process.ts";

const FILE_WORDS: Record<string, RegExp> = {
  elf: /^ELF /,
  pe: /^(MS-DOS executable )?PE32\+? executable/, // macOS's file(1) names the DOS stub first
  macho: /^Mach-O /,
  "macho-fat": /^Mach-O universal binary/,
  wasm: /WebAssembly/,
  zip: /^Zip archive/,
  tar: /tar archive/,
  "tar.gz": /^gzip compressed/,
  "npm-tgz": /^gzip compressed/,
  gzip: /^gzip compressed/,
  asar: /ASAR|^data$|^Matlab v4 mat-file/, // no ASAR magic in file(1): "data", or macOS's weak Matlab v4 guess
  sqlite: /^SQLite 3/,
  pdf: /^PDF document/,
  png: /^PNG image/,
  jpeg: /^JPEG image/,
  pcap: /pcap capture file/,
  "java-class": /compiled Java class/,
  json: /JSON|text/,
  text: /text/,
};

async function sh(program: string, args: string[]): Promise<string> {
  const r = await runProcess({ program, args, timeoutMs: 10_000, maxOutputBytes: 1 << 20 });
  assert.equal(r.code, 0, `${program} ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
}

function readelfNeeded(out: string): string[] {
  return [...out.matchAll(/\(NEEDED\)\s+Shared library: \[([^\]]+)\]/g)].map((m) => m[1]!);
}

test("differential vs file(1): our identification agrees on every fixture `file` knows", async (t) => {
  if (!which("file")) {
    t.skip("file(1) not on PATH");
    return;
  }
  const w = tmp("assay-diff-");
  const store = openTemp();
  try {
    const engine = createProbeEngine({ kernel: store.k, workspace: w.dir, which: () => null });
    let compared = 0;
    const disagree: string[] = [];
    for (const fx of fixtureSet()) {
      const re = FILE_WORDS[fx.format];
      if (!re || fx.files.length !== 1) continue;
      const f = fx.files[0]!;
      mkdirSync(join(w.dir, fx.name));
      const rel = `${fx.name}/${f.rel.split("/").pop()}`;
      writeFileSync(join(w.dir, rel), f.bytes);
      const theirs = (await sh("file", ["-b", join(w.dir, rel)])).trim();
      const ours = (await engine.run({ caseId: null, probeId: "file.identify", path: rel })).result as {
        format: string;
      };
      assert.equal(ours.format, fx.format);
      if (!re.test(theirs)) disagree.push(`${fx.name}: file says "${theirs}"`);
      compared++;
    }
    assert.deepEqual(disagree, []);
    t.diagnostic(`file(1) agreed on ${compared} fixtures`);
    assert.ok(compared >= 15);
  } finally {
    store.cleanup();
    w.cleanup();
  }
});

test("differential vs readelf -d: NEEDED libraries of the ELF fixture and of /bin/ls", async (t) => {
  if (!which("readelf")) {
    t.skip("readelf not on PATH");
    return;
  }
  const w = tmp("assay-diff-elf-");
  const store = openTemp();
  try {
    const engine = createProbeEngine({ kernel: store.k, workspace: w.dir, which: () => null });
    writeFileSync(join(w.dir, "tiny.so"), fixtureSet().find((f) => f.name === "elf")!.files[0]!.bytes);
    const subjects = ["tiny.so"];
    const ls = ["/bin/ls", "/usr/bin/ls"].find((p) => existsSync(p));
    if (ls) {
      copyFileSync(realpathSync(ls), join(w.dir, "ls"));
      subjects.push("ls");
    } else t.diagnostic("no /bin/ls; comparing the fixture only");
    for (const s of subjects) {
      const theirs = readelfNeeded(await sh("readelf", ["-dW", join(w.dir, s)]));
      const rec = await engine.run({ caseId: null, probeId: "elf.info", path: s });
      const ours = (rec.result as { needed: string[] }).needed;
      assert.deepEqual(ours, theirs, s);
      assert.ok(getEvidence(store.k, rec.observation_id));
      const ident = (await engine.run({ caseId: null, probeId: "file.identify", path: s })).result as {
        format: string;
      };
      assert.equal(ident.format, "elf");
      t.diagnostic(`readelf -d ${s}: NEEDED ${theirs.join(", ") || "(none)"} — equal`);
    }
  } finally {
    store.cleanup();
    w.cleanup();
  }
});
