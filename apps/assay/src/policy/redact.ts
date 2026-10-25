// Secret redaction for anything Assay stores or hands to a model. Walks every string in a JSON value,
// replaces each detected secret with `[redacted:<kind>:<fp8>]` and reports where it was. The secret
// itself is never stored: only a fingerprint (first 16 hex of its sha256), which lets two records
// agree that they saw the same secret without either holding it.

import { createHash } from "node:crypto";
import type { Json } from "../evidence/jcs.ts";

export const DETECTOR_VERSION = "assay.redact/1";

export interface Redaction {
  /** RFC 6901 JSON pointer of the string that held the secret. */
  pointer: string;
  fingerprint: string;
  kind: string;
}

interface Detector {
  kind: string;
  /** Global regex with the `d` flag; the secret is the named group `s` or the whole match. */
  re: RegExp;
  accept?: (secret: string) => boolean;
}

const SECRET_NAME =
  /(?:password|passwd|passphrase|pwd|secret|token|api[_-]?key|apikey|access[_-]?key|auth[_-]?key|private[_-]?key|client[_-]?secret|credentials?)$/i;

/** Shannon entropy in bits per character. */
export function entropy(s: string): number {
  if (s.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const ch of s) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let h = 0;
  for (const n of counts.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

const PLACEHOLDER =
  /^(?:x+|\*+|\.+|-+|_+)$|changeme|change[_-]?me|example|placeholder|your[_-]|<[^>]*>|\$\{|\{\{|%\(|process\.env|os\.environ|getenv|redacted|dummy|sample|test[_-]?(?:token|secret|password)/i;

function highEntropy(minLen: number, minBits: number): (s: string) => boolean {
  return (s) => {
    if (s.length < minLen || PLACEHOLDER.test(s)) return false;
    if (!/[0-9]/.test(s) && !/[^A-Za-z0-9]/.test(s)) return false; // plain words are not secrets
    return entropy(s) >= minBits;
  };
}

/** Unquoted values must also not look like an identifier chain or a call (`a.b.c`, `f(x)`). */
function unquotedValue(s: string): boolean {
  if (/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/.test(s)) return false;
  if (!/[0-9]/.test(s) || !/[A-Za-z]/.test(s)) return false;
  return highEntropy(12, 3.3)(s);
}

const DETECTORS: Detector[] = [
  {
    kind: "pem-private-key",
    re: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?(?:-----END (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----|$)/dg,
  },
  { kind: "anthropic-key", re: /\bsk-ant-[A-Za-z0-9_-]{20,}/dg },
  { kind: "openai-key", re: /\bsk-(?!ant-)(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{32,}/dg },
  { kind: "github-token", re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,255}\b/dg },
  { kind: "github-token", re: /\bgithub_pat_[A-Za-z0-9_]{22,255}\b/dg },
  { kind: "slack-token", re: /\bxox[abposr]-[A-Za-z0-9-]{10,}/dg },
  { kind: "slack-webhook", re: /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9_/]{20,}/dg },
  { kind: "stripe-key", re: /\b(?:sk|rk)_live_[A-Za-z0-9]{16,}\b/dg },
  { kind: "google-api-key", re: /\bAIza[0-9A-Za-z_-]{35}(?![0-9A-Za-z_-])/dg },
  { kind: "jwt", re: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/dg },
  { kind: "aws-access-key-id", re: /\b(?:AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16}\b/dg },
  {
    kind: "aws-secret-access-key",
    re: /(?:aws_?secret_?(?:access_?)?key|secret_?access_?key|SecretAccessKey)["']?\s*[:=]\s*["']?(?<s>[A-Za-z0-9/+=]{40})(?![A-Za-z0-9/+=])/dgi,
  },
  {
    kind: "generic-secret",
    re: /(?<![A-Za-z0-9])(?:[A-Za-z0-9_.-]*?)(?:password|passwd|passphrase|pwd|secret|token|api[_-]?key|apikey|access[_-]?key|auth[_-]?key|client[_-]?secret)["']?\s*(?::=|=|:)\s*(?<q>["'`])(?<s>[^"'`\s]{8,256})\k<q>/dgi,
    accept: highEntropy(8, 3.0),
  },
  {
    kind: "generic-secret",
    re: /(?<![A-Za-z0-9])(?:[A-Za-z0-9_]*?)(?:PASSWORD|PASSWD|SECRET|TOKEN|API_?KEY|ACCESS_?KEY|AUTH_?KEY|password|secret|token|api_?key)\s*[:=]\s*(?<s>[A-Za-z0-9+/=_\-!@#$%^&*~]{12,256})(?![A-Za-z0-9+/=_\-!@#$%^&*~])/dg,
    accept: unquotedValue,
  },
];

export function fingerprint(secret: string): string {
  return createHash("sha256").update(secret).digest("hex").slice(0, 16);
}

function escapePointer(seg: string): string {
  return seg.replaceAll("~", "~0").replaceAll("/", "~1");
}

/** Redact one string. `found` receives one entry per secret (pointer filled in by the caller). */
export function redactString(input: string, pointer = ""): { text: string; redactions: Redaction[] } {
  const redactions: Redaction[] = [];
  let s = input;
  for (const det of DETECTORS) {
    det.re.lastIndex = 0;
    if (!det.re.test(s)) continue;
    det.re.lastIndex = 0;
    let out = "";
    let last = 0;
    for (const m of s.matchAll(det.re)) {
      const span = m.indices?.groups?.s ?? m.indices?.[0];
      const secret = m.groups?.s ?? m[0];
      if (!span || secret.length === 0) continue;
      if (det.accept && !det.accept(secret)) continue;
      const fp = fingerprint(secret);
      out += `${s.slice(last, span[0])}[redacted:${det.kind}:${fp.slice(0, 8)}]`;
      last = span[1];
      redactions.push({ pointer, fingerprint: fp, kind: det.kind });
    }
    if (last > 0) s = out + s.slice(last);
  }
  return { text: s, redactions };
}

function walk(v: Json, pointer: string, key: string | null, out: Redaction[]): Json {
  if (typeof v === "string") {
    if (key !== null && SECRET_NAME.test(key) && !v.startsWith("[redacted:") && highEntropy(8, 3.0)(v)) {
      const fp = fingerprint(v);
      out.push({ pointer, fingerprint: fp, kind: "generic-secret" });
      return `[redacted:generic-secret:${fp.slice(0, 8)}]`;
    }
    const r = redactString(v, pointer);
    out.push(...r.redactions);
    return r.text;
  }
  if (Array.isArray(v)) return v.map((x, i) => walk(x, `${pointer}/${i}`, null, out));
  if (v !== null && typeof v === "object") {
    const o: { [k: string]: Json } = {};
    for (const [k, x] of Object.entries(v)) o[k] = walk(x, `${pointer}/${escapePointer(k)}`, k, out);
    return o;
  }
  return v;
}

/** Redact every string in a JSON value. The input is not modified. */
export function redact(value: Json): { value: Json; redactions: Redaction[] } {
  const redactions: Redaction[] = [];
  const out = walk(value, "", null, redactions);
  return { value: out, redactions };
}
