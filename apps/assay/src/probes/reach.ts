// The reach table: for each format and platform, whether Assay's probes cover it, cover it
// partly, or not at all, and why. It is computed by sweeping the generated test fixtures
// (test/fixtures/probes/gen.ts) and reading the router pack, so it is never written by hand.
//
//   node src/probes/reach.ts --write   regenerate docs/reach.json
//   test/probes-reach.test.ts          fails when docs/reach.json is stale

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ClaimRecord } from "../evidence/record.ts";
import { getEvidence } from "../evidence/store.ts";
import { Kernel } from "../kernel/kernel.ts";
import { createProbeEngine } from "./engine.ts";
import { loadRouterPack, type Platform } from "./router.ts";

export const PLATFORMS: Platform[] = ["linux", "darwin", "win32"];

export interface ReachFixture {
  name: string;
  format: string;
  subject: string;
  files: { rel: string; bytes: Uint8Array }[];
  probes: string[];
}

export interface ReachCell {
  status: "covered" | "partial" | "not-covered";
  reason: string;
}

export interface ReachRow {
  format: string;
  fixture: string | null;
  probes: string[];
  router: string[];
  platforms: Record<Platform, ReachCell>;
}

export interface ReachTable {
  generatedBy: string;
  source: string;
  rows: ReachRow[];
}

const RANK: Record<ReachCell["status"], number> = { covered: 0, partial: 1, "not-covered": 2 };
const STRUCTURAL_SKIP = new Set(["file.identify", "file.hash", "dir.inventory"]);

export async function computeReach(fixtures: ReachFixture[]): Promise<ReachTable> {
  const dir = mkdtempSync(join(tmpdir(), "assay-reach-"));
  const k = Kernel.open({ path: join(dir, "reach.db"), clock: () => 0 });
  const pack = loadRouterPack();
  const rows: ReachRow[] = [];
  try {
    const ws = join(dir, "ws");
    for (const fx of fixtures)
      for (const f of fx.files) {
        mkdirSync(dirname(join(ws, f.rel)), { recursive: true });
        writeFileSync(join(ws, f.rel), f.bytes);
      }
    const engine = createProbeEngine({ kernel: k, workspace: ws, which: () => null, platform: "linux" });
    const covered = new Set<string>();
    for (const fx of fixtures) {
      const rep = await engine.sweep({ caseId: null, path: fx.subject });
      const recs = rep.evidence.map((id) => getEvidence(k, id)).filter((r): r is ClaimRecord => !!r);
      const own = recs.filter((r) => r.locator?.path === fx.subject);
      const ident = own.find((r) => r.predicate === "file.identify");
      const format = ident ? String((ident.result as { format?: string }).format) : "?";
      const ran = [...new Set(recs.map((r) => r.probe?.id ?? ""))].filter((p) => p && !STRUCTURAL_SKIP.has(p)).sort();
      const failed = rep.notExamined.filter((n) => /\((?:[a-z]+\.[a-z.-]+)\)$/.test(n.what));
      const missing = fx.probes.filter((p) => !recs.some((r) => r.probe?.id === p));
      const partialProbes = recs
        .filter((r) => r.coverage && r.coverage.status !== "complete")
        .map((r) => r.probe?.id ?? "")
        .filter((p) => p);
      const router = pack.rows.filter((r) => r.detect.formats.includes(fx.format)).map((r) => r.id);
      const extOn = (pl: Platform) => [
        ...new Set(
          pack.rows
            .filter((r) => r.detect.formats.includes(fx.format))
            .flatMap((r) => r.external.filter((e) => e.platforms.includes(pl)).map((e) => e.program)),
        ),
      ];
      const cellFor = (pl: Platform): ReachCell => {
        if (format !== fx.format) return { status: "not-covered", reason: `fixture identified as ${format}` };
        if (failed.length > 0 || missing.length > 0)
          return {
            status: "partial",
            reason: `probe failures: ${[...failed.map((f) => `${f.what}: ${f.reason}`), ...missing.map((m) => `${m} did not run`)].join("; ")}`,
          };
        if (ran.length === 0) {
          const ext = extOn(pl);
          return {
            status: "partial",
            reason: `identified only; no built-in structure probe${ext.length ? `; external on ${pl}: ${ext.join(", ")}` : ""}`,
          };
        }
        if (partialProbes.length > 0)
          return { status: "partial", reason: `coverage partial in ${[...new Set(partialProbes)].sort().join(", ")}` };
        return { status: "covered", reason: `built-in: ${ran.join(", ")} (pure TypeScript)` };
      };
      covered.add(fx.format);
      const platforms = {} as Record<Platform, ReachCell>;
      for (const pl of PLATFORMS) platforms[pl] = cellFor(pl);
      const prev = rows.find((r) => r.format === fx.format);
      if (prev) {
        prev.fixture = `${prev.fixture}, ${fx.name}`;
        prev.probes = [...new Set([...prev.probes, ...ran])].sort();
        for (const pl of PLATFORMS) {
          const a = prev.platforms[pl];
          const b = platforms[pl];
          if (RANK[b.status] > RANK[a.status]) prev.platforms[pl] = b;
          else if (a.status === b.status && a.reason !== b.reason) a.reason = `${a.reason}; ${b.reason}`;
        }
      } else rows.push({ format: fx.format, fixture: fx.name, probes: ran, router, platforms });
    }
    // Router targets that no fixture represents: reach depends on external tools only.
    for (const r of pack.rows) {
      const anyFixture = r.detect.formats.some((f) => covered.has(f));
      if (anyFixture && r.detect.markers.length === 0) continue;
      const platforms = {} as Record<Platform, ReachCell>;
      for (const pl of PLATFORMS) {
        const tools = r.external.filter((e) => e.platforms.includes(pl)).map((t) => t.program);
        platforms[pl] =
          r.consent === "approval"
            ? {
                status: "not-covered",
                reason: `not static: needs the person's approval to run ${tools.join(", ") || "anything"}`,
              }
            : tools.length > 0
              ? {
                  status: "partial",
                  reason: `beyond the built-in probes only with external ${tools.join(", ")} (on PATH)`,
                }
              : { status: "not-covered", reason: `no built-in probe and no external tool for ${pl}` };
      }
      rows.push({ format: `router:${r.id}`, fixture: null, probes: r.probes, router: [r.id], platforms });
    }
  } finally {
    k.close();
    rmSync(dir, { recursive: true, force: true });
  }
  rows.sort((a, b) => (a.format < b.format ? -1 : a.format > b.format ? 1 : 0));
  return {
    generatedBy: "node src/probes/reach.ts --write",
    source: "sweeps of test/fixtures/probes/gen.ts fixtures + src/probes/router-pack.json",
    rows,
  };
}

export const REACH_PATH = fileURLToPath(new URL("../../docs/reach.json", import.meta.url));

export function serializeReach(t: ReachTable): string {
  return `${JSON.stringify(t, null, 2)}\n`;
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const genPath = "../../test/fixtures/probes/gen.ts"; // dev-only tool; not part of the built package
  const gen = (await import(genPath)) as { fixtureSet(): ReachFixture[] };
  const table = await computeReach(gen.fixtureSet());
  const text = serializeReach(table);
  if (process.argv.includes("--write")) {
    writeFileSync(REACH_PATH, text);
    process.stdout.write(`wrote ${REACH_PATH} (${table.rows.length} rows)\n`);
  } else process.stdout.write(text);
}
