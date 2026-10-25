// M12, live: the same questions to the same model on the same signed-in account, two ways.
//   Tier 0: the official client with Bash/Read/Grep and leanrea's skill text (the strongest
//           cheap baseline from the merger debate).
//   Assay:  the official client driven by Assay in enforced mode (only Assay's tools; claims re-run).
// Opt-in: ASSAY_LIVE=1. Spends real usage on the default account; capped per run and in total.
//   node bench/live.ts [--model haiku] [--reps 1] [--cap-usd 3] [--tasks id,id]
import { cpSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { App } from "../src/app/app.ts";
import { caseClaims } from "../src/evidence/store.ts";
import { tmp } from "../test/helpers.ts";

if (process.env.ASSAY_LIVE !== "1") {
  console.log("bench/live.ts spends real model usage; set ASSAY_LIVE=1 to run it.");
  process.exit(0);
}
const arg = (n: string, d: string) => {
  const i = process.argv.indexOf(n);
  return i >= 0 ? process.argv[i + 1]! : d;
};
const MODEL = arg("--model", "haiku");
const REPS = Number(arg("--reps", "1"));
const CAP = Number(arg("--cap-usd", "3"));
const PER_RUN = 0.4;
const ROOT = join(import.meta.dirname, "..");
const SKILL = readFileSync("/home/user/GitHub_Repos_Dump/aicodeking__leanrea/leanrea/SKILL.md", "utf8").replace(
  /^---[\s\S]*?---\n/,
  "",
);

interface Oracle {
  predicate: string;
  params: Record<string, unknown>;
  expect: string;
}
interface Task {
  id: string;
  question: string;
  oracle: Oracle[];
}
const only = arg("--tasks", "");
const tasks = readdirSync(join(ROOT, "bench", "tasks"))
  .filter((f) => f.endsWith(".json") && !f.startsWith("leanrea-"))
  .map((f) => JSON.parse(readFileSync(join(ROOT, "bench", "tasks", f), "utf8")) as Task)
  .filter((t) => !only || only.split(",").includes(t.id));

/** The fact an oracle item checks, as a string an answer must contain. */
function key(o: Oracle): string | null {
  const p = o.params;
  for (const k of ["library", "name", "specifier", "host", "entry", "hook", "format", "text"])
    if (typeof p[k] === "string") return String(p[k]).toLowerCase();
  return null;
}
function grade(t: Task, answer: string): { correct: number; facts: number } {
  const a = answer.toLowerCase();
  const facts = t.oracle.filter((o) => o.expect === "verified" && key(o));
  return { correct: facts.filter((o) => a.includes(key(o)!)).length, facts: facts.length };
}

interface Run {
  arm: "tier0" | "assay";
  task: string;
  rep: number;
  costUsd: number;
  ms: number;
  correct: number;
  facts: number;
  verifiedFacts: number;
  claims: number;
  verified: number;
  refuted: number;
  answer: string;
  error?: string;
  claimDetail?: { predicate: string | null; params: unknown; verdict: string | null; reason: string | null }[];
}
const runs: Run[] = [];
let spent = 0;

async function tier0(t: Task, ws: string): Promise<Omit<Run, "arm" | "task" | "rep">> {
  const t0 = Date.now();
  let cost = 0;
  let answer = "";
  const allow = new Set(["Bash", "Read", "Grep", "Glob", "LS"]);
  for await (const m of query({
    prompt: `${t.question} Answer briefly; cite file and offset or symbol for what you observed.`,
    options: {
      cwd: ws,
      model: MODEL,
      systemPrompt: { type: "preset", preset: "claude_code", append: SKILL },
      allowedTools: [...allow],
      settingSources: [],
      maxBudgetUsd: PER_RUN,
      env: { ...process.env, CLAUDE_AGENT_SDK_CLIENT_APP: "assay-bench/0.1.0" },
      canUseTool: async (name: string, input: Record<string, unknown>) =>
        allow.has(name)
          ? { behavior: "allow" as const, updatedInput: input }
          : { behavior: "deny" as const, message: "not allowed in this benchmark" },
    },
  })) {
    const msg = m as { type: string; total_cost_usd?: number; result?: string };
    if (msg.type === "result") {
      cost = msg.total_cost_usd ?? 0;
      answer = msg.result ?? "";
    }
  }
  const g = grade(t, answer);
  return { costUsd: cost, ms: Date.now() - t0, ...g, verifiedFacts: 0, claims: 0, verified: 0, refuted: 0, answer };
}

async function assay(t: Task, ws: string): Promise<Omit<Run, "arm" | "task" | "rep">> {
  const home = tmp("assay-live-home-");
  const app = new App({ home: home.dir, workspace: ws });
  try {
    await app.listen();
    await app.accounts.ensureDefaults();
    const acct = app.accounts.list().find((a) => a.provider === "claude" && a.home === null);
    if (!acct) throw new Error("no default Claude account");
    const c = app.kernel.createCase({ title: t.id, workspace: ws });
    const t0 = Date.now();
    await app.orchestrator.sendMessage(c.id, {
      text: `${t.question} Answer briefly.`,
      provider: "claude",
      accountId: acct.id,
      model: MODEL,
      mode: "enforced",
      budgetUsd: PER_RUN,
    });
    for (let i = 0; i < 1800; i++) {
      await new Promise((r) => setTimeout(r, 200));
      const tl = app.orchestrator.timeline(c.id);
      if (
        tl.some((e) => e.kind === "assistant" || e.kind === "error") &&
        app.orchestrator.caseActivity(c.id) !== "working"
      )
        break;
    }
    await app.orchestrator.verify(c.id);
    const ms = Date.now() - t0;
    const tl = app.orchestrator.timeline(c.id);
    const answer = tl
      .filter((e) => e.kind === "assistant")
      .map((e) => e.text)
      .join("\n");
    const claims = caseClaims(app.kernel, c.id);
    const cost = Number(
      app.kernel.get<{ c: number }>("SELECT SUM(COALESCE(cost_usd,0)) AS c FROM usage WHERE case_id=?", c.id)?.c ?? 0,
    );
    const g = grade(
      t,
      `${answer}\n${claims.map((x) => `${x.claim.text} ${JSON.stringify(x.claim.params ?? {})}`).join("\n")}`,
    );
    const verifiedText = claims
      .filter((x) => x.verdict === "verified")
      .map((x) => `${x.claim.text} ${JSON.stringify(x.claim.params ?? {})}`.toLowerCase())
      .join("\n");
    const verifiedFacts = t.oracle.filter(
      (o) => o.expect === "verified" && key(o) && verifiedText.includes(key(o)!),
    ).length;
    const err = tl.find((e) => e.kind === "error");
    if (process.env.ASSAY_LIVE_DEBUG) writeFileSync(`/tmp/claude-0/live-${t.id}.json`, JSON.stringify(tl, null, 1));
    return {
      costUsd: cost,
      ms,
      ...g,
      verifiedFacts,
      claims: claims.length,
      verified: claims.filter((x) => x.verdict === "verified").length,
      refuted: claims.filter((x) => x.verdict === "refuted").length,
      answer,
      claimDetail: claims.map((x) => ({
        predicate: x.claim.predicate ?? null,
        params: x.claim.params ?? null,
        verdict: x.verdict,
        reason: x.verdict_record?.reason ?? null,
      })),
      ...(err ? { error: err.text } : {}),
    };
  } finally {
    await app.close();
    home.cleanup();
  }
}

const summarizeOnly = process.argv.includes("--summarize");
if (summarizeOnly) {
  // recompute the summary (with the bootstrap interval) from the runs already recorded
  const prev = JSON.parse(readFileSync(join(ROOT, "bench", "results", "live.json"), "utf8")) as {
    runs: Run[];
    spentUsd: number;
  };
  runs.push(...prev.runs);
  spent = prev.spentUsd;
} else {
  for (let rep = 1; rep <= REPS; rep++) {
    for (const t of tasks) {
      for (const arm of rep % 2 ? (["tier0", "assay"] as const) : (["assay", "tier0"] as const)) {
        if (spent >= CAP) break;
        const ws = tmp(`assay-live-${arm}-`);
        cpSync(join(ROOT, "bench", "tasks", "fixtures"), ws.dir, { recursive: true });
        try {
          const r = arm === "tier0" ? await tier0(t, ws.dir) : await assay(t, ws.dir);
          spent += r.costUsd;
          runs.push({ arm, task: t.id, rep, ...r });
          console.log(
            `${arm.padEnd(5)} ${t.id.padEnd(16)} $${r.costUsd.toFixed(4)} ${r.ms}ms correct ${r.correct}/${r.facts} verified-facts ${r.verifiedFacts}${r.error ? ` ERROR ${r.error.slice(0, 80)}` : ""}`,
          );
        } catch (e) {
          runs.push({
            arm,
            task: t.id,
            rep,
            costUsd: 0,
            ms: 0,
            correct: 0,
            facts: 0,
            verifiedFacts: 0,
            claims: 0,
            verified: 0,
            refuted: 0,
            answer: "",
            error: String((e as Error).message),
          });
          console.log(`${arm} ${t.id} failed: ${(e as Error).message}`);
        } finally {
          ws.cleanup();
        }
      }
    }
  }
}
const sum = (arm: string, f: (r: Run) => number) => runs.filter((r) => r.arm === arm).reduce((a, r) => a + f(r), 0);
const arms = ["tier0", "assay"].map((arm) => {
  const cost = sum(arm, (r) => r.costUsd);
  const correct = sum(arm, (r) => r.correct);
  const facts = sum(arm, (r) => r.facts);
  return {
    arm,
    runs: runs.filter((r) => r.arm === arm).length,
    costUsd: +cost.toFixed(4),
    correct,
    facts,
    verifiedFacts: sum(arm, (r) => r.verifiedFacts),
    costPerCorrect: correct ? +(cost / correct).toFixed(5) : null,
    medianMs:
      [...runs.filter((r) => r.arm === arm).map((r) => r.ms)].sort((a, b) => a - b)[
        Math.floor(runs.filter((r) => r.arm === arm).length / 2)
      ] ?? null,
  };
});
const [t0a, asa] = arms as [(typeof arms)[number], (typeof arms)[number]];
const ratio = t0a.costPerCorrect && asa.costPerCorrect ? asa.costPerCorrect / t0a.costPerCorrect : null;
// paired bootstrap over (task, rep) cells of the cost-per-correct-fact ratio
const cells = new Map<string, Partial<Record<"tier0" | "assay", Run>>>();
for (const r of runs) cells.set(`${r.task}#${r.rep}`, { ...(cells.get(`${r.task}#${r.rep}`) ?? {}), [r.arm]: r });
const paired = [...cells.values()].filter((c): c is Record<"tier0" | "assay", Run> => !!c.tier0 && !!c.assay);
let seed = 7;
const rnd = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};
const boot: number[] = [];
for (let b = 0; b < 10_000 && paired.length; b++) {
  let ct = 0,
    ca = 0,
    nt = 0,
    na = 0;
  for (let i = 0; i < paired.length; i++) {
    const c = paired[Math.floor(rnd() * paired.length)]!;
    ct += c.tier0.costUsd;
    ca += c.assay.costUsd;
    nt += c.tier0.correct;
    na += c.assay.correct;
  }
  if (nt && na) boot.push(ca / na / (ct / nt));
}
boot.sort((a, b) => a - b);
const ci: [number, number] | null = boot.length
  ? [boot[Math.floor(boot.length * 0.025)]!, boot[Math.floor(boot.length * 0.975)]!]
  : null;
