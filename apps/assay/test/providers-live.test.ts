// Opt-in live smoke test: runs one real turn on the person's default Claude account.
// Only with ASSAY_LIVE=1. It spends at most $0.05.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createClaudeAdapter } from "../src/providers/claude.ts";
import { ofType, sessionOpts } from "./fixtures/providers/session.ts";
import { tmp } from "./helpers.ts";

const live = process.env.ASSAY_LIVE === "1";

describe("live: claude adapter on the default account", { skip: live ? false : "set ASSAY_LIVE=1 to run" }, () => {
  it("one turn: Reply with the single word OK.", { timeout: 180_000 }, async () => {
    const t = tmp("assay-live-");
    try {
      const r = sessionOpts({
        account: { id: "live", provider: "claude", label: "default", home: null },
        cwd: t.dir,
        mode: "enforced",
        maxBudgetUsd: 0.05,
        // No Assay server in this test: the MCP entry points nowhere and simply fails to connect.
        mcp: { url: "http://127.0.0.1:9/mcp", token: "none", stdioProxy: { program: "true", args: [] } },
      });
      const s = await createClaudeAdapter().start(r.opts);
      try {
        const out = await s.send("Reply with the single word OK.");
        assert.match(out.text, /OK/);
        assert.ok(ofType(r.events, "usage").length >= 1, "a usage event arrived");
        assert.ok(s.providerSessionId, "the session id was recorded");
      } finally {
        await s.close();
      }
    } finally {
      t.cleanup();
    }
  });
});
