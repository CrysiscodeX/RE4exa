import assert from "node:assert/strict";
import { test } from "node:test";
import { isCoreError } from "../src/errors.ts";
import { HandleStore } from "../src/mcp/handles.ts";

test("pages a payload to the end and reassembles it exactly", () => {
  const h = new HandleStore();
  const text = Array.from({ length: 3000 }, (_, i) => `line ${i} ${"\u00E9\u4E2D".repeat(i % 7)}`).join("\n");
  const id = h.put("c1", text, { untrusted: true, origin: "file:x" });
  let offset: number | null = 0;
  let out = "";
  let pages = 0;
  while (offset !== null) {
    const p = h.page(id, "c1", offset);
    assert.ok(Buffer.byteLength(p.text) <= 6 * 1024);
    assert.equal(p.untrusted, true);
    assert.equal(p.origin, "file:x");
    out += p.text;
    offset = p.nextOffset;
    pages++;
  }
  assert.equal(out, text);
  assert.ok(pages > 5);
  const p = h.page(id, "c1", 10, 5);
  assert.equal(p.text, text.slice(10, 15));
  assert.equal(p.total, text.length);
});

test("handles are scoped to their case and unknown handles fail with handle_unknown", () => {
  const h = new HandleStore();
  const id = h.put("c1", "secret stuff");
  assert.throws(
    () => h.page(id, "c2"),
    (e) => isCoreError(e, "handle_unknown"),
  );
  assert.throws(
    () => h.page("h_nope", "c1"),
    (e) => isCoreError(e, "handle_unknown"),
  );
  assert.throws(
    () => h.page(id, "c1", -1),
    (e) => isCoreError(e, "bad_request"),
  );
  h.dropCase("c1");
  assert.throws(
    () => h.page(id, "c1"),
    (e) => isCoreError(e, "handle_unknown"),
  );
  assert.equal(h.bytes, 0);
});

test("LRU evicts the least recently used entries past the byte cap", () => {
  const h = new HandleStore({ maxBytes: 3000 });
  const a = h.put("c", "a".repeat(1000));
  const b = h.put("c", "b".repeat(1000));
  h.page(a, "c"); // touch a
  const c = h.put("c", "c".repeat(1500));
  assert.ok(h.bytes <= 3000);
  assert.throws(
    () => h.page(b, "c"),
    (e) => isCoreError(e, "handle_unknown"),
  );
  assert.equal(h.page(a, "c").text.length, 1000);
  assert.equal(h.page(c, "c").text.length, 1500);
  // A payload over the per-entry cap is cut and marked.
  const big = h.put("c", "x".repeat(5000));
  assert.match(h.get(big, "c").text, /payload cut/);
});
