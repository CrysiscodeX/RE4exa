// inventory.rust: a Rust binary's cargo-auditable dependency list (.dep-v0) and the toolchain's
// marks (the rustc commit), so a Rust binary built without cargo-auditable is still named Rust
// and a non-Rust file is reported absent, with the scope that was read (leanrea LEAN-T13, rea
// REA-C14). Every bound is a named constant in src/readers/rust.ts.
import { NATIVE_CAP } from "@re4exa/core/probes/builtin/elf";
import { IDENTIFY_HEAD, identifyBytes } from "@re4exa/core/probes/builtin/identify";
import "../errors.ts";
import { LAYOUT_FORMATS, type LayoutSlice, layout } from "../readers/layout.ts";
import {
  RUST_CAPS,
  RUST_EDGE_CAP,
  RUST_INFLATE_CAP,
  RUST_LISTED_DEPS_CAP,
  RUST_MARKER_CAP,
  RUST_PACKAGE_CAP,
  type RustCaps,
  type RustDeps,
  type RustMarkers,
  type RustPackage,
  rustDeps,
  rustMarkers,
} from "../readers/rust.ts";
import { pageStream } from "./bytes.ts";
import { readHead, target } from "./file.ts";
import { PAGE_INPUT } from "./page.ts";
import type { Operation, OpResult } from "./types.ts";

const ALL = ["linux", "darwin", "win32"] as const;

export const NO_DEPS = "no dependency data (built without cargo-auditable)";

export interface RustSlice {
  arch: string;
  /** The .dep-v0 document's place, format and counts, or null when the slice has none. */
  deps: { section: RustDeps["section"]; format: number | null; packages: number; edges: number } | null;
  rustc: string | null;
  markers: string[];
  scope: RustMarkers["scope"];
}

/** The whole answer for a file's bytes; `caps` lets the tests lower the bounds. */
export function rustInventory(
  b: Uint8Array,
  format: string,
  caps: RustCaps = RUST_CAPS,
): {
  rust: boolean | null;
  status: string;
  rustc: string | null;
  rustcVersion: string | null;
  markers: string[];
  slices: RustSlice[];
  packages: (RustPackage & { slice: string })[];
  limitations: string[];
} {
  const limitations: string[] = [];
  let slices: LayoutSlice[] = [];
  if ((LAYOUT_FORMATS as readonly string[]).includes(format)) {
    try {
      slices = layout(b, format);
    } catch (e) {
      limitations.push(`the section table cannot be read: ${(e as Error).message}`);
    }
  }
  const out: RustSlice[] = [];
  const packages: (RustPackage & { slice: string })[] = [];
  let rustcVersion: string | null = null;
  const markers: string[] = [];
  for (const s of slices) {
    const pre = slices.length > 1 ? `${s.arch}: ` : "";
    for (const n of s.notes) limitations.push(`${pre}${n}`);
    const d = rustDeps(b, s, format, caps);
    const m = rustMarkers(b, s, format, caps.markers);
    if (d) {
      for (const n of d.notes) limitations.push(`${pre}${n}`);
      for (const p of d.packages) {
        if (p.dependencies.length > RUST_LISTED_DEPS_CAP) {
          limitations.push(
            `${pre}package ${p.index} (${p.name}) has ${p.dependencies.length} dependencies; the first ${RUST_LISTED_DEPS_CAP} are listed`,
          );
          p.dependencies = p.dependencies.slice(0, RUST_LISTED_DEPS_CAP);
          p.dependsOn = p.dependsOn.slice(0, RUST_LISTED_DEPS_CAP);
        }
        packages.push({ slice: s.arch, ...p });
      }
    }
    if (!m.scope.complete && !m.rustc && !d)
      limitations.push(`${pre}the marker scan stopped at its ${caps.markers}-byte cap`);
    rustcVersion ??= m.rustcVersion;
    for (const x of m.markers) if (!markers.includes(x)) markers.push(x);
    out.push({
      arch: s.arch,
      deps: d ? { section: d.section, format: d.format, packages: d.packages.length, edges: d.edges } : null,
      rustc: m.rustc,
      markers: m.markers,
      scope: m.scope,
    });
  }
  const auditable = out.some((s) => s.deps);
  const known = markers.length > 0;
  // absent only when every slice was read whole; a cut scan that found nothing is unknown
  const whole = !limitations.length && out.every((s) => s.scope.complete);
  const rust = known ? true : whole ? false : null;
  const status = auditable
    ? "dependency data (cargo-auditable)"
    : rust
      ? NO_DEPS
      : rust === false
        ? "absent: no .dep-v0 section and no Rust marker in the scope read"
        : "unknown: the scope could not be read whole";
  return {
    rust,
    status,
    rustc: out.find((s) => s.rustc)?.rustc ?? null,
    rustcVersion,
    markers,
    slices: out,
    packages,
    limitations,
  };
}

