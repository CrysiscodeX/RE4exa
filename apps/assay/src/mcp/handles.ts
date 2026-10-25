// Large tool payloads live behind handles so a tool result stays under the text budget. The store is
// an in-memory LRU with a byte cap; a handle belongs to one case, and untrusted payloads stay
// untrusted when they are paged back out with `assay_fetch`.

import { randomBytes } from "node:crypto";
import { AssayError } from "../errors.ts";

export interface HandleEntry {
  id: string;
  caseId: string;
  text: string;
  bytes: number;
  untrusted: boolean;
  origin: string;
  createdAt: number;
}

export interface HandlePage {
  handle: string;
  text: string;
  /** Offsets and lengths count UTF-16 code units of the stored text. */
  offset: number;
  length: number;
  total: number;
  nextOffset: number | null;
  untrusted: boolean;
  origin: string;
}

export interface HandleStoreOptions {
  /** Total bytes kept across all handles. Default 64 MiB. */
  maxBytes?: number;
  /** Largest single payload. Default 16 MiB; larger payloads are cut and marked. */
  maxEntryBytes?: number;
  now?: () => number;
}

export const DEFAULT_PAGE_BYTES = 6 * 1024;

export class HandleStore {
  readonly maxBytes: number;
  readonly maxEntryBytes: number;
  #entries = new Map<string, HandleEntry>();
  #bytes = 0;
  #now: () => number;

  constructor(opts: HandleStoreOptions = {}) {
    this.maxBytes = opts.maxBytes ?? 64 * 1024 * 1024;
    this.maxEntryBytes = Math.min(opts.maxEntryBytes ?? 16 * 1024 * 1024, this.maxBytes);
    this.#now = opts.now ?? Date.now;
  }

  get bytes(): number {
    return this.#bytes;
  }

  get size(): number {
    return this.#entries.size;
  }

  put(caseId: string, text: string, meta: { untrusted?: boolean; origin?: string } = {}): string {
    let stored = text;
    let bytes = Buffer.byteLength(stored);
    if (bytes > this.maxEntryBytes) {
      const mark = "\n[assay: payload cut at the handle store's per-entry cap]";
      const keep = Math.max(0, this.maxEntryBytes - Buffer.byteLength(mark));
      stored = `${Buffer.from(stored)
        .subarray(0, keep)
        .toString("utf8")
        .replace(/\uFFFD$/, "")}${mark}`;
      bytes = Buffer.byteLength(stored);
    }
    const id = `h_${randomBytes(12).toString("hex")}`;
    this.#entries.set(id, {
      id,
      caseId,
      text: stored,
      bytes,
      untrusted: meta.untrusted ?? false,
      origin: meta.origin ?? "tool",
      createdAt: this.#now(),
    });
    this.#bytes += bytes;
    this.#evict();
    return id;
  }

  #evict(): void {
    for (const [id, e] of this.#entries) {
      if (this.#bytes <= this.maxBytes) break;
      this.#entries.delete(id);
      this.#bytes -= e.bytes;
    }
  }

  get(handle: string, caseId: string): HandleEntry {
    const e = this.#entries.get(handle);
    if (!e || e.caseId !== caseId) throw new AssayError("handle_unknown", { handle });
    // Touch: move to the most-recently-used end.
    this.#entries.delete(handle);
    this.#entries.set(handle, e);
    return e;
  }

  /** One page of a payload; `length` defaults to roughly `DEFAULT_PAGE_BYTES` of UTF-8. */
  page(handle: string, caseId: string, offset = 0, length?: number, maxBytes = DEFAULT_PAGE_BYTES): HandlePage {
    const e = this.get(handle, caseId);
    if (!Number.isInteger(offset) || offset < 0) throw new AssayError("bad_request", { offset });
    if (length !== undefined && (!Number.isInteger(length) || length <= 0))
      throw new AssayError("bad_request", { length });
    const start = Math.min(offset, e.text.length);
    let end = Math.min(e.text.length, start + (length ?? maxBytes));
    let slice = e.text.slice(start, end);
    // Keep the page inside the byte budget even for multi-byte text.
    while (Buffer.byteLength(slice) > maxBytes && end > start + 1) {
      end = start + Math.max(1, Math.floor((end - start) * 0.75));
      slice = e.text.slice(start, end);
    }
    // Do not split a surrogate pair.
    if (end < e.text.length && /[\uD800-\uDBFF]$/.test(slice)) {
      end -= 1;
      slice = slice.slice(0, -1);
    }
    return {
      handle,
      text: slice,
      offset: start,
      length: slice.length,
      total: e.text.length,
      nextOffset: end < e.text.length ? end : null,
      untrusted: e.untrusted,
      origin: e.origin,
    };
  }

  dropCase(caseId: string): void {
    for (const [id, e] of this.#entries)
      if (e.caseId === caseId) {
        this.#entries.delete(id);
        this.#bytes -= e.bytes;
      }
  }
}
