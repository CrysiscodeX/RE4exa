# Security review notes

Items recorded for a later security review instead of stopping work on them. Each entry says what
happened or what is planned, where, what the exposure is, and what is already in place. Nothing
here has been reviewed yet; "status" says so per item. Add new items at the end with the next
number; never delete one (mark it resolved, with the commit).

## Done during development

### SR-1. rea 6.7.0 and 6.8.0 were installed and executed in the development container
- **What:** to capture rea's public catalogue (`docs/ledger/sources/rea-6.8.0-tools.json`), both
  versions were installed from npm into the session scratchpad
  (`npm install --ignore-scripts --no-audit --no-fund rea-agents@<v>`), then each was started as
  `node node_modules/rea-agents/scripts/rea.mjs mcp` with `REA_LOG_LEVEL=silent`, and asked
  for `tools/list` over stdio. Earlier research (the rea self-analysis, `research/`) ran rea
  6.5.0 and 6.7.0 the same way and through its batch scripts, with `HOME` and `TMPDIR` pointed
  at scratch directories.
- **Exposure:** third-party code ran with the session's user rights and network policy. The
  catalogue capture did **not** override `HOME` (the earlier self-analysis did). Install scripts
  were disabled; the package's own code was not.
- **In place:** the container is ephemeral; no credentials for other services were in the
  environment; only names and annotation hints were kept (no descriptions, schemas or code).
- **To decide:** run future behaviour audits (plan §1, method 1) only inside a container with no
  network, a scratch `HOME`, and no repository checkout mounted.
- **Status:** open.

### SR-2. rea was run with the V8 inspector on loopback during research
- **What:** one research step (E9) started rea with `--inspect=127.0.0.1:9239` to test its own
  runtime-observation tools against itself.
- **Exposure:** while it ran, any local process could attach to the inspector and run code in it.
- **In place:** loopback only, a short-lived process, inside the ephemeral container.
- **To decide:** reax's own runtime tools (phase 3) must never open an inspector port without an
  approval and a random port, and must close it when the job ends.
- **Status:** open (a design input for phase 3).

### SR-3. CI checks out with the job token in the remote URL
- **What:** `assay.yml` and `reax.yml` fetch the commit with
  `https://x-access-token:${TOKEN}@github.com/...`, so the token is written to `.git/config`
  in the runner's workspace for the rest of the job.
- **Exposure:** any step (including an npm script from a dependency) can read the token. Its
  permissions are `contents: read` and it expires with the job. No artifact uploads `.git/`.
- **To decide:** pass the token as `http.extraheader` for the fetch only and unset it after,
  or use `actions/checkout` with `persist-credentials: false`.
- **Status:** open.

### SR-4. The ledger reader parses XML with regular expressions
- **What:** `src/ledger/junit.ts` reads JUnit reports with regular expressions, not an XML parser.
- **Exposure:** the input is the CI's own test output, not a target. A crafted report could make
  the tag-matching regex slow (backtracking over quoted attributes). It cannot run code.
