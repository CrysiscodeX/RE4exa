---
name: rex
description: Investigate shipped software (binaries, npm packages, archives, ASAR, JS trees) with evidence. Use when a claim depends on an artifact's actual bytes - what a package ships, which processes or native addons it loads, exports and imports of a native library, embedded Go/Rust metadata - and when the answer must cite reproducible evidence, track what is still unknown, and report what was never examined. Skip it for questions a source repository answers directly.
---

# rex: evidence-first investigation

rex records every observation as a content-addressed evidence record
(`ev_<sha256>`): same bytes + same probe = same id, on any machine. Answers must
cite evidence and cannot claim more confidence than that evidence. Coverage says
which declared questions are answered, partial, unknown or **unaccounted**.

Run it as `tools/rex/rex.sh <command>` (or `rex mcp` as an MCP server, 10 tools).
Set `REX_STORE` to keep one store per investigation. Every command prints JSON.

## Workflow (2-6 calls for most questions)

1. **Declare the questions first** - they are what coverage is measured against.
   `rex plan add "Which child processes can it start?" --require observed`
2. **Identify, then follow its `next_probes`.** `rex identify <path>` routes by magic bytes.
   | Target | Probe |
   |---|---|
   | npm `.tgz`, ZIP/APK/IPA, `.asar`, directory | `rex inventory <path>` (entries, sha256, package.json facts, ASAR integrity mismatches) |
   | ELF / PE / Mach-O (incl. `.node` addons) | `rex native <path>` (sections, exports, imports/NEEDED, Go build info, Rust `.dep-v0`) |
   | JS tree | `rex js-refs <dir>` (imports, `import.meta.resolve`, `new URL(.., import.meta.url)` assets, child processes, `.node` refs, env vars, source maps) |
   | Anything | `rex find <path> "<needle>"` - bounded slices, never whole files |
   | Deeper engines | `rex ext objdump <path> -- -d {target}`, `rex ext rea <path> -- inspect-go-binary {target} --json` |
3. **Read summaries; fetch detail by id.** Large results come back elided with a cost block.
   `rex show <ev_id> --view page --path entries --offset 0 --limit 50`
4. **Answer with evidence.** `rex answer <q_id> --status answered --confidence observed --evidence ev_a,ev_b --text "..."`
   If the evidence is weaker than the question requires, record `--status partial` or `unknown`.
5. **Check coverage before concluding.** `rex coverage`. Unaccounted questions are not negatives.

## Rules

- Probes never execute the target. Runtime behaviour needs a separate, declared, isolated run.
- A pattern match is a *seen string*, not proof of execution or module resolution.
- No match in a truncated scan is unknown, not absence. A missing Go build info record does not mean "not Go".
- Re-running a probe is free: steps are idempotent and return the stored evidence (`reused: true`).
- Keep answers to what the cited evidence shows; put judgement in `--rationale`.

## Durable runs

Put repeatable probes in a plan and run it; after a crash, run it again - finished steps are reused.
```json
{"steps": [{"op": "identify", "path": "/abs/app.tgz"}, {"op": "inventory", "path": "/abs/app.tgz"},
           {"op": "find", "path": "/abs/app", "needle": "ipcMain.handle"}],
 "questions": [{"text": "Which IPC channels does the main process handle?"}]}
```
`rex run plan.json` · `rex steps --status failed` · `rex export bundle.jsonl` / `rex import bundle.jsonl`
(streamed JSONL; tampered records are rejected on import).

## Calibration

When answers are later confirmed or refuted, record it: `rex adjudicate <q_id> correct|incorrect`.
`rex calibrate` reports precision per confidence class with Wilson intervals and says which
classes should abstain at your target error rate. Use it to decide how much to trust `inferred`.

## Before building a new tool or feature

`rex gate "<what you plan to build>"` searches a dissect index (`DISSECT_DB`) for existing
capabilities and code, then returns the necessity ladder. Reuse what exists before writing code.
