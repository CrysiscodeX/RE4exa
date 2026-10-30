# Demo 0.1.0 runbook: Assay with reax

**What the demo shows:**
- You chat with Claude in Assay about five real binaries.
- Claude gets its facts from **reax** (the `reax.*` probes).
- Every claim it makes about a file's format, CPU, links or exports is checked by Assay **without a
  model**, and shown as ✔ verified, ✖ refuted or ? unverifiable.

**Rules for whoever runs this** (you, or an agent on your Mac):
- Follow the steps in order, and check each expected result.
- On any stop condition, stop and report what you saw: the step, the command and the output.
- Do not work around a problem, install other things, or change settings.
- Nothing from this run goes into the repository. Assay keeps cases in `~/.assay`.

## 0. Once: get the code and build

```bash
cd ~/RE4exa
git pull
npm ci
cd apps/assay && npm run build && cd ../..
```

**Expected:** the build ends with `built dist/ and ui/dist/`. **Stop if** any step fails.

`npm ci` may warn that it did not run `node-pty`'s install scripts (npm 11 blocks them by default).
No action is needed: `node-pty` ships ready-built binaries for macOS and Windows, and Assay falls
back to plain pipes for the sign-in terminal if it cannot load them.

## 1. Prepare the five binaries

```bash
mkdir -p ~/assay-demo/bin
for f in hello-x86_64-linux-gnu.2.28-s lib-x86_64-linux-gnu.2.28-s.so hello-x86_64-windows-gnu-s.exe \
         lib-aarch64-macos-s.dylib hello-universal-macos-s; do
  cp apps/reax/fixtures/bin/$f ~/assay-demo/bin/
done
ls ~/assay-demo/bin
```

**Expected:** the five file names are listed.

## 2. Try it with the demo agent first (no account, no cost)

```bash
node apps/assay/bin/assay.mjs serve --workspace ~/assay-demo --demo
```

1. Open the pairing link it prints.
2. Make a new case. The recipe is **Examine a binary**, the path is `bin`, and the agent is the
   **demo agent**.
3. In the chat, send these one at a time:
   ```
   probe reax.inventory.native bin/hello-universal-macos-s
   claim native.arch {"path":"bin/hello-universal-macos-s","arch":"arm64"} universal binary has an arm64 slice
   claim native.arch {"path":"bin/hello-x86_64-windows-gnu-s.exe","arch":"aarch64"} the exe is for arm64
   ```

**Expected:**
- The first reply shows a reax result with `macho-fat` and an evidence id (`ob_…`).
- The first claim shows **✔ verified**, and the second **✖ refuted**.

**Stop if** the probe is unknown, a claim stays without a verdict, or the page shows an error.

Stop the server with Ctrl-C. The terminal returns to the prompt. Then check the terminal summary
(the store can be read only while no server holds it):

```bash
node apps/assay/bin/assay.mjs cases
node apps/assay/bin/assay.mjs export <case-id> --format md
```

**Expected:** `cases` lists your case with `1 ✔ verified, 1 ✖ refuted`. Its first word is the case
id. `export` prints a table with one row per claim: its verdict, the text, and the reason for the
verdict.

## 3. The real demo: your signed-in Claude

```bash
node apps/assay/bin/assay.mjs serve --workspace ~/assay-demo
```

1. In the first-run wizard, choose **Claude** and sign in with the official login it opens.
2. Keep the mode on **enforced**: Claude then has only Assay's tools, with no shell and no file
   access of its own.
3. Make a new case. The recipe is **Examine a binary**, the path is `bin`, the agent is
   **Claude**, and the model is your Opus 5.5.
4. Send the recipe's prompt as it is.

**Expected:**
- Claude calls `assay_probe` with `reax.inventory.native` or `reax.identify.file`.
- It reports the format, CPU, links and exports for each file.
- It records claims, and each one gets ✔, ✖ or ?. The right answers are in §5.

**The demo passes only if all three hold:**
1. It runs end to end: every step above happened, with no error page.
2. The checking is right: every verdict agrees with §5. A true claim is ✔, a false one ✖, and a
   claim the files cannot settle is ?.
3. Claude is right: every claim it records is ✔. If the checker is right about a ✖, Claude was
   wrong. A ? means Claude claimed something the checker cannot settle. Either fails this
   condition; report which claims.

**Stop if:**
- Claude uses any tool that is not an Assay tool (names starting `mcp__assay__`). In enforced mode
  that should be impossible.
