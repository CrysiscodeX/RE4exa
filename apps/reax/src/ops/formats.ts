// Format-specific depth: inventory.notes (ELF notes) and inventory.go (Go build information and
// the pclntab function table).
import { CoreError } from "@re4exa/core/errors";
import { NATIVE_CAP } from "@re4exa/core/probes/builtin/elf";
import { IDENTIFY_HEAD, identifyBytes } from "@re4exa/core/probes/builtin/identify";
import "../errors.ts";
import { goBuildInfo, goFunctions } from "../readers/go.ts";
import { LAYOUT_FORMATS, layout } from "../readers/layout.ts";
import { elfNotes } from "../readers/notes.ts";
import { pageStream } from "./bytes.ts";
import { readHead, target } from "./file.ts";
import { PAGE_INPUT } from "./page.ts";
import type { JsonSchema, OpContext, Operation, OpResult } from "./types.ts";

const ALL = ["linux", "darwin", "win32"] as const;
const PATH: JsonSchema = { type: "string", description: "File path inside the workspace", maxLength: 4096 };

function native(ctx: OpContext, path: unknown) {
  const t = target(ctx, path);
  const { bytes, size } = readHead(t.abs, NATIVE_CAP);
  const format = identifyBytes(bytes.subarray(0, IDENTIFY_HEAD), t.rel, size).format;
  return { ...t, bytes, size, format };
}

export const inventoryNotes: Operation = {
  tool: "inventory",
  name: "inventory.notes",
  summary:
    "The notes of an ELF file and what the well-known ones say: GNU build ID, ABI tag (OS and minimum kernel), the property note (x86 IBT/SHSTK and ISA level, AArch64 BTI/PAC), the Go build ID and FDO packaging metadata.",
  input: { type: "object", properties: { path: PATH }, required: ["path"], additionalProperties: false },
  effect: "read",
  cost: "cheap",
  untrusted: true,
  platforms: [...ALL],
  examples: [
    {
      title: "The ABI a glibc executable was built for",
      workspace: "fixtures",
      args: { path: "hello-x86_64-linux-gnu.2.28-s" },
      expect: { notes: [{ owner: "GNU", typeName: "NT_GNU_ABI_TAG", abi: { os: "Linux", version: "2.0.0" } }] },
    },
  ],
  covers: ["rea.tool/inspect_elf_notes"],
  async run(ctx, args): Promise<OpResult> {
    const f = native(ctx, args.path);
    if (f.format !== "elf")
      throw new CoreError("bad_request", {
        field: "path",
        why: `an ELF file (notes are an ELF feature); this file is ${f.format}`,
      });
    const s = layout(f.bytes, "elf")[0]!;
    const notes = elfNotes(f.bytes, s);
    const describe = (n: (typeof notes)[number]) =>
      n.buildId
        ? `build ID ${n.buildId}`
        : n.abi
          ? `${n.abi.os} ${n.abi.version}`
          : n.properties
            ? n.properties.map((p) => `${p.type}: ${p.values.join(", ") || "none"}`).join("; ")
            : n.goBuildId
              ? `Go build ID ${n.goBuildId}`
              : n.packaging
                ? n.packaging
                : `${n.descSize} bytes`;
    return {
      data: { file: f.rel, notes },
      text: [
        `${f.rel}: ${notes.length} notes`,
        ...notes.map((n) => `  ${n.in}  ${n.owner} ${n.typeName ?? `type ${n.type}`}: ${describe(n)}`),
      ].join("\n"),
      coverage: s.notes.length ? "partial" : "complete",
      limitations: s.notes,
    };
  },
};

export const inventoryGo: Operation = {
  tool: "inventory",
  name: "inventory.go",
  summary:
    "A Go binary's build information (Go version, main module, every dependency with version, sum and replacement, build settings such as GOOS, GOARCH and CGO_ENABLED) and its functions from the pclntab, which survive stripping. Functions filter by name and page with offset and limit.",
  input: {
    type: "object",
    properties: {
      path: PATH,
      search: { type: "string", maxLength: 1024, description: "Keep only functions whose name contains this text" },
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
      title: "Which Go and modules built a stripped binary, and where main.main is",
      workspace: "extra",
      args: { path: "go-hello-x86_64-linux", search: "main.main" },
      expect: {
        go: true,
        buildInfo: { goVersion: "go1.24.7", path: "example.com/reaxgo" },
        items: [{ name: "main.main", entry: "0x491ae0" }],
      },
    },
  ],
  covers: ["rea.tool/inspect_go_binary", "leanrea/LEAN-C21", "leanrea/LEAN-C28", "leanrea/LEAN-T10"],
  async run(ctx, args): Promise<OpResult> {
    const f = native(ctx, args.path);
    if (!(LAYOUT_FORMATS as readonly string[]).includes(f.format) || f.format === "wasm")
      throw new CoreError("bad_request", { field: "path", why: `an ELF, PE or Mach-O file; this file is ${f.format}` });
    const s = layout(f.bytes, f.format)[0]!;
    const buildInfo = goBuildInfo(f.bytes, s);
    const fns = goFunctions(f.bytes, s);
    const q = args.search as string | undefined;
    const p = pageStream(
      (fns?.funcs ?? []).filter((x) => q === undefined || x.name.includes(q)),
      args,
    );
    const go = buildInfo !== null || fns !== null;
    const limitations: string[] = [];
    if (go && !buildInfo) limitations.push("no build information (Go before 1.13, or removed)");
    if (go && !fns) limitations.push("no pclntab found: functions are not listed");
    if (f.format === "macho-fat") limitations.push("only the first slice of a universal binary is read");
    return {
      data: { file: f.rel, go, buildInfo, pclntab: fns?.version ?? null, items: p.items, page: p.page },
      text: go
        ? [
            `${f.rel}: Go ${buildInfo?.goVersion ?? "(version unknown)"}${buildInfo?.path ? `, ${buildInfo.path}` : ""}; ${fns?.funcs.length ?? 0} functions${q !== undefined ? `, ${p.page.total} matching` : ""}`,
            ...(buildInfo?.deps ?? []).map(
              (d) => `  dep ${d.path} ${d.version}${d.replace ? ` => ${d.replace.path} ${d.replace.version}` : ""}`,
            ),
            ...(buildInfo?.settings ?? []).map((x) => `  build ${x.key}=${x.value}`),
            ...p.items.map((x) => `  ${x.entry}  ${x.name}`),
          ].join("\n")
        : `${f.rel}: not a Go binary (no build information and no pclntab)`,
      coverage: limitations.length ? "partial" : "complete",
      limitations,
    };
  },
};
