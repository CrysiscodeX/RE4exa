import { createHash, randomBytes } from "node:crypto";

// UUIDv7 (RFC 9562), monotonic within this process: ids minted in the same millisecond carry an
// increasing 12-bit sequence in rand_a (RFC 9562 §6.2 method 1), so sorting by id follows minting
// order. Nothing is read back from the store, so two processes can never collide on a cached
// counter (the pi-durable defect); uniqueness across processes comes from the 62 random bits.
let lastMs = -1;
let seq = 0;

export function uuidv7(nowMs: number = Date.now()): string {
  let ms = nowMs;
  if (ms <= lastMs) {
    seq++;
    if (seq > 0xfff) {
      // sequence exhausted within one millisecond: borrow the next millisecond
      lastMs++;
      seq = 0;
    }
    ms = lastMs;
  } else {
    lastMs = ms;
    seq = randomBytes(1)[0]! & 0x3f; // random start leaves headroom and avoids predictable ids
  }
  const b = randomBytes(16);
  const ts = BigInt(ms);
  for (let i = 0; i < 6; i++) b[i] = Number((ts >> BigInt(8 * (5 - i))) & 0xffn);
  b[6] = 0x70 | ((seq >> 8) & 0x0f);
  b[7] = seq & 0xff;
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
