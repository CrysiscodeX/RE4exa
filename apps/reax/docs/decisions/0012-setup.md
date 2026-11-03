# 0012. Setup, doctor and uninstall: Claude Code first, temporary homes only in development

Status: accepted (W2-7, SET, first slice; `884cad2`, `7925cb3`; reax run 41698459561 green).
Recorded as D-48 to D-53 in `docs/implementation/DECISION-LOG.md`. (0010 and 0011 are reserved for
RUN and MOB.)

## Context

Agents need reax registered as an MCP server in their client's configuration. That file belongs to
the user and often holds account data, so setup must never lose or garble it, and development must
never touch a real home. Only Node 24 built-ins are used. These are CLI commands with an internal
API (`src/setup/index.ts`), not registered operations (as for `reax daemon`): the registry,
`docs/operations.md` and `docs/tools.json` are unchanged.

## Decision

- **One client, Claude Code** (D-48): its user-scope entry `mcpServers.reax` in
  `<home>/.claude.json`, written as
  `{"type":"stdio","command":<absolute node>,"args":[<absolute bin/reax.mjs>,"mcp"]}`. The shape
  follows Claude Code's documented user-scope format; it is **not verified against a live client**
  (running one would read the real home). Codex waits for a TOML parser (D-49).
- **The entry runs the planned `reax mcp`** (D-50): the MCP stdio server is not built (DMN, later
  slice), so `reax doctor` reports `mcp_server: "not_built"` and setup's result says the client will
  not start the entry until it lands.
- **Commands.** `reax setup [--client claude-code] [--yes] [--json]`, `reax uninstall [--client
  claude-code] [--yes] [--json]`, `reax doctor [--json]`. Without `--yes`, setup and uninstall
  return the plan (`status: "plan"`, the entry before and after) and write nothing. The text form is
  inside the untrusted envelope: it quotes the user's file.
- **The home** comes only from the environment passed in: `HOME` (on Windows `USERPROFILE`, then
  `HOME`), an absolute path; otherwise `home_unset`, before any read or write. `os.homedir()` is not
  used anywhere in `src/setup`. Records go to `<REAX_HOME>/setup/claude-code.json` (`REAX_HOME` from
  the same environment, else `<home>/.reax`).
