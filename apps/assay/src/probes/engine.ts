// The probe engine: resolves and guards subjects, digests them, keys every run by its inputs
// (ProbeKey) before running, reuses stored evidence for a known key, runs probes with a timeout
// and an AbortSignal, redacts, and records S-2 evidence. `sweep` is the model-free first pass.

import { createHash } from "node:crypto";
import {
  closeSync,
  lstatSync,
  openSync,
  readdirSync,
  readlinkSync,
  readSync,
  realpathSync,
  type Stats,
  statSync,
} from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { ProbeContext, ProbeDef, ProbeEngine, ProbeOutput, ProbeSubject, SweepReport } from "../contracts.ts";
import { AssayError, isAssayError } from "../errors.ts";
import { pathNotFound } from "../mcp/suggest.ts";
import { canonicalize, type Json } from "../evidence/jcs.ts";
import { type ClaimRecord, type Confidence, type Finding, makeRecord, probeKey } from "../evidence/record.ts";
import { evidenceByProbeKey, putEvidence } from "../evidence/store.ts";
import type { Kernel } from "../kernel/kernel.ts";
import { runProcess } from "../vendor/orca-process-host/run-process.ts";
import { IDENTIFY_HEAD, type Ident, identifyBytes, identifyDirectory } from "./builtin/identify.ts";
import { BUILTIN_PROBES } from "./builtin/index.ts";
import { externalProbes, matchRows, type Platform, type ToolStatus, toolStatus, which } from "./router.ts";
import { type AssayProbe, basenameOf, fail, isObject, json } from "./util.ts";
import { SKIP_DIRS, walkDir } from "./walk.ts";

export type Redactor = (value: Json) => { value: Json; redactions: ClaimRecord["redactions"] };

export interface EngineOptions {
  kernel: Kernel;
  workspace: string;
  redact?: Redactor;
  clock?: () => number;
  platform?: Platform;
  /** Extra probes (plug-ins, tests). They default to confidence "derived" and are not swept. */
  probes?: ProbeDef[];
  /** Per-probe time limit. */
  timeoutMs?: number;
  /** Cancels every running probe (the case was cancelled). */
  signal?: AbortSignal;
  /** Let the sweep run external tools that need no consent and are on PATH (default false). */
  runExternal?: boolean;
  /** PATH lookup (tests inject one). */
  which?: (program: string) => string | null;
}

export interface AssayProbeEngine extends ProbeEngine {
  readonly workspace: string;
  resolve(path: string): ProbeSubject;
  run(input: {
    caseId: string | null;
    probeId: string;
    path: string;
    params?: Json;
    producerId?: string;
    signal?: AbortSignal;
  }): Promise<ClaimRecord>;
}

const DEFAULT_READ = 64 * 1024 * 1024;
const HARD_READ = 1024 * 1024 * 1024;
const DIGEST_MAX_ENTRIES = 20_000;
const DIGEST_MAX_DEPTH = 16;
const DIGEST_MAX_FILE = 512 * 1024 * 1024;
/** Formats the sweep identifies but has no structure probe for. */
const IDENTIFIED_ONLY = new Set([
  "sqlite",
  "pdf",
  "png",
  "jpeg",
  "plist",
  "pcap",
  "pcapng",
  "hermes-bytecode",
  "java-class",
  "gzip",
  "unknown",
]);

function readBytes(abs: string, max: number, size: number): Uint8Array {
  const n = Math.min(size, max, HARD_READ);
  const buf = Buffer.allocUnsafe(n);
  const fd = openSync(abs, "r");
  try {
    let off = 0;
    while (off < n) {
      const got = readSync(fd, buf, off, n - off, off);
      if (got === 0) break;
      off += got;
    }
    return off === n ? buf : buf.subarray(0, off);
  } finally {
    closeSync(fd);
  }
}

function hashFile(abs: string): string {
  const h = createHash("sha256");
  const fd = openSync(abs, "r");
  const chunk = Buffer.allocUnsafe(1024 * 1024);
  try {
    let pos = 0;
    for (;;) {
      const got = readSync(fd, chunk, 0, chunk.length, pos);
      if (got === 0) break;
      h.update(chunk.subarray(0, got));
      pos += got;
    }
  } finally {
    closeSync(fd);
  }
  return `sha256:${h.digest("hex")}`;
}

