#!/usr/bin/env node
// PreToolUse hook for Bash (D-54). It reads the hook payload on stdin and either allows the command
// (exit 0, no output) or denies it (exit 2, one line on stderr: `bash-guard: <reason>`). It never
// rewrites a command and never prints updatedInput.
//
// Rules:
//   A. node's test runner needs a timeout: in each segment, every --test switch (any spelling node
//      accepts: --test, --test=<v>) that follows a node or nodejs word must sit among that node's
//      own options (before its first non-option word and before `--`) together with
//      --test-timeout=<ms> or --test-timeout <ms>; node ignores the option after the first file.
//      A --test word after a variable or substitution ($X, $(which node), backticks) is denied:
//      what runs cannot be read. Segments are split on unquoted ; && || | & newlines and
//      parentheses; the bodies of $(...), backticks, every quoted string ('...', "...", $'...')
//      and every word holding blanks (node\ --test, for eval or sh -c) are checked as commands of
//      their own. Conservative: `echo "node --test"` is denied too. With unbalanced quotes the
//      whole string is one segment.
//   B. run_in_background: the whole command is one call `node <P> <seconds> -- ...`, where <P> is
//      scripts/bounded.mjs, ./scripts/bounded.mjs, or resolves (from cwd, after an optional leading
//      `cd <dir> &&`) to $CLAUDE_PROJECT_DIR/scripts/bounded.mjs; trailing redirections allowed.
//   C. Every bounded.mjs call, foreground or background, has a deadline that is an integer 1..3600.
// Malformed input fails closed: not JSON, or a Bash call without a string command, is denied.
//
// Limit (D-54): only commands that literally invoke `node ... --test` are judged. `npm test`,
// `npm run <script>` and other wrappers are not resolved: the scripts they run are out of scope.
//
// Node built-ins only; every loop is bounded by the input size and a nesting limit.
import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";

const MAX_INPUT = 1 << 20;
const MAX_COMMAND = 100_000;
const MAX_DEPTH = 8;
const MAX_SECONDS = 3600;

const R_UNREADABLE = "unreadable hook input";
const R_TIMEOUT =
  "node --test without --test-timeout=<ms> among node's options (before the first file or --) (D-47, D-54)";
const R_BACKGROUND =
  "run_in_background commands must be one call: node scripts/bounded.mjs <seconds> -- <command> (D-54)";
const R_DEADLINE = "bounded.mjs deadline must be an integer from 1 to 3600 seconds (D-54)";
const R_OPAQUE = "--test after a variable or command substitution cannot be checked; write node literally (D-54)";
const R_TOO_LONG = "command too long to check";
const R_TOO_DEEP = "command nested too deeply to check";
const R_INTERNAL = "internal error while checking the command";

class Deny extends Error {}

/** Marks, in a segment's words, that the next word is a redirection target. */
const REDIRECT = "\0redirect";

/**
 * Split a shell command into segments of words (quotes removed). Returns
 * { segments: [{ words, redirects, seps }], inner: [string], balanced } where `inner` holds the
 * bodies of $(...), backticks and quoted strings, to be checked as commands themselves, and
 * `seps` lists the separators met (for rule B).
 */
