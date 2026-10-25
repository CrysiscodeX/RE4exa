// Exports of a case: S-2 JSONL, SARIF 2.1.0, CycloneDX 1.6, Markdown, and a signed bundle that
// any recipient can check with `assay verify --bundle` (ed25519 over the canonical manifest).

import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AssayError } from "../errors.ts";
import { canonicalize, type Json } from "../evidence/jcs.ts";
import { type ClaimRecord, observationId, validate } from "../evidence/record.ts";
import { caseClaims, caseEvidence, listUnknowns } from "../evidence/store.ts";
import { sha256 } from "../kernel/ids.ts";
import type { Kernel } from "../kernel/kernel.ts";

export const BUNDLE_SPEC = "assay.bundle/1";

export function s2Jsonl(k: Kernel, caseId: string): string {
  return caseEvidence(k, caseId)
    .map((r) => JSON.stringify(r))
    .join("\n")
    .concat("\n");
}

export function sarif(k: Kernel, caseId: string, version: string): Json {
  const c = k.getCase(caseId);
  const claims = caseClaims(k, caseId);
  const evidence = caseEvidence(k, caseId);
  const results: Json[] = [];
  for (const cl of claims) {
    if (cl.verdict !== "refuted" && cl.verdict !== "unverifiable") continue;
    results.push({
      ruleId: cl.verdict === "refuted" ? "assay/claim-refuted" : "assay/claim-unverifiable",
      level: cl.verdict === "refuted" ? "error" : "note",
      message: { text: `${cl.claim.text} (${cl.verdict}: ${cl.verdict_record?.reason ?? ""})` },
      properties: { claimId: cl.id, author: cl.author, predicate: cl.claim.predicate ?? null },
    });
  }
  for (const e of evidence) {
    for (const f of e.ext?.findings ?? []) {
      results.push({
        ruleId: `assay/${f.class}`,
        level: "note",
        message: { text: f.label },
        locations: e.locator?.path ? [{ physicalLocation: { artifactLocation: { uri: e.locator.path } } }] : [],
        fingerprints: { findingKey: f.key },
        properties: { observationId: e.observation_id, confidence: e.confidence },
      });
    }
  }
  return {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "assay",
            version,
            informationUri: "https://github.com/crysiscodex/re4exa/tree/main/apps/assay",
            rules: [
              { id: "assay/claim-refuted", shortDescription: { text: "An agent claim was re-run and did not hold" } },
              { id: "assay/claim-unverifiable", shortDescription: { text: "An agent claim could not be re-run" } },
            ],
          },
        },
        properties: { caseId, title: c?.title ?? null },
        results,
      },
    ],
  };
}

export function cyclonedx(k: Kernel, caseId: string, version: string): Json {
  const evidence = caseEvidence(k, caseId).filter((e) => e.predicate === "pkg.manifest");
  const components: Json[] = [];
  const seen = new Set<string>();
  for (const e of evidence) {
    const r = e.result as Record<string, Json>;
    const name = typeof r.name === "string" ? r.name : null;
    if (name && !seen.has(name)) {
      seen.add(name);
      components.push({
        type: "library",
        name,
        version: typeof r.version === "string" ? r.version : "",
        hashes: e.subject ? [{ alg: "SHA-256", content: e.subject.digest.replace("sha256:", "") }] : [],
        properties: [{ name: "assay:observation_id", value: e.observation_id }],
      });
    }
    for (const [dep, range] of Object.entries((r.dependencies as Record<string, Json> | undefined) ?? {})) {
      if (seen.has(dep)) continue;
      seen.add(dep);
      components.push({ type: "library", name: dep, version: String(range), scope: "required", properties: [{ name: "assay:declared-by", value: name ?? "" }] });
    }
  }
  return {
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    serialNumber: `urn:uuid:${sha256(caseId).slice(0, 8)}-${sha256(caseId).slice(8, 12)}-4${sha256(caseId).slice(13, 16)}-8${sha256(caseId).slice(17, 20)}-${sha256(caseId).slice(20, 32)}`,
    version: 1,
    metadata: { tools: { components: [{ type: "application", name: "assay", version }] }, properties: [{ name: "assay:case", value: caseId }] },
    components,
  };
}

