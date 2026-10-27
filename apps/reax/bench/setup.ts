// One-time setup for the local backend, on Linux, macOS or Windows, on whatever GPU the machine
// has: detect the hardware, download llama.cpp's own release build for it at the pinned tag,
// check it really runs on that hardware, fall back (CUDA/ROCm -> Vulkan -> CPU) if it does not,
// download the model, load it once under the memory cap, and write bench/backends.json.
// Every download is checked against its publisher's sha256. Sign-in to Codex and Claude is
// yours to do; this script never touches credentials.
//   node bench/setup.ts [--dry-run] [--backend metal|cuda|rocm|vulkan|opencl-adreno|sycl|cpu]
//                       [--server path/to/llama-server] [--model path.gguf] [--model-repo owner/name]
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { loadConfig } from "../src/bench/backends/config.ts";
import { LlamaServer } from "../src/bench/backends/local.ts";
import { runCliSync } from "../src/bench/backends/proc.ts";
import {
  assetFor,
  BACKENDS,
  type BackendId,
  backendWorks,
  type Candidate,
  candidates,
  firstWorking,
  parseDevices,
} from "../src/bench/setup/hardware.ts";
import { downloadVerified, extract, findFile, modelFile, PUBLIC, releaseAssets } from "../src/bench/setup/install.ts";
import { probeHardware } from "../src/bench/setup/probe.ts";

/** llama.cpp release tag b11923 is commit de5122d879d00d2895c36be7e0cee94105aeeabd. */
export const LLAMA_TAG = "b11923";
/** Tried in order; the first that has a Q4_K_M file wins. Override with --model-repo. */
const MODEL_REPOS = [
  "Qwen/Qwen3-4B-Instruct-2507-GGUF",
  "unsloth/Qwen3-4B-Instruct-2507-GGUF",
  "bartowski/Qwen_Qwen3-4B-Instruct-2507-GGUF",
  "lmstudio-community/Qwen3-4B-Instruct-2507-GGUF",
];
const MODEL_FILE = /Qwen3-4B-Instruct-2507.*Q4_K_M\.gguf$/i;

process.on("uncaughtException", (e) => {
  const proxy = (process.env.HTTPS_PROXY || process.env.https_proxy) && !process.env.NODE_USE_ENV_PROXY;
  console.error(
    `setup failed: ${e.message}${proxy ? "\n(HTTPS_PROXY is set: Node uses it only with NODE_USE_ENV_PROXY=1; set that and run again)" : ""}`,
  );
  process.exit(1);
});

const { values: a } = parseArgs({
  options: {
    "dry-run": { type: "boolean", default: false },
    backend: { type: "string" },
    server: { type: "string" },
    model: { type: "string" },
    "model-repo": { type: "string" },
  },
});
if (a.backend && !BACKENDS.includes(a.backend as BackendId)) {
  console.error(`--backend must be one of ${BACKENDS.join(", ")}`);
  process.exit(2);
}

// The endpoints are overridable only so the tests can serve a fake release and model.
const EP = {
  githubApi: process.env.REAX_SETUP_GITHUB_API ?? PUBLIC.githubApi,
  huggingFace: process.env.REAX_SETUP_HF ?? PUBLIC.huggingFace,
};
const HERE = import.meta.dirname;
const CONFIG = process.env.REAX_BENCH_CONFIG ?? join(HERE, "backends.json");
const CACHE =
  process.env.REAX_CACHE ??
  (process.platform === "win32"
    ? join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "reax")
    : join(homedir(), ".cache", "reax"));
const cfg = loadConfig(CONFIG);
const exe = process.platform === "win32" ? "llama-server.exe" : "llama-server";
const mib = (n: number) => `${(n / 2 ** 20).toFixed(0)} MiB`;

const hw = probeHardware();
console.log(`machine: ${hw.os} ${hw.arch}`);
for (const g of hw.gpus) console.log(`  GPU: ${g.name} (${g.vendor})`);
if (!hw.gpus.length) console.log("  GPU: none found");
if (hw.cudaDriver) console.log(`  NVIDIA driver supports CUDA ${hw.cudaDriver.join(".")}`);
console.log(
  `  Vulkan loader: ${hw.vulkan ? "yes" : "no"}${hw.os === "linux" ? `; ROCm: ${hw.rocm ? "yes" : "no"}` : ""}`,
);

const list: Candidate[] = a.backend
  ? [{ backend: a.backend as BackendId, why: "chosen with --backend" }]
  : candidates(hw);
console.log(`builds to try, in order: ${list.map((c) => `${c.backend} (${c.why})`).join("; ")}`);

