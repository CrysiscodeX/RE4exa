// LC_FUNCTION_STARTS on real Apple Silicon libraries: the function addresses reax takes from the
// table equal llvm-objdump 18 --macho --function-starts (bench/corpus/functionstarts.facts.json), on
// the LearnHarness dylib and addons (the zig fixtures carry empty tables). Needs the npm registry,
// so REAX_CORPUS=1.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { test } from "node:test";
import { corpusDir, FSTARTS_FACTS, fetchCorpus, localPath } from "../scripts/corpus.ts";
import { runOperation } from "../src/ops/registry.ts";

const skip = process.env.REAX_CORPUS === "1" ? false : "needs the npm registry: set REAX_CORPUS=1 (every CI lane does)";
const FACTS = JSON.parse(readFileSync(FSTARTS_FACTS, "utf8")).facts as Record<
  string,
  { count: number; sha256: string }
>;
// biome-ignore lint/suspicious/noExplicitAny: operation data is JSON
type Any = any;

/** Every procedure of a file, all pages. */
async function procedures(path: string, workspace: string) {
  const out: { addr: string; sources: string[] }[] = [];
  for (let offset = 0; ; ) {
    const r = await runOperation("inventory.procedures", { path, offset, limit: 10000 }, { workspace });
    const d = r.data as Any;
    out.push(...d.items);
    offset += d.items.length;
    if (!d.page.next && offset >= d.page.total) return { items: out, result: r };
    if (!d.items.length) return { items: out, result: r };
  }
}
const digest = (addrs: string[]) =>
  createHash("sha256")
    .update([...addrs].sort().join("\n"))
    .digest("hex");

test("[+rea.tool/list_procedures] the function starts of real dylibs equal llvm-objdump's list, address for address", {
  skip,
}, async () => {
  const dir = corpusDir();
  let n = 0;
  for (const f of fetchCorpus(dir)) {
    const k = FACTS[f.key];
    if (!k) continue;
    const ws = mkdtempSync(join(tmpdir(), "reax-fs-"));
    try {
      cpSync(localPath(dir, f), join(ws, basename(f.path)));
      const { items } = await procedures(basename(f.path), ws);
      const starts = items.filter((x) => x.sources.includes("function-starts")).map((x) => x.addr);
      assert.equal(starts.length, k.count, f.key);
      assert.equal(digest(starts), k.sha256, f.key);
      n += starts.length;
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  }
  assert.ok(n > 40000, `${n} function starts compared`);
});

test("[-rea.tool/list_procedures] a function-starts table cut off in the middle of a number is reported, and the starts before it are kept", {
  skip,
}, async () => {
  const dir = corpusDir();
  const f = fetchCorpus(dir).find((x) => x.path.endsWith("sharp-darwin-arm64-0.35.5.node"))!;
  const ws = mkdtempSync(join(tmpdir(), "reax-fs-"));
  try {
    const b = Buffer.from(readFileSync(localPath(dir, f)));
    // find LC_FUNCTION_STARTS (0x26) and end the table inside a multi-byte number: 0x80 continues
    let p = 32;
    let off = 0;
    let size = 0;
    for (let i = 0; i < b.readUInt32LE(16); i++) {
      if (b.readUInt32LE(p) === 0x26) {
        off = b.readUInt32LE(p + 8);
        size = b.readUInt32LE(p + 12);
      }
      p += b.readUInt32LE(p + 4);
    }
    assert.ok(size > 100, "found the table");
    b.fill(0x80, off + size - 6, off + size);
    writeFileSync(join(ws, "cut.node"), b);
    const { items, result } = await procedures("cut.node", ws);
    const starts = items.filter((x) => x.sources.includes("function-starts"));
    assert.ok(
      starts.length > 100 && starts.length < FACTS[Object.keys(FACTS).find((k) => k.includes("sharp-darwin"))!]!.count,
    );
    assert.equal(result.coverage, "partial");
    assert.match(result.limitations.join(" "), /LC_FUNCTION_STARTS/);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});
