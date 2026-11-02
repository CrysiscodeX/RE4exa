# 0006. The sandbox: one interface, an enforcing backend per OS, fail closed elsewhere

Status: accepted (W1-1, SBX). Decision D-18 records the backends, the failure code and the labels.

## Context

Running a tool on a target (a disassembler, a decompiler, a sample under study) must not let that
tool, or the target, change the machine or reach the network. The plan's later items (ENG and the
leanrea limits) need a child process run under a policy that is enforced by the operating system,
not merely requested. Nothing may be installed or reconfigured to get it: no package, no sysctl,
no AppArmor profile, no admin right.

## Decision

- **Interface** (`src/sandbox/index.ts`): `runSandboxed(argv, policy, { timeoutMs, signal, passEnv })`.
  - The policy (`src/sandbox/policy.ts`) is a `scratch` directory, `network: false` and `required`.
  - The result holds the exit code, the signal, stdout, stderr, `timedOut`, `outputTruncated` and
    `enforcement`. `enforcement` is one of `"sandbox-exec"`, `"landlock"` or `"none"`.
- **The policy:** reads are allowed. Writes are allowed only beneath the scratch directory (and to
  `/dev/null`). There is no network.
- **The scratch directory is resolved to its real path first.** SBPL matches real paths (`/var` is
  `/private/var` on macOS), and Landlock rules name the directory they open.
- **macOS:** `/usr/bin/sandbox-exec -f <profile> -- argv`.
  - The SBPL profile is `(deny default)`, then allows for process exec and fork, signals to self,
    sysctl reads, mach lookups and every file read. `file-write*` is allowed only under the scratch
    `subpath` and on `/dev/null`.
  - The profile ends with `(deny network*)`. SBPL takes the last matching rule, so no earlier allow
    can reopen the network.
  - The profile file is written beside the scratch directory, not in it, and removed after the run.
  - Apple deprecates `sandbox-exec`, but it still works and needs no root.
- **Linux:** Landlock, through `src/sandbox/landlock.py`, run as `python3 -I landlock.py <scratch>
  -- argv`. The helper uses the system `python3`, standard library only (`ctypes`). In order, it:
  1. queries the ABI;
  2. creates a ruleset that handles every write-class filesystem right of that ABI (`WRITE_FILE`,
     `REMOVE_*`, `MAKE_*`, `REFER` from ABI 2, `TRUNCATE` from ABI 3) and, from ABI 4, TCP connect
     and bind;
  3. allows the write rights beneath the scratch directory and writing `/dev/null`, with no network
     rule;
  4. sets `PR_SET_NO_NEW_PRIVS`, restricts itself, and `exec`s the child.

  Any failure before the `exec` exits 125 with a `reax-landlock:` message, and nothing runs. Neither
  bubblewrap nor user namespaces are used: Ubuntu 24.04 restricts unprivileged namespaces through
  AppArmor, and lifting that is a system setting.
- **Detection is probed once per process, never assumed.**
  - macOS: `sandbox-exec` must exist and run a `true` canary under a deny-default profile.
  - Linux: the helper's ABI query. ABI 4 or later is `landlock`. ABI 1 to 3 is `landlock-no-net`,
    which can refuse writes but not network, so it does not meet the policy. No Landlock, or no
    `python3`, is `none`.
  - Windows: `none` in this item.
- **Fail closed.** When the backend cannot enforce the whole policy:
  - with `required: true`, `runSandboxed` throws `sandbox_unavailable` (not retryable) before any
    process starts;
  - with `required: false`, the child runs with no sandbox, and the result says
    `enforcement: "none"`.