// The model first: every build is checked by loading it.
let model = a.model ?? null;
let modelSha: string | null = null;
let modelFrom: string | null = a.model ? "given with --model" : null;
if (!model) {
  for (const repo of a["model-repo"] ? [a["model-repo"]] : MODEL_REPOS) {
    const f = await modelFile(repo, MODEL_FILE, EP).catch((e: Error) => {
      console.log(`  ${repo}: ${e.message}`);
      return null;
    });
    if (!f) continue;
    console.log(
      `model: ${repo}/${f.name}, ${f.size ? mib(f.size) : "size unknown"}, sha256 ${f.sha256 ?? "not published"}`,
    );
    model = join(CACHE, "models", f.name);
    modelFrom = `${EP.huggingFace}/${repo} (${f.name})`;
    if (a["dry-run"]) break;
    let last = 0;
    modelSha = await downloadVerified(f, model, (b) => {
      if (b - last > 256 * 2 ** 20) {
        last = b;
        process.stdout.write(`  ${mib(b)}\r`);
      }
    });
    if (!f.sha256) console.log(`  no published digest: pinned on first download as ${modelSha} (trust on first use)`);
    break;
  }
  if (!model && !a["dry-run"])
    throw new Error(`no ${MODEL_FILE} found in ${MODEL_REPOS.join(", ")}; pass --model or --model-repo`);
}

const assets = a.server
  ? []
  : await releaseAssets(LLAMA_TAG, EP).catch((e: Error) => {
      throw new Error(
        `could not list llama.cpp ${LLAMA_TAG}'s release assets (${e.message}); pass --server to use your own llama-server`,
      );
    });
if (!a.server) {
  console.log(`llama.cpp ${LLAMA_TAG}: ${assets.length} release assets`);
  for (const c of list) {
    const choice = assetFor(
      c.backend,
      hw,
      LLAMA_TAG,
      assets.map((x) => x.name),
    );
    console.log(`  ${c.backend}: ${choice ? [choice.main, ...choice.extra].join(" + ") : "no build in this release"}`);
  }
}
if (a["dry-run"]) {
  console.log("dry run: nothing downloaded or written");
  process.exit(0);
}

async function install(c: Candidate): Promise<string> {
  if (a.server) return a.server;
  const choice = assetFor(
    c.backend,
    hw,
    LLAMA_TAG,
    assets.map((x) => x.name),
  );
  if (!choice) throw new Error(`release ${LLAMA_TAG} has no ${c.backend} build for ${hw.os} ${hw.arch}`);
  const dir = join(CACHE, "llama.cpp", LLAMA_TAG, c.backend);
  rmSync(dir, { recursive: true, force: true });
  for (const name of [choice.main, ...choice.extra]) {
    const f = assets.find((x) => x.name === name)!;
    const archive = join(CACHE, "llama.cpp", LLAMA_TAG, "archives", name);
    const sha = await downloadVerified(f, archive);
    console.log(`  ${name}: sha256 ${sha}${f.sha256 ? " (matches GitHub's)" : " (GitHub published none)"}`);
    extract(archive, dir);
  }
  const server = findFile(dir, exe);
  if (!server) throw new Error(`${choice.main} has no ${exe}`);
  return server;
}

const port = cfg.local.port + 7;
const { chosen, result, failures } = await firstWorking(list, async (c) => {
  console.log(`trying ${c.backend} ...`);
  const server = await install(c);
  const listed = runCliSync([server, "--list-devices"], { timeoutMs: 60_000 });
  const devices = parseDevices(listed.out);
  if (!backendWorks(c.backend, devices))
    throw new Error(
      `it started but found no ${c.backend} device (${listed.out.split("\n").slice(-3).join(" | ") || "no output"})`,
    );
  const s = new LlamaServer({
    ...cfg.local,
    server: [server],
    model: model!,
    gpuLayers: c.backend === "cpu" ? 0 : cfg.local.gpuLayers,
    port,
  });
  await s.start(300_000);
  s.stop();
  if (s.overCap) throw new Error(`memory cap: ${s.overCap}`);
  return {
    server,
    device: devices[0] ? `${devices[0].name}: ${devices[0].description}` : "CPU",
    allocated: s.allocated,
  };
});
for (const f of failures) console.log(`  ${f.backend} did not work: ${f.error}`);
console.log(
  `using ${chosen.backend} on ${result.device}; llama.cpp allocated ${result.allocated} MiB of the ${cfg.local.memCapMiB} MiB cap`,
);

const existing = existsSync(CONFIG) ? (JSON.parse(readFileSync(CONFIG, "utf8")) as Record<string, unknown>) : {};
const local = {
  ...((existing.local as object | undefined) ?? {}),
  server: [result.server],
  model,
  modelSha256: modelSha,
  gpuLayers: chosen.backend === "cpu" ? 0 : cfg.local.gpuLayers,
  backend: chosen.backend,
  device: result.device,
};
const provenance = {
  llamaTag: LLAMA_TAG,
  llamaCommit: "de5122d879d00d2895c36be7e0cee94105aeeabd",
  model: modelFrom,
  hardware: hw,
  setupAt: new Date().toISOString(),
};
writeFileSync(CONFIG, `${JSON.stringify({ ...existing, local, provenance }, null, 2)}\n`);
console.log(`wrote ${CONFIG}

Next, sign in yourself (once each):
  codex login      (your ChatGPT account)
  claude           (then /login with your Claude account, then /exit)
Then: npm run bench:doctor -- --live   and   npm run bench:smoke`);
