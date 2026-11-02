# 0007. The daemon: one per home, local transport only, token-authenticated

Status: proposed (W2-1, DMN, first slice). Decisions D-25 (the Windows transport and its limits) and
D-26 (the names, files and lock) record it once the Task Master writes them.

## Context

Later items (the MCP server, sessions, jobs) need one long-lived reax process per home that the
CLI, stdio MCP and HTTP clients talk to. This slice builds only that process's skeleton: start, one
instance per `REAX_HOME`, authentication, ping, status and shutdown, and recovery after a crash.
Nothing may be installed, and only Node 24 built-ins are used (`node:net`, `node:crypto`,
`node:fs`, `node:sqlite`). No host tool (`icacls`, PowerShell) is run by `src/`.

## Decision

- **Commands:** `reax serve [--tcp [--host 127.0.0.1|::1] [--port N]]` (foreground; one JSON
  ready line `{ready, pid, instance, endpoint, recovered}` on stdout), `reax daemon start [--tcp …]`
  (the same, detached, output appended to `logs/daemon.log`; waits up to 10 s for it to answer),
  and `reax daemon ping|status|shutdown`. Exit codes follow the CLI: 0, 1 with `message [code]`, 2
  for usage. No new environment variable: `REAX_HOME` selects the home, and clients find the daemon
  through `run/endpoint.json`.
- **Transport:** a Unix socket on Linux and macOS, a named pipe (`\\.\pipe\reax-<32 hex of
  sha256(lowercased realpath(home))>`) on Windows. `--tcp` binds loopback only, on every platform.
- **Files** under `<home>/run/` (mode 0700; created with `mkdir`'s mode and then `chmod`, because
  umask can only narrow a mode):

  | File | Created | Removed at shutdown |
  |---|---|---|
  | `daemon.oslock` | node:sqlite, held for the daemon's life | no, by design (below) |
  | `daemon.lock` | `wx` (O_CREAT\|O_EXCL), 0600, fsync; `{pid, instance, startedAt, protocol}` | yes |
  | `daemon.token` | `wx`, 0600, after the lock; 32 random bytes, base64url (43 characters) | yes |
  | `endpoint.json` | temp file, then rename; `{transport, path \| host+port, pid, instance, protocol}` | yes, first |
  | `daemon.sock` | `listen` (POSIX) | yes |

  The socket is `<home>/run/daemon.sock` when that path is at most 100 bytes; otherwise
  `<tmpdir>/reax-<uid>/<16 hex of sha256(realpath(home))>.sock`, where `reax-<uid>` must be a real
  directory of this user with mode 0700. A fallback path over 103 bytes is refused with a message.
- **Home safety (POSIX):** before anything is created, a home or `run/` that is group- or
  world-writable, or owned by another user, is refused with `daemon_home_unsafe`. Clients refuse a
  `run/` or token file with any `0o077` bit, or another owner, before connecting.
