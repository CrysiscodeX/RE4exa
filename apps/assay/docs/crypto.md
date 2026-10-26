# Cryptography inventory

| Use | Algorithm | Where | Replaceable |
|---|---|---|---|
| Content addressing (ProbeKey, ObservationId, FindingKey, record digests, case log chain) | SHA-256 over RFC 8785 canonical JSON | `packages/core/src/evidence/record.ts`, `packages/core/src/kernel/kernel.ts` | The algorithm is named in the key prefix (`pk_`, `ob_`, `fk_`) and the spec version. A new hash means a new spec version (today `re4exa.claim/2`) |
| Bundle signatures | Ed25519 (`node:crypto`) | `src/export/export.ts` | The `signature.alg` field names the algorithm, and verification dispatches on it |
| Session cookies | HMAC-SHA256 | `src/server/server.ts` | The key is in the store's meta table. Rotate it by deleting `session_key`, which ends all sessions |
| MCP bearer tokens | 256 random bits; only their SHA-256 digest is kept | `src/mcp/server.ts` | — |
| Secret fingerprints | first 16 hex of SHA-256 | `packages/core/src/policy/redact.ts` | Versioned by `DETECTOR_VERSION` (`re4exa.redact/1`) |

**Post-quantum plan.** Bundle signatures will add ML-DSA (FIPS 204) once Node's `crypto` supports it, as a second signature beside Ed25519, so that older verifiers keep working. Verification will accept either signature, and after one support period it will require ML-DSA. Assay uses no public-key encryption (no KEM), so ML-KEM is not needed.
