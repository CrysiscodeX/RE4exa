// A small JavaScript/TypeScript tokenizer for the import census and the endpoint scan. It skips
// comments, decodes string literals, follows template literals through nested `${ … }` (with a
// brace stack), and tells regex literals from division by the previous significant token. It
// never throws: unterminated literals and comments are reported and scanning stops or resumes.

export type TokType = "ident" | "string" | "template" | "punct" | "number" | "regex" | "private";

export interface Tok {
  t: TokType;
  /** Identifier name, punctuator, decoded string value, or cooked template chunk. */
  v: string;
  /** Offset of the token in the source. */
  s: number;
  line: number;
  /** Template chunk followed by a `${` substitution. */
  sub?: boolean;
  /** Template chunk position: whole (no substitutions), head, middle or tail. */
  part?: "whole" | "head" | "middle" | "tail";
}

export interface TokenizeResult {
  tokens: Tok[];
  unterminated: { kind: "string" | "template" | "comment" | "regex"; offset: number; line: number }[];
  truncated: boolean;
}

const BEFORE_EXPR = new Set([
  "return",
  "typeof",
  "instanceof",
  "in",
  "of",
  "new",
  "delete",
  "void",
  "throw",
  "case",
  "do",
  "else",
  "yield",
  "await",
  "extends",
]);

function isIdentStart(c: number): boolean {
  return (
    (c >= 65 && c <= 90) ||
    (c >= 97 && c <= 122) ||
    c === 36 ||
    c === 95 ||
    (c >= 0x80 && c !== 0xa0 && c !== 0xfeff && c !== 0x2028 && c !== 0x2029)
  );
}

function isIdentPart(c: number): boolean {
  return isIdentStart(c) || (c >= 48 && c <= 57);
}

function isDigit(c: number): boolean {
  return c >= 48 && c <= 57;
}

