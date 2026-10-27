// Backend settings. Defaults are in code; bench/backends.json (or $REAX_BENCH_CONFIG) overrides
// them. Model names and effort options are what you asked for; the doctor checks them against the
// installed CLIs before a run, and each cell records what was actually used.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface BenchConfig {
  local: {
    /** llama-server command (argv prefix). */
    server: string[];
    /** Path to the GGUF file. */
    model: string;
    /** Its SHA-256, pinned at setup; checked by the doctor. */
    modelSha256: string | null;
    ctx: number;
    kvType: string;
    /** Memory cap for llama-server, in MiB (weights + KV cache + compute buffers). */
    memCapMiB: number;
    port: number;
    gpuLayers: number;
    maxTurns: number;
    maxTokensPerTurn: number;
  };
  codex: { cmd: string[]; model: string; effort: string; extraArgs: string[] };
  claude: {
    cmd: string[];
    model: string;
    effort: string;
    /** Arguments that set the effort, if the installed version has an option for it; null means
     * the doctor decides from `claude --help`. */
    effortArgs: string[] | null;
    extraArgs: string[];
  };
  cell: { timeoutMs: number };
}

export const DEFAULTS: BenchConfig = {
  local: {
    server: ["llama-server"],
    model: join(homedir(), ".cache", "reax", "models", "Qwen3-4B-Instruct-2507-Q4_K_M.gguf"),
    modelSha256: null,
    ctx: 16384,
    kvType: "q8_0",
    memCapMiB: 4096,
    port: 8089,
    gpuLayers: 99,
    maxTurns: 12,
    maxTokensPerTurn: 2048,
  },
  codex: { cmd: ["codex"], model: "gpt-6.1-sol", effort: "medium", extraArgs: [] },
  claude: { cmd: ["claude"], model: "claude-opus-5-5", effort: "medium", effortArgs: null, extraArgs: [] },
  cell: { timeoutMs: 600_000 },
};

export function loadConfig(
  path = process.env.REAX_BENCH_CONFIG ?? join(import.meta.dirname, "..", "..", "..", "bench", "backends.json"),
): BenchConfig {
  if (!existsSync(path)) return structuredClone(DEFAULTS);
  const o = JSON.parse(readFileSync(path, "utf8")) as Partial<BenchConfig>;
  return {
    local: { ...DEFAULTS.local, ...o.local },
    codex: { ...DEFAULTS.codex, ...o.codex },
    claude: { ...DEFAULTS.claude, ...o.claude },
    cell: { ...DEFAULTS.cell, ...o.cell },
  };
}