export function lex(src) {
  const segments = [];
  const inner = [];
  const seps = [];
  let words = [];
  let redirects = 0;
  let word = null;
  // the current word holds a blank escaped with a backslash (as in eval node\ --test)
  let escBlank = false;
  let i = 0;
  const n = src.length;
  const endWord = () => {
    if (word !== null) {
      words.push(word);
      // a word holding escaped blanks may be run as a command (eval, sh -c): it is checked as
      // one. Quoted and substituted bodies are already in `inner`.
      if (escBlank) inner.push(word);
    }
    word = null;
    escBlank = false;
  };
  const endSeg = (sep) => {
    endWord();
    if (words.length) segments.push({ words, redirects });
    words = [];
    redirects = 0;
    if (sep) seps.push(sep);
  };
  // reads a $( ... ) body starting after "$(", returns the index after the closing ")" or -1
  const readParen = (start) => {
    let depth = 1;
    let j = start;
    while (j < n) {
      const c = src[j];
      if (c === "\\") j += 2;
      else if (c === "'") {
        const k = src.indexOf("'", j + 1);
        if (k < 0) return -1;
        j = k + 1;
      } else if (c === '"') {
        j++;
        while (j < n && src[j] !== '"') j += src[j] === "\\" ? 2 : 1;
        if (j >= n) return -1;
        j++;
      } else if (c === "(") {
        depth++;
        j++;
      } else if (c === ")") {
        depth--;
        j++;
        if (depth === 0) return j;
      } else j++;
    }
    return -1;
  };
  while (i < n) {
    const c = src[i];
    if (c === "$" && src[i + 1] === '"') {
      i++; // $"..." (a locale string) reads as "..."
      continue;
    }
    if (c === "$" && src[i + 1] === "'") {
      // $'...' (ANSI-C quoting): backslash escapes the next character; common escapes decoded
      let j = i + 2;
      let body = "";
      const esc = { n: "\n", t: "\t", r: "\r" };
      while (j < n && src[j] !== "'") {
        if (src[j] === "\\" && j + 1 < n) {
          body += esc[src[j + 1]] ?? src[j + 1];
          j += 2;
        } else body += src[j++];
      }
      if (j >= n) return { segments, inner, seps, balanced: false };
      inner.push(body);
      word = (word ?? "") + body;
      i = j + 1;
      continue;
    }
    if (c === "\\") {
      if (src[i + 1] === "\n") {
        i += 2; // line continuation
        continue;
      }
      if (/\s/.test(src[i + 1] ?? "")) escBlank = true;
      word = (word ?? "") + (src[i + 1] ?? "");
      i += 2;
    } else if (c === "'") {
      const k = src.indexOf("'", i + 1);
      if (k < 0) return { segments, inner, seps, balanced: false };
      const body = src.slice(i + 1, k);
      inner.push(body);
      word = (word ?? "") + body;
      i = k + 1;
    } else if (c === '"') {
      let j = i + 1;
      let body = "";
      while (j < n && src[j] !== '"') {
        if (src[j] === "\\" && j + 1 < n) {
          body += src[j + 1];
          j += 2;
        } else if (src[j] === "$" && src[j + 1] === "(") {
          const e = readParen(j + 2);
          if (e < 0) return { segments, inner, seps, balanced: false };
          inner.push(src.slice(j + 2, e - 1));
          seps.push("$(");
          body += src.slice(j, e);
          j = e;
        } else if (src[j] === "`") {
          const k = src.indexOf("`", j + 1);
          if (k < 0) return { segments, inner, seps, balanced: false };
          inner.push(src.slice(j + 1, k));
          seps.push("`");
          body += src.slice(j, k + 1);
          j = k + 1;
        } else body += src[j++];
      }
      if (j >= n) return { segments, inner, seps, balanced: false };
      inner.push(body);
      word = (word ?? "") + body;
      i = j + 1;
    } else if (c === "$" && src[i + 1] === "(") {
      const e = readParen(i + 2);
      if (e < 0) return { segments, inner, seps, balanced: false };
      inner.push(src.slice(i + 2, e - 1));
      word = `${word ?? ""}${src.slice(i, e)}`;
      seps.push("$(");
      i = e;
    } else if (c === "`") {
      const k = src.indexOf("`", i + 1);
      if (k < 0) return { segments, inner, seps, balanced: false };
      inner.push(src.slice(i + 1, k));
      word = `${word ?? ""}${src.slice(i, k + 1)}`;
      seps.push("`");
      i = k + 1;
    } else if (c === "#" && word === null) {
      while (i < n && src[i] !== "\n") i++;
    } else if (c === " " || c === "\t" || c === "\r") {
      endWord();
      i++;
    } else if (c === ">" || c === "<" || (c === "&" && src[i + 1] === ">")) {
      // a redirection: [n]> [n]>> >| < << &> >&n <&n >&- ; a leading fd number is part of it.
      // Its target (the next word) is dropped from the segment's words; >&n and >&- have none.
      if (word !== null && /^\d+$/.test(word)) word = null;
      endWord();
      redirects++;
      let j = i + 1;
      if (c === "&") j++;
      if (src[j] === ">" || src[j] === "<" || src[j] === "|") j++;
      if (src[j] === "&" && /[\d-]/.test(src[j + 1] ?? "")) {
        j++;
        while (j < n && /[\d-]/.test(src[j])) j++;
      } else words.push(REDIRECT);
      i = j;
    } else if (c === ";" || c === "\n" || c === "(" || c === ")") {
      endSeg(c);
      i++;
    } else if (c === "&" || c === "|") {
      const two = src[i + 1] === c || (c === "|" && src[i + 1] === "&");
      endSeg(two ? src.slice(i, i + 2) : c);
      i += two ? 2 : 1;
    } else {
      word = (word ?? "") + c;
      i++;
    }
  }
  endSeg(null);
  // drop each redirect marker and the word after it (the target)
  for (const s of segments) {
    const kept = [];
    for (let k = 0; k < s.words.length; k++) {
      if (s.words[k] === REDIRECT) k++;
      else kept.push(s.words[k]);
    }
    s.words = kept;
  }
  return { segments, inner, seps, balanced: true };
}

