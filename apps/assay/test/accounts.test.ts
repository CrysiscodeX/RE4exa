import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { Kernel } from "@re4exa/core/kernel/kernel";
import { createAccounts, scrubDetail } from "../src/accounts/registry.ts";
import { recordUsageEvent, UsageRecorder } from "../src/accounts/usage.ts";
import type { AccountRef, AccountStatus, ProviderAdapter, ProviderId, ProviderInfo } from "../src/contracts.ts";
import { isAssayError } from "../src/errors.ts";
import type { AccountView } from "../src/server/api-types.ts";
import { openTemp } from "./helpers.ts";

// node-pty is optional and ships no Linux prebuild: without its install script (npm ci --ignore-scripts)
// the addon is absent and Assay uses pipes, so the pty variant has nothing to run.
const ptyName = "node-pty";
const ptyLoads = await import(ptyName).then(
  () => true,
  () => false,
);

// The login "terminal" program: prints a prompt, echoes one line of input, exits.
const LOGIN_SCRIPT = `process.stdout.write("code? "); process.stdin.once("data", d => { console.log("got " + String(d).trim() + " home=" + (process.env.TEST_HOME ?? "none")); process.exit(0); });`;

function testAdapter(
  id: ProviderId,
  state: { signedIn: boolean; installed?: boolean; fail?: boolean; seen: AccountRef[] },
): ProviderAdapter {
  return {
    id,
    async detect(): Promise<ProviderInfo> {
      return {
        id,
        installed: state.installed ?? true,
        version: "1",
        program: `/bin/${id}`,
        enforcement: "enforced",
        notes: [],
      };
    },
    async status(a: AccountRef): Promise<AccountStatus> {
      state.seen.push(a);
      if (state.fail) throw new Error("status tool crashed");
      return state.signedIn
        ? {
            signedIn: true,
            method: "oauth",
            detail: { email: "p@example.com", accessToken: "secret-value", apiKey: "sk-123" },
          }
        : { signedIn: false, method: null, detail: {} };
    },
    loginCommand(a: AccountRef) {
      return {
        program: process.execPath,
        args: ["-e", LOGIN_SCRIPT],
        env: { ...process.env, TEST_HOME: a.home ?? "default" } as Record<string, string>,
      };
    },
    async start() {
      throw new Error("not used");
    },
  };
}

