// The hybrid: the local model does the work; Opus (Claude Code) plans it and reviews it; Codex
// reviews it as a second, independent check. Neither reviewer sees the oracle: they check the
// worker's claims by running the reax command themselves. The worker gets at most one revision.
// The worker's first answer and the final answer are both kept, so the reviewers' effect shows.
import { parseClaims } from "../grade.ts";
import type { Backend, BackendContext, BackendResult, RoleRun } from "./types.ts";

export interface HybridParts {
  worker: Backend;
  opus: Backend;
  opusNoTools: Backend;
  codex: Backend;
}

export const PLAN_PROMPT = (
  task: string,
) => `You are orchestrating a small local model that will do this task with tools (reax operations on the files in the workspace).
Do not do the task yourself and do not run tools. Write a plan of at most five short steps for the worker: which reax operation to run on which file, and what to report.

Task:
${task}`;

export const CODEX_REVIEW_PROMPT = (
  task: string,
  claims: string,
) => `Review another agent's answer to this task. Check each claim yourself with the reax command (\`reax op <operation> --json '{"path":"<file>"}'\`; \`reax op --list\` lists operations). Do not trust the answer's wording.
Reply with a fenced block whose info string is "review", holding JSON: {"wrong": [claims that are false, with the right value if you found it], "missing": [facts the task asks for that are absent], "ok": true|false}.

Task:
${task}

The agent's claims:
${claims}`;

export const OPUS_REVIEW_PROMPT = (
  task: string,
  claims: string,
  codexReview: string,
) => `You are reviewing a local model's answer to this task. A second reviewer (Codex) has also checked it; its review is below. Verify anything you are unsure of yourself with the reax command (\`reax op <operation> --json '{"path":"<file>"}'\`).
Reply with a fenced block whose info string is "decision", holding JSON: {"decision": "accept" | "revise", "corrections": ["specific instruction to the worker", ...]}. Choose "revise" only for a claim you confirmed is wrong or a requested fact that is missing.

Task:
${task}

The local model's claims:
${claims}

Codex's review:
${codexReview}`;

function block(text: string, info: string): string | null {
  const m = [...text.matchAll(new RegExp(`\`\`\`${info}[^\\n]*\\n([\\s\\S]*?)\`\`\``, "g"))].at(-1);
  return m ? m[1]!.trim() : null;
}

export function decisionOf(text: string): { decision: "accept" | "revise"; corrections: string[] } {
  try {
    const d = JSON.parse(block(text, "decision") ?? "") as { decision?: string; corrections?: unknown[] };
    if (d.decision === "revise" && Array.isArray(d.corrections) && d.corrections.length)
      return { decision: "revise", corrections: d.corrections.map(String).slice(0, 20) };
  } catch {
    // an unreadable decision counts as accept: the worker's answer stands as it is
  }
  return { decision: "accept", corrections: [] };
}

function sum(runs: RoleRun[]): RoleRun {
  return {
    model: [...new Set(runs.map((r) => r.model))].join(" + "),
    requested_model: [...new Set(runs.map((r) => r.requested_model))].join(" + "),
    effort: [...new Set(runs.map((r) => r.effort))].join(" | "),
    turns: runs.reduce((a, r) => a + r.turns, 0),
    tool_calls: runs.reduce((a, r) => a + r.tool_calls, 0),
    tokens: {
      input_uncached: runs.reduce((a, r) => a + r.tokens.input_uncached, 0),
      input_cached: runs.reduce((a, r) => a + r.tokens.input_cached, 0),
      output: runs.reduce((a, r) => a + r.tokens.output, 0),
    },
    cost_usd: runs.reduce((a, r) => a + r.cost_usd, 0),
    ms: runs.reduce((a, r) => a + r.ms, 0),
  };
}

export function hybridBackend(p: HybridParts): Backend {
  return {
    name: "hybrid",
    async run(prompt: string, ctx: BackendContext): Promise<BackendResult> {
      const roles: Record<string, RoleRun> = {};
      const log: string[] = [];
      const step = async (role: string, b: Backend, text: string) => {
        const r = await b.run(text, ctx);
        roles[role] = r.run;
        log.push(`=== ${role} (${b.name})\n${r.transcript}`);
        return r;
      };
      const fail = (r: BackendResult, role: string, first?: string): BackendResult => ({
        answer: first ?? "",
        transcript: log.join("\n"),
        run: sum(Object.values(roles)),
        roles,
        ...(first !== undefined ? { first_answer: first } : {}),
        error: `${role}: ${r.error}`,
        ...(r.memory ? { memory: r.memory } : {}),
      });

      const plan = await step("plan", p.opusNoTools, PLAN_PROMPT(prompt));
      if (plan.error) return fail(plan, "plan");
      const first = await step("worker", p.worker, `${prompt}\n\nA reviewer suggests this plan:\n${plan.answer}`);
      if (first.error && !first.answer) return fail(first, "worker");
      const claims = JSON.stringify(parseClaims(first.answer).claims, null, 1);
      const codex = await step("codex_review", p.codex, CODEX_REVIEW_PROMPT(prompt, claims));
      const opus = await step(
        "opus_review",
        p.opus,
        OPUS_REVIEW_PROMPT(prompt, claims, codex.error ? `(Codex review failed: ${codex.error})` : codex.answer),
      );
      if (opus.error) return fail(opus, "opus_review", first.answer);
      const d = decisionOf(opus.answer);
      let final = first;
      if (d.decision === "revise") {
        final = await step(
          "worker_revision",
          p.worker,
          `${prompt}\n\nYour previous answer:\n${first.answer}\n\nA reviewer checked it and asks for these corrections:\n${d.corrections.map((c) => `- ${c}`).join("\n")}\nCheck each with the tools, then give the full corrected answer.`,
        );
        if (final.error && !final.answer) final = first;
      }
      return {
        answer: final.answer,
        first_answer: first.answer,
        transcript: log.join("\n"),
        run: sum(Object.values(roles)),
        roles,
        ...((final.memory ?? first.memory) ? { memory: (final.memory ?? first.memory)! } : {}),
        ...(codex.error ? { error: `codex_review: ${codex.error} (the run continued without it)` } : {}),
      };
    },
  };
}
