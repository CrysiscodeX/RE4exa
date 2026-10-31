// inventory.rust against the RustSec project's rust-audit-info (bench/oracle/rust.json, from
// scripts/oracle.ts on the committed fixture), and on damaged copies: every damage gives a partial
// result with a limitation and the rest of the answer, never an exception. The copies are written
// to a temporary directory; the committed files are never changed.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { deflateSync } from "node:zlib";
import { EXTRA, extraManifest } from "../scripts/extra-fixtures.ts";
import { runOperation } from "../src/ops/registry.ts";
import { NO_DEPS, rustInventory } from "../src/ops/rust.ts";
import { RUST_CAPS, RUST_EDGE_CAP, RUST_LISTED_DEPS_CAP, RUST_PACKAGE_CAP } from "../src/readers/rust.ts";

const REAX = join(import.meta.dirname, "..");
const BIN = join(REAX, "fixtures", "bin");
// biome-ignore lint/suspicious/noExplicitAny: the key is JSON from another tool
type Any = any;
const KEY = JSON.parse(readFileSync(join(REAX, "bench", "oracle", "rust.json"), "utf8")).files as Record<string, Any>;
const FIXTURE = "rust-deps-aarch64-apple-darwin";

/** cargo-auditable leaves out a field at its default; both sides are compared with the defaults filled in. */
const norm = (p: Any) => ({
  name: p.name,
  version: p.version,
  source: p.source,
  kind: p.kind ?? "runtime",
  features: p.features ?? [],
  root: p.root ?? false,
  dependencies: p.dependencies ?? [],
});

async function all(path: string, workspace: string) {
  return runOperation("inventory.rust", { path, limit: 10_000 }, { workspace });
}

function temp<T>(f: (dir: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "reax-rust-"));
  return f(dir).finally(() => rmSync(dir, { recursive: true, force: true }));
}

/** A copy of the fixture whose __DATA,.dep-v0 section header points at `blob`, appended to the
 * file; `size` overrides the recorded size (to make the section run past the end). */
function withDeps(blob: Uint8Array, size = blob.length): Buffer {
  const b = Buffer.from(readFileSync(join(EXTRA, FIXTURE)));
  const name = Buffer.concat([Buffer.from(".dep-v0"), Buffer.alloc(9), Buffer.from("__DATA\0")]);
  const at = b.indexOf(name);
  assert.ok(at > 0, "the fixture has a __DATA,.dep-v0 section header");
  const off = b.length + (16 - (b.length % 16));
  const out = Buffer.concat([b, Buffer.alloc(off - b.length), blob]);
  out.writeBigUInt64LE(BigInt(size), at + 40);
  out.writeUInt32LE(off, at + 48);
  return out;
}

const doc = (packages: unknown[]) => JSON.stringify({ packages, format: 1 });
const PKGS = [
  { name: "a", version: "1.0.0", source: "crates.io" },
  { name: "b", version: "2.0.0", source: "local", features: ["x", "y"] },
  { name: "c", version: "0.1.0", source: "local", kind: "build" },
  { name: "root", version: "0.2.0", source: "local", dependencies: [0, 1, 2], root: true },
];

async function damaged(blob: Uint8Array, size?: number) {
  return temp(async (dir) => {
    writeFileSync(join(dir, "f"), withDeps(blob, size));
    const r = await all("f", dir);
    return { r, d: r.data as Any };
  });
}

/** What every damaged copy still says: it is Rust, with its rustc commit and format. */
function rest(d: Any) {
  assert.equal(d.rust, true);
  assert.equal(d.rustc, "58cf8f9c35b355199727627d07ae34a4e2846d67");
  assert.equal(d.format, "macho");
  assert.equal(d.slices.length, 1);
  assert.ok(d.slices[0].deps, "the .dep-v0 section is reported");
}

test("[+rea.tool/inspect_rust_binary] [+leanrea/LEAN-C29] packages and edges equal rust-audit-info's, and the rustc commit is the toolchain's", async () => {
  const made = extraManifest();
  assert.ok(Object.keys(KEY).length > 0);
  for (const [file, k] of Object.entries(KEY)) {
    const r = await all(file, EXTRA);
    const d = r.data as Any;
    assert.equal(r.coverage, "complete", file);
    assert.deepStrictEqual(r.limitations, []);
    assert.equal(d.rust, true);
    assert.equal(d.status, "dependency data (cargo-auditable)");
    assert.equal(d.slices[0].deps.format, k.format, file);
    assert.deepStrictEqual(d.items.map(norm), k.packages.map(norm), file);
    // the edges, resolved to names
    const names = k.packages.map((p: Any) => `${p.name} ${p.version}`);
    for (const [i, p] of k.packages.entries())
      assert.deepStrictEqual(
        d.items[i].dependsOn,
        (p.dependencies ?? []).map((x: number) => names[x]),
        file,
      );
    assert.equal(
      d.slices[0].deps.edges,
      k.packages.map((p: Any) => p.dependencies?.length ?? 0).reduce((a: number, b: number) => a + b),
    );
    const commit = /commit-hash ([0-9a-f]{40})/.exec(made[file]!.made)?.[1];
    assert.ok(commit, "the manifest records the rustc commit");
    assert.equal(d.rustc, commit, file);
  }
  // the fixture has every kind of package the task needs
  const k = KEY[FIXTURE];
  assert.ok(k.packages.some((p: Any) => p.root));
  assert.ok(k.packages.some((p: Any) => p.source === "crates.io"));
  assert.ok(k.packages.some((p: Any) => p.source === "local" && !p.root));
  assert.ok(k.packages.some((p: Any) => p.kind === "build"));
});

