// Accounts: which signed-in agent client Assay drives, and where its configuration home is.
//
// Assay keeps only a registry row per account (provider, label, home, last status). Sign-in runs the
// provider's official login command inside the account's own home; status asks the official tool.
// Assay never reads, copies or refreshes a client's credentials, and never switches accounts on its own.
// Removing an account deletes the row; the home's files are deleted only when Assay created that home
// (ASSAY_HOME/accounts/<id>) and the caller passes deleteHome: true.

import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { chmodSync, mkdirSync, rmSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type { Json } from "@re4exa/core/evidence/jcs";
import { newId } from "@re4exa/core/kernel/ids";
import type { Kernel } from "@re4exa/core/kernel/kernel";
import { spawnProcess } from "@re4exa/core/vendor/orca-process-host/run-process";
import type { AccountRef, AccountStatus, ProviderAdapter, ProviderId } from "../contracts.ts";
import { AssayError } from "../errors.ts";
import type { AccountView } from "../server/api-types.ts";

type Status = AccountView["status"];

interface AccountRow {
  id: string;
  provider: ProviderId;
  label: string;
  home: string | null;
  status: Status;
  detail: string;
  created_at: number;
  checked_at: number | null;
}

/** The part of node-pty the login terminal uses. */
export interface PtyLike {
  onData(cb: (d: string) => void): unknown;
  onExit(cb: (e: { exitCode: number; signal?: number }) => void): unknown;
  write(d: string): void;
  kill(signal?: string): void;
}
export type PtySpawn = (
  program: string,
  args: string[],
  o: { name: string; cols: number; rows: number; cwd: string; env: Record<string, string> },
) => PtyLike;

export interface AccountsOptions {
  kernel: Kernel;
  /** ASSAY_HOME: homes Assay creates live under <home>/accounts/<id>. */
  home: string;
  providers: Map<ProviderId, ProviderAdapter>;
  /** Login terminal: "auto" tries node-pty and falls back to pipes; null forces pipes; a function is used as is. */
  pty?: PtySpawn | null | "auto";
  /** Called whenever an account's view changes (for the `account` push). */
  onChange?(view: AccountView): void;
  /** Also create a default account for the fake provider (demos and e2e). */
  defaultFake?: boolean;
  /** Kill a login that is still running after this long (default 10 minutes). */
  loginTimeoutMs?: number;
}

export interface LoginHandle {
  kind: "pty" | "pipes";
  write(d: string): void;
  kill(): void;
}

export interface Accounts {
  list(): AccountView[];
  ref(id: string): AccountRef | undefined;
  view(id: string): AccountView;
  create(input: { provider: ProviderId; label: string; home: "new" | "default" | string }): AccountView;
  remove(id: string, o?: { deleteHome?: boolean }): void;
  check(id: string): Promise<AccountView>;
  checkAll(): Promise<AccountView[]>;
  login(
    id: string,
    onOutput: (chunk: string, done: boolean) => void,
  ): Promise<{ started: boolean; terminal: "pty" | "pipes" }>;
  input(id: string, data: string): void;
  cancelLogin(id: string): void;
  loginRunning(id: string): boolean;
  ensureDefaults(): Promise<AccountView[]>;
  /** Directory of a home Assay created for this account id. */
  ownedHome(id: string): string;
  close(): void;
}

const SECRET_KEY = /token|secret|password|passwd|cookie|credential|api[-_]?key|authorization|session[-_]?key/i;

/** Drop anything that looks like a secret from a status detail (defence in depth). */
export function scrubDetail(d: Record<string, Json>): Record<string, Json> {
  const out: Record<string, Json> = {};
  for (const [k, v] of Object.entries(d)) {
    if (SECRET_KEY.test(k)) continue;
    if (typeof v === "string" && /^(sk-|eyJ)[\w.-]{16,}/.test(v)) continue;
    out[k] = v;
  }
  return out;
}

function parseDetail(s: string): Record<string, Json> {
  try {
    const v = JSON.parse(s) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, Json>) : {};
  } catch {
    return {};
  }
}

export function toView(r: AccountRow): AccountView {
  const d = parseDetail(r.detail);
  return {
    id: r.id,
    provider: r.provider,
    label: r.label,
    home: r.home,
    status: r.status,
    method: typeof d.method === "string" ? d.method : null,
    checkedAt: r.checked_at,
  };
}

const DEFAULT_LABELS: Record<ProviderId, string> = {
  claude: "Claude (default)",
  codex: "Codex (default)",
  acp: "ACP agent (default)",
  fake: "Fake (demo)",
};

