// Which llama.cpp build to run on this machine, decided from what the machine reports. Pure
// functions over probe output, so every branch is tested on every CI lane; bench/setup.ts runs
// the real probes and installs the result.
//
// The builds are llama.cpp's own release assets at one pinned tag. Their names come from that
// tag's .github/workflows/release.yml and release-publish.yml: each Windows GPU zip is the CPU
// toolset with that backend's library added; Linux builds are Ubuntu 22.04 tarballs; macOS
// tarballs carry Metal.

export type Os = "darwin" | "linux" | "win32";
export type Vendor = "nvidia" | "amd" | "intel" | "apple" | "qualcomm" | "other";
export type BackendId = "metal" | "cuda" | "rocm" | "vulkan" | "opencl-adreno" | "sycl" | "cpu";
export const BACKENDS: BackendId[] = ["metal", "cuda", "rocm", "vulkan", "opencl-adreno", "sycl", "cpu"];

export interface Gpu {
  vendor: Vendor;
  name: string;
}

export interface Hardware {
  os: Os;
  arch: string;
  gpus: Gpu[];
  /** Highest CUDA version the NVIDIA driver supports (from nvidia-smi), or null. */
  cudaDriver: [number, number] | null;
  /** A ROCm runtime is installed (Linux: rocminfo found). */
  rocm: boolean;
  /** A Vulkan loader is installed. */
  vulkan: boolean;
}

export interface Candidate {
  backend: BackendId;
  why: string;
}

/** A vendor from a PCI vendor id (Linux sysfs) or a device name (Windows, macOS). */
export function vendorOf(idOrName: string): Vendor {
  const s = idOrName.trim().toLowerCase();
  if (s === "0x10de" || /nvidia|geforce|quadro|rtx|tesla/.test(s)) return "nvidia";
  if (s === "0x1002" || /\bamd\b|radeon|\bati\b/.test(s)) return "amd";
  if (s === "0x8086" || /intel|\barc\b|iris/.test(s)) return "intel";
  if (s === "0x5143" || /qualcomm|adreno|snapdragon/.test(s)) return "qualcomm";
  if (s === "0x106b" || /apple/.test(s)) return "apple";
  return "other";
}

/** The "CUDA Version: 12.4" in nvidia-smi's header. */
export function parseNvidiaSmi(text: string): [number, number] | null {
  const m = /CUDA Version:\s*(\d+)\.(\d+)/.exec(text);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

/** One adapter name per line, as `Get-CimInstance Win32_VideoController` prints `Name`. */
export function parseVideoControllers(text: string): Gpu[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/basic display|remote display|virtual|parsec|mirage/i.test(l))
    .map((name) => ({ vendor: vendorOf(name), name }));
}

export interface Device {
  name: string;
  description: string;
  totalMiB: number;
  freeMiB: number;
}

/** `llama-server --list-devices`: "  CUDA0: NVIDIA GeForce RTX 4070 (12281 MiB, 11000 MiB free)". */
export function parseDevices(text: string): Device[] {
  const out: Device[] = [];
  for (const m of text.matchAll(/^\s+([\w.-]+): (.*) \((\d+) MiB, (\d+) MiB free\)\s*$/gm))
    out.push({ name: m[1]!, description: m[2]!, totalMiB: Number(m[3]), freeMiB: Number(m[4]) });
  return out;
}

const RANK: Vendor[] = ["nvidia", "amd", "apple", "intel", "qualcomm", "other"];

/** The builds to try, best first; CPU is always last, so a working build always exists. */
export function candidates(hw: Hardware): Candidate[] {
  const out: Candidate[] = [];
  const add = (backend: BackendId, why: string) => {
    if (!out.some((c) => c.backend === backend)) out.push({ backend, why });
  };
  if (hw.os === "darwin") {
    add(
      "metal",
      hw.arch === "arm64" ? "Apple Silicon: Metal" : "Intel Mac: the macOS build (Metal where the GPU supports it)",
    );
    add("cpu", "fallback: the same build with no layers on the GPU");
    return out;
  }
  const vendors = [...new Set(hw.gpus.map((g) => g.vendor))].sort((a, b) => RANK.indexOf(a) - RANK.indexOf(b));
  for (const v of vendors) {
    if (v === "nvidia") {
      if (hw.cudaDriver) add("cuda", `NVIDIA GPU, driver supports CUDA ${hw.cudaDriver.join(".")}`);
      add(
        "vulkan",
        hw.cudaDriver
          ? "NVIDIA GPU: Vulkan if CUDA does not start"
          : "NVIDIA GPU, but nvidia-smi gave no CUDA version: Vulkan",
      );
    }
    if (v === "amd") {
      if (hw.os === "win32" && hw.arch === "x64") add("rocm", "AMD GPU: the HIP (ROCm) build for Windows");
      if (hw.os === "linux" && hw.rocm) add("rocm", "AMD GPU with ROCm installed");
      add("vulkan", "AMD GPU: Vulkan (needs no ROCm)");
    }
    if (v === "intel") add("vulkan", "Intel GPU: Vulkan (SYCL only with --backend sycl; it needs the oneAPI runtime)");
    if (v === "qualcomm" && hw.os === "win32" && hw.arch === "arm64") {
      add("opencl-adreno", "Snapdragon: the Adreno OpenCL build");
      add("vulkan", "Snapdragon: Vulkan");
    }
    if (v === "other" && hw.vulkan) add("vulkan", "GPU of another vendor: Vulkan");
  }
  if (!out.length && hw.vulkan) add("vulkan", "a Vulkan loader is installed");
  add("cpu", "fallback: CPU only (always available)");
  // Vulkan needs a loader; with none installed it cannot start, so it is not tried.
  return out.filter((c) => c.backend !== "vulkan" || hw.vulkan);
}

