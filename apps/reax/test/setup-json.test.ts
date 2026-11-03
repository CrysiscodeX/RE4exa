// SET: how setup reads an existing configuration (ADR 0012), checked against Python's json
// (bench/oracle/set.json, scripts/oracle-set.py): each fixture's verdict, the bytes of every refused
// file left as they were, and the configuration after setup equal to the key's canonical form.
import assert from "node:assert/strict";
import { copyFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { isCoreError } from "@re4exa/core/errors";
import { setup } from "../src/setup/index.ts";
import { duplicateKey, MAX_CONFIG_BYTES, parseConfig } from "../src/setup/jsonedit.ts";
import { canonical, FIXTURES, KEY, sha256, tempHome, tree } from "./set-helpers.ts";

const ENTRY = KEY.entry;
const REFUSED = new Set([
  "syntax",
  "duplicate_key",
  "number_precision",
  "not_object",
  "servers_not_object",
  "too_large",
  "symlink",
]);

test("the key covers every fixture in fixtures/set, and the fixtures are the key's bytes", () => {
  const files = readdirSync(FIXTURES).sort();
  assert.deepEqual(files, Object.keys(KEY.files).sort());
  for (const f of files) assert.equal(sha256(readFileSync(`${FIXTURES}/${f}`)), KEY.files[f]!.sha256, f);
});

/** setup --yes on a temporary home holding the fixture: the code it failed with, or "ok". */
function runSetup(f: string): { code: string; t: ReturnType<typeof tempHome> } {
  const t = tempHome();
  copyFileSync(`${FIXTURES}/${f}`, t.config);
  try {
    setup({ env: t.env, yes: true, entry: ENTRY });
    return { code: "ok", t };
  } catch (e) {
    assert.ok(isCoreError(e), String(e));
    return { code: e.code === "config_malformed" ? String(e.detail?.reason) : e.code, t };
  }
}

test("[+RX-SET/config-intact] every refused fixture gets the key's reason from parsing and from setup, and setup leaves it byte-identical", () => {
  let refused = 0;
  for (const [f, k] of Object.entries(KEY.files)) {
    if (k.verdict === "ok") continue;
    refused++;
    const parsed = parseConfig(readFileSync(`${FIXTURES}/${f}`));
    if (k.verdict === "config_conflict") assert.equal(parsed.ok, true, f);
    else {
      assert.ok(REFUSED.has(k.verdict), f);
      assert.deepEqual(parsed, { ok: false, reason: k.verdict }, f);
    }
    const { code, t } = runSetup(f);
    assert.equal(code, k.verdict, f);
    assert.equal(sha256(readFileSync(t.config)), k.sha256, `${f} changed`);
    // no backup, no record, no temp file
    assert.deepEqual(tree(t.home), [".claude.json"], f);
  }
  assert.ok(refused >= 20, `only ${refused} refused fixtures`);
});

test("[-RX-SET/config-intact] look-alikes are accepted: nested mcpServers and reax, __proto__, control characters, lone surrogates, CRLF, exact numbers; the result equals the key", () => {
  let ok = 0;
  for (const [f, k] of Object.entries(KEY.files)) {
    if (k.verdict !== "ok") continue;
    ok++;
    const { code, t } = runSetup(f);
    assert.equal(code, "ok", f);
    const after = readFileSync(t.config, "utf8");
    const value = JSON.parse(after) as Record<string, unknown>;
    assert.equal(canonical(value), k.after, f);
    // __proto__ stays data: no object gained a prototype from the file
    assert.equal(Object.getPrototypeOf(value), Object.prototype, f);
    assert.equal(({} as Record<string, unknown>).polluted, undefined);
  }
  assert.ok(ok >= 10, `only ${ok} accepted fixtures`);
  for (const f of [
    "nested-servers.json",
    "proto.json",
    "surrogate.json",
    "control-keys.json",
    "num-ok.json",
    "crlf.json",
  ])
    assert.equal(KEY.files[f]?.verdict, "ok", f);
});

test("[+RX-SET/config-intact] the layout is kept: CRLF stays CRLF, a tab indent stays tabs, a missing final newline stays missing, one line stays one line", () => {
  const crlf = runSetup("crlf.json").t;
  const c = readFileSync(crlf.config, "utf8");
  assert.ok(c.endsWith("}\r\n"));
  assert.equal(c.replaceAll("\r\n", "").includes("\n"), false);
  const tabs = readFileSync(runSetup("tabs.json").t.config, "utf8");
  assert.ok(tabs.startsWith('{\n\t"a"'));
  assert.ok(tabs.endsWith("}"));
  const compact = readFileSync(runSetup("compact.json").t.config, "utf8");
  assert.equal(compact.includes("\n"), false);
});

test("[+RX-SET/config-intact] duplicates are found at any depth and after escapes; strings holding braces and quotes do not confuse the scan", () => {
  assert.equal(duplicateKey('{"a":{"b":[{"c":1,"c":2}]}}'), "c");
  assert.equal(duplicateKey('{"a":1,"\\u0061":2}'), "a");
  assert.equal(duplicateKey('{"x":"{\\"x\\":1,","y":["x","x"],"z":{"x":1}}'), null);
  assert.equal(duplicateKey('[{"a":1},{"a":1}]'), null);
});

test("[+RX-SET/config-intact] numbers: 2^64, 1e400, -0, a 34-digit decimal and 1.0 are refused; 1e+21, 1e-7 and 2^53-1 are kept", () => {
  for (const n of ["18446744073709551616", "1e400", "-0", "0.1000000000000000055511151231257827", "1.0", "1E5"])
    assert.deepEqual(parseConfig(Buffer.from(`{"n":${n}}`)), { ok: false, reason: "number_precision" }, n);
  for (const n of ["1e+21", "1e-7", "9007199254740991", "0", "-2.5"])
    assert.equal(parseConfig(Buffer.from(`{"n":[${n}]}`)).ok, true, n);
});

test("[+RX-SET/config-intact] a file over the 16 MiB cap is too_large before parsing and left as it is; one at the cap is read", () => {
  const t = tempHome();
  // valid JSON padded with spaces, so only the size can refuse it
  const big = Buffer.alloc(MAX_CONFIG_BYTES + 1, 0x20);
  big.write("{}", 0);
  writeFileSync(t.config, big);
  assert.deepEqual(parseConfig(big), { ok: false, reason: "too_large" });
  assert.throws(
    () => setup({ env: t.env, yes: true, entry: ENTRY }),
    (e: unknown) => isCoreError(e) && e.code === "config_malformed" && e.detail?.reason === "too_large",
  );
  assert.equal(sha256(readFileSync(t.config)), sha256(big));
  assert.equal(existsSync(`${t.config}.reax-backup`), false);
  assert.equal(parseConfig(big.subarray(0, MAX_CONFIG_BYTES)).ok, true);
});
