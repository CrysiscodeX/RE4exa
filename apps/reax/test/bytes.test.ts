// read.strings, read.bytes and search.bytes against answer keys from independent tools
// (bench/oracle/, written by scripts/oracle.ts from llvm-strings, GNU strings and Python's re),
// plus edge cases built here: window boundaries, odd-offset UTF-16, runs cut by the end of file.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { isCoreError } from "@re4exa/core/errors";
import { digestRows, SEARCH_CASES } from "../scripts/oracle.ts";
import { STRING_HOLD, type StringHit } from "../src/ops/bytes.ts";
import { runOperation } from "../src/ops/registry.ts";

const REAX = join(import.meta.dirname, "..");
const BIN = join(REAX, "fixtures", "bin");
const FILES = readdirSync(BIN).sort();
const STRINGS = JSON.parse(readFileSync(join(REAX, "bench", "oracle", "strings.json"), "utf8")) as {
  files: Record<string, { ascii: [number, string][]; utf16le: [number, string][] }>;
};
const SEARCH = JSON.parse(readFileSync(join(REAX, "bench", "oracle", "search.json"), "utf8")) as {
  files: Record<string, { count: number; sha256: string; first: number[] }[]>;
};

/** Every row of a paged operation, page by page. */
async function all<T>(op: string, args: Record<string, unknown>, workspace = BIN): Promise<T[]> {
  const out: T[] = [];
  let offset: number | null = 0;
  while (offset !== null) {
    const r = await runOperation(op, { ...args, offset, limit: 2000 }, { workspace });
    const d = r.data as { items: T[]; page: { next: number | null } };
    out.push(...d.items);
    offset = d.page.next;
  }
  return out;
}

const strs = (path: string, encoding: string, extra: Record<string, unknown> = {}, ws = BIN) =>
  all<StringHit>("read.strings", { path, encoding, max_text: STRING_HOLD, ...extra }, ws);

const refused = (code: string) => (e: unknown) => isCoreError(e) && e.code === code;

