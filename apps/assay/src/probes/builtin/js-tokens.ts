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

export function tokenize(src: string, maxTokens = 1_000_000): TokenizeResult {
  const toks: Tok[] = [];
  const unterminated: TokenizeResult["unterminated"] = [];
  const stack: ("brace" | "tpl")[] = [];
  const n = src.length;
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
    const p = prev();
    if (!p) return true;
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
        stack.push("tpl");
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
    if (c === 125 && stack[stack.length - 1] === "tpl") {
      stack.pop();
      i++;
      scanTemplate(false);
      continue;
    }
    if (c === 123) {
      stack.push("brace");
      toks.push({ t: "punct", v: "{", s: i, line });
      i++;
      continue;
    }
    if (c === 125) {
      stack.pop();
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
  // A `${` substitution still open at the end means the template never closed.
  if (!truncated && stack.includes("tpl")) unterminated.push({ kind: "template", offset: n, line });
  return { tokens: toks, unterminated, truncated };
}