- **Strict reading** (`src/setup/jsonedit.ts`). A file is edited only when `JSON.parse` reads it to
  exactly what its text says. Refusals are `config_malformed` with a reason, the file untouched:
  `syntax` (including an empty file, invalid UTF-8, JSONC comments, trailing commas, NaN, and a
  UTF-8 byte-order mark: refused rather than stripped, so the bytes are never re-encoded),
  `duplicate_key` (any depth; keys compared after unescaping), `number_precision` (a number whose
  `String(JSON.parse)` differs from its source text, read through the reviver's `context.source`:
  2^64, 1e400, -0, 1.0, 1E5, a 34-digit decimal), `not_object`, `servers_not_object`, `too_large`
  (over 16 MiB, checked on `lstat` and again on a read bounded to the cap + 1 byte, before parsing),
  `symlink` (never followed) and `not_file` (a directory or device in the file's place; a reason
  added to the work order's list). Only the top-level `mcpServers` is edited: a nested `mcpServers`
  or `reax` key is data. `__proto__` stays an own data key (every insertion uses
  `defineProperty`).
- **Layout** is kept where JSON allows: the indent detected from the first member line (none: one
  line), CRLF line endings, and the presence or absence of a final newline. The file is otherwise
  re-serialised with `JSON.stringify`, so whitespace inside lines and the order of integer-like keys
  may change; every value stays equal (the key's canonical form).
- **Writes** (D-51): a temp file in the same directory, opened exclusively with the original's mode
  (0600 for a new file) and `fchmod`ed against the umask, fsynced; then the file's digest is read
  again and must equal the one setup parsed (absent must still be absent), else `config_changed`
  and the temp file is removed, keeping the other writer's bytes; then rename. On first install the
  original bytes are kept beside it as `<home>/.claude.json.reax-backup` with the same mode (never in
  the reax home: the file may hold account data).
- **Order and rollback.** Setup writes in this order: the setup directory made and checked and the
  record written to its temp file (a reax home that cannot take it stops setup here, before the
  configuration is touched; the empty setup directory may stay); the backup; the configuration;
  last, the record's rename. If the rename fails, the configuration is rolled back (the original
  bytes written back, or a file setup created removed) only while it still has the digest setup gave
  it, and the backup is removed only once the original is back (`detail.rolled_back`). Uninstall
  deals with the file first, then removes the backup, then the record: a record left behind only
  makes the next uninstall find the entry gone. Every failed file operation is
  `setup_io_failed` (`detail.op`, `detail.target`, `detail.errno`), never a raw errno.
- **No write follows a link, and the record cannot steer one.** Every read opens with `O_NOFOLLOW`
  (where the OS has it) after an `lstat`, and refuses a non-regular file; every new file (the temp
  file, the backup, the record's temp file) is created with `O_EXCL`, which never follows a link,
  and a regular file of reax's own in the way is unlinked first. Anything but a regular file at the
  backup path is `config_conflict`/`backup_not_file`, recorded or not (a regular backup that no
  record of an existing file names is `backup_exists`); a link or file in place of `<REAX_HOME>/setup` is
  `config_conflict`/`record_dir_not_directory`, checked before anything is written. A record that is
  not a regular file, or whose fields are not exactly setup's (its `path` the file's own, its
  `backup` exactly `<path>.reax-backup` when the file existed before and null otherwise, digests of
  64 hex digits, the flags booleans), is `config_conflict`/`record_invalid` for setup and uninstall,
  nothing touched, and `recorded: "invalid"` in doctor. Uninstall only ever deletes the file's own
  path and its own backup path, never one read from the record.
- **Idempotence and update.** The recorded entry already in place: `unchanged`, nothing written.
  A recorded entry that differs from the one to write: replaced (`updated`). A `reax` entry with no
  record, or edited since reax wrote it: `config_conflict`, untouched. If the file was edited
  between setup and an update, the record is marked not restorable.
- **Uninstall.** File digest equal to the recorded after-digest (and restorable): the backup's bytes
  are written back exactly (its digest checked against the record first), or the file is deleted if
  setup created it. Otherwise only `mcpServers.reax` is removed (and `mcpServers` if setup created it
  and it is now empty), every other value kept. No record: `not_installed`, nothing changed. The
  backup and the record are removed at the end.
- **Doctor** reads only: `absent`, `not_configured`, `configured`, `configured_differently`,
  `malformed` (with the reason), whether a record exists, `mcp_server`, the reax version. It creates
  no file or directory.
- **Failure codes** (`src/errors.ts`): `home_unset`, `config_malformed`, `config_conflict`,
  `config_changed` (retryable), `setup_io_failed`.
- **The key** (D-52): `scripts/oracle-set.py`, Python's standard `json` (duplicates through
  `object_pairs_hook`, numbers through `parse_int`/`parse_float` keeping the source, which it
  compares with its own implementation of ECMA-262 Number::toString) and `hashlib`, run as a
  separate process by `scripts/oracle.ts` (`set` writes only `bench/oracle/set.json`; `--check`
  compares it with the rest, the Python version being a label). It gives each fixture in
  `fixtures/set/` a verdict, a sha256 and the canonical configuration after setup. The tests
  compare with their own canonicaliser (`test/set-helpers.ts`), sharing no code with `src/setup`.

## Development and tests

Every SET test and command runs on a temporary home: `test/set-helpers.ts` points the test
process's own `HOME`, `USERPROFILE` and `REAX_HOME` at a fresh temporary directory on load, every
home it hands out is asserted to be under `realpath(os.tmpdir())` before anything is written, and
children get only `PATH` and a temporary home. No client CLI is ever run. The symlink test is
skipped on Windows when creating a link needs a privilege (stated in the skip).

## Consequences

- Fifteen or more clients (REA-C40) need further slices; each adds a module beside
  `src/setup/claude-code.ts` and its name to `CLIENTS`.
- A user who reformats the file between setup and uninstall gets structural removal, not the
  original bytes; that is reported (`status: "removed"`).
