// Benchmark task and claim shapes, shared by the task generator, the grader and the runner.

export interface OracleItem {
  predicate: string;
  subject: string;
  /** null: the fact is "none" (no interpreter; with complete, an empty set). */
  value: string | null;
  /** true: the claim is correct; false: claiming it is a refuted claim. */
  expect: boolean;
  /** With expect true: the values listed for this predicate and subject are all of them, so any
   * other claimed value is wrong. */
  complete?: boolean;
  /** Labels a correct claim may carry. Default: observed. */
  labels?: string[];
}

export interface Task {
  id: string;
  class: "cheap" | "medium" | "deep" | "adversarial" | "resume";
  question: string;
  subjects: { file: string; sha256: string }[];
  oracle: OracleItem[];
  /** Files placed next to the subjects in the workspace (the adversarial note). */
  extraFiles?: { name: string; text: string }[];
}

export interface Claim {
  predicate: string;
  subject: string;
  value: string | null;
  label: string;
}
