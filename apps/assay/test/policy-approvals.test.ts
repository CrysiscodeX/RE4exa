import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { isAssayError } from "../src/errors.ts";
import { Kernel } from "../src/kernel/kernel.ts";
import { ApprovalQueue } from "../src/policy/approvals.ts";
import type { ApprovalView } from "../src/server/api-types.ts";
import { openTemp, tmp } from "./helpers.ts";

test("approve resolves, deny rejects approval_denied, events carry ApprovalView", async () => {
  const { k, cleanup } = openTemp();
  try {
    const c = k.createCase({ title: "t" });
    const q = new ApprovalQueue(k);
    const seen: ApprovalView[] = [];
    q.on("approval", (v: ApprovalView) => seen.push(v));
    const p1 = q.request({
      caseId: c.id,
      workerId: "w1",
      action: "assay_exec",
      detail: { program: "ls" },
      reason: "effect exec",
    });
    const pend = q.pending(c.id);
    assert.equal(pend.length, 1);
    assert.equal(pend[0]!.state, "pending");
    assert.equal(pend[0]!.reason, "effect exec");
    assert.equal(pend[0]!.workerId, "w1");
    assert.deepEqual(pend[0]!.detail, { program: "ls" });
    const v = q.decide(pend[0]!.id, "approve");
    assert.equal(v.state, "approved");
    await p1;

    const p2 = q.request({
      caseId: c.id,
      workerId: null,
      action: "assay_write_file",
      detail: {},
      reason: "effect write",
    });
    const id2 = q.pending(c.id)[0]!.id;
    q.decide(id2, "deny", "not now");
    await assert.rejects(
      p2,
      (e) => isAssayError(e, "approval_denied") && (e.detail as { note: string }).note === "not now",
    );
    assert.equal(q.get(id2)!.state, "denied");
    assert.deepEqual(
      seen.map((x) => x.state),
      ["pending", "approved", "pending", "denied"],
    );
    // Deciding twice is refused; unknown ids are not_found.
    assert.throws(
      () => q.decide(id2, "approve"),
      (e) => isAssayError(e, "bad_request"),
    );
    assert.throws(
      () => q.decide("apr_nope", "approve"),
      (e) => isAssayError(e, "not_found"),
    );
    assert.equal(q.pending().length, 0);
    // The case log records each step.
    const log = k.events(c.id).filter((e) => e.kind === "approval");
    assert.equal(log.length, 4);
  } finally {
    cleanup();
  }
});

test("a request expires after its timeout and on abort", async () => {
  const { k, cleanup } = openTemp();
  try {
    const q = new ApprovalQueue(k, { timeoutMs: 30 });
    const p = q.request({ caseId: null, workerId: null, action: "a", detail: null, reason: "r" });
    await assert.rejects(p, (e) => isAssayError(e, "approval_expired"));
    assert.equal(q.pending().length, 0);
    const ac = new AbortController();
    const p2 = q.request({
      caseId: null,
      workerId: null,
      action: "a",
      detail: null,
      reason: "r",
      signal: ac.signal,
      timeoutMs: 60_000,
    });
    ac.abort();
    await assert.rejects(p2, (e) => isAssayError(e, "approval_expired"));
    await assert.rejects(
      q.request({ caseId: null, workerId: null, action: "a", detail: null, reason: "r", signal: ac.signal }),
      (e) => isAssayError(e, "approval_expired"),
    );
  } finally {
    cleanup();
  }
});

test("detail is redacted before it is stored", async () => {
  const { k, cleanup } = openTemp();
  try {
    const q = new ApprovalQueue(k);
    const secret = `ghp_${"aB3".repeat(12)}`;
    const p = q.request({
      caseId: null,
      workerId: null,
      action: "a",
      detail: { args: [`--token=${secret}`] },
      reason: "r",
    });
    const row = k.get<{ detail: string }>("SELECT detail FROM approvals");
    assert.ok(!row!.detail.includes(secret));
    q.close();
    await assert.rejects(p, (e) => isAssayError(e, "approval_expired"));
  } finally {
    cleanup();
  }
});

test("restart: approvals left pending by a dead process are expired at startup; rules persist", () => {
  const t = tmp();
  const path = join(t.dir, "assay.db");
  try {
    const k1 = Kernel.open({ path });
    const q1 = new ApprovalQueue(k1);
    const c = k1.createCase({ title: "r" });
    void q1
      .request({ caseId: c.id, workerId: "w", action: "assay_exec", detail: {}, reason: "effect exec" })
      .catch(() => {});
    q1.addRule(c.id, { tool: "assay_exec" });
    q1.addRule(c.id, { tool: "assay_write_file", evenWhenTainted: true });
    assert.equal(q1.pending(c.id).length, 1);
    const id = q1.pending(c.id)[0]!.id;
    // Simulate process death: close the store without settling anything, then drop the waiters.
    k1.close();
    q1.close();
    assert.equal(k1.closed, true);

    const k2 = Kernel.open({ path });
    const q2 = new ApprovalQueue(k2);
    assert.equal(q2.pending().length, 0);
    assert.equal(q2.get(id)!.state, "expired");
    assert.throws(
      () => q2.decide(id, "approve"),
      (e) => isAssayError(e, "bad_request"),
    );
    assert.deepEqual(q2.rules(c.id), [
      { tool: "assay_exec", action: "approve", evenWhenTainted: false },
      { tool: "assay_write_file", action: "approve", evenWhenTainted: true },
    ]);
    assert.deepEqual(
      q2.removeRule(c.id, "assay_exec").map((r) => r.tool),
      ["assay_write_file"],
    );
    assert.equal(q2.list(c.id).length, 1);
    k2.close();
  } finally {
    t.cleanup();
  }
});