export interface AssetChoice {
  /** The archive holding llama-server. */
  main: string;
  /** Archives to extract next to it (the CUDA runtime). */
  extra: string[];
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const ver = (s: string) => s.split(".").map(Number) as [number, number];
const le = (a: [number, number], b: [number, number]) => a[0] < b[0] || (a[0] === b[0] && a[1] <= b[1]);

/**
 * The release asset(s) for a backend on this machine, or null when the release has none. CUDA
 * takes the newest build the driver supports, never one newer than the driver.
 */
export function assetFor(backend: BackendId, hw: Hardware, tag: string, names: string[]): AssetChoice | null {
  const arch = hw.arch === "arm64" ? "arm64" : "x64";
  const t = esc(tag);
  const pick = (re: RegExp) => names.filter((n) => re.test(n));
  if (hw.os === "darwin") {
    const m = pick(new RegExp(`^llama-${t}-bin-macos-${arch}\\.tar\\.gz$`));
    return m[0] ? { main: m[0], extra: [] } : null;
  }
  const win = hw.os === "win32";
  const archive = win ? "zip" : "tar\\.gz";
  const prefix = win ? `llama-${t}-bin-win` : `llama-${t}-bin-ubuntu`;
  if (backend === "cuda") {
    if (!hw.cudaDriver) return null;
    const re = new RegExp(`^${prefix}-cuda-(\\d+\\.\\d+)-${arch}\\.${archive}$`);
    const builds = names
      .map((n) => ({ n, v: re.exec(n)?.[1] }))
      .filter((x): x is { n: string; v: string } => !!x.v && le(ver(x.v), hw.cudaDriver!))
      .sort((a, b) => (le(ver(a.v), ver(b.v)) ? 1 : -1));
    const best = builds[0];
    if (!best) return null;
    const rt = win
      ? pick(new RegExp(`^cudart-llama-bin-win-cuda-${esc(best.v)}-${arch}\\.zip$`))
      : pick(new RegExp(`^cudart-llama-${t}-bin-ubuntu-cuda-${esc(best.v)}-${arch}\\.tar\\.gz$`));
    return { main: best.n, extra: rt.slice(0, 1) };
  }
  const seg: Record<BackendId, string | null> = {
    metal: null,
    cuda: null,
    rocm: "-rocm-\\d+\\.\\d+",
    vulkan: "-vulkan",
    "opencl-adreno": "-opencl-adreno",
    sycl: win ? "-sycl" : "-sycl-\\w+",
    cpu: win ? "-cpu" : "",
  };
  const s = seg[backend];
  if (s === null) return null;
  const m = pick(new RegExp(`^${prefix}${s}-${arch}\\.${archive}$`));
  return m[0] ? { main: m[0], extra: [] } : null;
}

/** Whether a build that started is really using the hardware it was chosen for. */
export function backendWorks(backend: BackendId, devices: Device[]): boolean {
  if (backend === "cpu") return true;
  const prefix: Record<BackendId, RegExp> = {
    metal: /^MTL/i,
    cuda: /^CUDA/i,
    rocm: /^(ROCm|HIP)/i,
    vulkan: /^Vulkan/i,
    "opencl-adreno": /OpenCL/i,
    sycl: /^SYCL/i,
    cpu: /./,
  };
  return devices.some((d) => prefix[backend].test(d.name));
}

/** Try candidates in order; the first that works wins, and every failure is kept to report. */
export async function firstWorking<T>(
  list: Candidate[],
  attempt: (c: Candidate) => Promise<T>,
): Promise<{ chosen: Candidate; result: T; failures: { backend: BackendId; error: string }[] }> {
  const failures: { backend: BackendId; error: string }[] = [];
  for (const c of list) {
    try {
      return { chosen: c, result: await attempt(c), failures };
    } catch (e) {
      failures.push({ backend: c.backend, error: (e as Error).message });
    }
  }
  throw new Error(
    `no llama.cpp build worked on this machine: ${failures.map((f) => `${f.backend}: ${f.error}`).join("; ")}`,
  );
}
