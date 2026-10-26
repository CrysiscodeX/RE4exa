// The verifier: re-runs each `seen` claim with a probe and records a verdict. It never upgrades a
// claim it could not re-run: a partial census, a capped listing or a missing tool gives
// "unverifiable" with the reason, never "verified". `inferred` and `unknown` claims are not re-run.

import type { ProbeEngine } from "../contracts.ts";
import { CoreError, isCoreError } from "../errors.ts";
import type { Json } from "../evidence/jcs.ts";
import type { ClaimRecord } from "../evidence/record.ts";
import { type AgentClaim, caseClaims, type StoredClaim, setVerdict, type Verdict } from "../evidence/store.ts";
import type { Kernel } from "../kernel/kernel.ts";
import { familiesOf } from "../probes/builtin/identify.ts";
import { checkParams, normalizeParams, PREDICATES } from "./predicates.ts";

export interface VerifyOutcome {
  verdict: Verdict | null;
  reason: string;
  observation_id?: string;
  probe?: string;
}

/** Runs a command in the approval-gated sandbox (wired by the lead). Rejects with approval_denied. */
export type ExecFn = (req: {
  caseId: string;
  claimId: string;
  program: string;
  args: string[];
}) => Promise<{ code: number | null; observation_id?: string }>;

export interface Verifier {
  verify(caseId: string, claim: StoredClaim): Promise<VerifyOutcome>;
  verifyCase(caseId: string): Promise<(VerifyOutcome & { claimId: string })[]>;
}

type Obj = Record<string, Json>;

const FORMAT_ALIASES: Record<string, string> = {
  "mach-o": "macho",
  elf64: "elf",
  elf32: "elf",
  exe: "pe",
  dll: "pe",
  pe32: "pe",
  "pe32+": "pe",
  js: "javascript",
  ts: "typescript",
  tgz: "tar.gz",
  universal: "macho-fat",
  fat: "macho-fat",
  sqlite3: "sqlite",
  jpg: "jpeg",
  wasm: "wasm",
  webassembly: "wasm",
};

function obj(v: Json | undefined): Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? v : {};
}

function strs(v: Json | undefined): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

// Words that make a sentence state an absence. Matching is deliberately broad: a false match makes
// the claim unverifiable, never wrongly verified.
const NEGATION =
  /\b(not|no|never|none|nothing|neither|nor|without|absent|missing|lacks?|lacking|free of)\b|n't\b|n’t\b/i;

