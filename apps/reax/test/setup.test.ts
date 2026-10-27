// Setup on every OS and GPU: which llama.cpp build is chosen for which machine, which release
// asset that is, the fallback when a build does not work, and the digest check on downloads.
// Also how the CLIs are started on each OS (npm .cmd shims on Windows without cmd.exe, prompts
// over stdin, PATH with the OS's delimiter, the whole process tree ended at the deadline).
// The asset names are the ones llama.cpp's release workflow produces at the pinned tag.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { test } from "node:test";
import { DEFAULTS } from "../src/bench/backends/config.ts";
import { LlamaServer, parseStrays, tasklistKiB } from "../src/bench/backends/local.ts";
import { findCommand, pathKey, prependPath, runCli, spawnFor } from "../src/bench/backends/proc.ts";
import { budgetMiB, fitContext, fitsCap, measureContext } from "../src/bench/setup/fit.ts";
import {
  assetFor,
  backendWorks,
  candidates,
  firstWorking,
  type Hardware,
  parseDevices,
  parseNvidiaSmi,
  parseVideoControllers,
  vendorOf,
} from "../src/bench/setup/hardware.ts";
import {
  downloadVerified,
  extract,
  findFile,
  modelFile,
  releaseAssets,
  resolveModelPath,
} from "../src/bench/setup/install.ts";

const TAG = "b11923";
const ASSETS = [
  ...[
    "cpu-x64",
    "cpu-arm64",
    "vulkan-x64",
    "vulkan-arm64",
    "opencl-adreno-arm64",
    "cuda-12.4-x64",
    "cuda-13.4-x64",
    "cuda-13.4-arm64",
    "rocm-10.0-x64",
    "sycl-x64",
    "openvino-2026.4.1-x64",
  ].map((s) => `llama-${TAG}-bin-win-${s}.zip`),
  ...["12.4-x64", "13.4-x64", "13.4-arm64"].map((s) => `cudart-llama-bin-win-cuda-${s}.zip`),
  `llama-${TAG}-bin-macos-arm64.tar.gz`,
  `llama-${TAG}-bin-macos-x64.tar.gz`,
  ...[
    "x64",
    "arm64",
    "s390x",
    "vulkan-x64",
    "vulkan-arm64",
    "cuda-12.8-x64",
    "cuda-13.4-x64",
    "rocm-10.0-x64",
    "sycl-fp16-x64",
  ].map((s) => `llama-${TAG}-bin-ubuntu-${s}.tar.gz`),
  ...["12.8-x64", "13.4-x64"].map((s) => `cudart-llama-${TAG}-bin-ubuntu-cuda-${s}.tar.gz`),
  `llama-${TAG}-bin-linux-arm64-snapdragon.tar.gz`,
  `llama-${TAG}-xcframework.zip`,
  `llama-${TAG}-ui.tar.gz`,
];

const hw = (o: Partial<Hardware>): Hardware => ({
  os: "linux",
  arch: "x64",
  gpus: [],
  cudaDriver: null,
  rocm: false,
  vulkan: true,
  ...o,
});
const order = (h: Hardware) => candidates(h).map((c) => c.backend);
const asset = (b: Parameters<typeof assetFor>[0], h: Hardware) => assetFor(b, h, TAG, ASSETS);
const nv = { vendor: "nvidia" as const, name: "NVIDIA GeForce RTX 4070" };
const amd = { vendor: "amd" as const, name: "AMD Radeon RX 7800 XT" };

