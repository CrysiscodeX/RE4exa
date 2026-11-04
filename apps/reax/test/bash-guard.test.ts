// .claude/hooks/bash-guard.mjs (D-54), fed recorded PreToolUse stdin. Each case is one file under
// test/fixtures/bash-guard: <name>.json holds the payload and, beside it in the same object, the
// expectation written by hand (`expect: {exit, reason}`; the hook ignores fields it does not use);
// <name>.stdin is raw stdin (truncated or not JSON) with its expectation in <name>.expect.json.
// No code is shared with the hook: it runs as a separate process, as Claude Code runs it.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const HOOK = join(ROOT, ".claude", "hooks", "bash-guard.mjs");
const DIR = join(import.meta.dirname, "fixtures", "bash-guard");
/** The fixtures' project directory (their cwd values sit under it). */
const PROJECT = "/proj";

interface Expect {
  exit: 0 | 2;
  reason: string | null;
}
interface Case {
  name: string;
  stdin: Buffer;
  expect: Expect;
}

function cases(): Case[] {
  const out: Case[] = [];
  for (const f of readdirSync(DIR).sort()) {
    if (f.endsWith(".expect.json")) continue;
    const stdin = readFileSync(join(DIR, f));
    if (f.endsWith(".json")) out.push({ name: f, stdin, expect: JSON.parse(stdin.toString()).expect });
    else if (f.endsWith(".stdin"))
      out.push({
        name: f,
        stdin,
        expect: JSON.parse(readFileSync(join(DIR, f.replace(/\.stdin$/, ".expect.json")), "utf8")),
      });
  }
  return out;
}

function hook(stdin: Buffer): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const p = spawn(process.execPath, [HOOK], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, CLAUDE_PROJECT_DIR: PROJECT },
  });
  let stdout = "";
  let stderr = "";
  p.stdout.on("data", (d) => {
    stdout += d;
  });
  p.stderr.on("data", (d) => {
    stderr += d;
  });
  p.stdin.end(stdin);
  const kill = setTimeout(() => p.kill("SIGKILL"), 20_000);
  return new Promise((res) =>
    p.on("close", (code) => {
      clearTimeout(kill);
      res({ code, stdout, stderr });
    }),
  );
}

async function check(c: Case): Promise<void> {
  const r = await hook(c.stdin);
  assert.equal(r.code, c.expect.exit, `${c.name}: ${r.stderr}`);
  // the hook never prints a command or updatedInput
  assert.equal(r.stdout, "", c.name);
  assert.equal(r.stderr, c.expect.reason === null ? "" : `bash-guard: ${c.expect.reason}\n`, c.name);
}

test("[+RX-INFRA/bash-guard] allowed cases exit 0 with no output: timeouts present, bounded background calls, other tools, extra payload fields", async () => {
  const all = cases().filter((c) => c.expect.exit === 0);
  assert.ok(all.length >= 13, `${all.length} allow fixtures`);
  assert.ok(
    all.some((c) => c.name === "allow-real-payload.json"),
    "a recorded real PreToolUse payload is among them",
  );
  for (const c of all) await check(c);
});

test("[-RX-INFRA/bash-guard] denied cases exit 2 with one reason line: no --test-timeout in any segment or nested command, background without bounded.mjs, deadlines outside 1..3600, malformed input", async () => {
  const all = cases().filter((c) => c.expect.exit === 2);
  assert.ok(all.length >= 28, `${all.length} deny fixtures`);
  for (const c of all) {
    assert.ok(c.expect.reason !== null, c.name);
    await check(c);
  }
});