describe("accounts registry", () => {
  let k: Kernel;
  let dir: string;
  let cleanup: () => void;
  let state: { signedIn: boolean; installed?: boolean; fail?: boolean; seen: AccountRef[] };
  let changes: AccountView[];
  beforeEach(() => {
    ({ k, dir, cleanup } = openTemp());
    state = { signedIn: false, seen: [] };
    changes = [];
  });
  afterEach(() => cleanup());

  const make = (o: { pty?: null | "auto"; defaultFake?: boolean; providers?: ProviderId[] } = {}) =>
    createAccounts({
      kernel: k,
      home: dir,
      providers: new Map((o.providers ?? ["claude", "fake"]).map((p) => [p, testAdapter(p, state)] as const)),
      pty: o.pty === undefined ? null : o.pty,
      defaultFake: o.defaultFake,
      onChange: (v) => changes.push(v),
    });

  it("create (default and new home), list, view, check, remove", async () => {
    const acc = make();
    const def = acc.create({ provider: "claude", label: "Me", home: "default" });
    assert.equal(def.home, null);
    assert.equal(def.status, "unknown");
    const sep = acc.create({ provider: "claude", label: "Work", home: "new" });
    assert.equal(sep.home, join(dir, "accounts", sep.id));
    assert.ok(existsSync(sep.home!), "Assay creates the separate home");
    assert.deepEqual(
      acc.list().map((v) => v.label),
      ["Me", "Work"],
    );
    assert.deepEqual(acc.ref(sep.id), { id: sep.id, provider: "claude", label: "Work", home: sep.home });

    state.signedIn = true;
    const checked = await acc.check(sep.id);
    assert.equal(checked.status, "signed-in");
    assert.equal(checked.method, "oauth");
    assert.ok(checked.checkedAt);
    assert.equal(state.seen.at(-1)?.home, sep.home, "status asked with the account's own home");
    const stored = k.get<{ detail: string }>("SELECT detail FROM accounts WHERE id=?", sep.id)!;
    assert.doesNotMatch(stored.detail, /secret-value|sk-123/, "no secrets stored");
    assert.match(stored.detail, /p@example.com/);
    assert.ok(changes.some((c) => c.id === sep.id && c.status === "checking"));

    state.signedIn = false;
    assert.equal((await acc.check(def.id)).status, "signed-out");
    state.fail = true;
    const unknown = await acc.check(def.id);
    assert.equal(unknown.status, "unknown");
    assert.equal(unknown.method, null);

    acc.remove(def.id);
    assert.equal(acc.ref(def.id), undefined);
    assert.throws(
      () => acc.view(def.id),
      (e: unknown) => isAssayError(e, "not_found"),
    );
    await assert.rejects(acc.check(def.id), (e: unknown) => isAssayError(e, "not_found"));
  });

  it("remove keeps the home's files unless deleteHome, and only deletes homes Assay created", () => {
    const acc = make();
    const a = acc.create({ provider: "claude", label: "A", home: "new" });
    acc.remove(a.id);
    assert.ok(existsSync(a.home!), "default: the provider's own files are not touched");
    const b = acc.create({ provider: "claude", label: "B", home: "new" });
    acc.remove(b.id, { deleteHome: true });
    assert.ok(!existsSync(b.home!));
    const ext = acc.create({ provider: "claude", label: "C", home: join(dir, "elsewhere") });
    assert.throws(
      () => acc.remove(ext.id, { deleteHome: true }),
      (e: unknown) => isAssayError(e, "bad_request"),
    );
    assert.ok(acc.ref(ext.id), "refused removal leaves the row");
    const d = acc.create({ provider: "claude", label: "D", home: "default" });
    assert.throws(
      () => acc.remove(d.id, { deleteHome: true }),
      (e: unknown) => isAssayError(e, "bad_request"),
    );
  });

  it("rejects unknown providers and labels an empty name", () => {
    const acc = make();
    assert.throws(
      () => acc.create({ provider: "codex", label: "x", home: "default" }),
      (e: unknown) => isAssayError(e, "bad_request"),
    );
    assert.equal(acc.create({ provider: "claude", label: "  ", home: "default" }).label, "Claude (default)");
  });

  const loginRoundTrip = async (acc: ReturnType<typeof make>, mode: null | "auto"): Promise<void> => {
    const a = acc.create({ provider: "claude", label: "Work", home: "new" });
    state.signedIn = true;
    const chunks: string[] = [];
    let done!: () => void;
    const finished = new Promise<void>((r) => {
      done = r;
    });
    const r = await acc.login(a.id, (chunk, isDone) => {
      chunks.push(chunk);
      if (isDone) done();
    });
    assert.equal(r.started, true);
    assert.equal(r.terminal, mode === null ? "pipes" : "pty");
    assert.equal(acc.loginRunning(a.id), true);
    assert.deepEqual(await acc.login(a.id, () => {}), { started: false, terminal: r.terminal }, "one login at a time");
    // wait for the prompt, then type
    for (let i = 0; i < 200 && !chunks.join("").includes("code?"); i++) await new Promise((res) => setTimeout(res, 10));
    acc.input(a.id, "1234\r");
    await finished;
    const out = chunks.join("");
    assert.match(out, /got 1234/);
    assert.match(out, new RegExp(`home=${a.home!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    assert.match(out, /login exited with code 0/);
    assert.equal(acc.loginRunning(a.id), false);
    assert.equal(acc.view(a.id).status, "signed-in", "status is re-checked after login");
    assert.throws(
      () => acc.input(a.id, "x"),
      (e: unknown) => isAssayError(e, "not_found"),
    );
  };

  for (const mode of [null, "auto"] as const) {
    const skip = mode === "auto" && !ptyLoads ? "node-pty's native addon is not installed on this host" : false;
    it(`login runs the official command in the account's home and streams output (${mode === null ? "pipes" : "pty"})`, {
      skip,
    }, async () => {
      const acc = make({ pty: mode });
      // a failed assertion must not leave the login program running (it would keep the test process alive)
      try {
        await loginRoundTrip(acc, mode);
      } finally {
        acc.close();
      }
    });
  }

  it("cancelLogin and close stop a running login", async () => {
    const acc = make();
    const a = acc.create({ provider: "claude", label: "W", home: "default" });
    let done!: () => void;
    const finished = new Promise<void>((r) => {
      done = r;
    });
    await acc.login(a.id, (_c, d) => d && done());
    acc.cancelLogin(a.id);
    await finished;
    assert.equal(acc.loginRunning(a.id), false);
    await acc.login(a.id, () => {});
    acc.close();
    assert.equal(acc.loginRunning(a.id), false);
  });

  it("a login program that cannot start reports provider_unavailable", async () => {
    const broken = testAdapter("claude", state);
    broken.loginCommand = () => ({ program: "/nonexistent/claude", args: ["auth", "login"], env: {} });
    const acc = createAccounts({ kernel: k, home: dir, providers: new Map([["claude", broken]]), pty: null });
    const a = acc.create({ provider: "claude", label: "x", home: "default" });
    const chunks: string[] = [];
    let done!: () => void;
    const finished = new Promise<void>((r) => {
      done = r;
    });
    try {
      await acc.login(a.id, (c, d) => {
        chunks.push(c);
        if (d) done();
      });
      await finished;
      assert.match(chunks.join(""), /ENOENT|exited/);
    } catch (e) {
      assert.ok(isAssayError(e, "provider_unavailable"));
    }
  });

  it("a pty that cannot start (posix_spawnp failed) falls back to pipes", async () => {
    const acc = createAccounts({
      kernel: k,
      home: dir,
      providers: new Map([["claude", testAdapter("claude", state)]]),
      pty: () => {
        throw new Error("posix_spawnp failed.");
      },
    });
    const a = acc.create({ provider: "claude", label: "x", home: "default" });
    let done!: () => void;
    const finished = new Promise<void>((r) => {
      done = r;
    });
    try {
      const r = await acc.login(a.id, (_c, d) => d && done());
      assert.equal(r.terminal, "pipes");
      acc.cancelLogin(a.id);
      await finished;
    } finally {
      acc.close();
    }
  });

  it("ensureDefaults creates one default account per installed provider, once", async () => {
    const acc = make({ providers: ["claude", "codex", "acp", "fake"] });
    const made = await acc.ensureDefaults();
    assert.deepEqual(
      made.map((v) => [v.provider, v.label, v.home]),
      [
        ["claude", "Claude (default)", null],
        ["codex", "Codex (default)", null],
        ["acp", "acp (default)", null],
      ],
    );
    assert.deepEqual(await acc.ensureDefaults(), [], "idempotent");
    acc.remove(made[0]!.id);
    assert.deepEqual(await acc.ensureDefaults(), [], "a removed default is not recreated");

    const { k: k2, dir: d2, cleanup: c2 } = openTemp();
    try {
      state.installed = false;
      const acc2 = createAccounts({
        kernel: k2,
        home: d2,
        providers: new Map([["claude", testAdapter("claude", state)]]),
        pty: null,
      });
      assert.deepEqual(await acc2.ensureDefaults(), [], "not installed: nothing created");
      state.installed = true;
      const withFake = createAccounts({
        kernel: k2,
        home: d2,
        providers: new Map([["fake", testAdapter("fake", state)]]),
        pty: null,
        defaultFake: true,
      });
      assert.deepEqual(
        (await withFake.ensureDefaults()).map((v) => v.label),
        ["Fake (demo)"],
      );
      assert.equal((await withFake.checkAll()).length, 1);
    } finally {
      c2();
    }
  });

  it("scrubDetail drops secret-looking keys and values", () => {
    assert.deepEqual(
      scrubDetail({
        email: "a@b",
        token: "x",
        refresh_token: "y",
        note: "sk-abcdefghijklmnopqrstu",
        api_key: "z",
        plan: "pro",
      }),
      { email: "a@b", plan: "pro" },
    );
  });
});

