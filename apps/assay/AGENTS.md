# Notes for agents working on Assay

## Run the checks

Install once at the repository root (`npm ci`; npm workspaces). Then, from `apps/assay`, in order:

```bash
npm run typecheck && npm run lint
npm test                 # unit, kernel, fault injection, tripwires, probes, providers (about 1 min)
npm run coverage         # same tests, with gates: lines 85, branches 75, functions 85
npm run build:ui && npm run e2e     # browser tests (Playwright chromium must be installed)
node --conditions=source bench/run.ts --gate          # model-free benchmark targets M1–M11, M13
node --conditions=source scripts/gen-docs.ts --check  # docs/failure-modes.md must be current
```

The engine-agnostic modules live in `packages/core` (`@re4exa/core`), with their own checks: `npm run typecheck`, `lint`, `test` and `coverage` there. From a source checkout, Node needs `--conditions=source` to resolve `@re4exa/core` to TypeScript; the npm scripts set it through `scripts/with-source.mjs`.

## Rules the code depends on

1. **Every write made for an attempt goes through `kernel.fence()`.** Use `commitStep`, `checkpoint` or `runEffect`, never raw SQL on tasks or checkpoints.
2. **Evidence keys:**
   - The ProbeKey is computed from inputs only.
   - Paths go in `locator` and never in `params`. The validator refuses absolute paths in `params`.
   - Agents never write `observed` or `derived` evidence.
3. **Text from the target is untrusted.** A tool returning file contents or command output sets `untrusted: true`, and the registry wraps the text in an envelope. Never put target text in `data`.
4. **Accounts are touched only through the official client.**
   - Do not read credential files, keychains or tokens.
   - Do not call undocumented endpoints or rotate accounts.
   - The tests grep the source for violations.
5. **Errors use codes from `src/errors.ts`** (Assay's own) **or `@re4exa/core/errors`** (engine-agnostic ones).
   - Add an Assay code in `src/errors.ts` (and to the `AppFailureCodes` augmentation there) with a message and a fix, then raise it in a test.
   - `test/failure-modes.test.ts` fails when a code is never exercised.
6. **Runtime dependencies need an entry in `scripts/dep-budget.ts`, with a reason.** Pin every version exactly.
7. **TypeScript must be erasable**, because Node runs it with type stripping:
   - no enums, no parameter properties, no namespaces;
   - relative imports end in `.ts`; imports of the shared engine are extensionless (`@re4exa/core/kernel/kernel`).
8. **Measurements must be real.**
   - Do not edit `bench/results/` by hand.
   - A missed target is reported as missed.

## Where to look

[ARCHITECTURE.md](ARCHITECTURE.md) maps the modules. [docs/](docs/) covers the API, the claim format, failure modes, the threat model, reach, configuration and debt.