test("[+RX-1/bench-setup] each machine gets the build for its hardware, best first, with CPU always last", () => {
  assert.deepEqual(order(hw({ os: "darwin", arch: "arm64" })), ["metal", "cpu"]);
  assert.equal(asset("metal", hw({ os: "darwin", arch: "arm64" }))?.main, `llama-${TAG}-bin-macos-arm64.tar.gz`);
  const winNv = hw({ os: "win32", gpus: [nv], cudaDriver: [13, 5] });
  assert.deepEqual(order(winNv), ["cuda", "vulkan", "cpu"]);
  assert.deepEqual(asset("cuda", winNv), {
    main: `llama-${TAG}-bin-win-cuda-13.4-x64.zip`,
    extra: ["cudart-llama-bin-win-cuda-13.4-x64.zip"],
  });
  assert.equal(asset("cuda", { ...winNv, cudaDriver: [12, 6] })?.main, `llama-${TAG}-bin-win-cuda-12.4-x64.zip`);
  const linNv = hw({ gpus: [nv], cudaDriver: [12, 9] });
  assert.deepEqual(asset("cuda", linNv), {
    main: `llama-${TAG}-bin-ubuntu-cuda-12.8-x64.tar.gz`,
    extra: [`cudart-llama-${TAG}-bin-ubuntu-cuda-12.8-x64.tar.gz`],
  });
  const winAmd = hw({ os: "win32", gpus: [amd] });
  assert.deepEqual(order(winAmd), ["rocm", "vulkan", "cpu"]);
  assert.equal(asset("rocm", winAmd)?.main, `llama-${TAG}-bin-win-rocm-10.0-x64.zip`);
  assert.deepEqual(order(hw({ gpus: [amd] })), ["vulkan", "cpu"], "Linux AMD without ROCm: Vulkan");
  assert.deepEqual(order(hw({ gpus: [amd], rocm: true })), ["rocm", "vulkan", "cpu"]);
  assert.deepEqual(order(hw({ gpus: [{ vendor: "intel", name: "Intel Arc A770" }] })), ["vulkan", "cpu"]);
  const snap = hw({ os: "win32", arch: "arm64", gpus: [{ vendor: "qualcomm", name: "Qualcomm Adreno X1-85" }] });
  assert.deepEqual(order(snap), ["opencl-adreno", "vulkan", "cpu"]);
  assert.equal(asset("opencl-adreno", snap)?.main, `llama-${TAG}-bin-win-opencl-adreno-arm64.zip`);
  assert.equal(asset("cpu", snap)?.main, `llama-${TAG}-bin-win-cpu-arm64.zip`);
  assert.equal(asset("cpu", hw({}))?.main, `llama-${TAG}-bin-ubuntu-x64.tar.gz`);
  assert.equal(asset("vulkan", hw({ arch: "arm64" }))?.main, `llama-${TAG}-bin-ubuntu-vulkan-arm64.tar.gz`);
  assert.deepEqual(order(hw({ gpus: [amd, nv], cudaDriver: [13, 4] })), ["cuda", "vulkan", "cpu"], "NVIDIA first");

  assert.deepEqual(parseNvidiaSmi("| NVIDIA-SMI 580.10   Driver Version: 580.10   CUDA Version: 13.0 |"), [13, 0]);
  assert.deepEqual(
    parseVideoControllers(
      "NVIDIA GeForce RTX 4070\r\nMicrosoft Basic Display Adapter\r\nIntel(R) UHD Graphics 770\r\n",
    ),
    [nv, { vendor: "intel", name: "Intel(R) UHD Graphics 770" }],
  );
  assert.deepEqual(["0x10de", "0x1002", "0x8086", "0x5143"].map(vendorOf), ["nvidia", "amd", "intel", "qualcomm"]);
  const devices = parseDevices(
    "Available devices:\n  CUDA0: NVIDIA GeForce RTX 4070 (12281 MiB, 11000 MiB free)\n  Vulkan0: AMD Radeon (8176 MiB, 8000 MiB free)\n",
  );
  assert.deepEqual(devices[0], {
    name: "CUDA0",
    description: "NVIDIA GeForce RTX 4070",
    totalMiB: 12281,
    freeMiB: 11000,
  });
  assert.ok(backendWorks("cuda", devices) && backendWorks("vulkan", devices) && backendWorks("cpu", []));
  assert.equal(tasklistKiB('"llama-server.exe","4242","Console","1","3.456.789 K"'), 3456789);
  assert.equal(tasklistKiB('"llama-server.exe","4242","Console","1","1,234 K"\r\n'), 1234);
});

