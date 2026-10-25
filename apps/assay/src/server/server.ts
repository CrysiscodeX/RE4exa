// Loopback HTTP + WebSocket server (T3 Code's pattern: pairing code → signed session; short-lived
// single-use WebSocket tickets). Refuses foreign Host and Origin headers (DNS rebinding, CSRF).

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, join, normalize, resolve } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import { AssayError, isAssayError } from "../errors.ts";
import type { ServerPush } from "./api-types.ts";

export interface Route {
  method: string;
  /** e.g. "/api/cases/:id/messages" */
  path: string;
  handler(ctx: { params: Record<string, string>; query: URLSearchParams; body: unknown; req: IncomingMessage; res: ServerResponse }): Promise<unknown> | unknown;
}

export interface ServerOptions {
  port?: number;
  host?: string;
  uiDir: string;
  sessionKey: Buffer;
  routes: Route[];
  /** Raw handler for the MCP endpoint (bearer tokens, no cookie). */
  mcp(req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void>;
  onPushSubscribe(send: (p: ServerPush) => void): () => void;
  version: string;
}

export interface RunningServer {
  url: string;
  port: number;
  pairingUrl(): string;
  close(): Promise<void>;
  server: Server;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
};

const SESSION_DAYS = 30;
const PAIR_TTL_MS = 5 * 60_000;
const TICKET_TTL_MS = 5 * 60_000;
const MAX_BODY = 4 * 1024 * 1024;

function b64url(b: Buffer): string {
  return b.toString("base64url");
}

export async function startServer(opts: ServerOptions): Promise<RunningServer> {
  const pairCodes = new Map<string, number>();
  const tickets = new Map<string, number>();
  let port = 0;

  const hmac = (s: string) => b64url(createHmac("sha256", opts.sessionKey).update(s).digest());
  const issueSession = () => {
    const payload = `v1.${Date.now() + SESSION_DAYS * 86_400_000}.${b64url(randomBytes(16))}`;
    return `${payload}.${hmac(payload)}`;
  };
  const validSession = (v: string | undefined): boolean => {
    if (!v) return false;
    const i = v.lastIndexOf(".");
    if (i < 0) return false;
    const payload = v.slice(0, i);
    const sig = Buffer.from(v.slice(i + 1));
    const want = Buffer.from(hmac(payload));
    if (sig.length !== want.length || !timingSafeEqual(sig, want)) return false;
    const exp = Number(payload.split(".")[1]);
    return Number.isFinite(exp) && exp > Date.now();
  };
  const cookie = (req: IncomingMessage, name: string): string | undefined => {
    for (const part of (req.headers.cookie ?? "").split(";")) {
      const [k, ...v] = part.trim().split("=");
      if (k === name) return v.join("=");
    }
    return undefined;
  };
  const newPairCode = () => {
    const code = b64url(randomBytes(12));
    pairCodes.set(code, Date.now() + PAIR_TTL_MS);
    return code;
  };

  const allowedHosts = () => new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);
  const checkHostOrigin = (req: IncomingMessage): boolean => {
    if (!allowedHosts().has(String(req.headers.host ?? ""))) return false;
    const origin = req.headers.origin;
    if (origin === undefined) return true;
    try {
      return allowedHosts().has(new URL(origin).host);
    } catch {
      return false;
    }
  };

  const compiled = opts.routes.map((r) => {
    const keys: string[] = [];
    const re = new RegExp(
      `^${r.path.replace(/:[a-zA-Z]+/g, (m) => {
        keys.push(m.slice(1));
        return "([^/]+)";
      })}$`,
    );
    return { ...r, re, keys };
  });

