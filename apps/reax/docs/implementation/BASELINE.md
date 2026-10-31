# Baseline (verified 2026-10-31 at commit 02dfbe8)

The readiness report of 2026-10-30 (commit 7005095) was re-measured against the current checkout.
The only commit since then is the licence change, which touches no reax behaviour. Every number
below was reproduced by script or by a test run, not copied from the report.

| Measure | Value | How it was measured |
|---|---:|---|
| Operations | 2 (`identify.file`, `inventory.native`) | `src/ops/registry.ts` |
| Tools defined in the registry types | 16 names; 2 with an operation | `src/ops/types.ts` |
| rea and leanrea capability rows with + and − tests | 7 / 357 | `scripts/status.ts` |
| reax's own rows with + and − tests | 26 / 26 | `scripts/status.ts` |
| Weak points with + and − tests | 21 / 244 | `scripts/status.ts` |
| Open weak points | 223: blocks 41, degrades 150, cosmetic 32 | `scripts/status.ts` |
| Security review notes | 15, all open | `docs/review-notes.md` |
| reax test suite | 111 tests; all pass, 6 skip by platform | CI run 41181129873 (02dfbe8) |
| CI | green on assay, reax and tests | runs for 02dfbe8 |

**Environment.** The dev container's default Node is 22.22.0. Node 24.22.1 (the version in
`.nvmrc` and CI) is installed under `/opt/nvm`, and `scripts/dev/setup-node.sh` installs and
selects it reproducibly. A session hook that would apply it automatically was refused by the
session's permission policy (changing Claude's own settings), so the setup script is the supported
path: run it, or set it as the cloud environment's setup script.

**Outside tools present in the dev container.** LLVM 18 (readobj, nm, objdump, dwarfdump,
pdbutil), gdb, lldb, Java and python3. zig is in CI and at `/tmp/reax-zig`. Not present: rizin,
radare2, Ghidra, capstone, JADX, Apktool, ILSpy, capa, FLOSS, yara-x, binwalk, unblob, tshark,
Frida, adb.
