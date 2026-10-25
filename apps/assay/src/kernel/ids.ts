import { createHash, randomBytes } from "node:crypto";

/** UUIDv7: time-ordered, generated fresh each call (no counter cached at open; see pi-durable defect). */
export function uuidv7(nowMs: number = Date.now()): string {
  const b = randomBytes(16);
  const ts = BigInt(nowMs);
  for (let i = 0; i < 6; i++) b[i] = Number((ts >> BigInt(8 * (5 - i))) & 0xffn);
  b[6] = (b[6]! & 0x0f) | 0x70;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function sha256(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

export function newId(prefix: string, nowMs?: number): string {
  return `${prefix}_${uuidv7(nowMs).replaceAll("-", "")}`;
}
