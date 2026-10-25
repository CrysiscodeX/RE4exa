// Test harness for the probe tests: fake probe contexts over in-memory bytes, and temporary
// workspaces populated with the generated fixtures.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ProbeContext, ProbeDef, ProbeOutput } from "../../../src/contracts.ts";
import type { Json } from "../../../src/evidence/jcs.ts";
import { subjectDigest } from "../../../src/evidence/record.ts";
import { tmp } from "../../helpers.ts";
import { type Fixture, fixtureSet } from "./gen.ts";

export function fakeCtx(bytes: Uint8Array, name = "subject.bin", params: Json = {}): ProbeContext {
  return {
    subject: {
      path: name,
      abs: `/nonexistent/${name}`,
      digest: subjectDigest(bytes),
      size: bytes.length,
      kind: "file",
    },
    params,
    signal: new AbortController().signal,
    async read(rel?: string, max?: number) {
      if (rel) throw new Error("fake context has no directory");
      return bytes.subarray(0, max ?? bytes.length);
    },
    async exec() {
      throw new Error("fake context cannot exec");
    },
  };
}

export function runOn(probe: ProbeDef, bytes: Uint8Array, name?: string, params?: Json): Promise<ProbeOutput> {
  return probe.run(fakeCtx(bytes, name, params));
}

export function writeFiles(root: string, files: { rel: string; bytes: Uint8Array | string }[]): void {
  for (const f of files) {
    mkdirSync(dirname(join(root, f.rel)), { recursive: true });
    writeFileSync(join(root, f.rel), f.bytes);
  }
}

/** A temporary workspace holding every generated fixture. */
export function fixtureWorkspace(fixtures: Fixture[] = fixtureSet()): {
  dir: string;
  cleanup: () => void;
  fixtures: Fixture[];
} {
  const t = tmp("assay-probes-");
  writeFiles(
    t.dir,
    fixtures.flatMap((f) => f.files),
  );
  return { ...t, fixtures };
}

export function fixture(name: string): Fixture {
  const f = fixtureSet().find((x) => x.name === name);
  if (!f) throw new Error(`no fixture ${name}`);
  return f;
}

export function bytesOf(name: string): Uint8Array {
  return fixture(name).files[0]!.bytes;
}
