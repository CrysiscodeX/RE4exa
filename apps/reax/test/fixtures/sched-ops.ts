// Test-only operations for the SCH tests. They reach a scheduler only through the in-process
// resolveOperation option (startDaemon({ sched }) or new Scheduler(...)); `reax serve` never passes
// it, so no production path can run them.
//   test.gate.cheap | medium | deep   (read)   and test.gate.write (medium, write):
//       each run registers under its `tag` and waits until the test opens that tag's gate; on abort
//       it rejects with the signal's reason. `fill` makes a result of that many bytes (`paged`: as a
//       page of items). Invocations are counted per tag and per operation.
//   test.engine (deep, exec): the fake engine's `sleep` mode through commandEngine, with the job's
//       signal; it ends only when its signal is aborted (cancel, timeout, disconnect, shutdown).
import { join } from "node:path";
import { CoreError } from "@re4exa/core/errors";
import { parseNm } from "../../src/engines/llvm.ts";
import { commandEngine } from "../../src/engines/run.ts";
import { operation } from "../../src/ops/registry.ts";
import type { Operation, OpResult } from "../../src/ops/types.ts";

const FAKE = join(import.meta.dirname, "fake-engine.mjs");
/** As in engines.test.ts: enforced where a sandbox exists; on win32 explicitly unenforced ("none"). */
export const ENGINE_REQUIRED = process.platform !== "win32";

/** The gates: tests open them by tag; runs that start before their gate opens wait for it. */
export class GateBoard {
  readonly #waiting = new Map<string, () => void>();
  readonly #open = new Set<string>();
  readonly #started = new Map<string, (() => void)[]>();
  /** Tags in the order their runs started. */
  readonly starts: string[] = [];
  /** Invocations per operation name. */
  readonly calls = new Map<string, number>();

  open(tag: string): void {
    const w = this.#waiting.get(tag);
    if (w) {
      this.#waiting.delete(tag);
      w();
    } else this.#open.add(tag);
  }

  /** Resolves once a run with this tag has started (at once if one already has). */
  started(tag: string): Promise<void> {
    if (this.starts.includes(tag)) return Promise.resolve();
    return new Promise((r) => {
      const list = this.#started.get(tag) ?? [];
      list.push(r);
      this.#started.set(tag, list);
    });
  }

  count(tag: string): number {
    return this.starts.filter((t) => t === tag).length;
  }

  async run(name: string, tag: string, signal: AbortSignal | undefined): Promise<void> {
    this.calls.set(name, (this.calls.get(name) ?? 0) + 1);
    this.starts.push(tag);
    for (const r of this.#started.get(tag) ?? []) r();
    this.#started.delete(tag);
    if (this.#open.delete(tag)) return;
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        this.#waiting.delete(tag);
        reject(signal!.reason);
      };
      if (signal?.aborted) {
        onAbort();
        return;
      }
      signal?.addEventListener("abort", onAbort, { once: true });
      this.#waiting.set(tag, () => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      });
    });
  }
}

const ALL = ["linux", "darwin", "win32"] as const;

function gateOp(board: GateBoard, cls: Operation["cost"], effect: Operation["effect"], name: string): Operation {
  return {
    tool: "verify",
    name,
    summary: "test only",
    input: {
      type: "object",
      properties: { tag: { type: "string", maxLength: 64 }, fill: { type: "integer" }, paged: { type: "boolean" } },
      required: ["tag"],
      additionalProperties: false,
    },
    effect,
    cost: cls,
    untrusted: false,
    platforms: [...ALL],
    examples: [],
    covers: [],
    async run(ctx, args): Promise<OpResult> {
      const tag = String(args.tag);
      await board.run(name, tag, ctx.signal);
      const fill = (args.fill as number | undefined) ?? 0;
      let data: unknown = { tag };
      if (fill > 0 && args.paged) {
        const items = Array.from({ length: Math.ceil(fill / 1000) }, (_, i) => `${i}:${"x".repeat(990)}`);
        data = { tag, items, page: { offset: 0, limit: items.length, total: items.length, next: null } };
      } else if (fill > 0) data = { tag, blob: "x".repeat(fill) };
      return { data, text: `gate ${tag}`, coverage: "complete", limitations: [] };
    },
  };
}

function engineOp(): Operation {
  const engine = commandEngine<{ mode: string }, unknown>({
    id: "fake-sched",
    operations: ["symbols"],
    resourceClass: "light",
    candidates: () => [FAKE],
    launcher: (p) => ({ program: process.execPath, prefix: [p] }),
    parseVersion: (out) => /^fake-engine version (\S+)$/m.exec(out)?.[1] ?? null,
    minMajor: 18,
    remediation: () => "test only",
    args: (r) => [r.mode],
    maxOutputBytes: 1 << 20,
    alwaysRequired: false,
    parse: (s) => {
      const p = parseNm(s);
      return p.ok ? { ok: true, data: p.data } : p;
    },
  });
  return {
    tool: "verify",
    name: "test.engine",
    summary: "test only",
    input: {
      type: "object",
      properties: { scratch: { type: "string", maxLength: 4096 } },
      required: ["scratch"],
      additionalProperties: false,
    },
    effect: "exec",
    cost: "deep",
    untrusted: false,
    platforms: [...ALL],
    examples: [],
    covers: [],
    async run(ctx, args): Promise<OpResult> {
      const r = await engine.run(
        { mode: "sleep" },
        { scratch: String(args.scratch), required: ENGINE_REQUIRED, timeoutMs: 600_000, signal: ctx.signal },
      );
      return { data: r, text: "engine", coverage: "complete", limitations: [] };
    },
  };
}

/** The test operations over one board, and a resolver: test operations first, then the registry. */
export function testOps(board: GateBoard) {
  const ops = new Map<string, Operation>();
  for (const [cls, effect, name] of [
    ["cheap", "read", "test.gate.cheap"],
    ["medium", "read", "test.gate.medium"],
    ["deep", "read", "test.gate.deep"],
    ["medium", "write", "test.gate.write"],
  ] as const)
    ops.set(name, gateOp(board, cls, effect, name));
  ops.set("test.engine", engineOp());
  return {
    ops,
    resolveOperation: (name: string): Operation => {
      const op = ops.get(name);
      if (op) return op;
      if (name.startsWith("test.")) throw new CoreError("operation_unknown", { operation: name });
      return operation(name);
    },
  };
}
