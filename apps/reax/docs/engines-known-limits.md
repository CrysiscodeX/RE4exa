# Engine providers: known limits (W1-2, ENG)

These are limits of the engine providers in `src/engines/`, recorded so later items can fix them.

## LLVM: a symbol name with a newline forges symbols

`llvm-nm -P` prints each symbol name as it is stored in the target, and `parseNm`
(`src/engines/llvm.ts`) reads one symbol per line. So a target can contain a symbol whose name
includes a newline, for example `a T 1 1\nevil_x`. That one symbol is then read as two:
- a forged symbol `a`, of type `T`, at address 0x1, with size 1;
- a symbol `evil_x`, which carries the real symbol's type and address.

The result still reports `coverage: "complete"`.

The test "a symbol name with a newline is read as two symbols" in `test/engines.test.ts` documents
this behaviour on a crafted copy of a fixture. When the parser is fixed, that test should be turned
around. The mitigation must land before COD exposes these symbols through operations.