/** node, nodejs, or a path ending in either (with .exe on Windows). */
const isNode = (w) => /^node(js)?(\.exe)?$/i.test(basename(w.replace(/\\/g, "/")));
const isBounded = (w) => basename(w.replace(/\\/g, "/")) === "bounded.mjs";
/** Every spelling of node's test-runner switch: --test and --test=<value>. */
const TEST_FLAG = /^--test(=|$)/;
/** node options whose value may be the next word. Any other option is taken to have none; an
 * unknown one with a separate value ends the options early, which can only deny more. */
const VALUE_OPTS = new Set([
  "-r",
  "--require",
  "--import",
  "--loader",
  "--experimental-loader",
  "-C",
  "--conditions",
  "--env-file",
  "--input-type",
  "--test-reporter",
  "--test-reporter-destination",
  "--test-name-pattern",
  "--test-skip-pattern",
  "--test-concurrency",
  "--test-shard",
  "--test-timeout",
  "--test-coverage-include",
  "--test-coverage-exclude",
  "--disable-warning",
  "--watch-path",
]);

/** The index range of node's own options after the node word at `at`: up to the first word that
 * is not an option (the script or first test file) or `--`. node ignores --test-timeout after it. */
function optionEnd(words, at) {
  let k = at + 1;
  while (k < words.length) {
    const w = words[k];
    if (w === "--" || w === "-" || !w.startsWith("-")) break;
    k += VALUE_OPTS.has(w) ? 2 : 1;
  }
  return Math.min(k, words.length);
}

/** Rules A and C on one segment's words. */
function checkWords(words) {
  const tests = [];
  for (let k = 0; k < words.length; k++) if (TEST_FLAG.test(words[k])) tests.push(k);
  if (tests.length) {
    // an expansion before the switch ($X, $(which node), `...`): what runs cannot be read
    if (words.slice(0, tests[0]).some((w) => /[$`]/.test(w))) throw new Deny(R_OPAQUE);
    // each switch after a node word must sit in that node's options, beside a --test-timeout
    const covered = new Set();
    for (let k = 0; k < words.length; k++) {
      if (!isNode(words[k])) continue;
      const end = optionEnd(words, k);
      const opts = words.slice(k + 1, end);
      const ok = opts.some(
        (w, j) =>
          /^--test-timeout=[1-9]\d*$/.test(w) || (w === "--test-timeout" && /^[1-9]\d*$/.test(opts[j + 1] ?? "")),
      );
      if (ok) for (let j = k + 1; j < end; j++) covered.add(j);
    }
    const firstNode = words.findIndex(isNode);
    for (const t of tests) if (firstNode >= 0 && firstNode < t && !covered.has(t)) throw new Deny(R_TIMEOUT);
  }
  const first = words.findIndex((w) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(w));
  for (let k = 0; k < words.length; k++) {
    if (!isBounded(words[k])) continue;
    if (k !== first && !(k > 0 && isNode(words[k - 1]))) continue;
    const s = words[k + 1] ?? "";
    if (!/^[1-9]\d{0,3}$/.test(s) || Number(s) > MAX_SECONDS) throw new Deny(R_DEADLINE);
  }
}

/** Rules A and C over a command and everything nested in it. */
function checkCommand(src, depth) {
  if (depth > MAX_DEPTH) throw new Deny(R_TOO_DEEP);
  const lx = lex(src);
  if (!lx.balanced) {
    // when in doubt, the whole string is one segment of blank-separated words, quotes dropped
    checkWords(src.split(/\s+/).map((w) => w.replace(/["'`\\]/g, "")));
    return lx;
  }
  for (const s of lx.segments) checkWords(s.words);
  for (const body of lx.inner) checkCommand(body, depth + 1);
  return lx;
}

