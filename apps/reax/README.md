# reax

A clean-room replacement for rea and leanrea, in development. **Phase 0b of the plan: nothing here
analyses software yet.** What exists is the record of what reax must do and the gate that decides
when something counts as done.

| Part | What it is |
|---|---|
| `docs/ledger/limitations/*.jsonl` | The limitation register: every known weakness of rea (112 rows), leanrea (83) and the donor projects whose code or lessons reax takes, pi-durable, absurd, Orca and T3 Code (49). Seeded mechanically from [`docs/profiles`](../../docs/profiles). |
| `docs/ledger/parity/*.jsonl` | The parity ledger: rea's 46 capability families, its 229 tool names and 6 prompts at 6.8.0, leanrea's capabilities and traps, and reax's own infrastructure rows. |
| `docs/ledger/phase-map.json` | Which phase's gate each family or tool falls in. Reviewable data. |
| `docs/ledger/sources/rea-6.8.0-tools.json` | rea's public tool names and annotation hints, captured over MCP `tools/list`. No descriptions, schemas or code. |
| `scripts/seed-register.ts` | Re-seeds the ledger from the profiles. Keeps triage, marks vanished rows orphaned. |
| `scripts/parity-check.ts` | Computes each row's status from the JUnit reports of every CI lane. |
| `fixtures/` | The fixture corpus: C and C++ sources written for reax, built with zig 0.15.2 (pinned by wheel hash) for ELF, PE, Mach-O (thin and universal) and WebAssembly; 17 fixtures, 732 KB, digests in `manifest.json`. `scripts/fixtures.ts --check` rebuilds them byte-identical (CI lane `linux-fixtures`). |
| `bench/` | Benchmark: `make-tasks.ts` writes 30 tasks whose oracle comes from LLVM's tools; `src/bench/grade.ts` grades every arm's claims block the same way; `run.ts` runs cells (fake arm only so far); `PREREG.md` fixes the rules before any live run. |
| `docs/engine-research.md` | Open replacements for the engines rea uses, per operation and target class, with versions, licences and gaps (desk research). |
| `docs/plan.md` | The plan, with §14: the changes the register's triage found. |
| `docs/decisions/` | Decisions that deviate from or refine the plan. |
| `docs/review-notes.md` | Security items recorded for review. |

## Live runs (Linux, macOS, Windows)

The live backends run on your own machine, under your own sign-ins. They are a local model through
llama.cpp, Codex CLI, Claude Code CLI, and a hybrid of the three. reax never reads or copies a
credential.

**What you need:**
- Node 24.15 or newer
- git
- on Windows, Git for Windows (Claude Code's Bash tool needs it)

**1. Get the code.** In a terminal (PowerShell on Windows):

```bash
git clone https://github.com/CrysiscodeX/RE4exa
cd RE4exa
git checkout claude/admiring-volta-uc87nj
npm ci
```

**2. Set up and sign in.** These commands work from the repository root:

```bash
npm run bench:setup                    # detects the GPU; installs llama.cpp's build for it and the model
npm install -g @openai/codex @anthropic-ai/claude-code   # if not installed
codex login                            # your ChatGPT account
claude                                 # then /login with your Claude account, then /exit
npm run bench:doctor -- --live         # checks everything, sends one short request per CLI
npm run bench:smoke                    # 5 tasks on local, codex, claude and hybrid
```

**How `bench:setup` chooses the build.** It installs llama.cpp's own release build at tag
`b11923`. It picks the build from the hardware it finds:

| Machine | Builds tried, in order |
|---|---|
| Apple Silicon or Intel Mac | Metal, then CPU |
| NVIDIA | CUDA (the newest build the driver supports), then Vulkan, then CPU |
| AMD Radeon | ROCm (on Windows, or on Linux with ROCm installed), then Vulkan, then CPU |
| Intel GPU | Vulkan, then CPU |
| Snapdragon (Windows on Arm) | Adreno OpenCL, then Vulkan, then CPU |
| anything else | Vulkan if a loader is installed, then CPU |

**Checks during setup:**
- Each build must find its device (`llama-server --list-devices`).
- Each build must load the model under the 4 GB cap, or the next build is tried.
- Every download is checked against its publisher's sha256.

**Options:**
- `--dry-run` shows the plan without downloading.
- `--backend <id>` forces a build. SYCL, and backends llama.cpp offers beyond these, are reachable
  this way but are untested.
- `--server <path>` uses a llama-server you built yourself.

Behind a proxy, set `NODE_USE_ENV_PROXY=1`.

**Results.** They land in `bench/results/smoke-<date>-<os>/`. Commit and push them. Mac and
Windows results are reported separately. The rules are in
[`bench/PREREG-v2-smoke.md`](bench/PREREG-v2-smoke.md).

## Status rules (ADR 0001)

A row is covered only when tests tagged `[+KEY]` and `[-KEY]` both passed on every platform the row
names, in one CI run. Skipped tests count as not run; a failing tagged test makes the row
regressed; a tag that names no row fails the check. Status is never committed.

Not done yet:
- the limitation rows are triaged (phase, fix, severity, kind) as a draft: written by an agent from
  the plan and profiles, spot-checked on 19 rows, not yet reviewed by a person. Eight wont
  candidates stay gated until a person decides. The plan changes the triage found are in
  [`docs/plan.md`](docs/plan.md) §14;
- `docs/operations.md` and the operation registry arrive in phase 1;
- live benchmark arms: the local, codex, claude and hybrid backends exist and are tested against
  stand-ins; no live cell has run yet (they need a Mac with the sign-ins). The rea and leanrea
  arms are not implemented, so leanrea's comparison rows stay open.

## Commands (Node 24.15+, from a checkout after `npm ci` at the repository root)

```bash
npm run seed            # refresh docs/ledger from docs/profiles
npm run seed:check      # fail when the committed ledger differs from a fresh seed
npm test                # unit tests
npm run test:lane       # tests, writing reports/<platform>.xml
npm run parity -- --gate-phase 0 --gate-kind reax-infra
```

Licence: Apache-2.0.
