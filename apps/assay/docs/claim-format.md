# Claim format: `re4exa.claim/2` (S-2; reads `assay.claim/1`)

A claim record states one thing about one subject, together with how it was obtained and how sure Assay is of it. The schema and the identity rules are in [`packages/core/src/evidence/record.ts`](../../../packages/core/src/evidence/record.ts), the shared engine. This page explains them.

## Fields

| Field | Hashed into the ObservationId | Meaning |
|---|---|---|
| `spec` | yes | `re4exa.claim/2` for new records; `assay.claim/1` records are still read. Each record's own spec is hashed, so old records keep verifying (docs/decisions/0004) |
| `probe_key` | yes | `pk_` + sha256 of the canonical inputs: probe id and version, parameters, subject digest and profile. It is known **before** the probe runs, so a durable step can be keyed by it |
| `probe` | — | `{id, version}`; already covered by `probe_key` |
| `predicate` | yes | What is claimed, for example `file.identify`, `pkg.manifest` or `js.imports` |
| `subject` | the digest only | `{digest: "sha256:…", format}`. A subject is named by its bytes, not by its path |
| `params` | yes | Probe parameters. Absolute paths are refused here and belong in `locator` |
| `result` | yes | The finding itself, with any secrets already redacted |
| `confidence` | yes | `observed` (a byte fact), `derived` (a count or aggregate by a stated rule), `inferred` (a heuristic) or `analyst-inference` (what an agent or person wrote) |
| `producer` | the kind only | `{kind: runner \| verifier \| agent \| person, id}`. Only `runner` and `verifier` may write `observed` or `derived` |
| `taint` | — | `target` when the content came from the artifact |
| `redactions` | the fingerprints | `{pointer, fingerprint, kind}` for every secret that was replaced. The secret's value is never stored |
| `nested` | yes, as sorted ids | ObservationIds of the records this one builds on. A nested record is referenced by its id and never embedded |
| `limitations` | — | What the probe cannot see |
| `coverage` | yes | `{status, examined, skipped, unresolved, unclaimed, forms}` (see below) |
| `locator` | **no** | Where the subject was found: path, offset, symbol |
| `volatile` | **no** | Timings, host, tool versions |
| `ext.findings` | — | `{key, class, label}`, where the key is a **FindingKey**: `fk_` + sha256 of `{class, normalized}`. It contains no subject digest, so the same finding in version 2 of an artifact gets the same key as in version 1. Re-assay pairs findings by this key |

## The identity rules, and the problems they fix

| Rule | Problem it fixes |
|---|---|
| The **ProbeKey** is computed from inputs only | rea computed its Evidence ID from the output, so it could not be used as a step key |
| The **ObservationId** contains no path, host or timing, and nested records count by id only | rea embedded `local_path` in nested records, so the same bytes at another path got a different ID |
| The **FindingKey** contains no subject digest | rea's IDs changed whenever the artifact changed, so the same finding could not be followed from one version to the next |

These are tested in `test/evidence.test.ts`: the same bytes at two paths and on two hosts give equal keys.

## Honest coverage

A record can claim `status: "complete"` only when `unresolved`, `unclaimed` and `skipped` are all zero. The validator refuses anything else. Probes that cannot resolve a loading form report it in `forms` and set `partial`. For example, `import(expr)` is a form `js.imports` cannot resolve. In rea, "complete" meant only "not truncated".

## Agent claims

Agents do not write evidence. They record claims with `assay_record_claim`, or in fenced `assay-claims` JSON blocks:

````
```assay-claims
[{"text": "package.json runs node install.js on postinstall", "label": "seen",
  "predicate": "pkg.has-install-script", "params": {"path": "package.json", "hook": "postinstall"}}]
```
````

After each turn the verifier re-runs every `seen` claim whose predicate it supports and gives it one of these verdicts:
- `verified`: Assay recorded its own evidence for the claim;
- `refuted`;
- `unverifiable`: the reason is stated, and the claim is treated as inferred.

Claims labelled `inferred` or `unknown` are recorded but not re-run.
