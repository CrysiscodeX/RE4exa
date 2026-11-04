#!/usr/bin/env node
// Run one command with a deadline (D-54). Node built-ins only.
//   node scripts/bounded.mjs <seconds> -- <command> [args...]
// POSIX: the command starts as the leader of a new session and process group (pgid = its pid);
// everything it starts stays in that group unless it leaves it. At the deadline the group gets
// SIGTERM, and SIGKILL 5 s later if it still exists. If the command exits before the deadline
// while other members of its group still run, the runner waits for the group to empty and, at
// the deadline, stops the rest the same way. Exit code: 124 if the command itself was still
// running at the deadline; otherwise the command's own code (a signal death is 128+signo), also
// when leftovers were stopped at the deadline. SIGINT, SIGTERM and SIGHUP sent to the runner are
// forwarded to the group the same way, and it exits 128+signo (124 if the deadline had passed).
// Not controlled: a process that leaves the group (setsid, setpgid, or a spawn with detached) is
// neither waited for nor signalled, and the report does not see it ("none" means none left in the
// recorded pid and group, not that nothing escaped).
// Windows: no process groups. At the deadline it runs `taskkill /T /F /PID <pid>` on its own child,
// which reaches only descendants still linked to it by parent pid: orphans (whose parent already
// exited) escape. When the command exits, the runner exits; its descendants are not tracked.
// It prints `bounded: started pid=<pid> pgid=<pgid> deadline=<s>s` at start and
// `bounded: still alive: <list|none>` at exit, checking only the pid and group it recorded (kill 0).
// It never signals anything outside its own group, never by name or pattern, never -1 or 0, and
// never runs a shell itself: pass `-- sh -c '...'` for a shell command. Usage errors exit 2.
import { spawn, spawnSync } from "node:child_process";
import { constants } from "node:os";

export const MAX_SECONDS = 3600;
export const KILL_GRACE_MS = 5000;
/** After SIGKILL, how long the runner waits for the group to disappear before reporting. */
const REAP_MS = 2000;
const POLL_MS = 50;
/** How often the runner checks whether a finished command's group has emptied. */
const DRAIN_POLL_MS = 100;
const WIN = process.platform === "win32";

const USAGE = "usage: node scripts/bounded.mjs <seconds 1..3600> -- <command> [args...]";

/** The deadline and the command, or an error message. */
export function parseArgs(argv) {
  const [s, sep, cmd, ...args] = argv;
  if (s === undefined || !/^[1-9]\d{0,3}$/.test(s) || Number(s) > MAX_SECONDS)
    return { error: `the deadline must be an integer from 1 to ${MAX_SECONDS} seconds` };
  if (sep !== "--" || !cmd) return { error: "missing -- <command>" };
  return { seconds: Number(s), cmd, args };
}

/** kill(target, 0): ESRCH means gone; EPERM means it exists (so it is reported as alive). */
export function exists(target) {
  try {
    process.kill(target, 0);
    return true;
  } catch (e) {
    return e?.code === "EPERM";
  }
}

/** The `still alive` line for the recorded targets ({ label, target }), using `alive` to check. */
export function aliveLine(targets, alive = exists) {
  const left = targets.filter((t) => alive(t.target)).map((t) => t.label);
  return `bounded: still alive: ${left.length ? left.join(" ") : "none"}`;
}

function signalGroup(pgid, sig) {
  try {
    process.kill(-pgid, sig);
  } catch {
    // ESRCH: the group is already gone
  }
}

function main() {
  const a = parseArgs(process.argv.slice(2));
  if (a.error) {
    process.stderr.write(`bounded: ${a.error}\n${USAGE}\n`);
    process.exit(2);
  }
  const child = spawn(a.cmd, a.args, { stdio: "inherit", detached: !WIN, windowsHide: true });
  let started = false;
  let timedOut = false;
  let signalled = null;
  let exited = null;
  let stopping = false;
  const timers = [];
  const pid = child.pid;
  const targets = () =>
    WIN
      ? [{ label: `pid=${pid}`, target: pid }]
      : [
          { label: `pid=${pid}`, target: pid },
          { label: `pgid=${pid}`, target: -pid },
        ];

  const finish = () => {
    for (const t of timers) clearTimeout(t);
    process.stderr.write(`${aliveLine(targets())}\n`);
    let code;
    if (timedOut) code = 124;
    else if (signalled) code = 128 + constants.signals[signalled];
    else if (exited.code !== null) code = exited.code;
    else code = 128 + (constants.signals[exited.signal] ?? 0);
    process.exit(code);
  };
  // after a stop: done once the child has exited and (POSIX) its group is gone
  const settled = () => exited !== null && (WIN || !exists(-pid));
  const waitSettled = (until, then) => {
    const tick = () => {
      if (settled()) return finish();
      if (Date.now() >= until) return then();
      timers.push(setTimeout(tick, POLL_MS));
    };
    tick();
  };
  const stop = (sig) => {
    if (stopping) return;
    stopping = true;
    if (WIN) {
      spawnSync("taskkill", ["/T", "/F", "/PID", String(pid)], { stdio: "ignore", windowsHide: true, timeout: 30_000 });
      return waitSettled(Date.now() + REAP_MS, finish);
    }
    signalGroup(pid, sig);
    waitSettled(Date.now() + KILL_GRACE_MS, () => {
      signalGroup(pid, "SIGKILL");
      waitSettled(Date.now() + REAP_MS, finish);
    });
  };

  child.on("error", (e) => {
    if (started) return;
    process.stderr.write(`bounded: cannot start ${a.cmd}: ${e.code ?? e.message}\n`);
    process.exit(127);
  });
  child.on("spawn", () => {
    started = true;
    process.stderr.write(`bounded: started pid=${pid} pgid=${WIN ? "none" : pid} deadline=${a.seconds}s\n`);
    timers.push(
      setTimeout(() => {
        // the command still running is a timeout; only its leftovers running is not
        if (exited === null) timedOut = true;
        else process.stderr.write(`bounded: deadline: stopping the rest of group ${pid}\n`);
        stop("SIGTERM");
      }, a.seconds * 1000),
    );
  });
  // the command exited before any stop: wait for the rest of its group, up to the deadline
  const drain = () => {
    if (stopping) return;
    if (!exists(-pid)) return finish();
    timers.push(setTimeout(drain, DRAIN_POLL_MS));
  };
  child.on("exit", (code, signal) => {
    exited = { code, signal };
    if (stopping) return;
    if (WIN || !exists(-pid)) return finish();
    process.stderr.write(`bounded: command exited; waiting for the rest of group ${pid} until the deadline\n`);
    drain();
  });
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(sig, () => {
      if (!timedOut && !signalled) signalled = sig;
      if (!started) process.exit(128 + constants.signals[sig]);
      stop(sig);
    });
  }
}

if (import.meta.main) main();
