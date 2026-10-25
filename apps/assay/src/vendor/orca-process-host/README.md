Vendored from stablyai/orca `src/packages/process-host/src` at commit 997d34b04389665795966ec4c0325b5cbfabf9ee (MIT, (c) 2026 Lovecast Inc.).
Changes: relative imports gain a `.ts` extension so Node can run the files with type stripping. Test files are not copied.
Change 2: `retryable-process-exit-proof.ts` replaces a TypeScript parameter property with an explicit field (type stripping does not support parameter properties).
Change 3: two non-null assertions (`bounded-output-sink.ts:29`, `process-tree-termination.ts:198`) so the files pass Assay's `noUncheckedIndexedAccess`; behaviour is unchanged (both indexes are guarded by the preceding length/match checks).
