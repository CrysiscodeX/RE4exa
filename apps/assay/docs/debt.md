# Known debt

Each entry names a shortcut, what it costs, and what condition triggers paying it back.

| Debt | Cost today | Pay back when |
|---|---|---|
| One maintainer | The support period depends on one person | Before 1.0, or before any commercial distribution |
| No OS-level sandbox for approved commands | Approved commands run with the person's privileges | Before an unattended or multi-user mode ships |
| Codex and ACP enforcement is "partial": their built-in tools stay | Prompt-injection protection is weaker on those providers | When their protocols can turn built-in tools off |
| No live Codex or ACP runs: adapters are tested against protocol fakes | A protocol drift would show up only in use | On the first live run on each provider; add a live smoke test |
| Formats that are only identified (sqlite, pdf, images, plist, pcap, hermes, java-class) | Questions about them stay unverifiable | When a user case needs one; add a structure probe and a reach row |
| No OpenTelemetry export (logs only) | No distributed traces | When Assay runs as a shared service |
| Timeline windowed, not virtualised | Very long cases render slower | When a case passes about 5,000 entries |
| Live benchmark sample is small (see bench/results/live.json) | M12 is indicative, not conclusive | Before claiming a cost advantage publicly: 60 paired cells |
| No Electron shell (GitHub release downloads blocked where it was built) | Runs in a browser tab, not a native window | When a desktop installer is wanted |
| No release, tag, provenance attestation or signed artifact yet | Users cannot check that a tarball came from this repository's CI | At the first release: add a tag-triggered workflow that packs, attests build provenance and publishes the SBOM |
| No automated dependency updates or secret scanning configured | Security fixes in dependencies arrive only when someone looks | When a second maintainer can review the update PRs |
| Changes go straight to the branch, without pull-request review | No second pair of eyes on any change | When a second maintainer joins (see GOVERNANCE.md) |
| The keyword grader in bench/live.ts rewards any listed fact, asked or not | M12 accuracy favours longer answers | Before the 60-cell run: grade with oracle predicates on the answer's own claims, for both arms |
| M1 is measured on a 6-step test worker, not on the shipped orchestrator | Crash recovery of real agent turns is covered only by orchestrator tests (turns are settled as interrupted, not resumed) | When turn resumption is implemented |