  const send = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
    const isText = typeof body === "string";
    res.writeHead(status, {
      "content-type": isText ? (headers["content-type"] ?? "text/plain; charset=utf-8") : "application/json",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...headers,
    });
    res.end(isText ? body : JSON.stringify(body));
  };

  const statusFor = (e: AssayError): number => {
    if (e.code === "bad_request" || e.code === "evidence_invalid" || e.code === "prompt_too_large" || e.code === "path_outside_workspace") return 400;
    if (e.code === "unauthorized") return 401;
    if (e.code === "not_found" || e.code === "probe_unknown") return 404;
    if (["receipt_conflict", "unknown_conflict", "breaker_open", "budget_exceeded", "depth_exceeded", "stale_attempt", "store_locked"].includes(e.code)) return 409;
    return 500;
  };

  const readBody = (req: IncomingMessage): Promise<unknown> =>
    new Promise((resolveBody, reject) => {
      let size = 0;
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => {
        size += c.length;
        if (size > MAX_BODY) {
          reject(new AssayError("bad_request", { why: "body too large" }));
          req.destroy();
        } else chunks.push(c);
      });
      req.on("end", () => {
        if (chunks.length === 0) return resolveBody(undefined);
        try {
          resolveBody(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        } catch {
          reject(new AssayError("bad_request", { why: "invalid JSON" }));
        }
      });
      req.on("error", reject);
    });

  const uiRoot = resolve(opts.uiDir);
  const csp = () =>
    `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' ws://127.0.0.1:${port} ws://localhost:${port}; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`;
  const serveStatic = (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://x");
    let p = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, "");
    if (p === "" || p === ".") p = "index.html";
    let file = resolve(uiRoot, p);
    if (!file.startsWith(uiRoot)) return send(res, 404, "not found");
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(uiRoot, "index.html");
    if (!existsSync(file)) return send(res, 503, "The UI is not built. Run `npm run build:ui` in apps/assay.");
    res.writeHead(200, {
      "content-type": MIME[extname(file)] ?? "application/octet-stream",
      "content-security-policy": csp(),
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "cross-origin-opener-policy": "same-origin",
      "cache-control": extname(file) === ".html" ? "no-store" : "public, max-age=31536000, immutable",
    });
    res.end(readFileSync(file));
  };

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://x");
      if (url.pathname === "/mcp") {
        if (!allowedHosts().has(String(req.headers.host ?? "")) || (req.headers.origin !== undefined && !checkHostOrigin(req)))
          return send(res, 403, { error: { code: "unauthorized", message: "foreign host or origin" } });
        const body = req.method === "POST" ? await readBody(req) : undefined;
        return await opts.mcp(req, res, body);
      }
      if (!checkHostOrigin(req)) return send(res, 403, { error: { code: "unauthorized", message: "foreign host or origin" } });
      if (!url.pathname.startsWith("/api/")) return serveStatic(req, res);
      if (url.pathname === "/api/pair" && req.method === "POST") {
        const body = (await readBody(req)) as { code?: string } | undefined;
        const exp = body?.code ? pairCodes.get(body.code) : undefined;
        if (!exp || exp < Date.now()) throw new AssayError("unauthorized", { why: "pairing code invalid or expired" });
        pairCodes.delete(body!.code!);
        return send(res, 200, { ok: true }, { "set-cookie": `assay_session=${issueSession()}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_DAYS * 86400}` });
      }
      if (!validSession(cookie(req, "assay_session"))) throw new AssayError("unauthorized");
      if (url.pathname === "/api/ws-ticket" && req.method === "POST") {
        const t = b64url(randomBytes(24));
        tickets.set(t, Date.now() + TICKET_TTL_MS);
        return send(res, 200, { ticket: t });
      }
      for (const r of compiled) {
        if (r.method !== req.method) continue;
        const m = r.re.exec(url.pathname);
        if (!m) continue;
        const params: Record<string, string> = {};
        r.keys.forEach((key, i) => {
          params[key] = decodeURIComponent(m[i + 1]!);
        });
        const body = req.method === "GET" || req.method === "DELETE" ? undefined : await readBody(req);
        const out = await r.handler({ params, query: url.searchParams, body, req, res });
        if (res.headersSent) return;
        if (out && typeof out === "object" && "__download" in (out as object)) {
          const d = out as unknown as { __download: true; body: string; type: string; filename: string };
          return send(res, 200, d.body, { "content-type": d.type, "content-disposition": `attachment; filename="${d.filename.replace(/[^a-zA-Z0-9._-]/g, "_")}"` });
        }
        return send(res, r.method === "POST" && r.path.endsWith("/messages") ? 202 : 200, out ?? { ok: true });
      }
      throw new AssayError("not_found", { path: url.pathname });
    } catch (e) {
      const err = isAssayError(e) ? e : new AssayError("bad_request", { message: String((e as Error)?.message ?? e) }, String((e as Error)?.message ?? e));
      if (!isAssayError(e)) process.stderr.write(`assay: ${(e as Error)?.stack ?? e}\n`);
      if (!res.headersSent) send(res, statusFor(err), { error: err.toJSON() });
    }
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://x");
    const t = url.searchParams.get("ticket") ?? "";
    const exp = tickets.get(t);
    if (url.pathname !== "/api/ws" || !checkHostOrigin(req) || !exp || exp < Date.now()) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    tickets.delete(t);
    wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
      const sendPush = (p: ServerPush) => {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(p));
      };
      sendPush({ type: "hello", version: opts.version });
      const unsub = opts.onPushSubscribe(sendPush);
      ws.on("message", () => undefined);
      ws.on("close", unsub);
      ws.on("error", unsub);
    });
  });

  await new Promise<void>((r) => server.listen(opts.port ?? 0, opts.host ?? "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
  const url = `http://127.0.0.1:${port}`;
  const sweeper = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of pairCodes) if (v < now) pairCodes.delete(k);
    for (const [k, v] of tickets) if (v < now) tickets.delete(k);
  }, 60_000);
  sweeper.unref();
  return {
    url,
    port,
    server,
    pairingUrl: () => `${url}/#pair=${newPairCode()}`,
    close: () =>
      new Promise<void>((r) => {
        clearInterval(sweeper);
        for (const c of wss.clients) c.terminate();
        wss.close();
        server.closeAllConnections?.();
        server.close(() => r());
      }),
  };
}
