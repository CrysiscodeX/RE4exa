// Fit the local model's context size to the memory cap by measuring, not estimating. llama.cpp
// reports its buffers at load, but the server's resident memory also holds the GPU runtime and
// the process itself, and it grows as the KV cache fills. So each candidate context is loaded,
// filled to about 90% with one request (the most a cell can use), and its peak resident memory
// sampled. The largest context whose peak and whose reported buffers both stay within the cap,
// less a margin, is the one the bench uses.
import type { BenchConfig } from "../backends/config.ts";
import { LlamaServer } from "../backends/local.ts";

export const CONTEXTS = [16384, 12288, 8192, 6144];
/** Headroom kept under the cap for what a measurement does not see (other requests, drift). */
export const MARGIN = 0.05;

export interface FitTrial {
  ctx: number;
  peak_rss_mib: number;
  allocated_mib: number;
  filled_tokens: number;
  fits: boolean;
  error: string | null;
}

export const budgetMiB = (capMiB: number) => Math.floor(capMiB * (1 - MARGIN));

export function fitsCap(t: Omit<FitTrial, "fits">, capMiB: number): boolean {
  const b = budgetMiB(capMiB);
  return !t.error && t.peak_rss_mib <= b && t.allocated_mib <= b;
}

/** Try contexts from largest to smallest; the first that fits wins. Every trial is kept. */
export async function fitContext(
  measure: (ctx: number) => Promise<Omit<FitTrial, "fits">>,
  capMiB: number,
  contexts: number[] = CONTEXTS,
): Promise<{ ctx: number | null; trials: FitTrial[] }> {
  const trials: FitTrial[] = [];
  for (const ctx of [...contexts].sort((a, b) => b - a)) {
    const m = await measure(ctx);
    const t = { ...m, fits: fitsCap(m, capMiB) };
    trials.push(t);
    if (t.fits) return { ctx, trials };
  }
  return { ctx: null, trials };
}

const FILL = "The quick brown fox reads a binary file and lists its sections, symbols and strings. ";

async function post(url: string, body: unknown, ms: number): Promise<Record<string, unknown>> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(ms),
  });
  if (!r.ok) throw new Error(`POST ${url}: HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return (await r.json()) as Record<string, unknown>;
}

/** Load the model at one context size, fill it, and report the peak resident memory. */
export async function measureContext(local: BenchConfig["local"], ctx: number): Promise<Omit<FitTrial, "fits">> {
  const s = new LlamaServer({ ...local, ctx }, { enforceCap: false });
  try {
    await s.start(300_000);
    const per = ((await post(`${s.url}/tokenize`, { content: FILL }, 60_000)).tokens as unknown[] | undefined)?.length;
    const target = Math.floor(ctx * 0.9) - 128;
    const reply = await post(
      `${s.url}/v1/chat/completions`,
      {
        model: "local",
        messages: [
          { role: "user", content: `${FILL.repeat(Math.max(1, Math.floor(target / (per || 20))))}\nReply OK.` },
        ],
        max_tokens: 8,
        temperature: 0,
      },
      600_000,
    );
    s.sample();
    await new Promise((ok) => setTimeout(ok, 1200));
    s.sample();
    const usage = reply.usage as { prompt_tokens?: number } | undefined;
    return {
      ctx,
      peak_rss_mib: s.peakRss,
      allocated_mib: s.allocated,
      filled_tokens: usage?.prompt_tokens ?? 0,
      error: null,
    };
  } catch (e) {
    return { ctx, peak_rss_mib: s.peakRss, allocated_mib: s.allocated, filled_tokens: 0, error: (e as Error).message };
  } finally {
    await s.close();
  }
}