export function createProbeEngine(opts: EngineOptions): AssayProbeEngine {
  const kernel = opts.kernel;
  let ws: string;
  try {
    ws = realpathSync(opts.workspace);
  } catch {
    throw new AssayError("not_found", { workspace: opts.workspace });
  }
  const platform: Platform = opts.platform ?? (process.platform as Platform);
  const clock = opts.clock ?? (() => kernel.now());
  const redact: Redactor = opts.redact ?? ((value) => ({ value, redactions: [] }));
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const lookup = opts.which ?? ((p: string) => which(p));
  const probes: ProbeDef[] = [...BUILTIN_PROBES, ...externalProbes(), ...(opts.probes ?? [])];
  const byId = new Map(probes.map((p) => [p.id, p]));
  const digestCache = new Map<string, { stamp: string; digest: string }>();
  const identCache = new Map<string, Ident>();
  const cmp = platform === "win32" ? (s: string) => s.toLowerCase() : (s: string) => s;
  const inside = (root: string, p: string) =>
    cmp(p) === cmp(root) || cmp(p).startsWith(cmp(root.endsWith(sep) ? root : root + sep));

  const fileDigest = (abs: string, st: Stats): string => {
    const stamp = `${st.size}:${st.mtimeMs}:${st.ino}:${st.ctimeMs}`;
    const c = digestCache.get(abs);
    if (c && c.stamp === stamp) return c.digest;
    const digest = hashFile(abs);
    digestCache.set(abs, { stamp, digest });
    return digest;
  };

  const dirDigest = (abs: string, depth: number, budget: { n: number }): string => {
    const list: Json[] = [];
    for (const name of readdirSync(abs).sort()) {
      const child = `${abs}${sep}${name}`;
      let st: Stats;
      try {
        st = lstatSync(child);
      } catch {
        continue;
      }
      if (st.isSymbolicLink()) {
        let target = "";
        try {
          target = readlinkSync(child);
        } catch {
          target = "?";
        }
        list.push({ name, link: target });
      } else if (st.isDirectory()) {
        if (SKIP_DIRS[name] !== undefined) list.push({ name, skipped: "not digested" });
        else if (depth >= DIGEST_MAX_DEPTH) list.push({ name, skipped: "depth limit" });
        else list.push({ name, dir: dirDigest(child, depth + 1, budget) });
      } else if (st.isFile()) {
        if (++budget.n > DIGEST_MAX_ENTRIES) list.push({ name, skipped: "entry cap" });
        else if (st.size > DIGEST_MAX_FILE) list.push({ name, size: st.size, skipped: "size cap" });
        else list.push({ name, digest: fileDigest(child, statSync(child)) });
      } else list.push({ name, special: true });
    }
    return `sha256:${createHash("sha256")
      .update(canonicalize({ entries: list }))
      .digest("hex")}`;
  };

  const resolveSubject = (p: string): ProbeSubject => {
    if (typeof p !== "string" || p.length === 0 || p.includes("\0")) throw new AssayError("bad_request", { path: p });
    const joined = isAbsolute(p) ? resolve(p) : resolve(ws, p);
    let real: string;
    try {
      real = realpathSync(joined);
    } catch {
      if (!inside(ws, joined)) throw new AssayError("path_outside_workspace", { path: p });
      throw pathNotFound(ws, p);
    }
    if (!inside(ws, real)) throw new AssayError("path_outside_workspace", { path: p, resolved: "outside" });
    const st = statSync(real);
    const rel = relative(ws, real).split(sep).join("/") || ".";
    if (st.isFile()) return { path: rel, abs: real, digest: fileDigest(real, st), size: st.size, kind: "file" };
    if (st.isDirectory())
      return { path: rel, abs: real, digest: dirDigest(real, 0, { n: 0 }), size: 0, kind: "directory" };
    throw new AssayError("bad_request", { path: p, why: "not a regular file or directory" });
  };

  const identOf = (s: ProbeSubject): Ident => {
    const k = `${s.digest}|${s.kind === "file" ? basenameOf(s.path) : ""}`;
    let id = identCache.get(k);
    if (!id) {
      id =
        s.kind === "directory"
          ? identifyDirectory(s.abs)
          : identifyBytes(readBytes(s.abs, IDENTIFY_HEAD, s.size), s.path, s.size);
      if (identCache.size > 50_000) identCache.clear();
      identCache.set(k, id);
    }
    return id;
  };

  const makeContext = (subject: ProbeSubject, params: Json, signal: AbortSignal): ProbeContext => ({
    subject,
    params,
    signal,
    async read(relPath?: string, max?: number) {
      const cap = Math.min(max ?? DEFAULT_READ, HARD_READ);
      if (relPath === undefined || relPath === "" || relPath === ".") {
        if (subject.kind !== "file") fail("read() without a path needs a file subject");
        return readBytes(subject.abs, cap, statSync(subject.abs).size);
      }
      if (subject.kind !== "directory") fail("read(relPath) needs a directory subject");
      const target = resolve(subject.abs, relPath);
      let real: string;
      try {
        real = realpathSync(target);
      } catch {
        if (!inside(subject.abs, target)) throw new AssayError("path_outside_workspace", { path: relPath });
        return fail(`no such file in the subject: ${relPath}`);
      }
      if (!inside(subject.abs, real) || !inside(ws, real))
        throw new AssayError("path_outside_workspace", { path: relPath });
      const st = statSync(real);
      if (!st.isFile()) fail(`not a file: ${relPath}`);
      return readBytes(real, cap, st.size);
    },
    async exec(program, args, o) {
      if (signal.aborted) fail("cancelled");
      try {
        const r = await runProcess({
          program,
          args,
          timeoutMs: o?.timeoutMs ?? 30_000,
          maxOutputBytes: o?.maxOutputBytes ?? 1024 * 1024,
          signal,
        });
        return {
          code: r.code,
          stdout: r.stdout,
          stderr: r.stderr,
          timedOut: r.timedOut,
          truncated: r.outputTruncated ?? false,
        };
      } catch (e) {
        return fail(`could not start ${program}: ${(e as NodeJS.ErrnoException).code ?? (e as Error).message}`);
      }
    },
  });

  const wrap = (e: unknown, probeId: string): AssayError => {
    if (isAssayError(e)) {
      if (e.code === "probe_failed") return new AssayError("probe_failed", { ...e.detail, probe: probeId }, e.message);
      if (e.code === "path_outside_workspace" || e.code === "not_found" || e.code === "bad_request") return e;
      return new AssayError("probe_failed", { probe: probeId, reason: `${e.code}: ${e.message}` });
    }
    const err = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    return new AssayError("probe_failed", { probe: probeId, reason: `internal error: ${err}`.slice(0, 400) });
  };

  const run: AssayProbeEngine["run"] = async (input) => {
    const probe = byId.get(input.probeId);
    if (!probe) throw new AssayError("probe_unknown", { probe: input.probeId });
    const params: Json = input.params ?? {};
    if (/"(\/|[A-Za-z]:\\)[^"]*"/.test(JSON.stringify(params)))
      throw new AssayError("bad_request", { why: "absolute paths belong in `path`, not in params" });
    const subject = resolveSubject(input.path);
    const ap = probe as Partial<AssayProbe>;
    const profile: Json = ap.nameSensitive && subject.kind === "file" ? { name: basenameOf(subject.path) } : null;
    const key = probeKey({ id: probe.id, version: probe.version }, params, subject.digest, profile);
    const existing = evidenceByProbeKey(kernel, key);
    if (existing) {
      if (input.caseId) putEvidence(kernel, input.caseId, existing);
      return existing;
    }
    if (!probe.platforms.includes(platform))
      throw new AssayError("probe_failed", { probe: probe.id, reason: `not available on ${platform}` });
    for (const req of probe.requires ?? [])
      if (!lookup(req)) throw new AssayError("probe_failed", { probe: probe.id, reason: "tool missing", program: req });
    const ident = identOf(subject);
    if (!probe.appliesTo({ format: ident.format, kind: subject.kind, families: ident.families } as never))
      throw new AssayError("probe_failed", {
        probe: probe.id,
        reason: `does not apply to ${subject.kind} of format ${ident.format}`,
      });
    const ac = new AbortController();
    const signals = [ac.signal, ...(opts.signal ? [opts.signal] : []), ...(input.signal ? [input.signal] : [])];
    const signal = signals.length === 1 ? ac.signal : AbortSignal.any(signals);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      ac.abort();
    }, timeoutMs);
    const t0 = performance.now();
    let out: ProbeOutput;
    try {
      if (signal.aborted) throw new AssayError("probe_failed", { reason: "cancelled" });
      const aborted = new Promise<never>((_, reject) => {
        signal.addEventListener(
          "abort",
          () =>
            reject(
              new AssayError("probe_failed", { reason: timedOut ? `timed out after ${timeoutMs} ms` : "cancelled" }),
            ),
          { once: true },
        );
      });
      aborted.catch(() => {});
      out = await Promise.race([probe.run(makeContext(subject, params, signal)), aborted]);
      if (!isObject(out) || !("result" in out)) fail("probe returned no result");
    } catch (e) {
      throw wrap(e, probe.id);
    } finally {
      clearTimeout(timer);
    }
    const ms = Math.round((performance.now() - t0) * 1000) / 1000;
    let rec: ClaimRecord;
    try {
      const red = redact(json(out.result));
      const findings = (out.findings ?? []) as Finding[];
      rec = makeRecord(
        {
          probe: { id: probe.id, version: probe.version },
          probe_key: key,
          predicate: probe.predicate,
          subject: { digest: subject.digest, format: ident.format },
          params,
          result: red.value,
          confidence: (ap.confidence ?? "derived") as Confidence,
          producer: { kind: "runner", id: input.producerId ?? "assay-runner" },
          taint: "target",
          redactions: red.redactions,
          limitations: [...new Set(out.limitations ?? [])],
          coverage: out.coverage ?? null,
          locator: { path: subject.path, ...(out.locator ?? {}) },
          volatile: { ms, platform, ...(isObject(out.volatile) ? out.volatile : {}) },
          ext: findings.length > 0 ? { findings } : undefined,
        },
        clock(),
      );
    } catch (e) {
      throw wrap(e, probe.id);
    }
    putEvidence(kernel, input.caseId, rec);
    return rec;
  };

  const sweep: ProbeEngine["sweep"] = async (input) => {
    const t0 = performance.now();
    const budgetMs = input.budgetMs ?? 60_000;
    const subject = resolveSubject(input.path);
    const report: SweepReport = {
      subject: subject.path,
      evidence: [],
      findings: [],
      questions: [],
      notExamined: [],
      elapsedMs: 0,
    };
    const seenEv = new Set<string>();
    const seenFind = new Set<string>();
    const questions = new Set<string>();
    const hosts = new Set<string>();
    const tools = new Map<string, { status: ToolStatus; paths: string[] }>();
    const ask = (q: string) => {
      if (questions.size < 100) questions.add(q);
    };

    const absorb = (rec: ClaimRecord) => {
      if (!seenEv.has(rec.observation_id)) {
        seenEv.add(rec.observation_id);
        report.evidence.push(rec.observation_id);
      }
      const where = (rec.locator?.path ?? subject.path) === "." ? "the workspace" : (rec.locator?.path ?? subject.path);
      for (const f of rec.ext?.findings ?? []) {
        const k = `${f.key}|${rec.observation_id}`;
        if (seenFind.has(k)) continue;
        seenFind.add(k);
        report.findings.push({ ...f, observation_id: rec.observation_id });
        if (f.class === "pkg.install-script") {
          const r = rec.result as { name?: string | null };
          ask(`What does the install script of ${r.name ?? where} do? (${f.label})`);
        } else if (f.class === "native.addon") ask(`What does the native add-on ${f.label} in ${where} do?`);
        else if (f.class === "net.host" && !hosts.has(f.label)) {
          hosts.add(f.label);
          if (hosts.size <= 20) ask(`What is sent to ${f.label}, and when? (endpoint in ${where})`);
        } else if (f.class === "code.obfuscated") ask(`What does the obfuscated code in ${where} do? (${f.label})`);
        else if (f.class === "archive.zip-slip")
          ask(`Archive ${where} has an entry that escapes the extraction directory (${f.label}): who extracts it?`);
      }
      const cov = rec.coverage;
      if (rec.predicate === "js.imports" && cov && (cov.unresolved > 0 || cov.unclaimed > 0)) {
        const r = rec.result as { unresolved?: { line: number; snippet: string }[] };
        const first = r.unresolved?.[0];
        ask(
          `${where} loads code the census could not resolve (${cov.unresolved} dynamic, ${cov.unclaimed} unclaimed${
            first ? `; first at line ${first.line}: ${first.snippet}` : ""
          }): what does it load?`,
        );
      }
      if (cov) for (const s of cov.skipped) report.notExamined.push({ what: `${where}: ${s.what}`, reason: s.reason });
    };

    const attempt = async (probeId: string, path: string): Promise<ClaimRecord | null> => {
      try {
        const rec = await run({ caseId: input.caseId, probeId, path });
        absorb(rec);
        return rec;
      } catch (e) {
        if (!isAssayError(e)) throw e;
        const reason = typeof e.detail?.reason === "string" ? e.detail.reason : e.message;
        report.notExamined.push({ what: `${path} (${probeId})`, reason });
        return null;
      }
    };

    const markersOf = (r: Json): string[] => {
      if (!isObject(r)) return [];
      const m: string[] = [];
      if (Array.isArray(r.markers)) for (const x of r.markers) if (typeof x === "string") m.push(x);
      if (Array.isArray(r.slices))
        for (const s of r.slices)
          if (isObject(s) && Array.isArray(s.markers)) for (const x of s.markers) if (typeof x === "string") m.push(x);
      return m;
    };

    const examineFile = async (path: string, isRoot: boolean) => {
      const idRec = await attempt("file.identify", path);
      if (!idRec) return;
      const ident = idRec.result as unknown as Ident;
      const markers: string[] = [];
      for (const p of probes) {
        const ap = p as Partial<AssayProbe>;
        if (p.id === "file.identify" || !ap.sweep || p.cost !== "cheap") continue;
        if (!(ap.sweep.includes("each") || (isRoot && ap.sweep.includes("root")))) continue;
        if (!p.appliesTo({ format: ident.format, kind: "file", families: ident.families } as never)) continue;
        const rec = await attempt(p.id, path);
        if (rec) markers.push(...markersOf(rec.result));
      }
      if (ident.format === "unknown") ask(`What is ${path}? Its format is not recognised.`);
      if (IDENTIFIED_ONLY.has(ident.format))
        report.notExamined.push({ what: path, reason: `unsupported format: ${ident.format} (identified only)` });
      for (const row of matchRows({ format: ident.format, name: path, markers }))
        for (const tool of row.external) {
          const st = toolStatus(row, tool, platform, lookup);
          const k = st.probeId;
          const entry = tools.get(k) ?? { status: st, paths: [] };
          entry.paths.push(path);
          tools.set(k, entry);
          if (st.available && opts.runExternal && row.consent === "none") {
            const rec = await attempt(st.probeId, path);
            if (rec) entry.status = { ...st, reason: "ran" };
          }
        }
    };

    if (subject.kind === "file") await examineFile(subject.path, true);
    else {
      const idRec = await attempt("file.identify", subject.path);
      const ident = (idRec?.result as unknown as Ident | undefined) ?? identifyDirectory(subject.abs);
      for (const p of probes) {
        const ap = p as Partial<AssayProbe>;
        if (p.id === "file.identify" || !ap.sweep?.includes("root") || p.cost !== "cheap") continue;
        if (!p.appliesTo({ format: ident.format, kind: "directory", families: ident.families } as never)) continue;
        await attempt(p.id, subject.path);
      }
      const w = walkDir(subject.abs, { maxFiles: 2000, maxDepth: input.depth ?? 8 });
      for (const s of w.skipped)
        report.notExamined.push({
          what: subject.path === "." ? s.what : `${subject.path}/${s.what}`,
          reason: s.reason,
        });
      for (let i = 0; i < w.files.length; i++) {
        const f = w.files[i]!;
        if (performance.now() - t0 > budgetMs) {
          report.notExamined.push({
            what: `${w.files.length - i} files from ${f.rel} on`,
            reason: `sweep budget (${budgetMs} ms) exhausted`,
          });
          break;
        }
        await examineFile(subject.path === "." ? f.rel : `${subject.path}/${f.rel}`, false);
      }
    }
    for (const { status, paths } of tools.values()) {
      if (status.reason === "ran") continue;
      const what = `${status.tool.program} ${status.tool.args.join(" ")} [${status.row.id}] for ${paths[0]}${
        paths.length > 1 ? ` and ${paths.length - 1} more` : ""
      } (fallback: ${status.tool.fallback})`;
      const reason = status.available
        ? status.row.consent === "approval"
          ? "needs approval (consent: approval); not run by the sweep"
          : `available; not run by the sweep (run probe ${status.probeId})`
        : status.reason;
      report.notExamined.push({ what, reason });
    }
    report.questions = [...questions];
    report.elapsedMs = Math.round(performance.now() - t0);
    return report;
  };

  return {
    workspace: ws,
    list: () => [...probes],
    resolve: resolveSubject,
    run,
    sweep,
  };
}
