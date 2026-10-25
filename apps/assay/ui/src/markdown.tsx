// A deliberately small Markdown renderer: paragraphs, headings (as bold lines), code fences, inline code,
// bold/italic, lists, blockquotes, and links shown as text plus URL. It builds React elements only, so
// raw HTML in the source is shown as text and can never become markup.

import type { ReactNode } from "react";

const INLINE =
  /(`+)([\s\S]*?)\1|\*\*([^*\n]+)\*\*|\[([^\]\n]+)\]\(([^)\s]+)\)|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])|(?<![\w*])\*([^*\s][^*\n]*?)\*(?![\w*])/g;

export function inline(text: string, keyBase = "i"): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const key = `${keyBase}-${n++}`;
    if (m[1] !== undefined) out.push(<code key={key}>{m[2]}</code>);
    else if (m[3] !== undefined) out.push(<strong key={key}>{inline(m[3], key)}</strong>);
    else if (m[4] !== undefined)
      out.push(
        <span key={key} className="md-link">
          {inline(m[4], key)} <span className="md-url">({m[5]})</span>
        </span>,
      );
    else if (m[6] !== undefined)
      out.push(
        <span key={key} className="md-url">
          {m[6]}
        </span>,
      );
    else if (m[7] !== undefined) out.push(<em key={key}>{inline(m[7], key)}</em>);
    last = at + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const LIST = /^\s{0,3}([-*+]|\d{1,9}[.)])\s+(.*)$/;

export function Markdown(props: { text: string }): ReactNode {
  const lines = props.text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let para: string[] = [];
  let i = 0;
  const flush = () => {
    if (para.length) blocks.push(<p key={`p${blocks.length}`}>{inline(para.join("\n"), `p${blocks.length}`)}</p>);
    para = [];
  };
  while (i < lines.length) {
    const line = lines[i]!;
    const fence = line.match(/^\s{0,3}(`{3,}|~{3,})\s*([\w+-]*)/);
    if (fence) {
      flush();
      const close = fence[1]!;
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.trimStart().startsWith(close)) body.push(lines[i++]!);
      i++;
      const k = `c${blocks.length}`;
      blocks.push(
        <pre key={k} className="md-pre" data-lang={fence[2] || undefined}>
          <code>{body.join("\n")}</code>
        </pre>,
      );
      continue;
    }
    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (heading) {
      flush();
      const k = `h${blocks.length}`;
      blocks.push(
        <p key={k} className={`md-h md-h${heading[1]!.length}`}>
          <strong>{inline(heading[2]!, k)}</strong>
        </p>,
      );
      i++;
      continue;
    }
    const li = line.match(LIST);
    if (li) {
      flush();
      const ordered = /\d/.test(li[1]!);
      const items: string[] = [];
      const start = ordered ? Number.parseInt(li[1]!, 10) : 1;
      while (i < lines.length) {
        const m = lines[i]!.match(LIST);
        if (m && /\d/.test(m[1]!) === ordered) {
          items.push(m[2]!);
          i++;
        } else if (items.length && /^\s{2,}\S/.test(lines[i]!)) {
          items[items.length - 1] += `\n${lines[i]!.trim()}`;
          i++;
        } else break;
      }
      const k = `l${blocks.length}`;
      // Items have no identity beyond their position in this immutable block.
      // biome-ignore lint/suspicious/noArrayIndexKey: see above
      const children = items.map((t, j) => <li key={`${k}-${j}`}>{inline(t, `${k}-${j}`)}</li>);
      blocks.push(
        ordered ? (
          <ol key={k} start={start === 1 ? undefined : start}>
            {children}
          </ol>
        ) : (
          <ul key={k}>{children}</ul>
        ),
      );
      continue;
    }
    if (/^\s{0,3}>/.test(line)) {
      flush();
      const body: string[] = [];
      while (i < lines.length && /^\s{0,3}>/.test(lines[i]!)) body.push(lines[i++]!.replace(/^\s{0,3}>\s?/, ""));
      blocks.push(
        <blockquote key={`q${blocks.length}`}>
          <Markdown text={body.join("\n")} />
        </blockquote>,
      );
      continue;
    }
    if (line.trim() === "") flush();
    else para.push(line);
    i++;
  }
  flush();
  return <div className="md">{blocks}</div>;
}
