// Stateless paging for list operations (DECISION-LOG D-3). The target is content-addressed and
// results are deterministic, so `offset` is a valid continuation token: page.next is the offset of
// the next page, or null on the last one.
import type { JsonSchema } from "./types.ts";

export const PAGE_MAX = 10_000;

export const PAGE_INPUT: Record<"offset" | "limit", JsonSchema> = {
  offset: { type: "integer", minimum: 0, default: 0, description: "first row to return (page.next continues)" },
  limit: { type: "integer", minimum: 1, maximum: PAGE_MAX, default: 200, description: "rows per page" },
};

export interface Page {
  offset: number;
  limit: number;
  total: number;
  /** The offset of the next page, or null when this page reaches the end. */
  next: number | null;
}

export function page<T>(all: readonly T[], args: Record<string, unknown>): { items: T[]; page: Page } {
  const offset = (args.offset as number | undefined) ?? 0;
  const limit = (args.limit as number | undefined) ?? 200;
  const items = all.slice(offset, offset + limit);
  const end = offset + items.length;
  return { items, page: { offset, limit, total: all.length, next: end < all.length ? end : null } };
}
