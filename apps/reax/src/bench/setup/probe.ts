// The real hardware probes: read-only OS queries (sysfs, nvidia-smi, rocminfo, the Windows video
// controller list, the Vulkan loader's presence). Anything that fails or is missing reads as
// "not there", never as an error, so detection always ends in at least the CPU build.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { arch, platform } from "node:os";
import { join } from "node:path";
import {
  windowsPowerShellPath,
  windowsSystem32Binary,
} from "@re4exa/core/vendor/orca-process-host/windows-system-binary";
import { runCliSync } from "../backends/proc.ts";
import { type Gpu, type Hardware, type Os, parseNvidiaSmi, parseVideoControllers, vendorOf } from "./hardware.ts";

const run = (argv: string[]) => {
  const r = runCliSync(argv, { timeoutMs: 20_000 });
  return r.ok ? r.out : null;
};

function linuxGpus(): Gpu[] {
  const out: Gpu[] = [];
  try {
    for (const card of readdirSync("/sys/class/drm").filter((c) => /^card\d+$/.test(c))) {
      const dev = join("/sys/class/drm", card, "device");
      const id = existsSync(join(dev, "vendor")) ? readFileSync(join(dev, "vendor"), "utf8").trim() : "";
      if (id) out.push({ vendor: vendorOf(id), name: `${card} (PCI vendor ${id})` });
    }
  } catch {
    // no DRM devices: a server or a container
  }
  return out;
}

function linuxVulkan(): boolean {
  const ld = run(["ldconfig", "-p"]);
  if (ld?.includes("libvulkan.so.1")) return true;
  return ["/usr/lib/x86_64-linux-gnu", "/usr/lib/aarch64-linux-gnu", "/usr/lib64", "/usr/lib"].some((d) =>
    existsSync(join(d, "libvulkan.so.1")),
  );
}

export function probeHardware(): Hardware {
  const os = platform() as Os;
  const a = arch();
  if (os === "darwin")
    return {
      os,
      arch: a,
      gpus: a === "arm64" ? [{ vendor: "apple", name: "Apple Silicon GPU" }] : [],
      cudaDriver: null,
      rocm: false,
      vulkan: false,
    };
  const smi = run(["nvidia-smi"]);
  if (os === "win32") {
    const names = run([
      windowsPowerShellPath(),
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "Get-CimInstance Win32_VideoController | ForEach-Object { $_.Name }",
    ]);
    return {
      os,
      arch: a,
      gpus: parseVideoControllers(names ?? ""),
      cudaDriver: smi ? parseNvidiaSmi(smi) : null,
      rocm: false,
      vulkan: existsSync(windowsSystem32Binary("vulkan-1.dll")),
    };
  }
  const gpus = linuxGpus();
  if (smi && !gpus.some((g) => g.vendor === "nvidia")) gpus.push({ vendor: "nvidia", name: "NVIDIA (nvidia-smi)" });
  return {
    os,
    arch: a,
    gpus,
    cudaDriver: smi ? parseNvidiaSmi(smi) : null,
    rocm: run(["rocminfo"]) !== null,
    vulkan: linuxVulkan(),
  };
}
