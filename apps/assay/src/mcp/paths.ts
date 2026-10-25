// Workspace path guard for the file tools. Resolves symlinks, so a link inside the workspace that
// points outside it is refused, and refuses writes into `.git` (hooks there run later as the person).

import { existsSync, lstatSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { AssayError } from "../errors.ts";

function inside(root: string, p: string): boolean {
  const rel = relative(root, p);
  return rel === "" || (!isAbsolute(rel) && rel.split(sep)[0] !== "..");
}

const PROTECTED_WRITE = new Set([".git"]);

export function resolveInWorkspace(
  workspace: string,
  p: string,
  opts: { write?: boolean; mustExist?: boolean } = {},
): { abs: string; rel: string } {
  if (typeof p !== "string" || p.length === 0 || p.includes("\u0000"))
    throw new AssayError("bad_request", { path: p, why: "a non-empty path without NUL" });
  const rootLexical = resolve(workspace);
  let root: string;
  try {
    root = realpathSync(rootLexical);
  } catch {
    throw new AssayError("not_found", { workspace });
  }
  const abs = resolve(rootLexical, p);
  if (!inside(rootLexical, abs) && !inside(root, abs)) throw new AssayError("path_outside_workspace", { path: p });
  const relLexical = inside(rootLexical, abs) ? relative(rootLexical, abs) : relative(root, abs);
  if (opts.write && relLexical.split(sep).some((seg) => PROTECTED_WRITE.has(seg)))
    throw new AssayError("path_outside_workspace", { path: p, why: "protected path (.git)" });
  if (existsSync(abs) || isDanglingLink(abs)) {
    if (opts.write && lstatSync(abs).isSymbolicLink())
      throw new AssayError("path_outside_workspace", { path: p, why: "refusing to write through a symlink" });
    let real: string;
    try {
      real = realpathSync(abs);
    } catch {
      throw new AssayError("path_outside_workspace", { path: p, why: "dangling symlink" });
    }
    if (!inside(root, real))
      throw new AssayError("path_outside_workspace", { path: p, why: "symlink leaves workspace" });
    return { abs: real, rel: relative(root, real) || "." };
  }
  if (opts.mustExist !== false && !opts.write) throw new AssayError("not_found", { path: p });
  // New file: the deepest existing ancestor must resolve inside the workspace.
  let anc = dirname(abs);
  while (!existsSync(anc) && anc !== dirname(anc)) anc = dirname(anc);
  const ancReal = realpathSync(anc);
  if (!inside(root, ancReal))
    throw new AssayError("path_outside_workspace", { path: p, why: "parent leaves workspace" });
  const final = resolve(ancReal, relative(anc, abs));
  return { abs: final, rel: relative(root, final) };
}

function isDanglingLink(p: string): boolean {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}
