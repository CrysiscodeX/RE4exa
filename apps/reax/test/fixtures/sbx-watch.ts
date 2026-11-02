// Watches every pid-addressed signal sent in this process during a sandbox run: process.kill is
// wrapped (signal 0 is only a probe and is not recorded), and each call is labelled with the reax
// tree function it came from ("walk", "group", "exit") or "other". Handle kills
// (ChildProcess.kill) do not go through process.kill and are not seen. Used by test/sandbox.test.ts,
// in process and inside its CLI-like runner.
import { TREE } from "../../src/sandbox/tree.ts";

export interface Sent {
  pid: number;
  sig: string;
  phase: "walk" | "group" | "exit" | "other";
  afterExit: boolean;
}

export function watchSignals() {
  const realKill = process.kill;
  const orig = { ...TREE };
  let phase: Sent["phase"] = "other";
  const state = { root: 0, exited: false, calls: { walk: 0, group: 0, exit: 0 }, sent: [] as Sent[] };
  const via =
    <R>(name: "walk" | "group" | "exit", f: (p: number) => R) =>
    (p: number): R => {
      state.calls[name]++;
      const prev = phase;
      phase = name;
      try {
        return f(p);
      } finally {
        phase = prev;
      }
    };
  TREE.killDescendants = via("walk", orig.killDescendants);
  TREE.killGroup = via("group", orig.killGroup);
  TREE.killGroupAtExit = (p: number) => {
    state.root = p;
    via("exit", orig.killGroupAtExit)(p);
    state.exited = true; // it runs inside the root's exit event
  };
  process.kill = ((p: number, sig?: string | number) => {
    if (sig !== 0) state.sent.push({ pid: p, sig: String(sig ?? "SIGTERM"), phase, afterExit: state.exited });
    return realKill.call(process, p, sig);
  }) as typeof process.kill;
  return {
    state,
    restore() {
      process.kill = realKill;
      Object.assign(TREE, orig);
    },
  };
}

/** What broke the rules: a pid-addressed signal not sent by reax's tree functions, or any signal
 * to the root or its group after the root's exit event. */
export function signalProblems(state: ReturnType<typeof watchSignals>["state"]): Sent[] {
  return state.sent.filter(
    (e) => e.phase === "other" || (e.afterExit && (e.pid === state.root || e.pid === -state.root)),
  );
}