test("[-RX-1/bench-setup] no build newer than the driver, no Vulkan without a loader, a build that fails falls back, a bad download is deleted", async () => {
  const old = hw({ os: "win32", gpus: [nv], cudaDriver: [11, 8] });
  assert.equal(asset("cuda", old), null, "a CUDA 11.8 driver cannot run a 12.4 build");
  assert.deepEqual(order(hw({ gpus: [nv] })), ["vulkan", "cpu"], "NVIDIA with no CUDA version: Vulkan");
  assert.deepEqual(order(hw({ gpus: [amd], vulkan: false })), ["cpu"], "no Vulkan loader: Vulkan is not tried");
  assert.deepEqual(order(hw({ gpus: [], vulkan: false })), ["cpu"]);
  assert.equal(asset("rocm", hw({ arch: "arm64", gpus: [amd], rocm: true })), null, "no ROCm build for Linux arm64");
  assert.equal(assetFor("metal", hw({ os: "darwin", arch: "arm64" }), TAG, []), null);
  assert.ok(!backendWorks("cuda", parseDevices("Available devices:\n  (none)\n")), "started, but no GPU: not working");

  const tried: string[] = [];
  const r = await firstWorking(
    order(hw({ gpus: [nv], cudaDriver: [13, 4] })).map((backend) => ({ backend, why: "" })),
    async (c) => {
      tried.push(c.backend);
      if (c.backend !== "cpu") throw new Error(`${c.backend} failed`);
      return "ok";
    },
  );
  assert.deepEqual(
    [tried, r.chosen.backend, r.failures.map((f) => f.backend)],
    [["cuda", "vulkan", "cpu"], "cpu", ["cuda", "vulkan"]],
  );
  await assert.rejects(
    firstWorking([{ backend: "cpu", why: "" }], async () => {
      throw new Error("no");
    }),
    /no llama.cpp build worked on this machine: cpu: no/,
  );

  const dir = mkdtempSync(join(tmpdir(), "reax-setup-"));
  const body = Buffer.from("llama build bytes");
  const sha = createHash("sha256").update(body).digest("hex");
  const server = createServer((req, res) => {
    if (req.url === "/repos/ggml-org/llama.cpp/releases/tags/b11923") {
      res.end(
        JSON.stringify({
          assets: [
            { name: "a.zip", browser_download_url: `${base}/a.zip`, digest: `sha256:${sha}`, size: body.length },
          ],
        }),
      );
    } else if (req.url === "/api/models/o/r/tree/main") {
      res.end(
        JSON.stringify([{ path: "README.md" }, { path: "m-Q4_K_M.gguf", size: 17, lfs: { oid: sha, size: 17 } }]),
      );
    } else if (req.url === "/a.zip" || req.url === "/o/r/resolve/main/m-Q4_K_M.gguf") res.end(body);
    else res.writeHead(404).end();
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const ep = { githubApi: base, huggingFace: base };
    const [a] = await releaseAssets("b11923", ep);
    assert.deepEqual(a, { name: "a.zip", url: `${base}/a.zip`, sha256: sha, size: body.length });
    assert.equal(await downloadVerified(a!, join(dir, "a.zip")), sha);
    const m = await modelFile("o/r", /Q4_K_M\.gguf$/, ep);
    assert.deepEqual([m?.name, m?.sha256], ["m-Q4_K_M.gguf", sha]);
    await assert.rejects(
      downloadVerified({ ...a!, sha256: "0".repeat(64) }, join(dir, "bad.zip")),
      /does not match the published/,
    );
    assert.ok(
      !existsSync(join(dir, "bad.zip")) && !existsSync(join(dir, "bad.zip.part")),
      "the bad download is deleted",
    );
    assert.equal(
      await downloadVerified({ ...a!, sha256: null }, join(dir, "tofu.zip")),
      sha,
      "no published digest: pinned on first use",
    );
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("[+RX-1/bench-setup] an archive unpacks with the system tar on every OS and its llama-server is found", () => {
  const dir = mkdtempSync(join(tmpdir(), "reax-tar-"));
  try {
    mkdirSync(join(dir, "src", "llama-b11923"), { recursive: true });
    writeFileSync(join(dir, "src", "llama-b11923", "llama-server"), "x");
    const tar =
      process.platform === "win32" ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar";
    execFileSync(tar, ["-czf", join(dir, "a.tar.gz"), "-C", join(dir, "src"), "llama-b11923"]);
    extract(join(dir, "a.tar.gz"), join(dir, "out"));
    assert.equal(findFile(join(dir, "out"), "llama-server"), join(dir, "out", "llama-b11923", "llama-server"));
    assert.equal(findFile(join(dir, "out"), "llama-server.exe"), null);
    assert.throws(() => extract(join(dir, "missing.tar.gz"), join(dir, "out2")), /could not unpack/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** A command named `echo-prompt` installed the way npm installs a CLI on this OS. */
function installEchoCommand(dir: string): void {
  const script = join(dir, "node_modules", "echo-prompt", "bin", "echo.js");
  mkdirSync(join(script, ".."), { recursive: true });
  writeFileSync(
    script,
    'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.stringify({args:process.argv.slice(2),stdin:s})));\n',
  );
  if (process.platform === "win32")
    writeFileSync(
      join(dir, "echo-prompt.cmd"),
      [
        "@ECHO off",
        "GOTO start",
        ":find_dp0",
        "SET dp0=%~dp0",
        "EXIT /b",
        ":start",
        "SETLOCAL",
        "CALL :find_dp0",
        "",
        'IF EXIST "%dp0%\\node.exe" (',
        '  SET "_prog=%dp0%\\node.exe"',
        ") ELSE (",
        '  SET "_prog=node"',
        "  SET PATHEXT=%PATHEXT:;.JS;=;%",
        ")",
        "",
        'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\echo-prompt\\bin\\echo.js" %*',
        "",
      ].join("\r\n"),
    );
  else {
    writeFileSync(join(dir, "echo-prompt"), `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`);
    chmodSync(join(dir, "echo-prompt"), 0o755);
  }
}

test("[+RX-1/bench-process] a CLI installed by npm starts on this OS with no shell, and a prompt with quotes, newlines and shell characters arrives intact on stdin", async () => {
  const dir = mkdtempSync(join(tmpdir(), "reax-proc-"));
  try {
    installEchoCommand(dir);
    const env = prependPath(process.env, dir);
    assert.equal(Object.keys(env).filter((k) => k.toUpperCase() === "PATH").length, 1, "one PATH key, not two");
    assert.ok(env[pathKey(env)]!.startsWith(`${dir}${delimiter}`));
    if (process.platform === "win32") {
      assert.match(findCommand("echo-prompt", env), /echo-prompt\.cmd$/i);
      const s = spawnFor(["echo-prompt", "x"], env);
      assert.match(s.file, /node(\.exe)?$/i, "the npm shim is run as node <script>, not through cmd.exe");
    }
    const prompt = `Say "hi" & echo %PATH% | ^caret $HOME \`tick\`\nsecond line ü\n`;
    const r = await runCli(["echo-prompt", "--flag", "a value"], {
      cwd: dir,
      env,
      deadline: Date.now() + 30_000,
      input: prompt,
    });
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout), { args: ["--flag", "a value"], stdin: prompt });
    // the same resolution on the off-platform branch: PATHEXT search finds the .cmd
    writeFileSync(join(dir, "tool.cmd"), "@echo off\r\n");
    assert.equal(findCommand("tool", { Path: dir, PATHEXT: ".EXE;.CMD" }, "win32"), join(dir, "tool.cmd"));
    assert.equal(findCommand("tool", { PATH: dir }, "linux"), "tool", "elsewhere the OS finds it");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("[-RX-1/bench-process] a missing CLI is an error result, not a crash, and the deadline ends the whole process tree", async () => {
  const missing = await runCli(["reax-no-such-cli"], {
    cwd: tmpdir(),
    env: process.env,
    deadline: Date.now() + 10_000,
  });
  assert.equal(missing.code, null);
  assert.match(missing.stderr, /ENOENT|not found|not recognized/i);
  const parent = `const c=require("child_process").spawn(process.execPath,["-e","setTimeout(()=>{},60000)"],{stdio:"ignore"});console.log(c.pid);setTimeout(()=>{},60000);`;
  const r = await runCli([process.execPath, "-e", parent], {
    cwd: tmpdir(),
    env: process.env,
    deadline: Date.now() + 1500,
  });
  assert.equal(r.timedOut, true);
  const grandchild = Number(r.stdout.trim());
  assert.ok(grandchild > 0, r.stdout);
  let alive = true;
  for (let i = 0; i < 50 && alive; i++) {
    try {
      process.kill(grandchild, 0);
      await new Promise((ok) => setTimeout(ok, 100));
    } catch {
      alive = false;
    }
  }
  assert.equal(alive, false, "the CLI's own child was ended too");
  assert.equal(
    readFileSync(join(import.meta.dirname, "..", ".gitignore"), "utf8").includes("bench/backends.json"),
    true,
  );
});

test("[+RX-1/bench-setup] setup end to end against a fake release: GPU builds that find no device fall back to CPU, the model is verified, backends.json is written", {
  skip: process.platform === "win32" && "the fake release's llama-server is a POSIX script; Windows wants an .exe",
}, async () => {
  const dir = mkdtempSync(join(tmpdir(), "reax-setup-e2e-"));
  const src = join(dir, "src", "llama-b11923");
  mkdirSync(src, { recursive: true });
  const stub = join(import.meta.dirname, "fixtures", "stub-llama.mjs");
  writeFileSync(join(src, "llama-server"), `#!/bin/sh\nexec "${process.execPath}" "${stub}" "$@"\n`);
  chmodSync(join(src, "llama-server"), 0o755);
  const tarball = join(dir, "build.tar.gz");
  execFileSync("tar", ["-czf", tarball, "-C", join(dir, "src"), "llama-b11923"]);
  const build = readFileSync(tarball);
  const model = Buffer.from("GGUF stand-in");
  const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
  const names = ASSETS.filter((n) => n.endsWith(".tar.gz"));
  const server = createServer((req, res) => {
    if (req.url === "/repos/ggml-org/llama.cpp/releases/tags/b11923")
      return res.end(
        JSON.stringify({
          assets: names.map((n) => ({
            name: n,
            browser_download_url: `${base}/dl/${n}`,
            digest: `sha256:${sha(build)}`,
          })),
        }),
      );
    if (req.url === "/api/models/Qwen/Qwen3-4B-Instruct-2507-GGUF/tree/main")
      return res.end(
        JSON.stringify([{ path: "Qwen3-4B-Instruct-2507-Q4_K_M.gguf", lfs: { oid: sha(model), size: model.length } }]),
      );
    if (req.url?.startsWith("/dl/")) return res.end(build);
    if (req.url === "/Qwen/Qwen3-4B-Instruct-2507-GGUF/resolve/main/Qwen3-4B-Instruct-2507-Q4_K_M.gguf")
      return res.end(model);
    res.writeHead(404).end();
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const config = join(dir, "backends.json");
  writeFileSync(
    config,
    JSON.stringify({ local: { port: 21000 + Math.floor(Math.random() * 2000) }, codex: { model: "kept" } }),
  );
  try {
    const r = await runCli(
      [
        process.execPath,
        "--conditions=source",
        "--disable-warning=ExperimentalWarning",
        join(import.meta.dirname, "..", "bench", "setup.ts"),
        "--mem-cap-mib",
        "4096",
      ],
      {
        cwd: dir,
        env: {
          ...process.env,
          REAX_SETUP_GITHUB_API: base,
          REAX_SETUP_HF: base,
          REAX_CACHE: join(dir, "cache"),
          REAX_BENCH_CONFIG: config,
        },
        deadline: Date.now() + 120_000,
      },
    );
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const written = JSON.parse(readFileSync(config, "utf8"));
    assert.equal(written.local.backend, "cpu");
    assert.equal(written.local.gpuLayers, 0);
    assert.equal(written.local.modelSha256, sha(model));
    assert.ok(existsSync(written.local.server[0]), "the unpacked llama-server");
    assert.equal(written.codex.model, "kept", "other settings are kept");
    assert.equal(written.provenance.llamaTag, "b11923");
    assert.equal(written.local.ctx, 16384, "the stub's memory fits the cap at the largest context");
    assert.equal(written.provenance.fit.trials[0].fits, true);
    if (process.platform === "darwin")
      assert.match(r.stdout, /metal did not work: it started but found no metal device/);
    assert.match(r.stdout, /using cpu on CPU; llama.cpp allocated 3300 MiB of the 4096 MiB cap/);
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

const stubLocal = (over: Partial<typeof DEFAULTS.local> = {}) => ({
  ...DEFAULTS.local,
  server: [process.execPath, join(import.meta.dirname, "fixtures", "stub-llama.mjs")],
  model: "stub.gguf",
  port: 23000 + Math.floor(Math.random() * 2000),
  ...over,
});

test("[+RX-1/bench-fit] the context is the largest whose measured peak resident memory, with the context filled, fits the cap", async () => {
  const peaks: Record<number, number> = { 16384: 4213, 12288: 3900, 8192: 3600, 6144: 3400 };
  const tried: number[] = [];
  const r = await fitContext(async (ctx) => {
    tried.push(ctx);
    return { ctx, peak_rss_mib: peaks[ctx]!, allocated_mib: 3300, filled_tokens: ctx * 0.9, error: null };
  }, 4096);
  assert.equal(budgetMiB(4096), 3891);
  assert.deepEqual(
    [r.ctx, tried],
    [8192, [16384, 12288, 8192]],
    "4213 (the Mac run's peak) and 3900 are over 3891; it stops at the first fit",
  );
  // real resident memory: the stub holds 30 MiB per 1000 tokens of context once it is filled
  process.env.STUB_MODEL_MIB = "100";
  process.env.STUB_KV_MIB = "50";
  process.env.STUB_COMPUTE_MIB = "10";
  process.env.STUB_MIB_PER_KTOK = "30";
  try {
    const local = stubLocal({ memCapMiB: 400 });
    const fit = await fitContext((ctx) => measureContext({ ...local, port: local.port + ctx / 1024 }, ctx), 400);
    assert.equal(fit.ctx, 8192, JSON.stringify(fit.trials));
    assert.ok(fit.trials[0]!.peak_rss_mib > 380, "16384 really took more than the budget");
    assert.ok(fit.trials.at(-1)!.filled_tokens > 8192 * 0.8, "the context was really filled");
    assert.equal(fit.trials.at(-1)!.allocated_mib, 160);
  } finally {
    for (const k of ["STUB_MODEL_MIB", "STUB_KV_MIB", "STUB_COMPUTE_MIB", "STUB_MIB_PER_KTOK"]) delete process.env[k];
  }
});

test("[-RX-1/bench-fit] nothing fits when even the smallest context is over the cap, and a failed or over-reported trial never fits", async () => {
  const r = await fitContext(
    async (ctx) => ({ ctx, peak_rss_mib: 5000, allocated_mib: 4000, filled_tokens: 0, error: null }),
    4096,
  );
  assert.equal(r.ctx, null);
  assert.equal(r.trials.length, 4, "every size was tried and kept for the report");
  assert.ok(!fitsCap({ ctx: 1, peak_rss_mib: 10, allocated_mib: 10, filled_tokens: 0, error: "HTTP 500" }, 4096));
  assert.ok(
    !fitsCap({ ctx: 1, peak_rss_mib: 10, allocated_mib: 3900, filled_tokens: 0, error: null }, 4096),
    "llama.cpp's own report counts too (GPU memory is not resident)",
  );
  const dead = await measureContext(stubLocal({ server: [process.execPath, "-e", "process.exit(4)"] }), 6144);
  assert.match(dead.error ?? "", /llama-server exited \d+|did not become healthy/);
});

test("[+RX-1/bench-close] a closed server has exited and its port is free; one that ignores SIGTERM is ended by SIGKILL", async () => {
  const s = new LlamaServer(stubLocal({ memCapMiB: 4096 }));
  await s.start(20_000);
  const pid = s.child!.pid!;
  const c = await s.close();
  assert.deepEqual([c.confirmed, c.graceful], [true, true]);
  assert.throws(() => process.kill(pid, 0), "the process is gone");
  assert.equal(s.child, null);
  process.env.STUB_IGNORE_TERM = "1";
  try {
    const stubborn = new LlamaServer(stubLocal({ memCapMiB: 4096 }));
    await stubborn.start(20_000);
    const k = await stubborn.close(500);
    assert.equal(k.confirmed, true);
    if (process.platform !== "win32") assert.equal(k.graceful, false, "SIGTERM was ignored, so SIGKILL ended it");
  } finally {
    delete process.env.STUB_IGNORE_TERM;
  }
  const ps = [
    "  101 /Users/x/.cache/reax/llama.cpp/b11923/metal/llama-b11923/llama-server -m m.gguf --port 8089",
    "  102 /bin/zsh",
    "  103 vim llama-server.md",
    "  104 /opt/homebrew/bin/llama-server -m /Users/x/Models/Qwen3.5-9B-Q4_K_M.gguf --port 8080",
    "  105 /usr/local/bin/llama-server -m x.gguf --port 8096",
  ].join("\n");
  assert.deepEqual(
    parseStrays(ps, "darwin", [8089, 8096]).map((x) => [x.pid, x.bench]),
    [
      [101, true],
      [104, false],
      [105, true],
    ],
    "the bench's cache or port marks a bench server; your own server on 8080 is yours",
  );
  assert.deepEqual(parseStrays('"llama-server.exe","4242","Console","1","3,456 K"\r\n', "win32"), [
    { pid: 4242, command: "llama-server.exe", bench: null },
  ]);
});

test("[-RX-1/bench-close] an interrupted harness (SIGINT) closes its servers before it exits", {
  skip:
    process.platform === "win32" &&
    "Windows has no SIGINT to send; Ctrl-C reaches the whole console group, llama-server included",
}, async () => {
  const script = `
    import { LlamaServer } from ${JSON.stringify(join(import.meta.dirname, "..", "src", "bench", "backends", "local.ts"))};
    const s = new LlamaServer(${JSON.stringify(stubLocal({ memCapMiB: 4096 }))});
    await s.start(20000);
    console.log(s.child.pid);
    setInterval(() => {}, 1000);
  `;
  const { spawn } = await import("node:child_process");
  const child = spawn(process.execPath, ["--conditions=source", "--input-type=module", "-e", script], {
    stdio: ["ignore", "pipe", "inherit"],
  });
  const pid = await new Promise<number>((ok) => child.stdout.once("data", (d: Buffer) => ok(Number(String(d).trim()))));
  assert.ok(pid > 0);
  child.kill("SIGINT");
  const code = await new Promise<number | null>((ok) => child.once("exit", (c) => ok(c)));
  assert.equal(code, 130);
  assert.throws(() => process.kill(pid, 0), "the harness closed its llama-server on SIGINT");
});

test("[+RX-1/bench-setup] your own model: a file, a path without .gguf, or a folder with its vision projector and split shards", () => {
  const d = mkdtempSync(join(tmpdir(), "reax-model-"));
  try {
    const one = join(d, "Qwen3.5-9B-Q4_K_M");
    mkdirSync(one);
    writeFileSync(join(one, "Qwen3.5-9B-Q4_K_M.gguf"), "x");
    writeFileSync(join(one, "mmproj-Qwen3.5-9B-F16.gguf"), "x");
    writeFileSync(join(one, "README.md"), "x");
    assert.equal(resolveModelPath(one), join(one, "Qwen3.5-9B-Q4_K_M.gguf"), "the projector is not the model");
    assert.equal(resolveModelPath(join(one, "Qwen3.5-9B-Q4_K_M.gguf")), join(one, "Qwen3.5-9B-Q4_K_M.gguf"));
    writeFileSync(join(d, "solo.gguf"), "x");
    assert.equal(resolveModelPath(join(d, "solo")), join(d, "solo.gguf"));
    const split = join(d, "split");
    mkdirSync(split);
    for (const n of ["00002", "00001", "00003"]) writeFileSync(join(split, `big-Q4_K_M-${n}-of-00003.gguf`), "x");
    assert.equal(resolveModelPath(split), join(split, "big-Q4_K_M-00001-of-00003.gguf"));
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("[-RX-1/bench-setup] a model folder that is empty, holds two models or does not exist is refused", () => {
  const d = mkdtempSync(join(tmpdir(), "reax-model-"));
  try {
    assert.throws(() => resolveModelPath(join(d, "missing")), /no model at/);
    assert.throws(() => resolveModelPath(d), /holds no .gguf model file/);
    writeFileSync(join(d, "a-Q4_K_M.gguf"), "x");
    writeFileSync(join(d, "b-Q5_K_M.gguf"), "x");
    assert.throws(() => resolveModelPath(d), /more than one model \(a-Q4_K_M.gguf, b-Q5_K_M.gguf\)/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
