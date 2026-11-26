import React from 'react';

/**
 * A small Markdown renderer for AI answers: headings, bullet and numbered lists, code blocks, bold, italic
 * and inline code. It builds React elements only (never HTML strings), so text from a model can't inject
 * markup. Anything it doesn't recognise is shown as plain text.
 */

function inline(text: string, key: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  // `code`, **bold**, *italic* / _italic_
  const re = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\s][^*\n]*\*|_[^_\s][^_\n]*_)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    const k = `${key}-${i++}`;
    if (t.startsWith('`')) out.push(<code key={k} className="px-1 py-px rounded bg-[#1a1a1d] text-[11px] font-mono text-amber-200/90">{t.slice(1, -1)}</code>);
    else if (t.startsWith('**')) out.push(<strong key={k} className="font-semibold text-neutral-100">{t.slice(2, -2)}</strong>);
    else out.push(<em key={k}>{t.slice(1, -1)}</em>);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export const ChatMarkdown: React.FC<{ text: string }> = ({ text }) => {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: React.ReactNode[] = [];
  let i = 0;
  let n = 0;
  while (i < lines.length) {
    const line = lines[i];
    const key = `b${n++}`;
    if (/^```/.test(line)) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) code.push(lines[i++]);
      i++; // closing fence
      blocks.push(
        <pre key={key} className="p-2.5 rounded-lg bg-[#161618] border border-[#2c2c32] overflow-x-auto text-[11px] font-mono text-neutral-300 whitespace-pre">
          {code.join('\n')}
        </pre>
      );
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const size = h[1].length <= 2 ? 'text-[13px]' : 'text-xs';
      blocks.push(<div key={key} className={`${size} font-semibold text-neutral-100 mt-1`}>{inline(h[2].replace(/\s+#+\s*$/, ''), key)}</div>);
      i++;
      continue;
    }
    if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const items: React.ReactNode[] = [];
      while (i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) {
        const indent = (lines[i].match(/^\s*/)?.[0].length ?? 0) >= 2;
        const body = lines[i].replace(/^\s*([-*+]|\d+[.)])\s+/, '');
        items.push(<li key={`${key}-${items.length}`} className={indent ? 'ml-4' : ''}>{inline(body, `${key}-${items.length}`)}</li>);
        i++;
      }
      blocks.push(
        ordered ? (
          <ol key={key} className="list-decimal pl-5 space-y-1">{items}</ol>
        ) : (
          <ul key={key} className="list-disc pl-5 space-y-1">{items}</ul>
        )
      );
      continue;
    }
    if (!line.trim()) {
      i++;
      continue;
    }
    // A paragraph: consecutive plain lines.
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(```|#{1,6}\s|\s*([-*+]|\d+[.)])\s+)/.test(lines[i])) para.push(lines[i++]);
    blocks.push(<p key={key}>{inline(para.join(' '), key)}</p>);
  }
  return <div className="space-y-2">{blocks}</div>;
};