/** Rule B: the command is one bounded.mjs call, after an optional `cd <dir> &&`. */
function checkBackground(lx, cwd, projectDir) {
  if (!lx.balanced) throw new Deny(R_BACKGROUND);
  let segs = lx.segments;
  let seps = lx.seps;
  let dir = typeof cwd === "string" ? cwd : null;
  if (segs.length === 2 && seps.length === 1 && seps[0] === "&&" && segs[0].words[0] === "cd") {
    const w = segs[0].words;
    if (w.length !== 2 || segs[0].redirects) throw new Deny(R_BACKGROUND);
    dir = dir !== null ? resolve(dir, w[1]) : null;
    segs = segs.slice(1);
    seps = [];
  }
  if (segs.length !== 1 || seps.length !== 0) throw new Deny(R_BACKGROUND);
  const w = segs[0].words;
  if (w.length < 4 || !isNode(w[0]) || w[3] !== "--") throw new Deny(R_BACKGROUND);
  let p = w[1];
  if (projectDir) p = p.replace(/^\$\{?CLAUDE_PROJECT_DIR\}?(?=[/\\])/, projectDir);
  if (p === "scripts/bounded.mjs" || p === "./scripts/bounded.mjs") return;
  if (projectDir && dir !== null) {
    const norm = (x) => (process.platform === "win32" ? x.toLowerCase() : x);
    if (norm(resolve(dir, p)) === norm(resolve(projectDir, "scripts", "bounded.mjs"))) return;
  }
  throw new Deny(R_BACKGROUND);
}

/** The decision for one payload: null to allow, or the deny reason. */
export function judge(raw, env = process.env) {
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    return R_UNREADABLE;
  }
  if (input === null || typeof input !== "object" || Array.isArray(input)) return R_UNREADABLE;
  if (input.tool_name !== "Bash") return null;
  const ti = input.tool_input;
  if (ti === null || typeof ti !== "object" || typeof ti.command !== "string") return R_UNREADABLE;
  const bg = ti.run_in_background;
  if (bg !== undefined && typeof bg !== "boolean") return R_UNREADABLE;
  if (ti.command.length > MAX_COMMAND) return R_TOO_LONG;
  try {
    // trailing blanks and newlines change nothing in what runs; without them a background call
    // is not mistaken for two
    const lx = checkCommand(ti.command.trimEnd(), 0);
    if (bg === true) checkBackground(lx, input.cwd, env.CLAUDE_PROJECT_DIR || null);
  } catch (e) {
    if (e instanceof Deny) return e.message;
    // an error in the guard itself fails closed: exit 1 would let Claude Code run the command
    return R_INTERNAL;
  }
  return null;
}

if (import.meta.main) {
  let raw = "";
  try {
    const buf = readFileSync(0);
    raw = buf.length > MAX_INPUT ? "" : buf.toString("utf8");
  } catch {
    raw = "";
  }
  let reason;
  try {
    reason = judge(raw);
  } catch {
    reason = R_INTERNAL;
  }
  if (reason !== null) {
    process.stderr.write(`bash-guard: ${reason}\n`);
    process.exitCode = 2;
  }
}
