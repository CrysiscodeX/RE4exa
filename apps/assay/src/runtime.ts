// Node flags for processes Assay starts with its own runtime. From a source checkout the code is
// TypeScript and the shared engine (@re4exa/core) must resolve to its source, so children get
// --conditions=source; the built package runs JavaScript and needs nothing extra.

const fromSource = import.meta.url.endsWith(".ts");

/** Flags to put before the script path when spawning `process.execPath` on an Assay script. */
export function nodeArgs(): string[] {
  return fromSource ? ["--conditions=source", "--disable-warning=ExperimentalWarning"] : [];
}
