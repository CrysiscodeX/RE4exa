# 02 Framing: who it is for, what it must do, what it must not

This is a draft written before the debate. Layer 1's anatomy and the skeptic's and judge's critiques (layer 4) will change it, and each change is recorded in the journal.

## 1. What the four repos do

| | Learns about artifacts | Keeps work alive |
|---|---|---|
| **Heavy** (server, many parts) | rea: an MCP server with about 200 tools and an evidence record per finding | absurd: a Postgres engine with steps, checkpoints, claims, events, sleeps and SDKs in several languages |
| **Light** (embedded or skill) | leanrea: a skill text that sends the agent to plain CLI tools and has it label what it saw, inferred, or does not know | pi-durable: an agent harness whose turns and tools persist in SQLite, embedded in one process |

In plain terms:
- Two of the repos produce **knowledge**: what is inside a shipped binary, package or app, and how sure we are of it.
- Two give **survival**: work that continues after a crash, restart or handover.

Neither pair does the other's job. That is the case for combining them. The fact that each pair contains two answers to the same problem is the case against shipping all four as they are.

## 2. Who would use it (draft)

| User | Situation | What they need from it |
|---|---|---|
| **An agent in a coding or security session** | Asked "what does this installer, extension, package or binary actually do?" | A small number of tools that fits its context. Answers with evidence it can cite. Work that survives the session ending |
| **An analyst or reviewer (a person)** | Long investigations across days, versions and machines | Resumable runs, a record of what was checked and what was not, diffs between versions |
| **A platform or supply-chain team** | Checks every dependency, release or desktop app in CI | Unattended batch runs, bounded cost, machine-readable results, attestations |
| **A tool builder** | Embeds analysis or durability in their own agent | A library or MCP surface with stable contracts. Bring-your-own model account |

## 3. Jobs no single repo does today

These are hypotheses. Layer 1 has to confirm or kill each one.

1. **Investigations that survive.** A multi-hour analysis whose findings survive crashes and can be resumed by a different agent or person. rea's ledger lives in memory; pi-durable and absurd have no artifact knowledge.
2. **Cheap first, deep when needed.** Start with leanrea's plain-tool moves. Bring in rea's heavy parsers only when the cheap path can't answer, and record why.
3. **Evidence that outlives the tool.** Findings stored as durable, content-addressed records that another run, version or tool can check again.
4. **Fleet analysis.** Many artifacts, many workers, one ledger, with receipts so that retrying a step does not repeat a side effect. This draws on absurd and Orca.
5. **Run on the person's own model account.** Integrated clients sign in through the provider's official tooling, which T3 Code demonstrates, so the product uses subscription credits instead of an API key it has to store.

## 4. Forces through 2030–35

These are what the candidates are judged against. They follow the RQS-2030 horizon criteria.

- **Agents are the main callers.** Interface economy matters: catalog bytes, how much state an agent must carry, actionable errors, idempotent calls (RQS INT, AGT).
- **Proof of how a result was reached:**
  - The EU Cyber Resilience Act requires vulnerability handling and SBOMs for products sold in the EU, with reporting duties from 2026 and full application from 2027.
  - The EU AI Act sets transparency duties.
  - SLSA-style attestation is expected.
  - Results need traceable evidence and declared support periods (RQS EPI, PRV, EVO-4).
- **Local first, with an optional cloud.** The same product should run embedded on a laptop and as a shared service (RQS OPS, PRV).
- **Context costs money.** Every byte an agent has to read costs tokens. Compression and summaries with expandable references matter (caveman, rea's catalog problem).
- **Identity across many providers.** A person may hold accounts with several model providers. Each account needs a separate home and an honest usage ledger. Limits are never evaded.
- **Software that ships in many forms:** WASM, Electron, native code, packages, containers and model weights. Analysis needs format reach, and has to say clearly which formats it does not cover.
- **Durability is expected of any agent run longer than a few minutes** (RQS REL).

## 5. Non-goals (draft)

- Not an offensive-security tool. Analysis is for understanding, auditing and defence.
- Not a general workflow platform competing with Temporal. Durability serves the investigation.
- Not a model provider proxy, and not an account pool.
- Not a decompiler. External engines (Ghidra and others) stay external and optional.

## 6. How success is measured

Every candidate states numbers for these:

| Measure | Why | Baseline from the reviews |
|---|---|---|
| Bytes an agent must load to start | Context cost | rea about 3.16 MB of catalog; leanrea about 8 KB of skill |
| Work lost when the process is killed mid-run | Durability | rea: all evidence of the session; pi-durable and absurd: up to the last completed step |
| Share of findings with checkable evidence | Epistemic quality | rea has evidence records; leanrea has labels only |
| Formats covered, and declared not covered | Reach and honesty | from layer 1 |
| Services required to run | Operations | absurd: Postgres; others: none |
| RQS-2030 grade, aiming for B or better, with no red line | Overall quality | best parent C 58.5 |
| Model credentials the product stores itself | Security | goal: none for subscription users |