- **Process tree.** reax owns the tree kill, which is best effort (see the residual windows and the
  known limit below). The child runs through core's process host (`runProcess`) in its own
  process group: `detached: true` is passed explicitly, because core
  forces it only when its termination barrier is on. Both wrappers `exec` the child, so it keeps
  the wrapper's pid, which reax learns through core's `onSpawn` hook. reax owns the deadline and
  the abort.
  - **Core sends no pid-addressed signal on POSIX.** reax passes `terminationBarrier: false`, so
    core's stop path only kills the root through its `ChildProcess` handle (SIGTERM, then SIGKILL
    after 2 s if `close` has not come), and Node does not signal through the handle of a reaped
    child. The tests wrap `process.kill` and check that every pid-addressed signal during a run
    came from reax's own walk or group kill. So the earlier post-reap SIGKILL to `-child.pid` from
    core's grace timer, and core's `kill(-pgid, 0)` group probe, no longer happen.
  - At the deadline or an abort, reax first checks whether the root is unreaped (Node has seen no
    exit for it, so its pid cannot have been reused).
    - **If it is unreaped**, reax, in the same turn:
      1. lists processes with `ps -A -o pid=,ppid=` (a host tool, run by absolute path), walks the
         parent-pid tree from the root and SIGKILLs every descendant the snapshot lists (up to three
         passes), which catches a descendant that left the group (setsid, or a detached spawn)
         while its parent still runs;
      2. SIGKILLs the group;
      3. destroys the child's pipes, unless `close` has already come, so an escaped holder cannot
         delay the end;
      4. stops core.

      The result has `code: null` and `signal: "SIGKILL"`, and `timedOut` is set for a deadline but
      not for an abort.
    - **If it was already reaped**, reax signals nothing and does not stop core. It only destroys
      the child's pipes, so `close` comes and the run ends with the root's own exit code.
    - `-A` rather than `-a`: under procps-ng, `-a` leaves out session leaders, and a setsid
      grandchild is one.
  - reax also SIGKILLs the group inside the root's `exit` event, so a grandchild backgrounded in
    the group does not outlive a normal exit.
  - Pids 0 and 1 are never signalled: the tree functions refuse them.
  - **Residual windows:**
    - the `ps` snapshot: a listed descendant could exit, be reaped by its own parent and have its pid
      reused before reax's kill reaches it;
    - the microseconds between libuv's `waitpid` and the `exit` event: while the group has members
      its id stays reserved, but when it is empty a process created in that window with that pid as
      its group id would receive the exit-turn kill.
  - The child's pipes are also destroyed after the run, so an escaped descendant holding them
    cannot keep the caller's process alive. A ref'd timer is held while the run is awaited.
  - **Known limit, on macOS and Linux: the setsid double fork escapes.** A descendant that left the
    group once its parent had exited is no longer a descendant of the root, so neither the walk nor
    the group kill reaches it, and it can outlive the run. Examples are a double fork with setsid,
    or a setsid grandchild of a child that exits normally. Whether such a process stays under the
    sandbox profile or Landlock domain it inherited has not been shown by a test, and this ADR does
    not claim it.
  - If such an escaped process holds the child's pipes, the run lasts until the deadline. It then
    reports `timedOut: true` with the root's own exit code (for example `code: 0`).
  - On Windows there is no reax tree kill. Core's termination barrier stays on there, which ends
    the tree with `taskkill /t`, guarded in core by a check that the child has not exited.
- **Environment.** The child does not inherit the parent's environment. It gets `PATH`, `LANG`,
  `LC_ALL` and `TZ` (plus `SystemRoot`, `windir`, `PATHEXT` and `ComSpec` on Windows), with `HOME`
  and `TMPDIR` (and on Windows `USERPROFILE`, `TEMP` and `TMP`) set to the scratch directory.
  Further variables are passed only by name, with the `passEnv` option.
- **Output** is capped (4 MiB per stream by default), and a cut is reported as `outputTruncated`.

## Out of scope (stated limits)

- Reads are not restricted. A sandboxed child can read anything the user can.
- On macOS, `(allow mach-lookup)` is unrestricted. A child can therefore reach system services,
  among them mDNSResponder, which resolves DNS names. A DNS lookup is a possible side channel out of
  the sandbox, even though sockets are denied. Restricting it to named services is left for later.
- No memory, CPU or process-count limits. Only the deadline is enforced.
- Windows has no enforcement. A Job Object limits resources, not file writes or network.
- Node's `--permission` model is not used. It binds only Node children, not native tools.
- No new npm dependency. `@anthropic-ai/sandbox-runtime`, landstrip and a C helper were not used.
- On Linux, network control covers TCP only (Landlock ABI 4). UDP and other socket families are not
  restricted by Landlock at this ABI.

## Consequences

- `RX-SBX/enforced` (linux, darwin) and `RX-SBX/fail-closed` (linux, darwin, win32) are the ledger
  rows. The tests check outcomes from outside the child: the bytes the test reads back, files that
  must be absent, and the connection count of a loopback listener that the test owns.
- On Linux, the first CI run must show Landlock ABI 4 or later in the backend test's name.
  Otherwise the item's Linux claim is revisited.

## Follow-ups (not part of W1-1)

- Prove the escaped grandchild is still sandboxed.
- Linux helper as `PR_SET_CHILD_SUBREAPER`, so orphaned descendants are reparented to the helper and
  can still be found and ended.
