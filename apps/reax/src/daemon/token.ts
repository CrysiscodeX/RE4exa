// The daemon's token: 32 random bytes (base64url, 43 characters), new on every start, written by the
// daemon itself to run/daemon.token (created exclusively, 0600). It is never an argument, an
// environment variable or a log line. Clients read it from the file at each connection, after the
// owner and mode checks in paths.ts.
//
// The compare hashes both sides first and then uses timingSafeEqual, so neither the content nor the
// length of the expected token leaks through timing. A value that is not a string, or is over 256
// characters, is refused before hashing.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { closeSync, fsyncSync, openSync, writeSync } from "node:fs";
import { CoreError } from "@re4exa/core/errors";
import { checkClientFiles, files, readSmall } from "./paths.ts";

export const TOKEN_BYTES = 32;
export const MAX_TOKEN_CHARS = 256;

export function newToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

/** Create the token file exclusively (O_CREAT|O_EXCL), mode 0600, and flush it. */
export function writeToken(path: string, token: string): void {
  const fd = openSync(path, "wx", 0o600);
  try {
    writeSync(fd, token);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/** The token a client presents, read from the home's token file after the safety checks. */
export function readToken(home: string): string {
  checkClientFiles(home);
  const t = readSmall(files(home).token);
  if (t === null || t.length === 0 || t.length > MAX_TOKEN_CHARS) throw new CoreError("daemon_not_running");
  return t;
}

const sha = (s: string) => createHash("sha256").update(s, "utf8").digest();

/** Constant-time check of a presented token against the daemon's. */
export function tokenMatches(given: unknown, expected: string): boolean {
  if (typeof given !== "string" || given.length > MAX_TOKEN_CHARS) return false;
  return timingSafeEqual(sha(given), sha(expected));
}