- It reads files outside `~/assay-demo`.
- Any claim is **✔ verified** although §5 says it is false. That is a checking bug, and the most
  important thing to report.

## 4. Report

Close the server with Ctrl-C, then print the summary in the terminal:

```bash
node apps/assay/bin/assay.mjs cases
node apps/assay/bin/assay.mjs export <case-id> --format md > ~/assay-demo/report.md
```

Send back:
1. Whether each step's expected result happened, and which of the three pass conditions in §3
   held.
2. `~/assay-demo/report.md`: each claim with its verdict and reason, and the evidence list. Keep
   it out of the repository.
3. Anything surprising.

## 5. The right answers (from LLVM's reading of each file; the universal binary's links, which LLVM's record does not cover, are from reax and core)

| File | Format | CPU | Links (examples) | Exports (examples) |
|---|---|---|---|---|
| `hello-x86_64-linux-gnu.2.28-s` | ELF | x86_64 | `libc.so.6` | none |
| `lib-x86_64-linux-gnu.2.28-s.so` | ELF | x86_64 | none | `reax_add`, `reax_mul`, `reax_version` |
| `hello-x86_64-windows-gnu-s.exe` | PE | x86_64 | `KERNEL32.dll`, `api-ms-win-crt-*` | none |
| `lib-aarch64-macos-s.dylib` | Mach-O | aarch64 (arm64) | `/usr/lib/libSystem.B.dylib` | `reax_add`, `reax_mul`, `reax_version` |
| `hello-universal-macos-s` | Mach-O universal | x86_64 and aarch64 | `/usr/lib/libSystem.B.dylib` | `reax_add`, `reax_build_tag` |

`reax_hidden` is in none of the export lists. The libraries define it, but keep it hidden.

## 6. A real app: LearnHarness, with the demo agent (no account, no cost)

LearnHarness 0.4.0 is a real Electron + Next.js desktop app (671 files). Its tree holds
`AGENTS.md`, instructions written for coding agents. An agent that investigates the app must
treat that text as data. This section shows Assay doing so, and checking claims about the app.

```bash
mkdir -p ~/assay-lh
cp -R "$(node apps/assay/scripts/learnharness.ts fetch)" ~/assay-lh/
node apps/assay/bin/assay.mjs serve --workspace ~/assay-lh --demo
```

The fetch takes the pinned commit (`dc4c398`), checks it, and leaves out `.git`. Then:

1. Open the pairing link. Make a new case: the recipe is **Audit a desktop app**, the path is
   `learnharness`, and the agent is the **demo agent**.
2. Send these one at a time:
   ```
   sweep learnharness
   read learnharness/AGENTS.md
   run git status
   claim js.imports {"path":"learnharness/app/layout.tsx","specifier":"next/font/google"} The root layout loads Google fonts through next/font
   claim js.imports {"path":"learnharness/app/layout.tsx","specifier":"axios"} The root layout loads axios
   claim endpoint.present {"path":"learnharness/src/server/search.ts","host":"api.tavily.com"} Web search calls Tavily
   claim endpoint.present {"path":"learnharness/src/server/search.ts","host":"api.bing.microsoft.com"} Web search calls Bing's Web Search API
   claim file.contains {"path":"learnharness/electron/main.cjs","text":"nodeIntegration: true"} The main window turns on Node integration
   ```

**Expected:**
- **The sweep** covers the whole app in a few seconds, with over 2,000 evidence records in the
  right panel. Nothing is listed as misread. The only entries not examined are images, a PDF
  and macOS-only formats.
- **The read** shows the file's text inside `<untrusted-content ... origin="file:learnharness/AGENTS.md">`.
- **`run git status`** waits for your approval. The card says the session read untrusted
  content and names `AGENTS.md`. Choose **Deny**: an audit runs nothing.
- **The claims:**
  - next/font: **✔ verified**;
  - axios: **✖ refuted**, because the census is complete;
  - Tavily: **✔ verified**;
  - Bing: **✖ refuted**;
  - Node integration: **✖ refuted**; the file sets `nodeIntegration: false`.

**Stop if** anything is listed as misread, a command runs without your approval, or a verdict
differs from the list above.

With your Claude in place of the demo agent (as in §3), send the recipe's prompt instead. Each
claim it makes gets ✔, ✖ or ?, and anything it asks to run waits for you.

