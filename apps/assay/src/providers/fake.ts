// A deterministic, scriptable provider for e2e tests, the bench and demos. No network beyond Assay's
// own MCP endpoint: it behaves like an agent that calls Assay's tools over MCP HTTP with the session's
// bearer token. Commands (first word of the user's text):
//   sweep <path>                          assay_sweep, then a summary of the findings
//   spawn <n> workers: <t1>; <t2> ...     assay_spawn_worker once per task
//   claim <predicate> <json-params> <text>  assay_record_claim (params.path, if any, is the subject)
//   run <program> <args...>               assay_exec (Assay's policy asks the person)
//   read <path>                           assay_read_file
//   echo <text>                           reply with the text, no tools
//   anything else                         read the first path-like word (default README.md) and record
//                                         three file.contains claims about it: two true, one false
// A worker (it sees assay_worker_done but not assay_spawn_worker) reports done at the end of a turn.
// `script` replaces the commands with explicit steps.

import type { Json } from "@re4exa/core/evidence/jcs";
import type {
  AccountRef,
  AccountStatus,
  AgentEvent,
  AgentSession,
  ProviderAdapter,
  ProviderInfo,
  SessionOptions,
} from "../contracts.ts";
import { AssayError } from "../errors.ts";
import { type McpCallResult, McpHttpClient, type McpTool, resultText } from "./mcp-client.ts";
import { estimateTokens, summarize } from "./util.ts";

export type FakeStep =
  | { text: string }
  | { thinking: string }
  | { tool: string; args?: Record<string, Json> }
  | { approve: { tool: string; input?: Json; reason?: string } }
  | { error: string; code?: string }
  | { delay: number }
  | { usage: { inputTokens: number; outputTokens: number; costUsd?: number | null; model?: string | null } }
  | { crash: string };

export interface FakeAdapterOptions {
  /** Steps for every turn, or a function of the turn's text and number (1-based). */
  script?: FakeStep[] | ((text: string, turn: number) => FakeStep[]);
  /** Delay between streamed text chunks, in ms (default 0). */
  chunkDelayMs?: number;
  fetch?: typeof fetch;
  model?: string;
}