export function cook(raw: string): string {
  if (!raw.includes("\\")) return raw;
  return raw.replace(/\\(u\{[0-9a-fA-F]{1,8}\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|\r\n|[\s\S])/g, (_m, e: string) => {
    switch (e[0]) {
      case "n":
        return "\n";
      case "t":
        return "\t";
      case "r":
        return "\r";
      case "b":
        return "\b";
      case "f":
        return "\f";
      case "v":
        return "\v";
      case "0":
        return "\0";
      case "\n":
      case "\r":
      case " ":
      case " ":
        return "";
      case "x":
        return e.length === 3 ? String.fromCharCode(Number.parseInt(e.slice(1), 16)) : e;
      case "u": {
        if (e.length === 1) return e;
        const cp = Number.parseInt(e[1] === "{" ? e.slice(2, -1) : e.slice(1), 16);
        return cp <= 0x10ffff ? String.fromCodePoint(cp) : "";
      }
      default:
        return e;
    }
  });
}

function countNl(src: string, from: number, to: number): number {
  let n = 0;
  for (let i = from; i < to; i++) if (src.charCodeAt(i) === 10) n++;
  return n;
}

/** Extensions whose files may hold JSX. TypeScript's .ts, .mts and .cts do not: there `<T>x` is a
 * type assertion. */
const JSX_EXT = new Set([".js", ".jsx", ".tsx", ".mjs", ".cjs"]);

/** Whether a file with this name may hold JSX (and should be tokenized with `jsx: true`). */
export function jsxFor(name: string): boolean {
  const m = /\.[^./\\]+$/.exec(name);
  return m !== null && JSX_EXT.has(m[0].toLowerCase());
}

interface Frame {
  v: "brace" | "tpl" | "jsx";
  up: Frame | null;
}

interface JsxFrame {
  /** The outermost element of a JSX expression that started in JavaScript. */
  root: boolean;
  state: "tag" | "children";
}

/**
 * Tokenizes JavaScript or TypeScript. With `jsx`, an element that starts where an operand is
 * expected is read as JSX: attribute strings become string tokens and `{...}` expressions are
 * tokenized as code, while tag names and text are skipped. A `<` that turns out not to be JSX (a
 * TypeScript generic such as `<T,>() => ...`, which reaches a character JSX cannot hold or runs
 * to the end of the file) is rolled back and read as a plain `<`.
 */
export function tokenize(src: string, maxTokens = 1_000_000, opts: { jsx?: boolean } = {}): TokenizeResult {
  const toks: Tok[] = [];
  const unterminated: TokenizeResult["unterminated"] = [];
  // The brace stack as an immutable linked list, so a JSX snapshot is one reference, not a copy.
  let stack: Frame | null = null;
  const push = (v: Frame["v"]): void => {
    stack = { v, up: stack };
  };
  const pop = (): void => {
    stack = stack?.up ?? null;
  };
  const top = (): Frame["v"] | undefined => stack?.v;
  const jsx = opts.jsx === true;
  const frames: JsxFrame[] = [];
  const roots: {
    i: number;
    line: number;
    toks: number;
    unterminated: number;
    stack: Frame | null;
    frames: number;
    noRegexBefore: number;
  }[] = [];
  const noJsxAt = new Set<number>();
  /** toks.length right after a JSX element ended: what follows it is not an operand position. */
  let jsxEnd = -1;
  const n = src.length;
  /** Characters failed JSX attempts may rescan; when spent, the rest of the file is read without
   * JSX. Keeps hostile input such as "(<a>" * n linear. */
  let jsxBudget = 8 * n + 1024;
  let i = 0;
  let line = 1;
  let truncated = false;
  let noRegexBefore = 0;
  if (src.startsWith("#!")) {
    const nl = src.indexOf("\n");
    i = nl < 0 ? n : nl;
  }

  const prev = (): Tok | undefined => toks[toks.length - 1];
  const regexAllowed = (): boolean => {
    if (toks.length === jsxEnd) return false;
    const p = prev();
    if (!p) return true;
    // TypeScript's non-null assertion (x! / y): a "!" right after an operand ends the operand. In
    // JavaScript an operand is never followed by a prefix "!", so this reads plain code the same.
    if (p.t === "punct" && p.v === "!") {
      const q = toks[toks.length - 2];
      if (
        q &&
        (q.t === "number" ||
          q.t === "string" ||
          q.t === "regex" ||
          q.t === "private" ||
          (q.t === "punct" && (q.v === ")" || q.v === "]")) ||
          (q.t === "ident" && !BEFORE_EXPR.has(q.v)) ||
          (q.t === "template" && q.sub !== true))
      )
        return false;
    }
    if (p.t === "punct") return p.v !== ")" && p.v !== "]" && p.v !== "}";
    if (p.t === "ident") return BEFORE_EXPR.has(p.v);
    if (p.t === "template") return p.sub === true;
    return false;
  };

  /** Scan template characters from `i` (just after "`" or "}"); pushes one chunk token. */
  const scanTemplate = (first: boolean): void => {
    const start = i;
    const startLine = line;
    let raw = "";
    const chunkStart = i;
    while (i < n) {
      const c = src.charCodeAt(i);
      if (c === 96) {
        raw += src.slice(chunkStart, i);
        i++;
        toks.push({ t: "template", v: cook(raw), s: start, line: startLine, part: first ? "whole" : "tail" });
        line += countNl(src, start, i);
        return;
      }
      if (c === 92) {
        i += 2;
        continue;
      }
      if (c === 36 && src.charCodeAt(i + 1) === 123) {
        raw += src.slice(chunkStart, i);
        i += 2;
        push("tpl");
        toks.push({
          t: "template",
          v: cook(raw),
          s: start,
          line: startLine,
          sub: true,
          part: first ? "head" : "middle",
        });
        line += countNl(src, start, i);
        return;
      }
      i++;
    }
    raw += src.slice(chunkStart, n);
    i = n;
    unterminated.push({ kind: "template", offset: start, line: startLine });
    toks.push({ t: "template", v: cook(raw), s: start, line: startLine, part: first ? "whole" : "tail" });
    line += countNl(src, start, n);
  };

  /** Undoes the innermost open JSX expression, or with `all`, every open one at once (from the
   * outermost), so that no failed position is scanned again more than once. */
  const rollback = (all = false): void => {
    if (all) for (const o of roots) noJsxAt.add(o.i);
    const r = all ? roots[0]! : roots[roots.length - 1]!;
    roots.length = all ? 0 : roots.length - 1;
    jsxBudget -= Math.max(1, i - r.i);
    i = r.i;
    line = r.line;
    toks.length = r.toks;
    unterminated.length = r.unterminated;
    stack = r.stack;
    frames.length = r.frames;
    noRegexBefore = r.noRegexBefore;
    noJsxAt.add(r.i);
    jsxEnd = -1;
  };

  /**
   * Scans JSX from `i` for the innermost open element until the element that started in
   * JavaScript closes, or a `{` hands control back to the JavaScript scanner (which resumes here
   * at the matching `}`). Returns false when the text cannot be JSX.
   */
  const scanJsx = (): boolean => {
    while (frames.length > 0) {
      const f = frames[frames.length - 1]!;
      if (i >= n) return true; // the end of the file with an element open: rolled back after the loop
      const c = src.charCodeAt(i);
      if (f.state === "tag") {
        if (c === 10) {
          line++;
          i++;
        } else if (c === 32 || c === 9 || c === 13) i++;
        else if (c === 47 && src.charCodeAt(i + 1) === 62) {
          i += 2;
          frames.pop();
          if (f.root) {
            roots.pop();
            jsxEnd = toks.length;
            return true;
          }
        } else if (c === 47 && src.charCodeAt(i + 1) === 47) {
          // a line comment between attributes
          const nl = src.indexOf("\n", i);
          i = nl < 0 ? n : nl;
        } else if (c === 47 && src.charCodeAt(i + 1) === 42) {
          const end = src.indexOf("*/", i + 2);
          if (end < 0) return false;
          line += countNl(src, i, end);
          i = end + 2;
        } else if (c === 62) {
          i++;
          f.state = "children";
        } else if (c === 123) {
          push("jsx");
          toks.push({ t: "punct", v: "{", s: i, line });
          i++;
          return true;
        } else if (c === 34 || c === 39) {
          const end = src.indexOf(src[i]!, i + 1);
          if (end < 0) return false;
          toks.push({ t: "string", v: src.slice(i + 1, end), s: i, line });
          line += countNl(src, i, end);
          i = end + 1;
        } else if (c === 61) i++;
        else if (isIdentStart(c) || c === 45 || c === 58 || c === 46) {
          i++;
          while (i < n) {
            const r = src.charCodeAt(i);
            if (isIdentPart(r) || r === 45 || r === 58 || r === 46) i++;
            else break;
          }
        } else return false;
        continue;
      }
      // children: text up to the next element, closing tag or {expression}
      let j = i;
      while (j < n) {
        const r = src.charCodeAt(j);
        if (r === 60 || r === 123) break;
        j++;
      }
      line += countNl(src, i, j);
      i = j;
      if (i >= n) return true;
      if (src.charCodeAt(i) === 123) {
        push("jsx");
        toks.push({ t: "punct", v: "{", s: i, line });
        i++;
        return true;
      }
      const d = src.charCodeAt(i + 1);
      if (d === 47) {
        const end = src.indexOf(">", i);
        if (end < 0) {
          i = n;
          return true;
        }
        line += countNl(src, i, end);
        i = end + 1;
        frames.pop();
        if (f.root) {
          roots.pop();
          jsxEnd = toks.length;
          return true;
        }
      } else if (isIdentStart(d) || d === 62) {
        i++;
        frames.push({ root: false, state: d === 62 ? "children" : "tag" });
        if (d === 62) i++;
      } else i++; // a stray "<" in text
    }
    return true;
  };

  for (;;) {
    while (i < n) {
      if (toks.length >= maxTokens) {
        truncated = true;
        break;
      }
      const c = src.charCodeAt(i);
      if (c === 10 || c === 0x2028 || c === 0x2029) {
        line++;
        i++;
        continue;
      }
      if (c === 32 || c === 9 || c === 13 || c === 11 || c === 12 || c === 0xa0 || c === 0xfeff) {
        i++;
        continue;
      }
      const start = i;
      const d = src.charCodeAt(i + 1);
      if (c === 47) {
        if (d === 47) {
          const nl = src.indexOf("\n", i);
          i = nl < 0 ? n : nl;
          continue;
        }
        if (d === 42) {
          const end = src.indexOf("*/", i + 2);
          if (end < 0) {
            unterminated.push({ kind: "comment", offset: i, line });
            line += countNl(src, i, n);
            i = n;
            break;
          }
          line += countNl(src, i, end);
          i = end + 2;
          continue;
        }
        // A failed regex scan already read to the end of its line; later attempts on that stretch
        // would fail the same way, so skip them (keeps hostile input like "(/[" * n linear).
        if (i >= noRegexBefore && regexAllowed()) {
          let j = i + 1;
          let inClass = false;
          let ok = false;
          while (j < n) {
            const r = src.charCodeAt(j);
            if (r === 10 || r === 13 || r === 0x2028 || r === 0x2029) break;
            if (r === 92) {
              j += 2;
              continue;
            }
            if (r === 91) inClass = true;
            else if (r === 93) inClass = false;
            else if (r === 47 && !inClass) {
              ok = true;
              break;
            }
            j++;
          }
          if (ok) {
            j++;
            while (j < n && isIdentPart(src.charCodeAt(j))) j++;
            toks.push({ t: "regex", v: src.slice(i, j), s: i, line });
            i = j;
            continue;
          }
          unterminated.push({ kind: "regex", offset: i, line });
          noRegexBefore = j;
        }
        if (d === 61) {
          toks.push({ t: "punct", v: "/=", s: i, line });
          i += 2;
        } else {
          toks.push({ t: "punct", v: "/", s: i, line });
          i++;
        }
        continue;
      }
      if (c === 39 || c === 34) {
        let j = i + 1;
        let closed = false;
        while (j < n) {
          const r = src.charCodeAt(j);
          if (r === c) {
            closed = true;
            break;
          }
          if (r === 92) {
            j += src.charCodeAt(j + 1) === 13 && src.charCodeAt(j + 2) === 10 ? 3 : 2;
            continue;
          }
          if (r === 10 || r === 13) break;
          j++;
        }
        const raw = src.slice(i + 1, Math.min(j, n));
        if (!closed) unterminated.push({ kind: "string", offset: i, line });
        toks.push({ t: "string", v: cook(raw), s: i, line });
        line += countNl(src, i, Math.min(j, n));
        i = closed ? j + 1 : Math.min(j, n);
        continue;
      }
      if (c === 96) {
        i++;
        scanTemplate(true);
        continue;
      }
      if (jsx && jsxBudget > 0 && c === 60 && !noJsxAt.has(i) && (isIdentStart(d) || d === 62) && regexAllowed()) {
        roots.push({
          i,
          line,
          toks: toks.length,
          unterminated: unterminated.length,
          stack,
          frames: frames.length,
          noRegexBefore,
        });
        i++;
        frames.push({ root: true, state: d === 62 ? "children" : "tag" });
        if (d === 62) i++;
        if (!scanJsx()) rollback();
        continue;
      }
      if (c === 125 && top() === "jsx") {
        pop();
        toks.push({ t: "punct", v: "}", s: i, line });
        i++;
        if (!scanJsx()) rollback();
        continue;
      }
      if (c === 125 && top() === "tpl") {
        pop();
        i++;
        scanTemplate(false);
        continue;
      }
      if (c === 123) {
        push("brace");
        toks.push({ t: "punct", v: "{", s: i, line });
        i++;
        continue;
      }
      if (c === 125) {
        pop();
        toks.push({ t: "punct", v: "}", s: i, line });
        i++;
        continue;
      }
      if (isIdentStart(c)) {
        let j = i + 1;
        while (j < n && isIdentPart(src.charCodeAt(j))) j++;
        toks.push({ t: "ident", v: src.slice(i, j), s: i, line });
        i = j;
        continue;
      }
      if (c === 35 && i + 1 < n && isIdentStart(d)) {
        let j = i + 2;
        while (j < n && isIdentPart(src.charCodeAt(j))) j++;
        toks.push({ t: "private", v: src.slice(i, j), s: i, line });
        i = j;
        continue;
      }
      if (isDigit(c) || (c === 46 && isDigit(d))) {
        let j = i + 1;
        const hex = c === 48 && (d === 120 || d === 88);
        while (j < n) {
          const r = src.charCodeAt(j);
          const p = src.charCodeAt(j - 1);
          if (isIdentPart(r) || r === 46) j++;
          else if ((r === 43 || r === 45) && (p === 101 || p === 69) && !hex) j++;
          else break;
        }
        toks.push({ t: "number", v: src.slice(i, j), s: i, line });
        i = j;
        continue;
      }
      let v: string;
      if (c === 46 && d === 46 && src.charCodeAt(i + 2) === 46) v = "...";
      else if (c === 63 && d === 46 && !isDigit(src.charCodeAt(i + 2))) v = "?.";
      else if (c === 61 && d === 62) v = "=>";
      else v = src[i]!;
      toks.push({ t: "punct", v, s: start, line });
      i += v.length;
    }
    // A JSX expression still open at the end was not JSX (a TypeScript generic, most often): read
    // it, and any open inside it, again from the outermost "<" as code.
    if (!truncated && roots.length > 0) {
      rollback(true);
      continue;
    }
    break;
  }
  // A `${` substitution still open at the end means the template never closed.
  let openTemplate = false;
  for (let f = stack as Frame | null; f; f = f.up) if (f.v === "tpl") openTemplate = true;
  if (!truncated && openTemplate) unterminated.push({ kind: "template", offset: n, line });
  return { tokens: toks, unterminated, truncated };
}