describe("usage accounting", () => {
  it("records usage events per account, worker and case, and marks re-sent turns", () => {
    const { k, cleanup } = openTemp();
    try {
      const rec = new UsageRecorder(k, { caseId: null, accountId: "acct_1", provider: "claude", workerId: "w_1" });
      const seen: string[] = [];
      const onEvent = rec.wrap((e) => seen.push(e.type));
      rec.beginTurn();
      onEvent({ type: "text-delta", text: "hi" });
      onEvent({ type: "usage", inputTokens: 100, outputTokens: 20, costUsd: 0.01, model: "m" });
      assert.deepEqual(rec.turnTotals(), {
        inputTokens: 100,
        outputTokens: 20,
        costUsd: 0.01,
        events: 1,
        resent: false,
      });
      rec.beginTurn({ resent: true });
      onEvent({ type: "usage", inputTokens: 100.4, outputTokens: -1, costUsd: null, model: null });
      assert.deepEqual(seen, ["text-delta", "usage", "usage"]);
      const rows = k.all<Record<string, unknown>>("SELECT * FROM usage ORDER BY at, id");
      assert.equal(rows.length, 2);
      assert.equal(rows[0]?.account_id, "acct_1");
      assert.equal(rows[0]?.worker_id, "w_1");
      assert.equal(rows[0]?.resent, 0);
      assert.equal(rows[1]?.resent, 1);
      assert.equal(rows[1]?.input_tokens, 100);
      assert.equal(rows[1]?.output_tokens, 0);
      assert.equal(rows[1]?.cost_usd, null);
      const sum = k.usageSummary("account_id")[0]!;
      assert.equal(sum.turns, 2);
      assert.equal(sum.resent, 1);
      assert.equal(recordUsageEvent(k, { provider: "fake" }, { type: "text", text: "x" }), false);
    } finally {
      cleanup();
    }
  });
});