test("[+leanrea/LEAN-T13] a Rust binary without .dep-v0 is still Rust, with no dependency data", async () => {
  await temp(async (dir) => {
    const b = Buffer.from(readFileSync(join(EXTRA, FIXTURE)));
    let n = 0;
    for (let at = b.indexOf(".dep-v0"); at >= 0; at = b.indexOf(".dep-v0", at + 1), n++) b[at + 5] = 0x78; // .dep-x0
    assert.ok(n > 0);
    writeFileSync(join(dir, "nodeps"), b);
    const r = await all("nodeps", dir);
    const d = r.data as Any;
    assert.equal(d.rust, true);
    assert.equal(d.status, NO_DEPS);
    assert.equal(d.rustc, "58cf8f9c35b355199727627d07ae34a4e2846d67");
    assert.equal(d.slices[0].deps, null);
    assert.deepStrictEqual(d.items, []);
    assert.equal(r.coverage, "complete");
    assert.match(r.text, /built without cargo-auditable/);
  });
});

test("[+leanrea/LEAN-T13] with its paths remapped away, libcore's panic message still marks a Rust binary", async () => {
  await temp(async (dir) => {
    const b = Buffer.from(readFileSync(join(EXTRA, FIXTURE)));
    const blank = (s: string) => {
      for (let at = b.indexOf(s); at >= 0; at = b.indexOf(s, at + 1)) b[at + 1] = 0x5f;
    };
    for (const s of [".dep-v0", "/rustc/", "/rust/deps/", "RUST_BACKTRACE"]) blank(s);
    writeFileSync(join(dir, "remapped"), b);
    const d = (await all("remapped", dir)).data as Any;
    assert.equal(d.rust, true);
    assert.equal(d.rustc, null);
    assert.deepStrictEqual(d.markers, ["libcore's Option::unwrap panic message"]);
    assert.equal(d.status, NO_DEPS);
  });
});

test("[-rea.tool/inspect_rust_binary] [-leanrea/LEAN-C29] [-leanrea/LEAN-T13] a non-Rust binary is absent, with the scope read", async () => {
  for (const f of ["hello-x86_64-linux-gnu.2.28-s", "hello-aarch64-macos-s", "hello-x86_64-windows-gnu-s.exe"]) {
    const r = await all(f, BIN);
    const d = r.data as Any;
    assert.equal(d.rust, false, f);
    assert.match(d.status, /^absent/, f);
    assert.equal(d.rustc, null, f);
    assert.deepStrictEqual(d.markers, [], f);
    assert.ok(d.slices[0].scope.sections.length > 0, `${f} names the sections it read`);
    assert.equal(d.slices[0].scope.complete, true, f);
    assert.equal(r.coverage, "complete", f);
    assert.doesNotMatch(r.text, /: Rust;/);
  }
  // a file that is not a native binary has no sections, so nothing to find
  await temp(async (dir) => {
    writeFileSync(join(dir, "t.txt"), "/rustc/ is not here\n");
    const d = (await all("t.txt", dir)).data as Any;
    assert.equal(d.rust, false);
  });
});

test("[-leanrea/LEAN-T13] a marker scan cut by its cap is unknown, not absent", () => {
  const b = readFileSync(join(BIN, "hello-x86_64-linux-gnu.2.28-s"));
  const r = rustInventory(b, "elf", { ...RUST_CAPS, markers: 16 });
  assert.equal(r.rust, null);
  assert.match(r.status, /^unknown/);
  assert.match(r.limitations.join(" "), /16-byte cap/);
});

test("[-rea.tool/inspect_rust_binary] [-leanrea/LEAN-C29] [-leanrea/LEAN-T13] a .dep-v0 that is not zlib is partial", async () => {
  const { r, d } = await damaged(Buffer.from("not a zlib stream at all"));
  rest(d);
  assert.equal(r.coverage, "partial");
  assert.match(r.limitations.join(" "), /not a valid zlib stream/);
  assert.deepStrictEqual(d.items, []);
});

