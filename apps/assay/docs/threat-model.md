# Assay threat model

> threat model v1, reviewed for assay 0.1.0

Assay drives official agent clients on the person's own signed-in accounts and checks what they claim
against re-runnable evidence. It runs locally. The agents it drives are useful precisely because they
read attacker-controlled material -- the artifacts under analysis -- so the central assumption is that
**target content is hostile and the agent may be fooled by it.** Assay's job is to make sure that being
fooled cannot, on its own, change the world: every effect with consequences passes through policy and,
when it matters, the person.

This document is the contract the `policy/` and `mcp/` subsystems implement and the tests enforce.

## Assets

- **A1 Workspace files** -- the person's source tree and the artifacts under analysis. Integrity and
  confidentiality (a malicious artifact must not read a sibling private key and send it out).
- **A2 The person's accounts** -- Claude / Codex / ACP, driven through official clients on real
  credentials. Assay never handles the credentials; it must not let an agent spend, post or act on
  those accounts beyond the turn the person asked for.
- **A3 Evidence integrity** -- the hash-chained case log, claim records and verdicts. A claim is only
  worth anything if it cannot be forged or silently edited.
- **A4 The local server** -- the loopback HTTP server and its MCP endpoint. A web page or another
  local program must not be able to drive it.
- **A5 The person's wider machine** -- files outside the workspace, other processes, SSH keys, the
  shell. Assay's tools must not become a path to them.

## Actors

- **M1 Malicious artifact content** -- the primary adversary. Text, file names, metadata, encoded or
  hidden payloads in the material the agent reads, trying to turn the agent into its deputy.
- **M2 Other local software** -- a browser tab, a second CLI, a cron job on the same machine, probing
  the loopback server (DNS rebinding, CSRF-style requests, port scraping for the bearer token).
- **M3 A compromised or confused agent** -- a client that has been talked into trying an effect, or a
  buggy one that calls tools it should not.
- **M4 A second MCP server in the client's session** -- another server the person has configured, able
  to offer look-alike tools or read what flows past in the same session.
- **M5 A bundle recipient** -- someone the person shares an exported case with, and conversely a
  tampered bundle arriving from someone else.

## Trust boundaries

- **TB1 target content -> agent.** Everything the agent reads is untrusted data, never instructions.
- **TB2 agent -> Assay tools.** The agent is not trusted to self-authorize; policy decides.
- **TB3 Assay -> the OS.** `assay_exec` / `assay_write_file` cross into the real machine.
- **TB4 browser / other local process -> local server.** Only the paired UI and the issued agent
  tokens may talk to the server.
- **TB5 Assay -> provider CLI.** Assay configures the client but does not hold its credentials; in
  enforced mode the client must see only Assay's tools.
- **TB6 other MCP servers inside the client.** Assay cannot police tools it does not own; it can only
  keep them out (enforced mode) or declare them out of scope (open mode).
- **TB7 exported bundle -> recipient.** Integrity travels with the bundle, not with Assay.

## Top threats, mitigations, and the test that checks each