- **One daemon per home, in three steps:**
  1. *The OS lock decides.* `run/daemon.oslock` is opened with node:sqlite (`timeout: 0`,
     `locking_mode=EXCLUSIVE`, `BEGIN IMMEDIATE`, write the pid, `COMMIT`): the owner-lock technique
     of core's kernel, reimplemented here because core does not export it. Busy means
     `daemon_running`. The OS releases the lock when the process dies, on all three systems, so
     racing starts and crashed daemons are decided without clean-up. The file is never deleted:
     unlinking a lock file another process may be opening recreates the race.
  2. *`daemon.lock` is diagnosed,* as defence in depth (filesystems without locking) and as the
     source of the recovery report. It is stale only when its pid is dead (`ESRCH`); or the pid is
     alive but its endpoint refuses outright (`ECONNREFUSED`, `ENOENT`: a reused pid); or there is
     no endpoint for its instance and the lock is older than 10 s; or it is unparsable and older
     than 10 s. Anything else counts as alive, including a probe that times out (2 s). A stale lock
     is removed only if it still has the diagnosed bytes when re-read; its token and endpoint go
     with it, and its socket only if `lstat` says it is a socket.
  3. *`daemon.lock` is created with O_EXCL;* then, by the lock's owner only, the socket path is
     cleared (only a socket; any other file there is `daemon_home_unsafe`, and the new lock is
     removed again); then the token (O_EXCL), then listen, then `endpoint.json`.

  *Why O_EXCL alone is not enough:* recovering a stale lock means deleting it, and there is no
  atomic "delete it if it is still the stale one". Two recoverers can each diagnose the same stale
  lock; the first deletes it and creates its own; the second then deletes the first one's fresh
  lock. Re-reading before deleting narrows that window but cannot close it. The OS lock closes it,
  because only its holder ever diagnoses or deletes.

  `recovered` (ready line and `status`) is `null` or `{reason: "pid-dead" | "unreachable" |
  "unreadable", pid}`. The test seam `DAEMON_HOOKS` (in process only, like PM's `MIGRATE_HOOKS`)
  can turn step 1 off and pause between steps 2 and 3. There is no environment-variable seam.
- **Protocol, version 1:** UTF-8 JSON, one frame per line. A frame is at most 64 KiB; at most 32
  connections at once (more are closed at once); a connection with no valid hello within 2 s is
  closed. A refused connection stops counting at once and is destroyed once its error frame is
  flushed, or after 1 s whatever the peer does, so peers that never read cannot hold the slots.
  At most 64 sockets are open at once, refused ones still draining included. Replies use
  backpressure: while a peer's replies are backed up, its requests are not read; a peer whose
  replies stay backed up for 5 s, or exceed 1 MiB unread, is disconnected; requests read but not
  yet handled are capped at 256 Ki characters (UTF-16 code units) per connection. Per-connection log lines are rate-limited
  (20 per 10 s, then a count of the suppressed ones). The first frame is `{"type":"hello","protocol":1,"token":"…"}`; the reply is
  `{"type":"hello","ok":true,"protocol":1,"instance":"…"}`, or an error frame and the connection is
  closed: a missing or wrong token (or any other first frame) is `daemon_unauthorized`; another
  protocol version is `daemon_protocol_mismatch`; malformed or oversized input is core's
  `bad_request`. Then `{"id":n,"method":"ping"|"status"|"shutdown"}` gets `{"id":n,"ok":true,
  "result":…}` or `{"id":n,"ok":false,"error":{code,message,retryable,fix}}`. An unknown method is
  `bad_request`, and the connection stays open.
- **The token:** generated by the daemon itself, new on every start, never an argument, an
  environment variable, a log line, a reply or a field of the lock or endpoint files. Clients read
  it from the file at each connection and never cache it. The daemon compares
  `timingSafeEqual(sha256(given), sha256(expected))`; a value that is not a string, or is over 256
  characters, is refused before hashing.
- **Bind validation (`--tcp`):** `--host` is exactly `127.0.0.1` (the default) or `::1`;
  `--port` defaults to 0. Everything else (`0.0.0.0`, `::`, `localhost`, other `127.x`,
  `::ffff:127.0.0.1`, LAN addresses, hostnames, an empty value) is `daemon_bind_refused`, before
  the OS lock, before any file and before any socket. After `listen`, the bound address is checked
  against the same set.
- **Shutdown** (a client's `shutdown`, SIGTERM or SIGINT): `endpoint.json`, the server, the
  socket, the token, `daemon.lock`, then the OS lock. Each file only while `daemon.lock` still
  names this instance. The process exits 0.
- **Failure codes** (`src/errors.ts`): `daemon_running`, `daemon_not_running` (retryable),
  `daemon_unauthorized`, `daemon_bind_refused`, `daemon_home_unsafe`, `daemon_protocol_mismatch`.

## Out of scope (stated limits)

- **Windows (D-25):** reax sets no ACL (Node has no ACL API and no host tool is run). The token file
  inherits the ACL of `REAX_HOME` (under `%USERPROFILE%`: the user, SYSTEM and Administrators). The
  pipe keeps Windows' default DACL (full control for LocalSystem, Administrators and the creator
  owner; read for Everyone), so another user cannot write a hello. The home-safety checks are
  POSIX-only. Plan §3.3's "pipe ACL to the user's SID" is not met, and SR-9 stays open. The tests
  print `icacls` for the token file as a diagnostic only.
- **Slots on `--tcp`:** any local user can connect to a loopback port. Without the token such a
  connection is closed within 2 s (no hello), or once its error frame is flushed and within 1 s (a
  wrong one), but 32 silent connections
  renewed every 2 s can keep the slots full and delay legitimate clients. The Unix socket (0700
  `run/`) does not have this exposure, which is one reason it is the default.
- **A full daemon is not reported as busy:** at the 32-connection cap the 33rd connection is closed
  without a frame, and reax's client reports that as `daemon_unauthorized`. To be fixed in SCH
  with a retryable busy code or a busy frame.
- **Same-user processes:** any process running as the same user can read the token file (SR-9).
  The token separates users, not one user's own processes.
- No TLS, no HTTP, no MCP, no auto-start from the CLI, no idle timeout, no service units, and the
  daemon does not own `pm.db` yet (D-23's reopen trigger is untouched).

## Consequences

- Racing starts, crashes and stale files are decided by the OS lock; the lock file's diagnosis is
  what the user sees (`recovered`).
- `run/daemon.oslock` stays in the home after shutdown; that is expected.
- The internal API (`startDaemon`, `daemonCall`, `DAEMON_HOOKS`, `PROTOCOL_VERSION`) is not an
  operation: the registry, `docs/operations.md` and `docs/tools.json` are unchanged.

## Follow-ups (later DMN slices)

- MCP over stdio and HTTP as clients of this daemon (REA-C01, REA-C02); sessions (REA-C05); jobs,
  progress and cancellation (REA-C36); the daemon taking ownership of `pm.db`.
- Re-reading the token and licence paths in the daemon (donor weak point T3-2).