/**
 * node-pty spawns through a `spawn-helper` binary on macOS. Its published prebuilds lack the execute
 * bit (restored only by a build step that `npm ci --ignore-scripts` and some installers skip), so
 * every spawn fails with "posix_spawnp failed". Restore the bit where we can.
 */
function ensureSpawnHelper(name: string): void {
  if (process.platform === "win32") return;
  const root = dirname(createRequire(import.meta.url).resolve(`${name}/package.json`));
  for (const d of ["build/Release", "build/Debug", `prebuilds/${process.platform}-${process.arch}`]) {
    const p = join(root, d, "spawn-helper");
    try {
      const mode = statSync(p).mode;
      if ((mode & 0o111) !== 0o111) chmodSync(p, mode | 0o755);
    } catch {
      // absent (Linux needs no helper) or read-only: a failing spawn falls back to pipes
    }
  }
}

async function loadPty(): Promise<PtySpawn | null> {
  try {
    const name = "node-pty";
    ensureSpawnHelper(name);
    const mod = (await import(name)) as { spawn?: PtySpawn; default?: { spawn?: PtySpawn } };
    return mod.spawn ?? mod.default?.spawn ?? null;
  } catch {
    return null;
  }
}

export function createAccounts(o: AccountsOptions): Accounts {
  const k = o.kernel;
  const assayHome = resolve(o.home);
  const logins = new Map<string, LoginHandle>();
  let ptyPromise: Promise<PtySpawn | null> | null = null;
  const pty = (): Promise<PtySpawn | null> => {
    if (o.pty === null) return Promise.resolve(null);
    if (typeof o.pty === "function") return Promise.resolve(o.pty);
    ptyPromise ??= loadPty();
    return ptyPromise;
  };

  const row = (id: string): AccountRow | undefined => k.get<AccountRow>("SELECT * FROM accounts WHERE id=?", id);
  const must = (id: string): AccountRow => {
    const r = row(id);
    if (!r) throw new AssayError("not_found", { account: id });
    return r;
  };
  const changed = (id: string): AccountView => {
    const v = toView(must(id));
    try {
      o.onChange?.(v);
    } catch {
      // a listener's failure must not break the registry
    }
    return v;
  };
  const adapter = (p: ProviderId): ProviderAdapter => {
    const a = o.providers.get(p);
    if (!a) throw new AssayError("provider_unavailable", { provider: p });
    return a;
  };
  const ref = (r: AccountRow): AccountRef => ({ id: r.id, provider: r.provider, label: r.label, home: r.home });
  const ownedHome = (id: string): string => join(assayHome, "accounts", id);

  const api: Accounts = {
    list() {
      return k.all<AccountRow>("SELECT * FROM accounts ORDER BY created_at, id").map(toView);
    },

    ref(id) {
      const r = row(id);
      return r ? ref(r) : undefined;
    },

    view(id) {
      return toView(must(id));
    },

    ownedHome,

    create(input) {
      if (!o.providers.has(input.provider))
        throw new AssayError("bad_request", { why: "unknown provider", provider: input.provider });
      const label = input.label.trim() || DEFAULT_LABELS[input.provider];
      const id = newId("acct", k.now());
      let home: string | null;
      if (input.home === "default") home = null;
      else if (input.home === "new") {
        home = ownedHome(id);
        mkdirSync(home, { recursive: true, mode: 0o700 });
      } else {
        home = resolve(input.home);
        mkdirSync(home, { recursive: true, mode: 0o700 });
      }
      k.run(
        "INSERT INTO accounts(id,provider,label,home,status,detail,created_at,checked_at) VALUES(?,?,?,?,?,?,?,?)",
        id,
        input.provider,
        label,
        home,
        "unknown",
        "{}",
        k.now(),
        null,
      );
      return changed(id);
    },

    remove(id, opts = {}) {
      const r = must(id);
      const owned = r.home !== null && resolve(r.home) === ownedHome(id);
      if (opts.deleteHome && !owned)
        throw new AssayError("bad_request", { why: "Assay deletes only homes it created", home: r.home });
      api.cancelLogin(id);
      k.run("DELETE FROM accounts WHERE id=?", id);
      if (opts.deleteHome && owned && r.home) rmSync(r.home, { recursive: true, force: true });
    },

    async check(id) {
      const r = must(id);
      k.run("UPDATE accounts SET status=? WHERE id=?", "checking", id);
      changed(id);
      let st: AccountStatus | null = null;
      let err: string | null = null;
      try {
        st = await adapter(r.provider).status(ref(r));
      } catch (e) {
        err = (e as Error).message ?? String(e);
      }
      if (!row(id)) throw new AssayError("not_found", { account: id });
      const status: Status = st ? (st.signedIn ? "signed-in" : "signed-out") : "unknown";
      const detail = st ? { ...scrubDetail(st.detail), method: st.method } : { error: err, method: null };
      k.run(
        "UPDATE accounts SET status=?, detail=?, checked_at=? WHERE id=?",
        status,
        JSON.stringify(detail),
        k.now(),
        id,
      );
      return changed(id);
    },

    async checkAll() {
      const out: AccountView[] = [];
      for (const v of api.list()) out.push(await api.check(v.id));
      return out;
    },

    async login(id, onOutput) {
      const r = must(id);
      const existing = logins.get(id);
      if (existing) return { started: false, terminal: existing.kind };
      const cmd = adapter(r.provider).loginCommand(ref(r));
      const cwd = r.home ?? homedir();
      if (r.home) mkdirSync(r.home, { recursive: true, mode: 0o700 });
      const spawnPty = await pty();
      let finished = false;
      const finish = (code: number | null): void => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        logins.delete(id);
        onOutput(`\r\n[login exited${code === null ? "" : ` with code ${code}`}]\r\n`, false);
        void api
          .check(id)
          .catch(() => undefined)
          .finally(() => onOutput("", true));
      };
      const timer = setTimeout(() => logins.get(id)?.kill(), o.loginTimeoutMs ?? 10 * 60_000);
      timer.unref?.();
      let handle: LoginHandle;
      let p: PtyLike | null = null;
      if (spawnPty) {
        try {
          p = spawnPty(cmd.program, cmd.args, { name: "xterm-256color", cols: 100, rows: 30, cwd, env: cmd.env });
        } catch {
          p = null; // the pty could not start (e.g. its helper cannot run): use pipes
        }
      }
      if (p) {
        const term = p;
        term.onData((d) => onOutput(d, false));
        term.onExit((e) => {
          finish(e.exitCode);
          // On Windows node-pty closes the pseudoconsole and stops its conout worker thread only in
          // kill(); after a natural exit both would leak (and keep the process from exiting).
          if (process.platform === "win32") {
            try {
              term.kill();
            } catch {
              // already released
            }
          }
        });
        handle = { kind: "pty", write: (d) => term.write(d), kill: () => term.kill() };
      } else {
        let child: ChildProcessWithoutNullStreams;
        try {
          child = spawnProcess({ program: cmd.program, args: cmd.args, env: cmd.env, cwd, stdio: "pipe" });
        } catch (e) {
          clearTimeout(timer);
          throw new AssayError(
            "provider_unavailable",
            { provider: r.provider, program: cmd.program },
            (e as Error).message,
          );
        }
        for (const s of [child.stdin, child.stdout, child.stderr]) s.on("error", () => {});
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (d: string) => onOutput(d, false));
        child.stderr.on("data", (d: string) => onOutput(d, false));
        child.on("error", (e) => {
          onOutput(`${e.message}\r\n`, false);
          finish(null);
        });
        child.on("close", (code) => finish(code));
        handle = {
          kind: "pipes",
          // Without a terminal the client sees no TTY; Enter must arrive as a newline.
          write: (d) => child.stdin.write(d.replace(/\r(?!\n)/g, "\n")),
          kill: () => child.kill("SIGTERM"),
        };
      }
      logins.set(id, handle);
      onOutput(`$ ${basename(cmd.program)} ${cmd.args.join(" ")}\r\n`, false);
      return { started: true, terminal: handle.kind };
    },

    input(id, data) {
      const h = logins.get(id);
      if (!h) throw new AssayError("not_found", { login: id, why: "no login is running for this account" });
      h.write(data);
    },

    cancelLogin(id) {
      logins.get(id)?.kill();
    },

    loginRunning(id) {
      return logins.has(id);
    },

    async ensureDefaults() {
      const made: AccountView[] = [];
      for (const [pid, a] of o.providers) {
        if (pid === "fake" && !o.defaultFake) continue;
        const key = `accounts.default.${pid}`;
        if (k.meta(key)) continue;
        let info: Awaited<ReturnType<ProviderAdapter["detect"]>>;
        try {
          info = await a.detect();
        } catch {
          continue;
        }
        if (!info.installed) continue;
        const has = k.get("SELECT id FROM accounts WHERE provider=? AND home IS NULL", pid);
        if (!has) {
          const label = pid === "acp" && info.program ? `${basename(info.program)} (default)` : DEFAULT_LABELS[pid];
          made.push(api.create({ provider: pid, label, home: "default" }));
        }
        k.setMeta(key, String(k.now()));
      }
      return made;
    },

    close() {
      for (const h of logins.values()) h.kill();
      logins.clear();
    },
  };
  return api;
}
