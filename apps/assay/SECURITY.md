# Security policy

## Supported versions

Security fixes go to the latest 0.x release. The support period is stated in machine-readable form in [`support.json`](support.json).

## Reporting a vulnerability

Report it privately through GitHub's private vulnerability reporting on this repository (Security → Report a vulnerability). Do not open a public issue.

| Commitment | Time |
|---|---|
| Acknowledgement | within 3 working days |
| First assessment | within 10 working days |
| Fix or mitigation for a confirmed high or critical issue | target 30 days |
| Actively exploited issue | notified the same working day |

When a release is affected, an advisory is published once a fix is available.

Each release's dependency inventory is the CycloneDX SBOM produced by CI (`npm sbom`, the `assay-results` artifact). Dependencies are exact-pinned. The runtime list is checked by `scripts/dep-budget.ts`.

## What Assay protects, and what it does not

The full model is [docs/threat-model.md](docs/threat-model.md). It lists 7 trust boundaries, 11 threats, the test for each threat, and the residual risks. In short:

**What Assay holds and does:**
- **No model credentials.** Agent clients sign in with their own official login, in their own config home.
- **Loopback only.** The server is paired once, then uses HMAC session cookies and single-use WebSocket tickets. Foreign Host and Origin headers are refused.
- **Target content is fenced.** Anything read from the target is wrapped in a fresh random tag. After such content is read, actions that write, execute, use the network or publish need the person's approval.
- **Secrets are not stored.** Secrets found in targets are replaced by fingerprints before anything is stored.

**What Assay does not do:**
- It does not sandbox the commands the person approves. They run with the person's privileges, bounded by argv-only execution, time limits, output caps and the workspace path guard.
- In *open* mode, the agent client's built-in tools bypass Assay's checks. The interface labels this mode "unenforced".