test("[-rea.tool/inspect_rust_binary] [-leanrea/LEAN-C29] [-leanrea/LEAN-T13] a zlib bomb stops at the inflate cap", async () => {
  // 64 MiB of JSON whitespace, far past the 8 MiB cap, in about 64 KB of zlib
  const bomb = deflateSync(Buffer.concat([Buffer.from('{"packages":['), Buffer.alloc(64 << 20, 0x20)]), {
    level: 9,
  });
  const t0 = performance.now();
  const { r, d } = await damaged(bomb);
  assert.ok(performance.now() - t0 < 10_000, "the bomb is refused quickly");
  rest(d);
  assert.equal(r.coverage, "partial");
  assert.match(r.limitations.join(" "), /inflates past the 8388608-byte cap/);
});

test("[-rea.tool/inspect_rust_binary] [-leanrea/LEAN-C29] [-leanrea/LEAN-T13] truncated JSON keeps the packages before the cut", async () => {
  const text = doc(PKGS);
  const cut = text.indexOf('{"name":"c"') + 10;
  const { r, d } = await damaged(deflateSync(text.slice(0, cut)));
  rest(d);
  assert.equal(r.coverage, "partial");
  assert.match(r.limitations.join(" "), /not valid JSON.*2 packages read before the damage/);
  assert.deepStrictEqual(
    d.items.map((x: Any) => [x.name, x.features]),
    [
      ["a", []],
      ["b", ["x", "y"]],
    ],
  );
});

test("[-rea.tool/inspect_rust_binary] [-leanrea/LEAN-C29] [-leanrea/LEAN-T13] a section that runs past the end of the file is partial", async () => {
  const z = deflateSync(doc(PKGS));
  const { r, d } = await damaged(z.subarray(0, z.length - 6), z.length + 100);
  rest(d);
  assert.equal(r.coverage, "partial");
  const l = r.limitations.join(" ");
  assert.match(l, /runs past the end of the file/);
  assert.match(l, /cut short/);
});

test("[-rea.tool/inspect_rust_binary] [-leanrea/LEAN-C29] [-leanrea/LEAN-T13] a package list past the cap keeps the first 65536", async () => {
  const many = Array.from({ length: RUST_PACKAGE_CAP + 5 }, (_, i) => ({
    name: `p${i}`,
    version: "1",
    source: "local",
  }));
  const { r, d } = await damaged(deflateSync(doc(many)));
  rest(d);
  assert.equal(r.coverage, "partial");
  assert.equal(d.slices[0].deps.packages, RUST_PACKAGE_CAP);
  assert.equal(d.page.total, RUST_PACKAGE_CAP);
  assert.match(r.limitations.join(" "), /lists 65541 packages; only the first 65536 are read/);
});

test("[-rea.tool/inspect_rust_binary] [-leanrea/LEAN-C29] [-leanrea/LEAN-T13] edges past the cap are cut", async () => {
  const deps = new Array(RUST_EDGE_CAP + 3).fill(0);
  const { r, d } = await damaged(deflateSync(doc([{ name: "a", version: "1", source: "local", dependencies: deps }])));
  rest(d);
  assert.equal(r.coverage, "partial");
  assert.equal(d.slices[0].deps.edges, RUST_EDGE_CAP);
  assert.match(r.limitations.join(" "), /1048576-edge cap/);
  assert.equal(d.items[0].dependencies.length, RUST_LISTED_DEPS_CAP, "one package's list fits a page");
});

test("[-rea.tool/inspect_rust_binary] [-leanrea/LEAN-C29] [-leanrea/LEAN-T13] a dependency index out of range is left out", async () => {
  const bad = [...PKGS.slice(0, 3), { ...PKGS[3], dependencies: [0, 99, -1, 2] }];
  const { r, d } = await damaged(deflateSync(doc(bad)));
  rest(d);
  assert.equal(r.coverage, "partial");
  assert.match(r.limitations.join(" "), /2 dependency indices are out of range/);
  assert.deepStrictEqual(d.items[3].dependencies, [0, 2]);
  assert.deepStrictEqual(d.items[3].dependsOn, ["a 1.0.0", "c 0.1.0"]);
});

test("[+leanrea/LEAN-C29] a wasm custom section .dep-v0 is read by the same path", () => {
  const z = deflateSync(doc(PKGS));
  const name = Buffer.from(".dep-v0");
  const body = Buffer.concat([Buffer.from([name.length]), name, z]);
  const lebs = (n: number) => {
    const o: number[] = [];
    do {
      let x = n & 0x7f;
      n >>>= 7;
      if (n) x |= 0x80;
      o.push(x);
    } while (n);
    return Buffer.from(o);
  };
  const wasm = Buffer.concat([Buffer.from("\0asm\x01\0\0\0", "latin1"), Buffer.from([0]), lebs(body.length), body]);
  const r = rustInventory(wasm, "wasm");
  assert.equal(r.rust, true);
  assert.deepStrictEqual(r.limitations, []);
  assert.deepStrictEqual(r.packages.map(norm), PKGS.map(norm));
});
