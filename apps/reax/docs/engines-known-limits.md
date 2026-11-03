# Engine providers: known limits (W1-2, ENG)

These are limits of the engine providers in `src/engines/`, recorded so later items can fix them.

## LLVM: symbol names that forge symbols (closed, D-31)

Until W2-3, `llvm-nm -P` output was read one symbol per line, so a target whose symbol name held a
newline (for example `a T 1 1\nevil_x`) was read as two symbols, the first one forged, and the result
still said `coverage: "complete"`.

Since W2-3 (D-31) the output is framed per run. llvm-nm runs as `llvm-nm -A -P --defined-only` on a
symlink to the target at `<scratch>/<32 random hex digits>/<name>`, made for that run only and removed
after it. `-A` starts every record with `<that path>: `. The target cannot know the path, so it cannot
forge a record start:
- a line that starts with the exact prefix starts a record; every other line continues the previous
  record's name (joined with `\n`; nothing is stripped, so `\r`, tabs and spaces stay);
- the record's last three space-separated fields are type, value and size, so a name with spaces that
  look like fields (`x T 10 T 20 30`) is read whole;
- a first line without the prefix, the path with any other framing, or a record whose tail is not
  `type value size` gives `engine_output_invalid`;
- when the output is cut at the cap, its last record is left out (it may be missing continuation
  lines) and the result is `partial`.

The test `[+RX-ENG/nm-names] a symbol name with a newline is read as one symbol, exactly` in
`test/engines.test.ts` (formerly the test that pinned the forged result) checks this on crafted copies
derived at test time by `scripts/name-fixtures.ts`; their answer key is `bench/oracle/names.json`.

## LLVM: what is still limited

- **Archives are refused.** In an archive, llvm-nm frames a record as `<path>[<member>]: `. The member
  name comes from the target and may itself hold `]: ` or a newline, so the member and the symbol name
  cannot be split unambiguously. A target that starts with an ar magic number (`!<arch>`, `!<thin>`)
  is refused with `bad_request` before anything starts; output framed that way anyway gives
  `engine_output_invalid`. Other archive forms (a fat Mach-O holding archives, an AIX big archive,
  magic `<bigaf>`) pass the magic check, run, and fail closed: their member-framed records give
  `engine_output_invalid`, never a result.
- **Names that are not valid UTF-8 are not exact.** The sandbox decodes the engine's stdout as UTF-8,
  so such bytes arrive as U+FFFD. A result with any name holding U+FFFD is `partial`, with a limitation
  that counts those names (a name that really holds U+FFFD is flagged too). Reading the raw bytes
  would fix this; it is not done.
- **The framing depends on llvm-nm's `-A` format.** Checked with LLVM 18.1.8 (macOS) on every fixture;
  CI's LLVM 18.1.3 (Linux) runs the same tests. Reopen D-31 if the prefix format changes.
