import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ApprovalQueue } from "@re4exa/core/policy/approvals";
import { createProbeEngine } from "@re4exa/core/probes/engine";
import { bytesOf } from "@re4exa/core/testing/harness";
import type { ToolContext } from "../src/contracts.ts";
import { AssayError } from "../src/errors.ts";
import { createToolRegistry } from "../src/mcp/registry.ts";
import { openTemp } from "./helpers.ts";

// Router rows with consent: approval (here `npx -y @electron/asar`, which downloads and runs a package) must
// wait for the person on every run, and the tool must not inherit Assay's environment.
test("consent: approval probes ask first and run with the minimal environment", {
  skip: process.platform === "win32",
}, async () => {
  const { k, cleanup } = openTemp();
  const ws = mkdtempSync(join(tmpdir(), "assay-ws-"));
  const bin = mkdtempSync(join(tmpdir(), "assay-bin-"));
  const out = join(bin, "env.txt");
  writeFileSync(join(bin, "npx"), `#!/bin/sh\nenv > '${out}'\necho /index.js\n`);
  chmodSync(join(bin, "npx"), 0o755);
  writeFileSync(join(ws, "app.asar"), bytesOf("asar"));
  const oldPath = process.env.PATH;
  process.env.PATH = `${bin}:${oldPath}`;
  process.env.ASSAY_TEST_SECRET = "sk-should-not-leak";
  const approvals = new ApprovalQueue(k);
  try {
    const engine = createProbeEngine({ kernel: k, workspace: ws, platform: "linux" });
    const probe = engine.list().find((p) => p.id.includes("asar-list"));
    assert.ok(probe, "the asar-list router probe is registered");
    const reg = createToolRegistry({ kernel: k, engine, approvals, workspace: ws });
    const c = k.createCase({ title: "t", workspace: ws });
    const asked: string[] = [];
    let answer = "deny";
    const ctx: ToolContext = {
      caseId: c.id,
      caller: "coordinator",
      workspace: ws,
      signal: new AbortController().signal,
      approve: async (action) => {
        asked.push(action);
        if (answer === "deny") throw new AssayError("approval_denied", { action });
      },
    };
    const denied = await reg.call(ctx, "assay_probe", { probe: probe.id, path: "app.asar" });
    assert.equal(denied.isError, true);
    assert.equal(asked.length, 1, "asked before running, though the session is not tainted");
    assert.ok(!existsSync(out), "the tool did not run");
    answer = "approve";
    const ok = await reg.call(ctx, "assay_probe", { probe: probe.id, path: "app.asar" });
    assert.notEqual(ok.isError, true, JSON.stringify(ok));
    const env = readFileSync(out, "utf8");
    assert.ok(!env.includes("ASSAY_TEST_SECRET"), "Assay's environment is not passed to the tool");
    assert.match(env, /^PATH=/m);
  } finally {
    process.env.PATH = oldPath;
    delete process.env.ASSAY_TEST_SECRET;
    approvals.close();
    cleanup();
    rmSync(ws, { recursive: true, force: true });
    rmSync(bin, { recursive: true, force: true });
  }
});
