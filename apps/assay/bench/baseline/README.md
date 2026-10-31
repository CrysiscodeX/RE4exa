# Tier 0 baseline

`leanrea-SKILL.md` is leanrea's skill file, byte-identical to
[aicodeking/leanrea](https://github.com/aicodeking/leanrea) `leanrea/SKILL.md` at commit
`09ba4aa0217f82cd880f855a60b877f59f39b22b`:

- 8,374 bytes, sha256 `53581bd7fb1fae4352ab43252e67b84667b68895a68e372b99d302b58d9c782d`
- `test/baseline.test.ts` checks the digest. The formatter is told to skip this folder (`biome.json`).

It is MIT-licensed; its licence text is in the root `THIRD_PARTY_NOTICES`. `bench/live.ts` gives the skill to the Tier 0 arm as its system prompt, so the live benchmark can be rerun from this repository alone.

**Correction (2026-10-26).** The copy first committed in 1039666 was not identical: the formatter had rewritten it (14,657 bytes). The 24 recorded live runs are not affected. They ran before the file was vendored, and read the original from a fresh clone.
