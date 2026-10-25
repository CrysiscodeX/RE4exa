import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, beforeEach, describe, it } from "node:test";
import { isAssayError } from "../src/errors.ts";
import type { Json } from "../src/evidence/jcs.ts";
import {
  createFakeAdapter,
  FAKE_ABSENT_NEEDLE,
  parseClaimCommand,
  parseSpawnCommand,
  pathIn,
} from "../src/providers/fake.ts";
import { McpHttpClient } from "../src/providers/mcp-client.ts";
import { ofType, sessionOpts, textOf } from "./fixtures/providers/session.ts";

const FILE = "first line of the readme\nmiddle\nthe very last line here\n";

interface Stub {
  url: string;
  calls: { name: string; args: Record<string, Json> }[];
  authSeen: string[];
  sessionSeen: (string | null)[];
  tools: string[];
  sse: boolean;
  server: Server;
}

function startStub(): Promise<Stub> {
  const stub = {
    calls: [],
    authSeen: [],
    sessionSeen: [],
    tools: ["assay_sweep", "assay_read_file", "assay_record_claim", "assay_exec", "assay_spawn_worker"],
    sse: false,
  } as unknown as Stub;
  const reply = (res: ServerResponse, id: unknown, result: unknown, sse: boolean): void => {
    const body = JSON.stringify({ jsonrpc: "2.0", id, result });
    if (sse) {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(
        `event: message\ndata: {"jsonrpc":"2.0","method":"notifications/progress","params":{}}\n\nevent: message\ndata: ${body}\n\n`,
      );
    } else {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(body);
    }
  };
  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    let raw = "";
    for await (const c of req) raw += c;
    stub.authSeen.push(String(req.headers.authorization ?? ""));
    if (req.headers.authorization !== "Bearer tok_fake") {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "bad token" } }));
      return;
    }
    const m = JSON.parse(raw) as {
      id?: number;
      method: string;
      params?: { name?: string; arguments?: Record<string, Json> };
    };
    if (m.method !== "initialize") stub.sessionSeen.push((req.headers["mcp-session-id"] as string) ?? null);
    if (m.id === undefined) {
      res.writeHead(202);
      res.end();
      return;
    }
    if (m.method === "initialize") {
      res.setHeader("mcp-session-id", "mcp-sess-1");
      return reply(
        res,
        m.id,
        { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "assay", version: "0" } },
        false,
      );
    }
    if (m.method === "tools/list")
      return reply(res, m.id, { tools: stub.tools.map((name) => ({ name, inputSchema: { type: "object" } })) }, false);
    if (m.method === "tools/call") {
      const name = m.params?.name ?? "";
      const args = m.params?.arguments ?? {};
      stub.calls.push({ name, args });
      const text = (t: string, extra: Record<string, unknown> = {}) => ({
        content: [{ type: "text", text: t }],
        ...extra,
      });
      let result: unknown;
      switch (name) {
        case "assay_sweep":
          result = text("swept", {
            structuredContent: {
              findings: [{ label: "install script" }, { label: "native addon" }],
              questions: ["what does it fetch?"],
            },
          });
          break;
        case "assay_read_file":
          result = args.path === "missing.txt" ? text("not found", { isError: true }) : text(FILE);
          break;
        case "assay_spawn_worker":
          result = text(`Started worker w_${stub.calls.length} (${String(args.task)}) on fake.`);
          break;
        case "assay_exec":
          result = text("approved and ran: exit 0\nhello");
          break;
        default:
          result = text("ok");
      }
      return reply(res, m.id, result, stub.sse);
    }
    reply(res, m.id, {}, false);
  };
  const server = createServer((req, res) => void handler(req, res));
  stub.server = server;
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      stub.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
      resolve(stub);
    });
  });
}

