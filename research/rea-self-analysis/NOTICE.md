# Notices

RE4exa is not REA and is not affiliated with morluto, the REA project, or the
authors of the other repositories studied here. Nothing here is a copy or fork of
their code. The research scripts in `scripts/` and the prototype in
`../../prototypes/rea-durable-evidence/` are original work. The results in
`results/` are measurements of the published packages listed below, and they
contain file paths, digests and short excerpts produced by those tools.

## Studied software (read, measured, or run locally; not redistributed)

| Project | Version / commit | License | How it was used |
|---|---|---|---|
| [morluto/rea](https://github.com/morluto/rea) (npm `rea-agents`) | 6.7.0 and 6.5.0 from npm; source `b4938ae` (2026-10-20) | MIT, © 2026 morluto | Run against its own published package; source read as ground truth |
| [aicodeking/leanrea](https://github.com/aicodeking/leanrea) | `09ba4aa` | MIT, © 2026 AICodeKing | Plain-CLI routing recipe used as a comparison arm; benchmark read |
| [JuliusBrussee/caveman](https://github.com/JuliusBrussee/caveman) | `bad48a0` | Apache-2.0 | Go engine built from source and run offline (telemetry lives only in the Node CLI, which was not run) |
| [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail) | `09c434a` | MIT, © 2026 DietrichGebert | Necessity ladder and audit checklist applied by hand |
| [usestrix/strix](https://github.com/usestrix/strix) | `aa2036f` | Apache-2.0 | Coverage-accounting design read; not run |
| [earendil-works/absurd](https://github.com/earendil-works/absurd) (npm `absurd-sdk`) | SDK 0.5.1; schema from `3cfc64f` | Apache-2.0 | Durable-execution engine used by the prototype (schema fetched at setup, not vendored) |
| [earendil-works/pi](https://github.com/earendil-works/pi) `packages/durable` | `fdce48e` (npm 1.3.0) | MIT, © 2025 Mario Zechner | Read as the alternative durable design |
| [PromptEngineer48/my-jev](https://github.com/PromptEngineer48/my-jev) | `a254b5d` | MIT, © 2026 Prompt Engineer 48 | Calibration metrics (Brier, ECE) read |
| [NandhaKishorM/laya](https://github.com/NandhaKishorM/laya) | `ffc1420` | Apache-2.0 | Calibration, abstention and risk-coverage methods read; weights not reachable here |
| [mizorewww/laya-coreml](https://github.com/mizorewww/laya-coreml) | `7b36334` | Apache-2.0 | Port-fidelity method read; needs Apple Silicon |

The tools REA calls (GNU objdump, procps, Node.js, Postgres) keep their own licenses.
REA's third-party notices are in its package's `THIRD_PARTY_NOTICES.md`.