export function negationIn(text: string): boolean {
  // Quoted spans and path-like tokens (no/such/file, app/missing.txt) are names, not statements.
  const prose = text.replace(/`[^`]*`|"[^"]*"|\S*[/\\._]\S*/g, " ");
  return NEGATION.test(prose);
}

function libBase(s: string): string {
  const parts = s.split(/[\\/]/);
  return parts[parts.length - 1] ?? s;
}

function linksMatch(have: string, want: string, caseless: boolean): boolean {
  const norm = (x: string) => (caseless ? x.toLowerCase() : x);
  const h = norm(libBase(have));
  const w = norm(libBase(want));
  if (norm(have) === norm(want) || h === w) return true;
  if (w.includes(".")) return false;
  return h.startsWith(`${w}.so`) || h === `${w}.dll` || h === `${w}.dylib` || h.startsWith(`${w}.`);
}

export function createVerifier(opts: {
  kernel: Kernel;
  engine: ProbeEngine;
  exec?: ExecFn;
  /** Producer id on evidence the verifier records. Default "verifier". */
  producerId?: string;
}): Verifier {
  const { kernel, engine } = opts;
  const unv = (reason: string, rec?: ClaimRecord): VerifyOutcome => ({
    verdict: "unverifiable",
    reason,
    ...(rec ? { observation_id: rec.observation_id, probe: rec.probe?.id } : {}),
  });
  const out = (verdict: Verdict, reason: string, rec: ClaimRecord): VerifyOutcome => ({
    verdict,
    reason,
    observation_id: rec.observation_id,
    ...(rec.probe ? { probe: rec.probe.id } : {}),
  });

  const decide = async (caseId: string, claimId: string, c: AgentClaim): Promise<VerifyOutcome> => {
    if (!c.predicate) return unv("the claim names no predicate");
    const spec = PREDICATES[c.predicate];
    if (!spec) return unv(`unsupported predicate ${c.predicate}`);
    const p: Obj = normalizeParams(c.predicate, { ...obj(c.params) });
    if ((p.path === undefined || p.path === null) && c.subject?.path) p.path = c.subject.path;
    const bad = checkParams(spec, p);
    if (bad) return unv(bad);

    let digestChecked = false;
    const probe = async (probeId: string, params: Obj): Promise<ClaimRecord | VerifyOutcome> => {
      try {
        const rec = await engine.run({
          caseId,
          probeId,
          path: p.path as string,
          params,
          producerId: opts.producerId ?? "verifier",
        });
        if (!digestChecked && c.subject?.digest && rec.subject && rec.subject.digest !== c.subject.digest)
          return unv(`the subject changed since the claim (digest ${rec.subject.digest} != ${c.subject.digest})`, rec);
        digestChecked = true;
        return rec;
      } catch (e) {
        if (!isCoreError(e)) return unv(`internal error: ${(e as Error).message}`);
        if (e.code === "path_outside_workspace") return unv("the path resolves outside the workspace");
        if (e.code === "not_found") return unv("the subject does not exist");
        const why = e.detail?.reason ?? e.detail?.why;
        const reason = typeof why === "string" ? why : e.message;
        return unv(`${probeId} could not run: ${reason}`);
      }
    };
    const isOutcome = (x: ClaimRecord | VerifyOutcome): x is VerifyOutcome => "verdict" in x;
    const complete = (r: ClaimRecord) => r.coverage?.status === "complete";

    switch (c.predicate) {
      case "file.contains": {
        // Evidence params may not hold absolute paths; a needle that looks like one is searched as hex.
        const text = typeof p.text === "string" ? p.text : null;
        const params: Obj =
          text === null
            ? { hex: p.hex! }
            : /^(\/|[A-Za-z]:\\)/.test(text)
              ? { hex: Buffer.from(text, "utf8").toString("hex") }
              : { text };
        if (typeof p.offset === "number") params.offset = p.offset;
        const r = await probe("file.contains", params);
        if (isOutcome(r)) return r;
        const found = obj(r.result).found === true;
        if (found) return out("verified", "the needle occurs in the file", r);
        if (complete(r)) return out("refuted", "the whole file was scanned and the needle does not occur", r);
        return unv("the file is larger than the scan cap; the needle was not in the scanned part", r);
      }
      case "file.identify": {
        const r = await probe("file.identify", {});
        if (isOutcome(r)) return r;
        const res = obj(r.result);
        const want = String(p.format).toLowerCase();
        const norm = FORMAT_ALIASES[want] ?? want;
        const fams = strs(res.families);
        const fmt = String(res.format);
        if (fmt === norm || fams.includes(norm)) return out("verified", `identified as ${fmt}`, r);
        return out("refuted", `identified as ${fmt} (${fams.join(", ")}), not ${p.format}`, r);
      }
      case "file.hash": {
        const want = String(p.sha256)
          .toLowerCase()
          .replace(/^sha256:/, "");
        if (!/^[0-9a-f]{64}$/.test(want)) return unv("param sha256 is not 64 hex digits");
        const r = await probe("file.hash", {});
        if (isOutcome(r)) return r;
        const have = String(obj(r.result).sha256);
        return have === want ? out("verified", "sha256 matches", r) : out("refuted", `sha256 is ${have}`, r);
      }
      case "pkg.has-dependency": {
        const r = await probe("pkg.manifest", {});
        if (isOutcome(r)) return r;
        const res = obj(r.result);
        const scopes = p.scope
          ? [String(p.scope)]
          : ["dependencies", "optionalDependencies", "peerDependencies", "devDependencies"];
        for (const s of scopes)
          if (obj(res[s])[String(p.name)] !== undefined) return out("verified", `${p.name} is in ${s}`, r);
        return out("refuted", `${p.name} is not in ${scopes.join(", ")}`, r);
      }
      case "pkg.has-install-script": {
        const r = await probe("pkg.manifest", {});
        if (isOutcome(r)) return r;
        const hooks = (obj(r.result).installHooks as Json[] | undefined) ?? [];
        const names = hooks.map((h) => String(obj(h).hook));
        const want = typeof p.hook === "string" ? p.hook : null;
        if (want ? names.includes(want) : names.length > 0)
          return out("verified", `install hooks: ${names.join(", ") || "none"}`, r);
        if (r.limitations.some((l) => l.includes("lone package.json")) && (want === null || want === "install"))
          return unv("read from a lone package.json: an implicit node-gyp install cannot be ruled out", r);
        return out("refuted", `install hooks: ${names.join(", ") || "none"}`, r);
      }
      case "js.imports": {
        const r = await probe("js.imports", {});
        if (isOutcome(r)) return r;
        const specs = strs(obj(r.result).specifiers);
        if (specs.includes(String(p.specifier))) return out("verified", `the census found ${p.specifier}`, r);
        if (complete(r)) return out("refuted", `the census is complete and does not include ${p.specifier}`, r);
        const cov = r.coverage;
        return unv(
          `the census is partial (${cov?.unresolved ?? 0} unresolved, ${cov?.unclaimed ?? 0} unclaimed, ${cov?.skipped.length ?? 0} skipped): ${p.specifier} may be loaded dynamically`,
          r,
        );
      }
      case "native.links": {
        const id = await probe("file.identify", {});
        if (isOutcome(id)) return id;
        const fmt = String(obj(id.result).format);
        const probeId =
          fmt === "elf"
            ? "elf.info"
            : fmt === "pe"
              ? "pe.info"
              : familiesOf(fmt).includes("macho")
                ? "macho.info"
                : null;
        if (!probeId) return unv(`not a supported native binary (format ${fmt})`, id);
        const r = await probe(probeId, {});
        if (isOutcome(r)) return r;
        const res = obj(r.result);
        const libs =
          probeId === "elf.info"
            ? strs(res.needed)
            : probeId === "pe.info"
              ? ((res.imports as Json[] | undefined) ?? []).map((i) => String(obj(i).dll))
              : ((res.slices as Json[] | undefined) ?? []).flatMap((s) =>
                  ((obj(s).dylibs as Json[] | undefined) ?? []).map((d) => String(obj(d).name)),
                );
        const lib = String(p.library);
        const hit = libs.find((l) => linksMatch(l, lib, probeId !== "elf.info"));
        if (hit) return out("verified", `links ${hit}`, r);
        return out("refuted", `static link list: ${libs.join(", ") || "(none)"}`, r);
      }
      case "archive.contains": {
        const r = await probe("archive.list", {});
        if (isOutcome(r)) return r;
        const norm = (s: string) => s.replace(/^\.\//, "").replace(/\/$/, "");
        const want = norm(String(p.entry));
        const entries = ((obj(r.result).entries as Json[] | undefined) ?? []).map((e) => norm(String(obj(e).name)));
        if (entries.includes(want)) return out("verified", `the archive has ${p.entry}`, r);
        if (complete(r)) return out("refuted", `the complete listing has no ${p.entry}`, r);
        return unv("the listing was capped or truncated", r);
      }
      case "endpoint.present": {
        const host = String(p.host).toLowerCase();
        const r = await probe("js.endpoints", {});
        if (isOutcome(r)) return r;
        const hosts = ((obj(r.result).hosts as Json[] | undefined) ?? []).map((h) => String(obj(h).host));
        if (hosts.includes(host)) return out("verified", `a literal names ${host}`, r);
        const isDir = r.subject?.format === "directory" || r.subject?.format === "npm-package";
        if (!isDir && obj(r.result).truncated !== true) {
          const raw = await probe("file.contains", { text: host, ignoreCase: true });
          if (isOutcome(raw)) return unv(`not among the literals; ${raw.reason}`, r);
          if (obj(raw.result).found === true)
            return unv(`${host} occurs in the bytes but not as an endpoint literal (comment or built string?)`, raw);
          if (complete(raw)) return out("refuted", `${host} does not occur anywhere in the file`, raw);
        }
        return unv(`${host} is not among the literals and the scan was not exhaustive`, r);
      }
      case "cmd.exit": {
        if (!opts.exec) return unv("needs approval: cmd.exit runs a program and no approval-gated sandbox is wired");
        try {
          const res = await opts.exec({
            caseId,
            claimId,
            program: String(p.program),
            args: strs(p.args),
          });
          const v: Verdict = res.code === p.expect ? "verified" : "refuted";
          return {
            verdict: v,
            reason: `exit code ${res.code}, expected ${p.expect}`,
            ...(res.observation_id ? { observation_id: res.observation_id } : {}),
            probe: "cmd.exit",
          };
        } catch (e) {
          if (isCoreError(e, "approval_denied")) return unv("the person denied running the command");
          if (isCoreError(e)) return unv(`the command could not run: ${e.message}`);
          return unv(`the command could not run: ${(e as Error).message}`);
        }
      }
      default:
        return unv(`unsupported predicate ${c.predicate}`);
    }
  };

  // The verdict is about the predicate, so the text must say the same thing. A text that negates
  // ("app.js does NOT use eval") over a positive predicate would otherwise come back verified.
  const checked = async (caseId: string, sc: StoredClaim): Promise<VerifyOutcome> => {
    const params = obj(sc.claim.params);
    const negate = params.negate === true;
    if (negationIn(sc.claim.text) !== negate)
      return unv(
        negate
          ? "the predicate is negated (negate: true) but the claim text states no negation"
          : "the claim text states a negation the predicate does not; add negate: true to check it",
      );
    if (!negate) return decide(caseId, sc.id, sc.claim);
    const { negate: _drop, ...rest } = params;
    const o = await decide(caseId, sc.id, { ...sc.claim, params: rest });
    if (o.verdict === "verified") return { ...o, verdict: "refuted", reason: `the negation is false: ${o.reason}` };
    if (o.verdict === "refuted") return { ...o, verdict: "verified", reason: `the negation holds: ${o.reason}` };
    return o;
  };

  const verify = async (caseId: string, sc: StoredClaim): Promise<VerifyOutcome> => {
    if (sc.case_id !== caseId) throw new CoreError("bad_request", { why: "claim belongs to another case" });
    if (sc.claim.label !== "seen")
      return { verdict: null, reason: `not re-run: the claim is labelled ${sc.claim.label}` };
    const o = await checked(caseId, sc);
    if (o.verdict) {
      const record: StoredClaim["verdict_record"] = { reason: o.reason };
      if (o.observation_id) record.observation_id = o.observation_id;
      if (o.probe) record.probe = o.probe;
      setVerdict(kernel, sc.id, o.verdict, record);
    }
    return o;
  };

  return {
    verify,
    async verifyCase(caseId) {
      const res: (VerifyOutcome & { claimId: string })[] = [];
      for (const c of caseClaims(kernel, caseId)) {
        if (c.verdict !== null) continue;
        res.push({ claimId: c.id, ...(await verify(caseId, c)) });
      }
      return res;
    },
  };
}

// ------------------------------------------------------------------------- claim blocks ----

export interface ClaimBlockError {
  block: number;
  index: number | null;
  reason: string;
}

// Agents write claims in fenced blocks: ```assay-claims (Assay) or ```reax-claims (reax), plus the
// neutral ```claims. Each app's prompt names one; all three are read.
const FENCE = /```(?:assay-claims|reax-claims|claims)[^\n]*\n([\s\S]*?)```/g;

/** Extract ```assay-claims fenced JSON arrays from assistant text; bad entries are skipped and reported. */
export function parseClaimBlocks(text: string): { claims: AgentClaim[]; errors: ClaimBlockError[] } {
  const claims: AgentClaim[] = [];
  const errors: ClaimBlockError[] = [];
  let block = 0;
  for (const m of text.matchAll(FENCE)) {
    const body = m[1]!;
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch (e) {
      errors.push({ block, index: null, reason: `not valid JSON: ${(e as Error).message}` });
      block++;
      continue;
    }
    if (!Array.isArray(parsed)) {
      errors.push({ block, index: null, reason: "the block must hold a JSON array" });
      block++;
      continue;
    }
    parsed.forEach((entry, index) => {
      const r = toClaim(entry);
      if (typeof r === "string") errors.push({ block, index, reason: r });
      else claims.push(r);
    });
    block++;
  }
  return { claims, errors };
}

function toClaim(e: unknown): AgentClaim | string {
  if (typeof e !== "object" || e === null || Array.isArray(e)) return "entry must be an object";
  const o = e as Record<string, unknown>;
  if (typeof o.text !== "string" || o.text.length === 0 || o.text.length > 2000) return "text must be 1-2000 chars";
  if (o.label !== "seen" && o.label !== "inferred" && o.label !== "unknown")
    return "label must be seen, inferred or unknown";
  const c: AgentClaim = { text: o.text, label: o.label };
  if (o.predicate !== undefined) {
    if (typeof o.predicate !== "string" || !/^[a-z][a-z0-9_.-]{1,63}$/.test(o.predicate))
      return "predicate must be a lowercase dotted name";
    c.predicate = o.predicate;
  }
  if (o.params !== undefined) {
    if (typeof o.params !== "object" || o.params === null || Array.isArray(o.params)) return "params must be an object";
    c.params = o.params as Json;
  }
  if (o.subject !== undefined) {
    const s = o.subject as Record<string, unknown>;
    if (typeof s !== "object" || s === null) return "subject must be an object";
    const sub: { path?: string; digest?: string } = {};
    if (s.path !== undefined) {
      if (typeof s.path !== "string") return "subject.path must be a string";
      sub.path = s.path;
    }
    if (s.digest !== undefined) {
      if (typeof s.digest !== "string" || !/^sha256:[0-9a-f]{64}$/.test(s.digest))
        return "subject.digest must be sha256:<hex>";
      sub.digest = s.digest;
    }
    c.subject = sub;
  }
  if (o.cites !== undefined) {
    if (!Array.isArray(o.cites) || o.cites.some((x) => typeof x !== "string" || !/^ob_[0-9a-f]{64}$/.test(x)))
      return "cites must be observation ids";
    c.cites = o.cites as string[];
  }
  if (o.question_class !== undefined) {
    if (typeof o.question_class !== "string" || o.question_class.length > 64)
      return "question_class must be a short string";
    c.question_class = o.question_class;
  }
  return c;
}