/** The text the default reply's false claim looks for; it is in no real file. */
export const FAKE_ABSENT_NEEDLE = "assay-fake-absent-0f1e2d3c";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Split `claim <predicate> <json> <text>` (exported for tests). */
export function parseClaimCommand(rest: string): { predicate: string; params: Json; text: string } {
  const m = /^(\S+)\s+/.exec(rest);
  if (!m) throw new AssayError("bad_request", { why: "claim needs <predicate> <json-params> <text>" });
  const predicate = m[1]!;
  const after = rest.slice(m[0].length);
  if (!after.startsWith("{") && !after.startsWith("[")) {
    throw new AssayError("bad_request", { why: "claim params must be JSON" });
  }
  let depth = 0;
  let inStr = false;
  let end = -1;
  for (let i = 0; i < after.length; i++) {
    const c = after[i];
    if (inStr) {
      if (c === "\\") i++;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  if (end < 0) throw new AssayError("bad_request", { why: "unbalanced claim params" });
  return { predicate, params: JSON.parse(after.slice(0, end)) as Json, text: after.slice(end).trim() };
}

/** Split `spawn <n> workers: a; b; c` (exported for tests). */
export function parseSpawnCommand(rest: string): string[] {
  const m = /^(\d+)\s+workers?\s*:\s*(.*)$/is.exec(rest.trim());
  const tasks = (m ? m[2]! : rest)
    .split(";")
    .map((t) => t.trim())
    .filter(Boolean);
  const n = m ? Number(m[1]) : tasks.length;
  return tasks.slice(0, n);
}

/** Pick the first path-like word in free text. */
export function pathIn(text: string): string | null {
  for (const w of text.split(/\s+/)) {
    const t = w.replace(/^["'`(<]+|["'`)>,.;:!?]+$/g, "");
    if (/^[\w.~-]*[/.][\w./~-]+$/.test(t) && !/^\.+$/.test(t)) return t;
  }
  return null;
}

class FakeSession implements AgentSession {
  readonly providerSessionId: string;
  #opts: SessionOptions;
  #o: FakeAdapterOptions;
  #mcp: McpHttpClient | null = null;
  #tools: McpTool[] | null = null;
  #turn = 0;
  #calls = 0;
  #busy = false;
  #interrupted = false;
  #closed = false;
  #reply = "";
  #inputChars = 0;

  constructor(opts: SessionOptions, o: FakeAdapterOptions, id: string) {
    this.#opts = opts;
    this.#o = o;
    this.providerSessionId = opts.resume ?? id;
  }

  #emit(e: AgentEvent): void {
    try {
      this.#opts.onEvent(e);
    } catch {
      // listener failures must not break the session
    }
  }

  async #client(): Promise<McpHttpClient> {
    if (!this.#mcp) {
      const c = new McpHttpClient(this.#opts.mcp.url, this.#opts.mcp.token, this.#o.fetch);
      await c.initialize();
      this.#mcp = c;
      this.#tools = await c.listTools();
    }
    return this.#mcp;
  }

  async #hasTool(name: string): Promise<boolean> {
    await this.#client();
    return (this.#tools ?? []).some((t) => t.name === name);
  }

  async #call(
    name: string,
    args: Record<string, Json>,
  ): Promise<{ ok: boolean; text: string; data: Json | undefined }> {
    const id = `fake_call_${++this.#calls}`;
    this.#emit({ type: "tool-call", id, name, input: args });
    let r: McpCallResult;
    try {
      const c = await this.#client();
      r = await c.callTool(name, args);
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      this.#emit({ type: "tool-result", id, name, ok: false, summary: summarize(msg) });
      return { ok: false, text: msg, data: undefined };
    }
    const text = resultText(r);
    this.#inputChars += text.length;
    this.#emit({ type: "tool-result", id, name, ok: r.isError !== true, summary: summarize(text) });
    return { ok: r.isError !== true, text, data: r.structuredContent };
  }

  async #say(text: string): Promise<void> {
    const chunks = text.match(/\S+\s*|\s+/g) ?? [];
    for (const c of chunks) {
      if (this.#interrupted) return;
      this.#reply += c;
      this.#emit({ type: "text-delta", text: c });
      if (this.#o.chunkDelayMs) await sleep(this.#o.chunkDelayMs);
    }
  }

  async #runStep(s: FakeStep): Promise<void> {
    if ("text" in s) await this.#say(s.text);
    else if ("thinking" in s) this.#emit({ type: "thinking", text: s.thinking });
    else if ("tool" in s) await this.#call(s.tool, s.args ?? {});
    else if ("approve" in s) {
      const ok = await this.#opts.approve({
        tool: s.approve.tool,
        input: s.approve.input ?? null,
        reason: s.approve.reason,
      });
      await this.#say(ok ? `(${s.approve.tool} approved) ` : `(${s.approve.tool} denied) `);
    } else if ("error" in s) this.#emit({ type: "error", message: s.error, code: s.code });
    else if ("delay" in s) {
      const until = Date.now() + s.delay;
      while (Date.now() < until && !this.#interrupted) await sleep(Math.min(10, s.delay));
    } else if ("usage" in s)
      this.#emit({
        type: "usage",
        inputTokens: s.usage.inputTokens,
        outputTokens: s.usage.outputTokens,
        costUsd: s.usage.costUsd ?? 0,
        model: s.usage.model ?? this.#o.model ?? "fake",
      });
    else if ("crash" in s) throw new AssayError("provider_error", { provider: "fake" }, s.crash);
  }

  async #command(text: string): Promise<void> {
    const t = text.trim();
    const m = /^(\w+)\s*(.*)$/s.exec(t);
    const verb = m?.[1]?.toLowerCase() ?? "";
    const rest = m?.[2]?.trim() ?? "";
    switch (verb) {
      case "sweep":
        return this.#sweep(rest || ".");
      case "spawn": {
        const tasks = parseSpawnCommand(rest);
        const ids: string[] = [];
        for (const task of tasks) {
          const r = await this.#call("assay_spawn_worker", { task });
          ids.push(/\b(w(?:orker)?_[\w-]+)/.exec(r.text)?.[1] ?? (r.ok ? "started" : "failed"));
        }
        return this.#say(`Started ${tasks.length} worker${tasks.length === 1 ? "" : "s"}: ${ids.join(", ")}.`);
      }
      case "claim": {
        const c = parseClaimCommand(rest);
        const args: Record<string, Json> = { predicate: c.predicate, params: c.params, text: c.text, label: "seen" };
        const p = c.params as { path?: unknown } | null;
        if (p && typeof p === "object" && !Array.isArray(p) && typeof p.path === "string") args.path = p.path;
        const r = await this.#call("assay_record_claim", args);
        return this.#say(r.ok ? `Recorded: ${c.text}` : `Could not record the claim: ${summarize(r.text, 200)}`);
      }
      case "run": {
        const [program, ...args] = rest.split(/\s+/).filter(Boolean);
        if (!program) return this.#say("Nothing to run.");
        const r = await this.#call("assay_exec", { program, args });
        return this.#say(
          r.ok ? `Ran ${program}: ${summarize(r.text, 400)}` : `Could not run ${program}: ${summarize(r.text, 200)}`,
        );
      }
      case "read": {
        const r = await this.#call("assay_read_file", { path: rest });
        return this.#say(
          r.ok ? `${rest}: ${summarize(r.text, 400)}` : `Could not read ${rest}: ${summarize(r.text, 200)}`,
        );
      }
      case "echo":
        return this.#say(rest);
      default:
        return this.#defaultReply(t);
    }
  }

  async #sweep(path: string): Promise<void> {
    const r = await this.#call("assay_sweep", { path });
    if (!r.ok) return this.#say(`The sweep of ${path} failed: ${summarize(r.text, 200)}`);
    const data = r.data as { findings?: { label?: string; class?: string }[]; questions?: string[] } | undefined;
    const findings = Array.isArray(data?.findings) ? data.findings : null;
    if (!findings) return this.#say(`Sweep of ${path}: ${summarize(r.text, 400)}`);
    const list = findings
      .slice(0, 5)
      .map((f) => f.label ?? f.class ?? "finding")
      .join("; ");
    const q = data?.questions?.length ? ` Open questions: ${data.questions.length}.` : "";
    return this.#say(
      `Sweep of ${path}: ${findings.length} finding${findings.length === 1 ? "" : "s"}${findings.length ? ` (${list})` : ""}.${q}`,
    );
  }

  async #defaultReply(text: string): Promise<void> {
    const path = pathIn(text) ?? "README.md";
    const r = await this.#call("assay_read_file", { path });
    if (!r.ok) return this.#say(`I could not read ${path}: ${summarize(r.text, 200)}`);
    const lines = r.text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length >= 3 && !/^<\/?untrusted/.test(l));
    const first = (lines[0] ?? r.text.trim()).slice(0, 40);
    const last = (lines[lines.length - 1] ?? first).slice(0, 40);
    const claims: { needle: string; text: string }[] = [
      { needle: first, text: `${path} contains "${first}"` },
      { needle: last, text: `${path} contains "${last}"` },
      { needle: FAKE_ABSENT_NEEDLE, text: `${path} contains "${FAKE_ABSENT_NEEDLE}"` },
    ];
    for (const c of claims) {
      if (this.#interrupted) return;
      await this.#call("assay_record_claim", {
        predicate: "file.contains",
        params: { text: c.needle },
        path,
        text: c.text,
        label: "seen",
      });
    }
    return this.#say(
      `I read ${path} and recorded 3 claims about it:\n${claims.map((c, i) => `${i + 1}. ${c.text}`).join("\n")}`,
    );
  }

  async send(text: string): Promise<{ text: string; stopReason: string }> {
    if (this.#closed) throw new AssayError("provider_error", { provider: "fake" }, "The session is closed");
    if (this.#busy) throw new AssayError("bad_request", { why: "a turn is already running" });
    this.#busy = true;
    this.#interrupted = false;
    this.#reply = "";
    this.#inputChars = this.#turn === 0 ? this.#opts.systemPrompt.length + text.length : text.length;
    const turn = ++this.#turn;
    this.#emit({ type: "status", state: "working" });
    try {
      const script = typeof this.#o.script === "function" ? this.#o.script(text, turn) : this.#o.script;
      const hasUsage = script?.some((s) => "usage" in s) ?? false;
      if (script) {
        for (const s of script) {
          if (this.#interrupted) break;
          await this.#runStep(s);
        }
      } else {
        await this.#command(text);
        if (!this.#interrupted && (await this.#isWorker()))
          await this.#call("assay_worker_done", { summary: summarize(this.#reply, 300) });
      }
      if (!hasUsage)
        this.#emit({
          type: "usage",
          inputTokens: Math.ceil(this.#inputChars / 4),
          outputTokens: estimateTokens(this.#reply),
          costUsd: 0,
          model: this.#o.model ?? "fake",
        });
      this.#emit({ type: "status", state: "idle" });
      return { text: this.#reply, stopReason: this.#interrupted ? "interrupted" : "end_turn" };
    } catch (e) {
      const message = (e as Error).message ?? String(e);
      this.#emit({ type: "error", message, code: e instanceof AssayError ? e.code : "provider_error" });
      this.#emit({ type: "status", state: "error" });
      throw e;
    } finally {
      this.#busy = false;
    }
  }

  async #isWorker(): Promise<boolean> {
    if (!this.#mcp) return false;
    return (await this.#hasTool("assay_worker_done")) && !(await this.#hasTool("assay_spawn_worker"));
  }

  async interrupt(): Promise<void> {
    if (this.#busy) this.#interrupted = true;
  }

  async close(): Promise<void> {
    this.#closed = true;
    this.#interrupted = true;
  }
}

export function createFakeAdapter(o: FakeAdapterOptions = {}): ProviderAdapter {
  let n = 0;
  return {
    id: "fake",
    async detect(): Promise<ProviderInfo> {
      return {
        id: "fake",
        installed: true,
        version: "1.0.0",
        program: null,
        enforcement: "enforced",
        notes: ["Deterministic scripted provider for tests, the bench and demos. It only calls Assay's MCP tools."],
      };
    },
    async status(_account: AccountRef): Promise<AccountStatus> {
      return { signedIn: true, method: "none", detail: { note: "the fake provider needs no sign-in" } };
    },
    loginCommand(_account: AccountRef): { program: string; args: string[]; env: Record<string, string> } {
      return { program: process.execPath, args: ["-e", "console.log('The fake provider needs no sign-in.')"], env: {} };
    },
    async start(opts: SessionOptions): Promise<AgentSession> {
      opts.onEvent({ type: "status", state: "starting" });
      const s = new FakeSession(opts, o, `fake-session-${++n}`);
      opts.onEvent({ type: "status", state: "idle" });
      return s;
    },
  };
}
