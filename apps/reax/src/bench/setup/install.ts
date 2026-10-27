// Download, verify and unpack: the llama.cpp release archives and the model file. Every
// download is checked against the digest its publisher reports (GitHub's per-asset sha256,
// Hugging Face's LFS sha256) before it is used; a mismatch deletes the file and stops. The base
// URLs are parameters so the tests run against a local server.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { windowsSystem32Binary } from "@re4exa/core/vendor/orca-process-host/windows-system-binary";

export interface Endpoints {
  githubApi: string;
  huggingFace: string;
}

export const PUBLIC: Endpoints = { githubApi: "https://api.github.com", huggingFace: "https://huggingface.co" };

export interface RemoteFile {
  name: string;
  url: string;
  /** The publisher's sha256, or null when it reports none. */
  sha256: string | null;
  size: number | null;
}

async function getJson(url: string): Promise<unknown> {
  const r = await fetch(url, { headers: { accept: "application/json", "user-agent": "reax-bench-setup" } });
  if (!r.ok) throw new Error(`GET ${url}: HTTP ${r.status}`);
  return r.json();
}

/** The assets of one llama.cpp release, with GitHub's sha256 for each. */
export async function releaseAssets(tag: string, ep: Endpoints = PUBLIC): Promise<RemoteFile[]> {
  const j = (await getJson(`${ep.githubApi}/repos/ggml-org/llama.cpp/releases/tags/${tag}`)) as {
    assets?: { name: string; browser_download_url: string; digest?: string | null; size?: number }[];
  };
  return (j.assets ?? []).map((a) => ({
    name: a.name,
    url: a.browser_download_url,
    sha256: a.digest?.startsWith("sha256:") ? a.digest.slice(7) : null,
    size: a.size ?? null,
  }));
}

/** The first file in a Hugging Face model repository whose name matches, with its LFS sha256. */
export async function modelFile(repo: string, match: RegExp, ep: Endpoints = PUBLIC): Promise<RemoteFile | null> {
  const entries = (await getJson(`${ep.huggingFace}/api/models/${repo}/tree/main`)) as {
    path: string;
    size?: number;
    lfs?: { oid?: string; sha256?: string; size?: number };
  }[];
  const e = entries.find((x) => match.test(x.path));
  if (!e) return null;
  return {
    name: e.path,
    url: `${ep.huggingFace}/${repo}/resolve/main/${e.path}`,
    sha256: e.lfs?.sha256 ?? e.lfs?.oid ?? null,
    size: e.lfs?.size ?? e.size ?? null,
  };
}

/** sha256 of a file on disk. */
export async function fileSha256(path: string): Promise<string> {
  const h = createHash("sha256");
  const { createReadStream } = await import("node:fs");
  await pipeline(createReadStream(path), h);
  return h.digest("hex");
}

/**
 * Download to `dest` and check the digest. An existing file with the right digest is kept. A
 * mismatch deletes the download and throws. With no published digest the computed one is
 * returned for the caller to pin (trust on first use; the caller records that it was).
 */
export async function downloadVerified(
  f: RemoteFile,
  dest: string,
  onProgress?: (bytes: number) => void,
): Promise<string> {
  mkdirSync(dirname(dest), { recursive: true });
  if (existsSync(dest) && f.sha256 && (await fileSha256(dest)) === f.sha256) return f.sha256;
  const part = `${dest}.part`;
  const r = await fetch(f.url, { redirect: "follow", headers: { "user-agent": "reax-bench-setup" } });
  if (!r.ok || !r.body) throw new Error(`GET ${f.url}: HTTP ${r.status}`);
  const h = createHash("sha256");
  let bytes = 0;
  const body = Readable.fromWeb(r.body as import("node:stream/web").ReadableStream);
  body.on("data", (d: Buffer) => {
    h.update(d);
    bytes += d.length;
    onProgress?.(bytes);
  });
  await pipeline(body, createWriteStream(part));
  const got = h.digest("hex");
  if (f.sha256 && got !== f.sha256) {
    rmSync(part, { force: true });
    throw new Error(`${f.name}: sha256 ${got} does not match the published ${f.sha256}; the download was deleted`);
  }
  renameSync(part, dest);
  return got;
}

/** Unpack a .zip or .tar.gz into dir with the system tar (bsdtar on Windows and macOS reads zip). */
export function extract(archive: string, dir: string): void {
  mkdirSync(dir, { recursive: true });
  const tar = process.platform === "win32" ? windowsSystem32Binary("tar.exe") : "tar";
  const r = spawnSync(tar, ["-xf", archive, "-C", dir], { encoding: "utf8", windowsHide: true });
  if (r.status !== 0) throw new Error(`could not unpack ${archive}: ${r.stderr || r.error}`);
}

/** The first file named `name` under dir (depth-first). */
export function findFile(dir: string, name: string): string | null {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) {
      const f = findFile(p, name);
      if (f) return f;
    } else if (e === name) return p;
  }
  return null;
}

/**
 * The GGUF file to load for a path you give: the file itself; `<path>.gguf` when the path has
 * no extension; or, for a folder, its one model file. Vision projectors (`mmproj-*.gguf`) are
 * not models; for a split model the first shard is returned, since llama.cpp loads the rest
 * from it. A folder holding more than one model is refused, naming them.
 */
export function resolveModelPath(path: string): string {
  if (existsSync(path) && statSync(path).isFile()) return path;
  if (!existsSync(path) && existsSync(`${path}.gguf`)) return `${path}.gguf`;
  if (!existsSync(path)) throw new Error(`no model at ${path}`);
  const ggufs = readdirSync(path)
    .filter((f) => /\.gguf$/i.test(f) && !/^mmproj/i.test(f))
    .sort();
  const models = new Map<string, string[]>();
  for (const f of ggufs) {
    const key = f.replace(/-\d{5}-of-\d{5}\.gguf$/i, "");
    models.set(key, [...(models.get(key) ?? []), f]);
  }
  if (models.size === 0) throw new Error(`${path} holds no .gguf model file`);
  if (models.size > 1)
    throw new Error(`${path} holds more than one model (${[...models.keys()].join(", ")}): pass the file itself`);
  return join(path, [...models.values()][0]![0]!);
}
