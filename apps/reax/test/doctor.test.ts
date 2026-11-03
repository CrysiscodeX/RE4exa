// SET: reax doctor (ADR 0012) reports Claude Code's state and the MCP server's build state, on
// temporary homes only (test/set-helpers.ts), and creates no file or directory.
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { doctor, reaxVersion, setup } from "../src/setup/index.ts";
import { FIXTURES, KEY, tempHome, tree } from "./set-helpers.ts";

const ENTRY = KEY.entry;

test("[+RX-SET/doctor] doctor reports absent, not_configured, configured, configured_differently and malformed with its reason, and mcp_server not_built", () => {
  const states: Record<string, unknown>[] = [];
  const absent = tempHome();
  states.push(doctor(absent.env, ENTRY).clients[0]!);
  for (const f of ["no-servers.json", "reax-present.json", "dup-top.json", "servers-null.json"]) {
    const t = tempHome();
    copyFileSync(join(FIXTURES, f), t.config);
    states.push(doctor(t.env, ENTRY).clients[0]!);
  }
  const c = tempHome();
  setup({ env: c.env, yes: true, entry: ENTRY });
  const configured = doctor(c.env, ENTRY);
  states.push(configured.clients[0]!);
  assert.deepEqual(
    states.map((s) => [s.state, s.reason ?? null, s.recorded]),
    [
      ["absent", null, false],
      ["not_configured", null, false],
      ["configured_differently", null, false],
      ["malformed", "duplicate_key", false],
      ["malformed", "servers_not_object", false],
      ["configured", null, true],
    ],
  );
  assert.equal(configured.mcp_server, "not_built");
  assert.equal(configured.reax_version, reaxVersion());
  assert.match(configured.reax_version, /^\d+\.\d+\.\d+/);
});

test("[-RX-SET/doctor] doctor changes no file and creates no directory, not even the reax home's setup directory", () => {
  const t = tempHome();
  assert.deepEqual(tree(t.home), []);
  doctor(t.env, ENTRY);
  assert.deepEqual(tree(t.home), []);
  writeFileSync(t.config, "{");
  mkdirSync(t.reaxHome);
  doctor(t.env, ENTRY);
  assert.deepEqual(tree(t.home), [".claude.json", "reax-home"]);
});
