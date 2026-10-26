// Seeding: rows come from the profiles mechanically, never typed in by hand. Each extractor names
// the profile section it reads; a renamed or restructured section makes the seeder throw.
//
// Re-seeding is idempotent and keeps triage: fields a person or the code sets (fix, phase,
// platforms, wont, category overrides, reax mapping) survive; only the fields the profile owns
// (title, evidence, severity, kind) are refreshed. A row the profile no longer contains is kept and
// marked orphaned, never deleted.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { items, plain, section, slug, tables } from "./markdown.ts";
import type { Category, LimitationRow, ParityRow, Platform, Severity, SourceRef } from "./schema.ts";

const ALL: Platform[] = ["linux", "darwin", "win32"];

/** Keyword classifier for rows whose profile gives no area. Order matters: first match wins. */
const CATEGORY_WORDS: [Category, RegExp][] = [
  ["question", /^(why|what|how|whether|will|do |does |did |is |are |would )/i],
  ["enforcement", /prose only|unchecked|nothing (enforces|checks)|models skip|relies on the model|not enforced/i],
  [
    "security",
    /inject|untrusted|secret|token|credential|auth|sandbox|privilege|approval|attack|exfil|telemetry|trust|full access|cve|advisory|ghsa|vulnerab|supply.chain|dependabot|codeql|safety defaults|foreign code|remote js|security/i,
  ],
  ["context", /context|catalog|tools\/list|bytes per|tokens|token cost|output schema|sent twice|dual|result size/i],
  [
    "state",
    /durab|crash|lost|data loss|ledger|persist|restart|replay|overwrite|two.process|one process|resume|retention|checkpoint|lease|stale|migration|deep binding|silent failed|liveness/i,
  ],
  [
    "scale",
    /memory|heap|oom|rss|large|slow|timeout|time out|blocks? (mcp )?(ping|cancel)|synchronous parse|cold start|budget|growth|concurren|throughput|barrier|orchestrator size/i,
  ],
  [
    "coverage",
    /no (support|tar|row|command)|not (opened|parsed|covered|examined|supported)|missing|lacks|cannot|only on|macos.only|apfs only|does not (handle|parse|open)|pseudocode|requires rg|needs go|no overlap|absence reported|needs inline/i,
  ],
  [
    "correctness",
    /wrong|incorrect|false|mislabel|jitter|timing counted|complete.*unresolved|"complete"|identity|id changes|misread|contested|bug|pipes? break|escaped pipes|unescaped|reused, not consumed|mismatch|clock skew|exactly-once|unique index|weakens|lists names|not stock|label format|wording|\$ref|const\b/i,
  ],
  [
    "install",
    /install|node floor|node \d|engine floor|platform|windows|linux|homebrew|npx|tmpdir|claude desktop|gemini|client|watchdog/i,
  ],
  ["errors", /error|message|retryable|remediation|code(s)? (differ|inconsistent)/i],
  [
    "tests",
    /test|benchmark|grader|oracle|ci\b|mutation|eval|task (electron|native|deep|go)|keys? (accept|match)|self-reported|committed results|target setup|checklist-style|narrow task/i,
  ],
  [
    "governance",
    /maintainer|review|release|semver|breaking|licen[cs]e|governance|changelog|contribut|merged|owner|experimental|unpublished|unverified numbers|documentation|production mileage|schema churn|observation gaps|delegation cost/i,
  ],
];

export function classify(text: string, fallback = ""): Category {
  for (const [cat, re] of CATEGORY_WORDS) if (re.test(text)) return cat;
  // Short headings ("Watchdogs.") say little; the item's body says more.
  if (fallback) for (const [cat, re] of CATEGORY_WORDS) if (cat !== "question" && re.test(fallback)) return cat;
  return "other";
}

const AREA: Record<string, Category> = {
  formats: "coverage",
  scale: "scale",
  correctness: "correctness",
  "agent cost": "context",
  context: "context",
  state: "state",
  security: "security",
  install: "install",
  ergonomics: "errors",
  "tests/ci": "tests",
  tests: "tests",
};

function severityOf(text: string): Severity {
  const t = text.toLowerCase();
  if (/\bblocks?\b/.test(t)) return "blocks";
  if (/\bdegrades?\b/.test(t)) return "degrades";
  if (/\bcosmetic\b/.test(t)) return "cosmetic";
  return "unrated";
}