function withDir(fn: (dir: string) => Promise<void>) {
  return async () => {
    const dir = mkdtempSync(join(tmpdir(), "reax-bytes-"));
    try {
      await fn(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

test("[+rea.tool/list_strings] every fixture's ASCII strings equal llvm-strings, and its UTF-16LE strings equal GNU strings -e l", async () => {
  assert.equal(Object.keys(STRINGS.files).length, FILES.length, "the key covers every fixture");
  let n = 0;
  for (const f of FILES) {
    const key = STRINGS.files[f]!;
    const ascii = await strs(f, "ascii");
    assert.deepStrictEqual(
      ascii.map((s) => [s.offset, s.text]),
      key.ascii,
      `${f} ascii`,
    );
    const utf16 = await strs(f, "utf16le");
    assert.deepStrictEqual(
      utf16.map((s) => [s.offset, s.text]),
      key.utf16le,
      `${f} utf16le`,
    );
    const both = await strs(f, "all");
    assert.equal(both.length, ascii.length + utf16.length, `${f} all`);
    assert.ok(
      both.every((s, i) => i === 0 || both[i - 1]!.offset <= s.offset),
      `${f} all is in offset order`,
    );
    n += ascii.length + utf16.length;
  }
  assert.ok(n >= 2756, `${n} strings compared`);
});

test(
  "[+rea.tool/list_strings] strings across the 1 MiB read window, at odd UTF-16 offsets, and with a tab, match the definition",
  withDir(async (dir) => {
    const buf = Buffer.alloc(3 * (1 << 20) + 7, 0x01);
    const put = (at: number, b: Buffer) => b.copy(buf, at);
    put((1 << 20) - 5, Buffer.from("straddles-the-window"));
    put(1000, Buffer.from("tab\there"));
    put(2001, Buffer.from("odd-utf16", "utf16le"));
    put(3000, Buffer.from("abc")); // too short
    put(buf.length - 3, Buffer.from("end")); // cut by the end of file, under min
    put(2 * (1 << 20) + 1, Buffer.from("x".repeat(70_000)));
    writeFileSync(join(dir, "f.bin"), buf);
    const ascii = await strs("f.bin", "ascii", {}, dir);
    assert.deepStrictEqual(
      ascii.map((s) => [s.offset, s.length]),
      [
        [1000, 8],
        [(1 << 20) - 5, 20],
        [2 * (1 << 20) + 1, 70_000],
      ],
    );
    const long = ascii[2]!;
    assert.equal(long.text.length, STRING_HOLD, "text is held to STRING_HOLD; length is exact");
    const cut = (
      await runOperation("read.strings", { path: "f.bin", encoding: "ascii", offset: 2 }, { workspace: dir })
    ).data as { items: (StringHit & { cut?: boolean })[] };
    assert.equal(cut.items[0]!.text.length, 1024);
    assert.equal(cut.items[0]!.cut, true);
    const utf16 = await strs("f.bin", "utf16le", {}, dir);
    assert.deepStrictEqual(
      utf16.map((s) => [s.offset, s.text]),
      [[2001, "odd-utf16"]],
    );
    // where GNU strings is installed, it agrees on this file too
    const gnu = spawnSync("strings", ["-a", "-t", "d", "-n", "4", join(dir, "f.bin")], { encoding: "latin1" });
    if (gnu.status === 0)
      assert.deepStrictEqual(
        gnu.stdout
          .trim()
          .split("\n")
          .map((l) => Number(/^ *(\d+) /.exec(l)![1])),
        ascii.map((s) => s.offset),
      );
  }),
);

test("[-rea.tool/list_strings] bad arguments, a directory and a path outside the workspace are refused", async () => {
  const ctx = { workspace: BIN };
  for (const bad of [
    { path: FILES[0], min: 0 },
    { path: FILES[0], encoding: "utf8" },
    { path: FILES[0], max_text: 1 },
    { path: FILES[0], limit: 0 },
  ])
    await assert.rejects(runOperation("read.strings", bad, ctx), refused("bad_request"), JSON.stringify(bad));
  await assert.rejects(runOperation("read.strings", { path: "." }, ctx), refused("bad_request"));
  await assert.rejects(runOperation("read.strings", { path: "../../package.json" }, ctx), isCoreError);
  // an empty file has no strings, and says so completely
  await withDir(async (dir) => {
    writeFileSync(join(dir, "empty"), "");
    const r = await runOperation("read.strings", { path: "empty" }, { workspace: dir });
    assert.equal((r.data as { page: { total: number } }).page.total, 0);
    assert.equal(r.coverage, "complete");
  })();
});

test("[+rea.tool/search_strings] search keeps exactly the key's strings that contain the text, in either case when asked", async () => {
  for (const f of ["lib-x86_64-linux-gnu.2.28-s.so", "hello-x86_64-windows-gnu-s.exe", "hello-aarch64-macos-s"]) {
    const key = STRINGS.files[f]!.ascii;
    for (const q of ["reax", "lib", "GLIBC", "a"]) {
      const got = await strs(f, "ascii", { search: q });
      assert.deepStrictEqual(
        got.map((s) => [s.offset, s.text]),
        key.filter(([, t]) => t.includes(q)),
        `${f} ${q}`,
      );
      const folded = await strs(f, "ascii", { search: q.toUpperCase(), ignore_case: true });
      assert.deepStrictEqual(
        folded.map((s) => [s.offset, s.text]),
        key.filter(([, t]) => t.toLowerCase().includes(q.toLowerCase())),
        `${f} ${q} folded`,
      );
    }
  }
});

test("[-rea.tool/search_strings] a search that matches nothing is complete and empty; one no string can hold says why", async () => {
  const none = await runOperation(
    "read.strings",
    { path: "lib-x86_64-linux-gnu.2.28-s.so", search: "no-such-string-anywhere" },
    { workspace: BIN },
  );
  assert.equal((none.data as { page: { total: number } }).page.total, 0);
  assert.equal(none.coverage, "complete");
  const odd = await runOperation(
    "read.strings",
    { path: "lib-x86_64-linux-gnu.2.28-s.so", search: "é" },
    { workspace: BIN },
  );
  assert.equal((odd.data as { page: { total: number } }).page.total, 0);
  assert.match(odd.limitations.join(" "), /printable ASCII only/);
});

test("[+rea.tool/search_bytes] every match offset, overlapping ones included, equals Python's re on every fixture", async () => {
  let compared = 0;
  for (const f of FILES)
    for (const [i, c] of SEARCH_CASES.entries()) {
      const offs = await all<number>("search.bytes", { path: f, ...c });
      const key = SEARCH.files[f]![i]!;
      assert.deepStrictEqual(digestRows(offs), key, `${f} ${JSON.stringify(c)}`);
      compared += offs.length;
    }
  assert.ok(compared > 10_000, `${compared} offsets compared`);
});

test("[-rea.tool/search_bytes] a malformed pattern is refused, and a pattern longer than the file matches nothing", async () => {
  const ctx = { workspace: BIN };
  const f = "lib-x86_64-linux-gnu.2.28-s.so";
  for (const bad of [
    { path: f },
    { path: f, hex: "7f", text: "x" },
    { path: f, hex: "7" },
    { path: f, hex: "zz" },
    { path: f, hex: "?? ??" },
    { path: f, hex: "7f", ignore_case: true },
    { path: f, text: "" },
    { path: f, hex: "00 ".repeat(257) },
  ])
    await assert.rejects(runOperation("search.bytes", bad, ctx), refused("bad_request"), JSON.stringify(bad));
  await withDir(async (dir) => {
    writeFileSync(join(dir, "tiny"), "ab");
    const r = await runOperation("search.bytes", { path: "tiny", text: "abc" }, { workspace: dir });
    assert.equal((r.data as { page: { total: number } }).page.total, 0);
    // overlapping: "aaaa" holds "aa" at 0, 1 and 2
    writeFileSync(join(dir, "aaaa"), "aaaa");
    assert.deepStrictEqual(await all<number>("search.bytes", { path: "aaaa", text: "aa" }, dir), [0, 1, 2]);
  })();
});

test("[+rea.tool/read_bytes] [+leanrea/LEAN-C07] any slice of any fixture is exactly the file's bytes, with a hexdump", async () => {
  let seed = 7;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return seed / 2 ** 31;
  };
  for (const f of FILES) {
    const bytes = readFileSync(join(BIN, f));
    for (let k = 0; k < 5; k++) {
      const at = Math.floor(rnd() * bytes.length);
      const length = 1 + Math.floor(rnd() * 2048);
      const r = await runOperation("read.bytes", { path: f, at, length }, { workspace: BIN });
      const d = r.data as { hex: string; length: number; size: number };
      const want = bytes.subarray(at, at + length);
      assert.equal(d.hex, want.toString("hex"), `${f} @${at}+${length}`);
      assert.equal(d.length, want.length);
      assert.equal(d.size, bytes.length);
      assert.equal(r.limitations.length > 0, want.length < length, "a short read says so");
    }
  }
  const r = await runOperation(
    "read.bytes",
    { path: "hello-x86_64-linux-gnu.2.28-s", at: 16, length: 18 },
    { workspace: BIN },
  );
  assert.equal(r.text.split("\n")[1], "00000010  02 00 3e 00 01 00 00 00 80 15 00 01 00 00 00 00  |..>.............|");
});

test("[-rea.tool/read_bytes] [-leanrea/LEAN-C07] a slice past the end, of no bytes or over 64 KiB, or outside the workspace is refused", async () => {
  const ctx = { workspace: BIN };
  const f = "hello-x86_64-linux-gnu.2.28-s";
  const size = readFileSync(join(BIN, f)).length;
  for (const bad of [
    { path: f, at: size + 1 },
    { path: f, length: 0 },
    { path: f, length: 65_537 },
    { path: f, at: -1 },
  ])
    await assert.rejects(runOperation("read.bytes", bad, ctx), refused("bad_request"), JSON.stringify(bad));
  await assert.rejects(runOperation("read.bytes", { path: "../package.json" }, ctx), isCoreError);
  const end = await runOperation("read.bytes", { path: f, at: size }, ctx);
  assert.equal((end.data as { length: number }).length, 0);
});