export function markdown(k: Kernel, caseId: string): string {
  const c = k.getCase(caseId);
  const claims = caseClaims(k, caseId);
  const unknowns = listUnknowns(k, caseId);
  const evidence = caseEvidence(k, caseId);
  const badge = (v: string | null) => (v === "verified" ? "✔ verified" : v === "refuted" ? "✖ refuted" : v === "unverifiable" ? "? unverifiable" : "· not checked");
  const lines = [
    `# ${c?.title ?? caseId}`,
    "",
    `Case \`${caseId}\`. ${evidence.length} evidence records, ${claims.length} claims, ${unknowns.filter((u) => u.status === "open").length} open questions. Log chain ${k.verifyChain(caseId) === null ? "intact" : "BROKEN"}.`,
    "",
    "## Claims",
    "",
    "| Verdict | Claim | Author | Label |",
    "|---|---|---|---|",
    ...claims.map((cl) => `| ${badge(cl.verdict)} | ${cl.claim.text.replaceAll("|", "\\|")} | ${cl.author} | ${cl.claim.label} |`),
    "",
    "## Open questions",
    "",
    ...(unknowns.filter((u) => u.status === "open").map((u) => `- ${u.question}`) || []),
    "",
    "## Evidence",
    "",
    "| Observation | Predicate | Path | Confidence | Coverage |",
    "|---|---|---|---|---|",
    ...evidence.map((e) => `| \`${e.observation_id.slice(0, 15)}…\` | ${e.predicate} | ${e.locator?.path ?? ""} | ${e.confidence} | ${e.coverage?.status ?? ""} |`),
    "",
  ];
  return lines.join("\n");
}

// ---------- signed bundles ----------

function keyPaths(home: string): { priv: string; pub: string } {
  return { priv: join(home, "keys", "signing-ed25519.pem"), pub: join(home, "keys", "signing-ed25519.pub.pem") };
}

export function signingKey(home: string): { privatePem: string; publicPem: string } {
  const p = keyPaths(home);
  if (!existsSync(p.priv)) {
    mkdirSync(join(home, "keys"), { recursive: true });
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    writeFileSync(p.priv, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
    writeFileSync(p.pub, publicKey.export({ type: "spki", format: "pem" }));
    try {
      chmodSync(p.priv, 0o600);
    } catch {
      // Windows: ACLs, not modes
    }
  }
  return { privatePem: readFileSync(p.priv, "utf8"), publicPem: readFileSync(p.pub, "utf8") };
}

export interface Bundle {
  spec: typeof BUNDLE_SPEC;
  manifest: { case: string; title: string; created_at: number; producer: string; records: { observation_id: string; sha256: string }[]; claims: Json };
  records: ClaimRecord[];
  signature: { alg: "ed25519"; public_key: string; value: string };
}

export function makeBundle(k: Kernel, caseId: string, home: string, version: string): Bundle {
  const c = k.getCase(caseId);
  if (!c) throw new AssayError("not_found", { case: caseId });
  const records = caseEvidence(k, caseId);
  const claims = caseClaims(k, caseId).map((cl) => ({ text: cl.claim.text, label: cl.claim.label, author: cl.author, verdict: cl.verdict, evidence: cl.verdict_record?.observation_id ?? null }));
  const manifest = {
    case: caseId,
    title: c.title,
    created_at: k.now(),
    producer: `assay ${version}`,
    records: records.map((r) => ({ observation_id: r.observation_id, sha256: sha256(canonicalize(r as unknown as Json)) })),
    claims: claims as unknown as Json,
  };
  const key = signingKey(home);
  const value = sign(null, Buffer.from(canonicalize(manifest as unknown as Json)), createPrivateKey(key.privatePem)).toString("base64");
  return { spec: BUNDLE_SPEC, manifest, records, signature: { alg: "ed25519", public_key: key.publicPem, value } };
}

/** Check signature, record digests and every record's ObservationId. Throws bundle_tampered. */
export function verifyBundle(b: Bundle, trustedPublicKey?: string): { records: number; claims: number; signer: string } {
  if (b.spec !== BUNDLE_SPEC) throw new AssayError("bundle_tampered", { why: "unknown spec" });
  const pub = trustedPublicKey ?? b.signature.public_key;
  const ok = verify(null, Buffer.from(canonicalize(b.manifest as unknown as Json)), createPublicKey(pub), Buffer.from(b.signature.value, "base64"));
  if (!ok) throw new AssayError("bundle_tampered", { why: "signature does not verify" });
  if (b.records.length !== b.manifest.records.length) throw new AssayError("bundle_tampered", { why: "record count" });
  b.records.forEach((r, i) => {
    const m = b.manifest.records[i]!;
    if (m.observation_id !== r.observation_id || m.sha256 !== sha256(canonicalize(r as unknown as Json))) throw new AssayError("bundle_tampered", { why: "record digest", index: i });
    const { observation_id: _id, ...rest } = r;
    if (observationId(rest) !== r.observation_id) throw new AssayError("bundle_tampered", { why: "observation id", index: i });
    validate(r);
  });
  return { records: b.records.length, claims: Array.isArray(b.manifest.claims) ? b.manifest.claims.length : 0, signer: sha256(pub).slice(0, 16) };
}
