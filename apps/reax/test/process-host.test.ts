// Core's process host must work where procps is missing (rea needed `ps` on PATH even for static
// analysis; rea profile §9A A7.2): tree termination reads /proc on Linux and uses absolute system
// paths on Windows.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { readLinuxProcessGroupStates } from "@re4exa/core/vendor/orca-process-host/process-tree-termination";
import { runProcess } from "@re4exa/core/vendor/orca-process-host/run-process";

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

test("[+REA-A7.2] with only node's own directory on PATH, a timed-out process tree is killed, grandchild included", async () => {
  const script = `
    const { spawn } = require("node:child_process");
    const g = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
    console.log(g.pid);
    setInterval(() => {}, 1000);`;
  const t0 = Date.now();
  const r = await runProcess({
    program: process.execPath,
    args: ["-e", script],
    detached: true,
    timeoutMs: 1500,
    env: { PATH: dirname(process.execPath), SystemRoot: process.env.SystemRoot },
    terminationBarrier: true,
  });
  assert.equal(r.timedOut, true);
  assert.ok(Date.now() - t0 < 15_000, "termination did not hang");
  const grandchild = Number(r.stdout.trim().split(/\s+/)[0]);
  assert.ok(grandchild > 0, `child printed its grandchild's pid: ${JSON.stringify(r.stdout)}`);
  for (let i = 0; i < 40 && alive(grandchild); i++) await new Promise((res) => setTimeout(res, 50));
  assert.equal(alive(grandchild), false, "the grandchild is gone too");
});

test("[-REA-A7.2] a tool that is not on PATH fails with an error instead of hanging or passing", async () => {
  await assert.rejects(
    runProcess({
      program: "reax-no-such-tool-7f3a",
      args: [],
      env: { PATH: dirname(process.execPath) },
      timeoutMs: 5000,
    }),
    /ENOENT|not found|cannot find/i,
  );
});

test("the Linux /proc reader sees a live process group and nothing for an unused one", {
  skip: process.platform !== "linux" && "Linux only",
}, async () => {
  const c = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { detached: true, stdio: "ignore" });
  try {
    await new Promise((r) => setTimeout(r, 200));
    const states = readLinuxProcessGroupStates(c.pid!);
    assert.ok(states && states.length >= 1, JSON.stringify(states));
    assert.deepEqual(readLinuxProcessGroupStates(2 ** 30), []);
    const empty = mkdtempSync(join(tmpdir(), "reax-proc-"));
    rmSync(empty, { recursive: true });
    assert.equal(
      readLinuxProcessGroupStates(c.pid!, empty),
      null,
      "an unreadable /proc gives null, so the caller falls back",
    );
  } finally {
    process.kill(-c.pid!, "SIGKILL");
  }
});