function kindOf(text: string): LimitationRow["kind"] {
  const t = text.toLowerCase();
  if (t.startsWith("design")) return "design";
  if (t.startsWith("accident")) return "accident";
  if (/\bdesign\b/.test(t) && !/\baccident\b/.test(t)) return "design";
  if (/\baccident\b/.test(t)) return "accident";
  return "unknown";
}

function row(
  subject: LimitationRow["subject"],
  id: string,
  title: string,
  evidence: string,
  source: SourceRef,
  extra: Partial<LimitationRow> = {},
): LimitationRow {
  const t = plain(title);
  return {
    id,
    subject,
    category: extra.category ?? classify(t, plain(evidence)),
    title: t.length > 300 ? `${t.slice(0, 297)}...` : t,
    evidence: plain(evidence).slice(0, 600),
    severity: extra.severity ?? "unrated",
    kind: extra.kind ?? "unknown",
    source,
    fix: null,
    phase: null,
    platforms: [...ALL],
    wont: null,
  };
}

// CRLF from a Windows checkout reads the same as LF.
const read = (root: string, rel: string) => readFileSync(join(root, rel), "utf8").replaceAll("\r\n", "\n");

// ---------------------------------------------------------------------------------------------
// rea
// ---------------------------------------------------------------------------------------------