const summary = `model ${MODEL}, ${tasks.length} tasks × ${REPS}: Tier 0 ${t0a.correct}/${t0a.facts} facts, $${t0a.costUsd}, 0 machine-verified; Assay ${asa.correct}/${asa.facts} facts, $${asa.costUsd}, ${asa.verifiedFacts} machine-verified; cost per correct fact ratio Assay/Tier0 = ${ratio?.toFixed(2) ?? "n/a"}${ci ? ` [95% bootstrap ${ci[0].toFixed(2)}–${ci[1].toFixed(2)}, ${paired.length} paired cells]` : ""}`;
const out = {
  at: new Date().toISOString(),
  model: MODEL,
  reps: REPS,
  capUsd: CAP,
  spentUsd: +spent.toFixed(4),
  arms,
  ratio,
  ci,
  pairedCells: paired.length,
  // M12 passes only when the whole interval is at or below parity and accuracy is not lower
  pass: ci !== null && ci[1] <= 1.0 && asa.correct >= t0a.correct,
  summary,
  runs,
};
mkdirSync(join(ROOT, "bench", "results"), { recursive: true });
writeFileSync(join(ROOT, "bench", "results", arg("--out", "live.json")), `${JSON.stringify(out, null, 2)}\n`);
console.log(`\n${summary}\nspent $${spent.toFixed(4)} of cap $${CAP}`);
