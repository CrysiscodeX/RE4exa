# 0002 Agent clients sign in themselves; Assay holds no model credentials

**Status:** accepted.

**Decision.**
- Each account is the official client's own login (`claude auth login`, `codex login`, ACP `authenticate`), in its own configuration home.
- Assay asks the official tool for status, and records usage from the client's own events.
- It never reads credential stores, never copies tokens, and never rotates accounts. pi-ai's Claude OAuth path is excluded because it presents itself as Claude Code.

**Consequences.**
- People use their subscription through their own client, and Assay stores no secrets.
- Whether provider terms allow a third-party product to drive the official client is the person's to check. Attach mode, where the person runs the client, avoids the question.