export function reaLimitations(root: string): LimitationRow[] {
  const file = "docs/profiles/rea.md";
  const text = read(root, file);
  const out: LimitationRow[] = [];

  const s31 = section(text, "### 3.1");
  for (const r of tables(s31).flatMap((t) => t.rows)) {
    const num = r.cells.Item?.match(/#(\d+)/)?.[1];
    if (!num) continue;
    out.push(
      row(
        "rea",
        `REA-ISS-${num}`,
        `${r.cells.Item}: ${r.cells["What it says"]}`,
        `${r.cells.Item?.match(/\((https?:[^)]+)\)/)?.[1] ?? ""} (${r.cells.Date}); confirmed in code: ${r.cells["Confirmed in code?"] ?? ""}`,
        { file, section: "### 3.1", key: `#${num}` },
      ),
    );
  }

  const s5 = section(text, "## 5.");
  for (const r of tables(s5).flatMap((t) => t.rows)) {
    const id = r.cells.ID;
    const lim = r.cells.Limits ?? "";
    if (!id?.startsWith("REA-C") || !lim || lim === "—" || lim === "-") continue;
    out.push(
      row("rea", `${id}-LIMIT`, `${r.cells.Capability}: ${lim}`, r.cells["Implementation (paths @b4938ae)"] ?? "", {
        file,
        section: "## 5.",
        key: id,
      }),
    );
  }

  const s9a = section(text, "### 9A.");
  for (const r of tables(s9a).flatMap((t) => t.rows)) {
    const id = r.cells["#"];
    if (!id || !/^A\d/.test(id)) continue;
    out.push(
      row(
        "rea",
        `REA-${id}`,
        r.cells.Limitation ?? "",
        `${r.cells["Evidence (code)"] ?? ""}; test: ${r.cells["Test / measurement"] ?? ""}; ${r.cells.Status ?? ""}`,
        { file, section: "### 9A.", key: id },
        {
          category: AREA[(r.cells.Area ?? "").toLowerCase()] ?? classify(r.cells.Limitation ?? ""),
          severity: severityOf(r.cells.Severity ?? ""),
          kind: kindOf(r.cells.Kind ?? ""),
        },
      ),
    );
  }

  const s9b = section(text, "### 9B.");
  const unconfirmed = s9b.lines.join(" ").match(/\(unconfirmed\):\s*(.*?)(?:\.\s|\.$)/)?.[1] ?? "";
  unconfirmed
    .split(";")
    .map((x) => x.trim())
    .filter(Boolean)
    .forEach((t, i) => {
      out.push(
        row("rea", `REA-9B-${i + 1}`, t, "search snippets only (unconfirmed)", {
          file,
          section: "### 9B.",
          key: `${i + 1}`,
        }),
      );
    });

  const s9c = section(text, "### 9C.");
  for (const r of tables(s9c).flatMap((t) => t.rows)) {
    const tool = plain(r.cells.Tool ?? "");
    if (!tool) continue;
    const what = r.cells["What it does that rea does not (or does differently)"] ?? "";
    out.push(
      row(
        "rea",
        `REA-9C-${slug(tool)}`,
        `Compared with ${tool}: ${what}`,
        r.cells["rea status"] ?? "",
        {
          file,
          section: "### 9C.",
          key: tool,
        },
        { category: "coverage" },
      ),
    );
  }

  const s9d = section(text, "### 9D.");
  const its = items(s9d);
  const newAt = its.findIndex((x) => x.indent === 0 && x.text.startsWith("**New:**"));
  if (newAt >= 0)
    for (let i = newAt + 1; i < its.length && its[i]!.indent > 0; i++)
      out.push(
        row("rea", `REA-9D-NEW-${i - newAt}`, its[i]!.text, "docs/profiles/rea.md §9D (HEAD 7d36d17)", {
          file,
          section: "### 9D.",
          key: `new-${i - newAt}`,
        }),
      );

  const s10 = section(text, "## 10.");
  const ten = items(s10);
  const block = (label: string) => {
    const at = ten.findIndex((x) => x.indent === 0 && x.text.startsWith(label));
    const res: string[] = [];
    if (at >= 0) for (let i = at + 1; i < ten.length && ten[i]!.indent > 0; i++) res.push(ten[i]!.text);
    return res;
  };
  // Problems that only point at rows already seeded (A-ids) add nothing; the rest are new rows.
  block("**Problems:**")
    .filter((t) => !/\(A\d/.test(t))
    .forEach((t, i) => {
      out.push(
        row("rea", `REA-10-${i + 1}`, t, "docs/profiles/rea.md §10", { file, section: "## 10.", key: `p${i + 1}` }),
      );
    });
  block("**Open questions:**").forEach((t, i) => {
    out.push(
      row(
        "rea",
        `REA-Q-${i + 1}`,
        t,
        "docs/profiles/rea.md §10",
        { file, section: "## 10.", key: `q${i + 1}` },
        {
          category: "question",
          kind: "question",
        },
      ),
    );
  });
  return out;
}

// ---------------------------------------------------------------------------------------------
// leanrea
// ---------------------------------------------------------------------------------------------

export function leanreaLimitations(root: string): LimitationRow[] {
  const file = "docs/profiles/leanrea.md";
  const text = read(root, file);
  const out: LimitationRow[] = [];

  const s5 = section(text, "## 5.");
  for (const r of tables(s5).flatMap((t) => t.rows)) {
    const id = r.cells.ID;
    if (!id?.startsWith("LEAN-C")) continue;
    const lim = r.cells.Limits ?? r.cells["Known defects"] ?? "";
    if (!lim || lim === "—" || lim === "-") continue;
    const what = r.cells.Capability ?? r.cells["Target (detect)"] ?? r.cells.Pattern ?? id;
    out.push(
      row("leanrea", `${id}-LIMIT`, `${what}: ${lim}`, r.cells.Where ?? "", { file, section: "## 5.", key: id }),
    );
  }

  const s9a = section(text, "### 9A.");
  for (const r of tables(s9a).flatMap((t) => t.rows)) {
    const id = r.cells["#"];
    if (!id || !/^A-\d/.test(id)) continue;
    out.push(
      row(
        "leanrea",
        `LEAN-${id}`,
        `${r.cells.Limitation}: ${r.cells["What fails or is missing"] ?? ""}`,
        r.cells.Evidence ?? "",
        {
          file,
          section: "### 9A.",
          key: id,
        },
        { severity: severityOf(r.cells.Severity ?? ""), kind: kindOf(r.cells["Design / accident"] ?? "") },
      ),
    );
  }

  const s9b = section(text, "### 9B.");
  tables(s9b)
    .flatMap((t) => t.rows)
    .forEach((r, i) => {
      out.push(
        row(
          "leanrea",
          `LEAN-9B-${i + 1}`,
          r.cells.Report ?? "",
          `${r.cells["URL, date"] ?? ""}; confirmed: ${r.cells["Confirmed against text or runs?"] ?? ""}`,
          {
            file,
            section: "### 9B.",
            key: `${i + 1}`,
          },
        ),
      );
    });

  const s9c = section(text, "### 9C.");
  for (const r of tables(s9c).flatMap((t) => t.rows)) {
    const who = plain(r.cells.Comparable ?? "").replace(/\s*\(.*$/, "");
    if (!who) continue;
    out.push(
      row(
        "leanrea",
        `LEAN-9C-${slug(who)}`,
        `Compared with ${who}: ${r.cells["What it documents"] ?? ""}`,
        r.cells["leanrea @09ba4aa"] ?? "",
        {
          file,
          section: "### 9C.",
          key: who,
        },
        { category: "coverage" },
      ),
    );
  }

  const s10 = section(text, "## 10.");
  const lines = s10.lines;
  const chAt = lines.findIndex((l) => l.startsWith("**Challenges:**"));
  const qAt = lines.findIndex((l) => l.startsWith("**Open questions:**"));
  const sub = (from: number, to: number) =>
    items({ heading: "", line: s10.line + from + 1, lines: lines.slice(from + 1, to) });
  if (chAt >= 0)
    sub(chAt, qAt >= 0 ? qAt : lines.length)
      .filter((x) => x.indent === 0)
      .forEach((x, i) => {
        out.push(
          row("leanrea", `LEAN-10-${i + 1}`, x.text, "docs/profiles/leanrea.md §10", {
            file,
            section: "## 10.",
            key: `c${i + 1}`,
          }),
        );
      });
  if (qAt >= 0)
    sub(qAt, lines.length)
      .filter((x) => x.indent === 0)
      .forEach((x, i) => {
        out.push(
          row(
            "leanrea",
            `LEAN-Q-${i + 1}`,
            x.text,
            "docs/profiles/leanrea.md §10",
            { file, section: "## 10.", key: `q${i + 1}` },
            {
              category: "question",
              kind: "question",
            },
          ),
        );
      });
  return out;
}

// ---------------------------------------------------------------------------------------------
// donors: the projects whose code or lessons the shared engine inherits
// ---------------------------------------------------------------------------------------------

function numbered(
  root: string,
  subject: LimitationRow["subject"],
  prefix: string,
  file: string,
  heading: string,
): LimitationRow[] {
  const s = section(read(root, file), heading);
  const out: LimitationRow[] = [];
  for (const it of items(s).filter((x) => x.indent === 0 && /^\d+\.$/.test(x.marker))) {
    const n = it.marker.replace(".", "");
    const title = it.text.match(/^\*\*(.+?)\*\*/)?.[1] ?? it.text;
    const isQ = /^open questions?/i.test(plain(title));
    if (isQ) {
      // An "Open questions" item carries its questions as sub-items.
      const all = items(s);
      const at = all.indexOf(it);
      for (let i = at + 1, q = 1; i < all.length && all[i]!.indent > 0; i++, q++)
        out.push(
          row(
            subject,
            `${prefix}-Q-${q}`,
            all[i]!.text,
            `${file} ${heading}`,
            { file, section: heading, key: `${n}.${q}` },
            {
              category: "question",
              kind: "question",
            },
          ),
        );
      continue;
    }
    out.push(row(subject, `${prefix}-${n}`, title, it.text, { file, section: heading, key: n }));
  }
  return out;
}

export function donorLimitations(root: string): LimitationRow[] {
  const out: LimitationRow[] = [];
  out.push(...numbered(root, "pi-durable", "PD", "docs/profiles/pi-durable.md", "## 9."));
  out.push(...numbered(root, "orca", "OR", "docs/profiles/orca.md", "## 11."));
  out.push(...numbered(root, "t3code", "T3", "docs/profiles/t3code.md", "## 11."));
  const file = "docs/profiles/absurd.md";
  const s = section(read(root, file), "## 9.");
  s.lines.forEach((l, i) => {
    const m = l.match(/^\*\*P(\d+)\.\s*(.+?)\*\*/);
    if (!m) return;
    const body: string[] = [];
    for (let j = i + 1; j < s.lines.length && !/^\*\*P\d+\./.test(s.lines[j]!); j++) body.push(s.lines[j]!.trim());
    out.push(row("absurd", `AB-P${m[1]}`, m[2]!, body.join(" "), { file, section: "## 9.", key: `P${m[1]}` }));
  });
  return out;
}

// ---------------------------------------------------------------------------------------------
// parity
// ---------------------------------------------------------------------------------------------

export interface PhaseMap {
  families: Record<string, number>;
  tools: Record<string, number>;
  leanrea: Record<string, number>;
}

export function reaParity(root: string, phases: PhaseMap): ParityRow[] {
  const file = "docs/profiles/rea.md";
  const out: ParityRow[] = [];
  for (const r of tables(section(read(root, file), "## 5.")).flatMap((t) => t.rows)) {
    const id = r.cells.ID;
    if (!id?.startsWith("REA-C")) continue;
    out.push({
      key: `rea.family/${id}`,
      kind: "rea-family",
      title: plain(r.cells.Capability ?? id),
      family: id,
      reax: { tool: null, operation: null, engine: null },
      phase: phases.families[id] ?? null,
      platforms: [...ALL],
      wont: null,
      source: { file, section: "## 5.", key: id },
    });
  }
  const cat = JSON.parse(read(root, "apps/reax/docs/ledger/sources/rea-6.8.0-tools.json")) as {
    tools: { name: string; family: string }[];
    prompts: string[];
  };
  for (const t of cat.tools)
    out.push({
      key: `rea.tool/${t.name}`,
      kind: "rea-tool",
      title: t.name,
      family: t.family,
      reax: { tool: null, operation: null, engine: null },
      phase: phases.tools[t.name] ?? phases.families[t.family] ?? null,
      platforms: [...ALL],
      wont: null,
      source: { file: "apps/reax/docs/ledger/sources/rea-6.8.0-tools.json", section: "tools", key: t.name },
    });
  for (const p of cat.prompts)
    out.push({
      key: `rea.prompt/${p}`,
      kind: "rea-prompt",
      title: p,
      family: "REA-C41",
      reax: { tool: null, operation: null, engine: null },
      phase: phases.families["REA-C41"] ?? null,
      platforms: [...ALL],
      wont: null,
      source: { file: "apps/reax/docs/ledger/sources/rea-6.8.0-tools.json", section: "prompts", key: p },
    });
  return out;
}

export function leanreaParity(root: string, phases: PhaseMap): ParityRow[] {
  const file = "docs/profiles/leanrea.md";
  const s5 = section(read(root, file), "## 5.");
  const out: ParityRow[] = [];
  for (const r of tables(s5).flatMap((t) => t.rows)) {
    const id = r.cells.ID;
    if (!id) continue;
    const isTrap = id.startsWith("LEAN-T");
    if (!isTrap && !id.startsWith("LEAN-C")) continue;
    const title = r.cells.Capability ?? r.cells["Target (detect)"] ?? r.cells.Pattern ?? r.cells.Trap ?? id;
    out.push({
      key: `leanrea/${id}`,
      kind: isTrap ? "leanrea-trap" : "leanrea-capability",
      title: plain(title).slice(0, 200),
      family: id,
      reax: { tool: null, operation: null, engine: null },
      phase: phases.leanrea[id] ?? phases.leanrea[isTrap ? "traps" : "default"] ?? null,
      platforms: [...ALL],
      wont: null,
      source: { file, section: "## 5.", key: id },
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// merging
// ---------------------------------------------------------------------------------------------

const PROFILE_OWNED_LIMIT = ["title", "evidence", "severity", "kind", "source", "subject"] as const;
const PROFILE_OWNED_PARITY = ["title", "kind", "family", "source"] as const;

/** Merge freshly extracted rows into the existing ones: keep triage, refresh profile-owned fields,
 * add new rows, mark vanished ones orphaned. Rows not produced by the seeder (reax's own rows)
 * pass through untouched. */
export function merge<T extends { source: SourceRef | null; orphaned?: boolean }>(
  existing: T[],
  fresh: T[],
  keyOf: (r: T) => string,
  owned: readonly (keyof T)[],
  seededSources: Set<string>,
): T[] {
  const byKey = new Map(existing.map((r) => [keyOf(r), r]));
  const seen = new Set<string>();
  const out: T[] = [];
  for (const f of fresh) {
    const k = keyOf(f);
    if (seen.has(k)) throw new Error(`seeder produced the key ${k} twice`);
    seen.add(k);
    const old = byKey.get(k);
    if (!old) {
      out.push(f);
      continue;
    }
    const merged = { ...old } as T;
    for (const field of owned) merged[field] = f[field];
    delete merged.orphaned;
    // A category set by the classifier may be overridden by hand; keep the old one unless the
    // profile itself states an area (rea §9A), in which case the profile wins.
    out.push(merged);
  }
  for (const old of existing) {
    const k = keyOf(old);
    if (seen.has(k)) continue;
    const seeded = old.source !== null && seededSources.has(old.source.file);
    out.push(seeded ? { ...old, orphaned: true } : old);
  }
  return out;
}

export const OWNED = { limitation: PROFILE_OWNED_LIMIT, parity: PROFILE_OWNED_PARITY };