- **To decide:** if reports ever come from outside the workflow (a fork's artifacts), add a size
  cap per file before parsing.
- **Status:** open, low.

### SR-5. Profile text from the public web flows into the ledger and the CI step summary
- **What:** limitation titles and evidence are copied from `docs/profiles`, which quotes public
  issues, posts and search snippets. `parity-check.ts` writes them into Markdown
  (`reports/parity.md` and `$GITHUB_STEP_SUMMARY`).
- **Exposure:** Markdown in a title (a link, an image) renders in the job summary. Pipes and
  newlines are escaped; links and images are not.
- **To decide:** render titles as code spans, or strip link and image syntax, in the report.
- **Status:** open, low.

## Planned capabilities that need review before they ship

### SR-6. Running engines on untrusted targets (phase 2)
Ghidra (with its script runner), rizin, JADX, Apktool, ILSpy, capa, FLOSS, unblob, binwalk and
the others parse hostile input. Plan §3.6: every engine runs in the sandbox, network off,
memory-capped. Open points: the Linux helper (Landlock and seccomp) does not exist yet; bubblewrap
fails by default on Ubuntu 24.04 (AppArmor); macOS `sandbox-exec` is deprecated and may be
removed; the Windows helper (Job Object and AppContainer) is unwritten. Until each lands, results
from that platform are labelled `unenforced`.

### SR-7. Runtime and device operations (phase 3)
Frida, Chrome DevTools Protocol, Electron and V8 inspection, ADB device operations, process
capture and native UI observation all act on live processes or devices. Plan: off by default, an
approval for each run, scope limits (`scope.md`), no network for the instrumented process unless
approved. Review: what an approved session can reach, how approval is bound to one target, and
how a session is torn down on daemon crash.

### SR-8. Secrets found inside targets (see also ledger row REA-A6.4)
Plan §3.5: secrets found in targets are stored encrypted at rest; model-facing output shows a
fingerprint and type only; revealing a value is an approval-gated operation. Review: key storage
per platform, what the reveal operation logs, and whether reveal should exist at all.

### SR-9. The daemon's local socket, pipe and HTTP transport
Plan §3.3: socket directory 0700, token file 0600, Windows pipe ACL to the user's SID, refusal of
group- or world-writable homes; HTTP binds loopback with a bearer token, and any other bind needs
TLS and an explicit flag. Review the implementation against same-user attackers (another process
of the same user) as well as other users.

### SR-10. Optional local model endpoint
Plan §5: any OpenAI-compatible endpoint, loopback only unless `--allow-remote-model`. Target
content goes to that model. Review: what is sent, whether untrusted target text can steer the
model's suggestions into an `annotate` approval that a user accepts without reading.

### SR-11. Annotation write-back to engine projects
Plan §3.5: rename, retype, comment and bookmark only, with snapshots before each write session.
Review that no operation can reach byte-level patching through an engine's scripting interface.

### SR-12. Network access for live browser observation (phase 3)
Live page observation (rea family C20, leanrea C38) needs network, but plan §3.6 runs every engine
with the network off. Candidate design: a separate approval-gated sandbox profile that allows
only the target origin through a recording proxy, with the CDP port on loopback and closed when
the job ends. Review what the instrumented page can reach and what the recording keeps. Status:
open; must be decided before phase 3.

### SR-13. The benchmark setup downloads and runs third-party binaries
`bench/setup.ts` downloads llama.cpp's own release build (tag b11923, commit de5122d) and a GGUF
model, then runs that llama-server. Each download is checked against its publisher's sha256: GitHub's
per-asset digest, and the LFS sha256 from Hugging Face. That proves the bytes are what the
publisher published, not that the publisher is trustworthy.

Where no digest is published, the computed digest is pinned on first use, and setup says so.

The model repositories are tried in a fixed order:
1. Qwen
2. unsloth
3. bartowski
4. lmstudio-community

The first one that has the file wins, so which publisher was used is recorded in
`provenance.model`.

llama-server binds 127.0.0.1 only. It runs as the user with no sandbox (plan §3.6's sandbox is not
built yet).

For review:
- whether to pin the asset digests in the repository once a first run has recorded them;
- whether to verify GitHub's artifact attestations (the release workflow attests its assets) when
  the `gh` CLI is present.

### SR-14. How the CLIs are started on Windows
npm installs `codex` and `claude` as `.cmd` shims. reax runs them without a shell: core's vendored
`resolveSpawn` reads a recognised npm shim and runs `node <script>` directly. A shim it does not
recognise falls back to a cmd.exe command line, which it builds and caret-escapes itself.

Prompts go over stdin, never through argv, so no prompt text reaches cmd's parser. Agents call reax
as `reax op <operation> path=<file>`, which needs no quoting in sh, PowerShell or cmd.

For review: the cmd.exe fallback path is not exercised by a test, because every shim in CI is
recognised.

### SR-15. Third-party binaries fetched at test time (the LearnHarness corpus)
`scripts/corpus.ts` fetches 11 npm packages (13 native files) that LearnHarness's lockfile pins,
with `npm pack`. It does not install them and runs no scripts.
- **Integrity:** each tarball must match the lockfile's sha512 before anything in it is read. A
  mismatch stops the run.
- **Unpacking:** core's own tar reader extracts only the named files, by exact entry name, so no
  path from the archive is used to write.
- **Use:** the files are only read, by reax, by core and by LLVM; they are never loaded or run.
  They are cached outside the repository and never committed.
- **Exposure:** a parser bug in reax, core or LLVM triggered by a crafted file. That risk is the
  same as for any file a user examines, and these files come from a pinned, hash-checked source.

Found by this corpus: a Mach-O install name can carry the build machine's path (resvg's is
`/Users/runner/work/...`). reax reports it as `ownName`, not as a link. Agents should treat it as
target text, which the untrusted-content envelope already does.

For review: the registry is trusted to serve the tarball the lockfile pins. The hash check makes
any substitution fail loudly, rather than pass silently.
