// The answer key for inventory.rust: the RustSec project's rust-audit-info, which reads
// cargo-auditable's .dep-v0 section with its own parser (the auditable-info crate) and prints the
// document as JSON. The output is stored as printed, per fixture, in bench/oracle/rust.json.
// rust-audit-info has no --version; the version is the one CI installs
// (cargo install --locked --version 0.5.4 rust-audit-info).
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

export const RUST_AUDIT_INFO_TOOL = "rust-audit-info 0.5.4";

/** REAX_RUST_AUDIT_INFO, then the project-local install in /tmp/reax-cargo, then PATH. */
export function rustAuditInfo(): string {
  const env = process.env.REAX_RUST_AUDIT_INFO;
  if (env) return env;
  const local = "/tmp/reax-cargo/bin/rust-audit-info";
  return existsSync(local) ? local : "rust-audit-info";
}

/** rust-audit-info's JSON for one file, parsed and otherwise as printed. */
export function rustKey(path: string): unknown {
  const bin = rustAuditInfo();
  const r = spawnSync(bin, [path], { encoding: "utf8", maxBuffer: 1 << 26 });
  if (r.error) throw new Error(`${bin} is not installed (cargo install --locked --version 0.5.4 rust-audit-info)`);
  if (r.status !== 0) throw new Error(`${bin} ${path}: ${r.stderr.trim()}`);
  return JSON.parse(r.stdout);
}
