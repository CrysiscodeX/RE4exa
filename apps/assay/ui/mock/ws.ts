// Minimal RFC 6455 WebSocket server side for the mock: handshake, unmasking, text frames, ping/pong, close.
// Enough for the UI's needs; not a general-purpose implementation (no extensions, no binary messages).

import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

export interface WsConn {
  send(text: string): void;
  close(): void;
  readonly closed: boolean;
  onText: ((text: string) => void) | null;
  onClose: (() => void) | null;
}

function frame(opcode: number, payload: Buffer): Buffer {
  const len = payload.length;
  let head: Buffer;
  if (len < 126) {
    head = Buffer.from([0x80 | opcode, len]);
  } else if (len < 65536) {
    head = Buffer.alloc(4);
    head[0] = 0x80 | opcode;
    head[1] = 126;
    head.writeUInt16BE(len, 2);
  } else {
    head = Buffer.alloc(10);
    head[0] = 0x80 | opcode;
    head[1] = 127;
    head.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([head, payload]);
}

/** Completes the upgrade handshake and returns a connection, or null when the request is not a valid upgrade. */
export function acceptWebSocket(req: IncomingMessage, socket: Duplex): WsConn | null {
  const key = req.headers["sec-websocket-key"];
  if (typeof key !== "string" || req.headers.upgrade?.toLowerCase() !== "websocket") return null;
  const accept = createHash("sha1")
    .update(key + GUID)
    .digest("base64");
  socket.write(
    `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
  let buf = Buffer.alloc(0);
  let fragments: Buffer[] = [];
  const conn: WsConn = {
    closed: false,
    onText: null,
    onClose: null,
    send(text) {
      if (!conn.closed) socket.write(frame(0x1, Buffer.from(text, "utf8")));
    },
    close() {
      if (conn.closed) return;
      socket.write(frame(0x8, Buffer.alloc(0)));
      finish();
      socket.end();
    },
  };
  const finish = () => {
    if (conn.closed) return;
    (conn as { closed: boolean }).closed = true;
    conn.onClose?.();
  };
  socket.on("data", (chunk: Buffer) => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 2) {
      const b0 = buf[0]!;
      const b1 = buf[1]!;
      const fin = (b0 & 0x80) !== 0;
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let off = 2;
      if (len === 126) {
        if (buf.length < 4) return;
        len = buf.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (buf.length < 10) return;
        len = Number(buf.readBigUInt64BE(2));
        off = 10;
      }
      const maskLen = masked ? 4 : 0;
      if (buf.length < off + maskLen + len) return;
      const mask = masked ? buf.subarray(off, off + 4) : null;
      const payload = Buffer.from(buf.subarray(off + maskLen, off + maskLen + len));
      if (mask) for (let i = 0; i < payload.length; i++) payload[i] = payload[i]! ^ mask[i % 4]!;
      buf = buf.subarray(off + maskLen + len);
      if (opcode === 0x8) {
        conn.close();
        return;
      }
      if (opcode === 0x9) {
        socket.write(frame(0xa, payload));
        continue;
      }
      if (opcode === 0xa) continue;
      if (opcode === 0x1 || opcode === 0x0) {
        fragments.push(payload);
        if (fin) {
          const text = Buffer.concat(fragments).toString("utf8");
          fragments = [];
          conn.onText?.(text);
        }
      }
    }
  });
  socket.on("close", finish);
  socket.on("error", finish);
  return conn;
}