export const inventoryRust: Operation = {
  tool: "inventory",
  name: "inventory.rust",
  summary: `A Rust binary's dependencies as cargo-auditable embeds them (.dep-v0 in ELF, PE, every Mach-O slice and wasm): format version, every package with version, source, kind, features and root flag, and the dependency edges as indices and names; and the rustc commit and other Rust marks, so a Rust binary without cargo-auditable is still named Rust. Bounded: ${RUST_INFLATE_CAP / 1048576} MiB inflated, ${RUST_PACKAGE_CAP} packages, ${RUST_EDGE_CAP} edges (${RUST_LISTED_DEPS_CAP} listed per package), ${RUST_MARKER_CAP / 1048576} MiB of read-only data scanned; past a bound or on damage the result is partial. Packages page with offset and limit.`,
  input: {
    type: "object",
    properties: {
      path: { type: "string", description: "File path inside the workspace", maxLength: 4096 },
      ...PAGE_INPUT,
    },
    required: ["path"],
    additionalProperties: false,
  },
  effect: "read",
  cost: "cheap",
  untrusted: true,
  platforms: [...ALL],
  examples: [
    {
      title: "Which crates a Rust binary was built from, and with which rustc",
      workspace: "extra",
      args: { path: "rust-deps-aarch64-apple-darwin" },
      expect: {
        rust: true,
        rustc: "58cf8f9c35b355199727627d07ae34a4e2846d67",
        items: [{ name: "itoa", version: "1.0.11", source: "crates.io" }],
      },
    },
  ],
  covers: ["rea.tool/inspect_rust_binary", "leanrea/LEAN-C29", "leanrea/LEAN-T13"],
  async run(ctx, args): Promise<OpResult> {
    const t = target(ctx, args.path);
    const { bytes, size } = readHead(t.abs, NATIVE_CAP);
    const format = identifyBytes(bytes.subarray(0, IDENTIFY_HEAD), t.rel, size).format;
    const r = rustInventory(bytes, format);
    const p = pageStream(r.packages, args);
    const { packages: _all, limitations, ...rest } = r;
    const deps = r.slices.filter((s) => s.deps);
    return {
      data: { file: t.rel, format, ...rest, items: p.items, page: p.page },
      text: [
        `${t.rel}: ${r.rust === true ? "Rust" : r.rust === false ? "not Rust" : "Rust unknown"}; ${r.status}${r.rustc ? `; rustc commit ${r.rustc}` : ""}`,
        ...r.markers.map((m) => `  mark: ${m}`),
        ...deps.map(
          (s) =>
            `  ${s.arch}: ${s.deps!.section.name} format ${s.deps!.format ?? "?"}, ${s.deps!.packages} packages, ${s.deps!.edges} edges`,
        ),
        ...p.items.map(
          (x) =>
            `  [${x.index}] ${x.name} ${x.version} (${x.source}${x.kind !== "runtime" ? `, ${x.kind}` : ""}${x.root ? ", root" : ""})${x.features.length ? ` features ${x.features.join(",")}` : ""}${x.dependsOn.length ? ` -> ${x.dependsOn.join(", ")}` : ""}`,
        ),
        `  scope: ${r.slices.map((s) => `${s.arch} ${s.scope.sections.join(" ") || "no read-only data"} (${s.scope.bytes} bytes${s.scope.complete ? "" : ", cut"})`).join("; ") || `no sections (${format})`}`,
      ].join("\n"),
      coverage: limitations.length ? "partial" : "complete",
      limitations,
    };
  },
};
