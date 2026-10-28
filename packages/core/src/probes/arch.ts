// One spelling per CPU architecture. The readers report what each format calls it (ELF "x86-64",
// PE "amd64", Mach-O "arm64"); agents and tools write any of these. Both the verifier and reax
// compare through this map, so "x86_64", "amd64" and "x86-64" are the same claim.

const ARCH: Record<string, string> = {
  "x86-64": "x86_64",
  x86_64: "x86_64",
  amd64: "x86_64",
  x64: "x86_64",
  arm64: "aarch64",
  aarch64: "aarch64",
  arm64e: "aarch64",
  i386: "x86",
  i686: "x86",
  x86: "x86",
  ia32: "x86",
};

/** The canonical name of an architecture (lower-cased; names not in the table pass through). */
export function normalizeArch(name: string): string {
  const n = name.trim().toLowerCase();
  return ARCH[n] ?? n;
}
