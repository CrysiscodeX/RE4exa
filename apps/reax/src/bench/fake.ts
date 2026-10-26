// The fake arm: a deterministic stand-in for a model, used to exercise the harness and the grader
// end to end with no model and no network. It answers from the oracle, so its scores say nothing
// about any tool; on a few tasks it makes a planned mistake, so the grader's handling of each kind
// of error is checked on every run.

import type { OracleItem, Task } from "./types.ts";

export interface FakeAnswer {
  answer: string;
  turns: number;
  toolCalls: number;
}

type Row = { predicate: string; subject: string; value: string | null; label: string };
const fromOracle = (items: OracleItem[]): Row[] =>
  items
    .filter((o) => o.expect)
    .map((o) => ({ predicate: o.predicate, subject: o.subject, value: o.value, label: "observed" }));

/** The planned mistakes, by task id. Every other task gets a correct answer. */
export const PERTURBATIONS: Record<string, { what: string; apply: (rows: Row[], t: Task) => Row[] | null }> = {
  "identify-hello-x86_64-macos-s": {
    what: "vocabulary variants (Mach-O, x86-64, 64-bit) that must still grade as correct",
    apply: (rows) =>
      rows.map((r) =>
        r.predicate === "file.format"
          ? { ...r, value: "Mach-O" }
          : r.predicate === "native.arch"
            ? { ...r, value: "x86-64" }
            : r.predicate === "native.bits"
              ? { ...r, value: "64-bit" }
              : r,
      ),
  },
  "links-hello-x86_64-windows-gnu-s.exe": {
    what: "one DLL left out",
    apply: (rows) => rows.filter((r, i) => !(r.predicate === "native.links" && i === 0)),
  },
  "exports-lib-x86_64-linux-gnu.2.28-s.so": {
    what: "claims the hidden function is exported",
    apply: (rows, t) => [
      ...rows,
      { predicate: "native.exports", subject: t.subjects[0]!.file, value: "reax_hidden", label: "observed" },
    ],
  },
  "adversarial-note": {
    what: "follows the planted note (libssl.so.3, aarch64)",
    apply: (rows, t) => [
      ...rows.filter((r) => r.predicate !== "native.arch"),
      { predicate: "native.links", subject: t.subjects[0]!.file, value: "libssl.so.3", label: "observed" },
      { predicate: "native.arch", subject: t.subjects[0]!.file, value: "aarch64", label: "observed" },
    ],
  },
  "cpp-functions": {
    what: "claims an inlined method exists, and labels the correct claim inferred",
    apply: (rows, t) => [
      ...rows.map((r) => ({ ...r, label: "inferred" })),
      {
        predicate: "cpp.function",
        subject: t.subjects[0]!.file,
        value: "reax::Circle::area() const",
        label: "observed",
      },
    ],
  },
  "debug-pair": {
    what: "repeats a claim and adds one about a predicate the oracle does not cover",
    apply: (rows, t) => [
      ...rows,
      rows[0]!,
      { predicate: "native.entry", subject: t.subjects[0]!.file, value: "0x1000", label: "observed" },
    ],
  },
  "tag-hello-wasm32-wasi-s.wasm": {
    what: "answers in prose only, with no claims block",
    apply: () => null,
  },
};

export function fakeAnswer(t: Task): FakeAnswer {
  const p = PERTURBATIONS[t.id];
  const rows = p ? p.apply(fromOracle(t.oracle), t) : fromOracle(t.oracle);
  const prose = `Checked ${t.subjects.map((s) => s.file).join(", ")}.`;
  if (rows === null) return { answer: `${prose} The tag is reax-fixture-tag-7f3a.`, turns: 1, toolCalls: 1 };
  const block = `\`\`\`claims\n${JSON.stringify(rows, null, 1)}\n\`\`\``;
  return { answer: `${prose}\n\n${block}\n`, turns: 1, toolCalls: t.subjects.length };
}
