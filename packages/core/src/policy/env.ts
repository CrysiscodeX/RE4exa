// The environment a child process gets: a fixed allow-list, never the parent's full environment,
// so API keys and tokens in Assay's own environment do not reach commands, probes or the verifier.

const SAFE_ENV_KEYS = ["PATH", "HOME", "LANG", "LC_ALL", "TMPDIR", "TMP", "TEMP", "SystemRoot", "PATHEXT", "ComSpec"];

export function minimalEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { TERM: "dumb", NO_COLOR: "1" };
  for (const k of SAFE_ENV_KEYS) if (process.env[k] !== undefined) env[k] = process.env[k];
  return env;
}
