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

Stop the server with Ctrl-C. The terminal returns to the prompt.

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

**Stop if:**
- Claude uses any tool that is not an Assay tool (names starting `mcp__assay__`). In enforced mode
  that should be impossible.
- It reads files outside `~/assay-demo`.
- Any claim is **✔ verified** although §5 says it is false. That is a checking bug, and the most
  important thing to report.

## 4. Report

Send back:
1. Whether each step's expected result happened.
2. The case's claims list: the text, the verdict and the reason. Copy it from the case page. Do
   not commit it.
3. Anything surprising.

Close the server with Ctrl-C when you are done.

## 5. The right answers (from LLVM's reading of each file; the universal binary's links, which LLVM's record does not cover, are from reax and core)

| File | Format | CPU | Links (examples) | Exports (examples) |
|---|---|---|---|---|
| `hello-x86_64-linux-gnu.2.28-s` | ELF | x86_64 | `libc.so.6` | none |
| `lib-x86_64-linux-gnu.2.28-s.so` | ELF | x86_64 | none | `reax_add`, `reax_mul`, `reax_version` |
| `hello-x86_64-windows-gnu-s.exe` | PE | x86_64 | `KERNEL32.dll`, `api-ms-win-crt-*` | none |
| `lib-aarch64-macos-s.dylib` | Mach-O | aarch64 (arm64) | `/usr/lib/libSystem.B.dylib` | `reax_add`, `reax_mul`, `reax_version` |
| `hello-universal-macos-s` | Mach-O universal | x86_64 and aarch64 | `/usr/lib/libSystem.B.dylib` | `reax_add`, `reax_build_tag` |

`reax_hidden` is in none of the export lists. The libraries define it, but keep it hidden.