describe("fake provider against a stub MCP HTTP server", () => {
  let stub: Stub;
  before(async () => {
    stub = await startStub();
  });
  after(() => stub.server.close());
  beforeEach(() => {
    stub.calls = [];
    stub.authSeen = [];
    stub.sessionSeen = [];
    stub.sse = false;
    stub.tools = ["assay_sweep", "assay_read_file", "assay_record_claim", "assay_exec", "assay_spawn_worker"];
  });
  const opts = (over: Parameters<typeof sessionOpts>[0] = {}) =>
    sessionOpts({ mcp: { url: stub.url, token: "tok_fake", stdioProxy: { program: "x", args: [] } }, ...over });

  it("default reply: reads a file and records two true claims and one false one, streaming text and usage", async () => {
    const r = opts();
    const s = await createFakeAdapter().start(r.opts);
    const out = await s.send("Please look at docs/notes.md for me");
    assert.equal(out.stopReason, "end_turn");
    assert.equal(textOf(r.events), out.text);
    assert.ok(ofType(r.events, "text-delta").length > 3, "streams in chunks");
    assert.deepEqual(stub.calls[0], { name: "assay_read_file", args: { path: "docs/notes.md" } });
    const claims = stub.calls.filter((c) => c.name === "assay_record_claim").map((c) => c.args);
    assert.equal(claims.length, 3);
    assert.deepEqual(
      claims.map((c) => (c.params as { text: string }).text),
      ["first line of the readme", "the very last line here", FAKE_ABSENT_NEEDLE],
    );
    for (const c of claims) {
      assert.equal(c.predicate, "file.contains");
      assert.equal(c.path, "docs/notes.md");
      assert.equal(c.label, "seen");
    }
    assert.ok(
      stub.authSeen.every((a) => a === "Bearer tok_fake"),
      "bearer token on every request",
    );
    assert.ok(
      stub.sessionSeen.every((sid) => sid === "mcp-sess-1"),
      "MCP session id carried after initialize",
    );
    const usage = ofType(r.events, "usage");
    assert.equal(usage.length, 1);
    assert.equal(usage[0]?.costUsd, 0);
    assert.ok((usage[0]?.inputTokens ?? 0) > 0 && (usage[0]?.outputTokens ?? 0) > 0);
    assert.deepEqual(
      ofType(r.events, "tool-call").map((e) => e.name),
      ["assay_read_file", "assay_record_claim", "assay_record_claim", "assay_record_claim"],
    );
    assert.ok(ofType(r.events, "tool-result").every((e) => e.ok));
    await s.close();
  });

  it("default reply without a path reads README.md; a failed read records nothing", async () => {
    const r = opts();
    const s = await createFakeAdapter().start(r.opts);
    await s.send("what is this project?");
    assert.equal(stub.calls[0]?.args.path, "README.md");
    stub.calls = [];
    const out = await s.send("check missing.txt");
    assert.match(out.text, /could not read missing\.txt/);
    assert.equal(stub.calls.filter((c) => c.name === "assay_record_claim").length, 0);
    assert.equal(ofType(r.events, "tool-result").at(-1)?.ok, false);
  });

  it("sweep summarises the findings (tool results over SSE)", async () => {
    stub.sse = true;
    const r = opts();
    const s = await createFakeAdapter().start(r.opts);
    const out = await s.send("sweep pkg/");
    assert.deepEqual(stub.calls, [{ name: "assay_sweep", args: { path: "pkg/" } }]);
    assert.equal(out.text, "Sweep of pkg/: 2 findings (install script; native addon). Open questions: 1.");
  });

  it("spawn, claim, run, read and echo commands", async () => {
    const r = opts();
    const s = await createFakeAdapter().start(r.opts);
    const spawned = await s.send("spawn 2 workers: check the manifest; read the install script; ignored third");
    assert.deepEqual(
      stub.calls.map((c) => [c.name, c.args.task]),
      [
        ["assay_spawn_worker", "check the manifest"],
        ["assay_spawn_worker", "read the install script"],
      ],
    );
    assert.equal(spawned.text, "Started 2 workers: w_1, w_2.");
    stub.calls = [];
    await s.send(
      'claim pkg.has-install-script {"path": "package.json", "script": "postinstall"} The package has a postinstall script',
    );
    assert.deepEqual(stub.calls[0], {
      name: "assay_record_claim",
      args: {
        predicate: "pkg.has-install-script",
        params: { path: "package.json", script: "postinstall" },
        text: "The package has a postinstall script",
        label: "seen",
        path: "package.json",
      },
    });
    stub.calls = [];
    const ran = await s.send("run ls -la src");
    assert.deepEqual(stub.calls[0], { name: "assay_exec", args: { program: "ls", args: ["-la", "src"] } });
    assert.match(ran.text, /^Ran ls: approved and ran/);
    stub.calls = [];
    const read = await s.send("read a/b.txt");
    assert.deepEqual(stub.calls[0], { name: "assay_read_file", args: { path: "a/b.txt" } });
    assert.match(read.text, /^a\/b\.txt: first line/);
    assert.equal((await s.send("echo just words")).text, "just words");
  });

  it("a worker (sees assay_worker_done, not assay_spawn_worker) reports done after its turn", async () => {
    stub.tools = ["assay_read_file", "assay_record_claim", "assay_worker_done"];
    const s = await createFakeAdapter().start(opts().opts);
    await s.send("read x/y.txt");
    assert.deepEqual(
      stub.calls.map((c) => c.name),
      ["assay_read_file", "assay_worker_done"],
    );
    assert.match(String(stub.calls[1]?.args.summary), /^x\/y\.txt:/);
  });

  it("script steps: text, thinking, tool, approval, error, usage", async () => {
    const r = opts({ allow: (t) => t === "net" });
    const a = createFakeAdapter({
      script: (text, turn) => [
        { thinking: `turn ${turn}` },
        { text: `you said ${text}. ` },
        { tool: "assay_read_file", args: { path: "q.txt" } },
        { approve: { tool: "net", input: { host: "example.com" }, reason: "fetch" } },
        { approve: { tool: "rm" } },
        { error: "soft failure", code: "x" },
        { usage: { inputTokens: 7, outputTokens: 3, costUsd: 0.5 } },
      ],
    });
    const s = await a.start(r.opts);
    const out = await s.send("hi");
    assert.equal(out.text, "you said hi. (net approved) (rm denied) ");
    assert.deepEqual(
      r.approvals.map((x) => x.tool),
      ["net", "rm"],
    );
    assert.deepEqual(ofType(r.events, "usage"), [
      { type: "usage", inputTokens: 7, outputTokens: 3, costUsd: 0.5, model: "fake" },
    ]);
    assert.deepEqual(ofType(r.events, "error"), [{ type: "error", message: "soft failure", code: "x" }]);
    assert.deepEqual(ofType(r.events, "thinking"), [{ type: "thinking", text: "turn 1" }]);
    assert.ok(s.providerSessionId?.startsWith("fake-session-"));
  });

  it("interrupt stops a turn; crash steps reject with provider_error; resume keeps the id", async () => {
    const a = createFakeAdapter({
      script: (t) => (t === "crash" ? [{ crash: "boom" }] : [{ text: "a " }, { delay: 2000 }, { text: "b" }]),
    });
    const r = opts({ resume: "fake-old" });
    const s = await a.start(r.opts);
    assert.equal(s.providerSessionId, "fake-old");
    const p = s.send("go");
    await new Promise((res) => setTimeout(res, 30));
    await s.interrupt();
    const out = await p;
    assert.equal(out.stopReason, "interrupted");
    assert.equal(out.text, "a ");
    await assert.rejects(s.send("crash"), (e: unknown) => isAssayError(e, "provider_error"));
    assert.equal(ofType(r.events, "status").at(-1)?.state, "error");
    await s.close();
    await assert.rejects(s.send("after close"), (e: unknown) => isAssayError(e, "provider_error"));
  });

  it("a wrong token surfaces as a failed tool result", async () => {
    const r = sessionOpts({ mcp: { url: stub.url, token: "wrong", stdioProxy: { program: "x", args: [] } } });
    const s = await createFakeAdapter().start(r.opts);
    const out = await s.send("read z.txt");
    assert.match(out.text, /Could not read z\.txt: MCP HTTP 401/);
    await assert.rejects(new McpHttpClient(stub.url, "wrong").initialize(), (e: unknown) =>
      isAssayError(e, "unauthorized"),
    );
  });

  it("detect, status and login need nothing", async () => {
    const a = createFakeAdapter();
    const info = await a.detect();
    assert.equal(info.installed, true);
    assert.equal(info.enforcement, "enforced");
    assert.equal((await a.status({ id: "f", provider: "fake", label: "f", home: null })).signedIn, true);
    assert.equal(a.loginCommand({ id: "f", provider: "fake", label: "f", home: null }).program, process.execPath);
  });

  it("command parsers", () => {
    assert.deepEqual(parseClaimCommand('file.contains {"path":"a {b}","needle":"x\\"y"} It has it'), {
      predicate: "file.contains",
      params: { path: "a {b}", needle: 'x"y' },
      text: "It has it",
    });
    assert.throws(
      () => parseClaimCommand("file.contains not-json"),
      (e: unknown) => isAssayError(e, "bad_request"),
    );
    assert.throws(
      () => parseClaimCommand('p {"a": 1'),
      (e: unknown) => isAssayError(e, "bad_request"),
    );
    assert.throws(
      () => parseClaimCommand(""),
      (e: unknown) => isAssayError(e, "bad_request"),
    );
    assert.deepEqual(parseSpawnCommand("3 workers: a; b"), ["a", "b"]);
    assert.deepEqual(parseSpawnCommand("a; b; c"), ["a", "b", "c"]);
    assert.equal(pathIn("look at (src/index.ts), please"), "src/index.ts");
    assert.equal(pathIn("nothing here"), null);
  });
});