| # | Boundary | Threat | Mitigation | Test |
|---|---|---|---|---|
| T1 | TB1/TB3 | Injected instruction in an artifact makes the agent run a command or write a file ("run `touch PWNED`", curl an exfil URL, write `~/.ssh`). | Tool output from the target is marked untrusted and wrapped by `envelope`; reading it taints the caller (`SessionTaint`). `decide` routes every write/exec/network/publish to approval, and auto-approve rules stop applying once tainted. Reason text names untrusted content. | `test/tripwire.test.ts` (24 carriers, 0 executed, 100% routed); `test/policy-taint.test.ts` (policy matrix); `test/mcp-registry.test.ts` (taint + reason + no spawn). |
| T2 | TB1 | Content breaks out of the envelope by writing its own `</untrusted-content>`, guessing the id, or using a look-alike / escaped / full-width tag. | `envelope` uses a fresh random id per call and neutralises every closing/opening tag look-alike (case, spacing, `_`/`-`, HTML and JS escapes, full-width/small forms) inside the body. | `test/policy-taint.test.ts` ("closing-tag escapes are neutralised, including guessed ids"); tripwire `escape-close.md`, `unicode-tags.md`, `zero-width.md`. |
| T3 | TB1 | Hidden instructions a human reviewer cannot see (Unicode tag chars, bidi overrides, zero-width chars). | `envelope`/`sanitizeUntrusted` strip U+E0000-E007F, bidi controls and zero-width chars, and report counts in the `sanitized` attribute so the reviewer knows text was removed. | `test/policy-taint.test.ts` ("strips Unicode tag characters, bidi controls and zero-width"). |
| T4 | TB1/A3 | A secret in the artifact (or in a tool error, approval detail, claim) is copied into the model context, the log, or an export. | `redact` walks every string, replaces detected secrets with `[redacted:<kind>:<fp8>]`, stores only a fingerprint. Applied to untrusted tool output, approval detail and error bodies. | `test/policy-redact.test.ts` (seeded corpus: 0 survive, <=2 false hits in 54 benign lines); `test/mcp-registry.test.ts` (secret in file output); `test/policy-approvals.test.ts` (detail redacted). |
| T5 | TB3/A1/A5 | Path traversal or a symlink lets a file tool escape the workspace, or a write lands a hook in `.git`. | `resolveInWorkspace` resolves real paths, refuses anything outside the workspace, refuses writes through a symlink or into `.git`. | `test/mcp-registry.test.ts` ("path guard"). |
| T6 | TB3 | `assay_exec` reaches a shell, runs unbounded, leaks the environment, or floods output. | argv only, no shell (vendored Orca `runProcess`), 30 s timeout, 1 MiB output cap, a minimal allow-listed environment. | `test/mcp-registry.test.ts` ("argv only, bounded, minimal environment"). |
| T7 | TB2/A2 | A worker calls a coordinator-only (worker-management) tool, or an agent self-approves. | `list`/`visible` hide `coordinatorOnly` tools from workers; `call` re-checks and only policy calls `ctx.approve`. The agent has no "approve" verb. | `test/mcp-registry.test.ts` ("hides coordinatorOnly"); `test/mcp-server.test.ts`. |
| T8 | TB4/A4 | A browser or other local process drives the server (DNS rebinding, CSRF, token theft). | `mountHttp` requires a bearer token (constant-time compare, only a digest kept), checks Host and Origin against the loopback name, answers JSON only (no SSE), rejects GET. | `test/mcp-server.test.ts` ("bearer auth, Host/Origin checks, methods"). |
| T9 | TB2/A3 | A forged tool result or a fake "SYSTEM:"/"user approved" message convinces the agent it already has permission. | Such text arrives only as enveloped untrusted content and still taints; approval is a separate out-of-band decision the content cannot reach. | tripwire `fake-tool-result.json`, `fake-system.md`, `escape-close.md`. |
| T10 | TB5/TB6 | In enforced mode the client also loads the person's other MCP servers, exposing un-policed tools. | `claudeMcpArgs` adds `--strict-mcp-config`; `assertOnlyAssay` refuses any config naming another server. | `test/mcp-config.test.ts` ("refuses any other server"). |
| T11 | A3 | An instruction past the 8 KB result budget, or inside a large payload, slips through un-enveloped. | The whole payload is redacted and enveloped; only a preview is inlined and the rest goes behind one handle that pages back enveloped and still tainting. | `test/mcp-registry.test.ts` ("large results ... one payload copy"); tripwire `long.txt`. |

## Residual risks (stated plainly)

- **Open mode bypasses taint for the client's built-in tools.** In open mode the client keeps its own
  file/exec tools, which never pass through Assay's policy. A prompt injection can use *those*. Assay
  reports the enforcement level per provider (`ProviderInfo.enforcement`); only enforced mode gives the
  guarantees above. Use open mode only with trusted targets.
- **Assay provides no OS-level process isolation.** `assay_exec` bounds time, output, argv and
  environment, but an approved process runs with the person's own privileges. Sandboxing (containers,
  seccomp, a separate user) is the host's responsibility; on Linux Assay does not add it.
- **Approval is only as strong as the person.** Policy routes correctly, but a person who approves
  without reading defeats it. The reason text and redacted detail exist to make the decision
  informed; they cannot force attention.
- **The detector set is not exhaustive.** `redact` covers common secret shapes and high-entropy
  assignments; a novel credential format or a secret split across values can still pass. Redaction is
  defence in depth, not a guarantee that no secret ever reaches the model.
- **TB6 beyond enforced mode.** Assay cannot inspect or constrain another MCP server's tools; it can
  only exclude them. A person who adds another server in open mode is outside Assay's control.
- **Bundle trust (TB7) rides on signatures, not on Assay.** A recipient must verify the bundle's
  signature and digests; a bundle whose producer's key is not trusted proves nothing. Assay reports a
  failed check as `bundle_tampered` but cannot establish who the producer is.
- **Local-process threats (M2) share the machine.** The loopback checks stop remote and browser-based
  access, but another program running as the same user can read the token from memory or the config
  file; Assay keeps the config mode `0600` but cannot defend against a peer with equal privilege.
