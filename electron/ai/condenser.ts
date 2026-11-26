/**
 * The condenser (AI pipeline, step 2): turns each relevant document into something short enough to send.
 *
 * - Short documents go whole: a summary would save little and lose detail.
 * - Long documents get a "doc card": a local model's factual summary, cached by content hash so each
 *   version of a file is summarized once.
 * - Without a local model, a long document gets an excerpt card: its headings plus the passage that best
 *   matches the question. The thinker can always ask for the full text.
 * Node only; the model call is injected so tests can run it.
 */
import fs from 'fs';
import path from 'path';
import { hashText, type PipelineDoc } from './finder';

/** Up to this many characters, a document is sent whole. */
export const WHOLE_DOC_CHARS = 4000;
/** What a card model reads of a long document (well inside an 8k-token window). */
const CARD_INPUT_CHARS = 20000;

export const CARD_SYSTEM = `You write a doc card: a compact, factual summary of one project document, for another AI that will decide whether to read the document in full.
Output Markdown only, at most 150 words, with no preamble:
- One line saying what the document is and what it is for.
- 3 to 6 bullets with its key facts, decisions, names, numbers and status.
- An "Open questions" bullet only if the document itself lists open questions or TODOs.
Use only what the document says. Never add, guess or generalize.`;

export interface Condensed {
  doc: PipelineDoc;
  kind: 'whole' | 'card' | 'excerpt';
  text: string;
}

export type CardWriter = (system: string, user: string) => Promise<string>;

export class CardCache {
  constructor(private dir: string) {}
  private file(model: string, hash: string) {
    return path.join(this.dir, model.replace(/[^a-zA-Z0-9._-]/g, '_'), hash.slice(0, 2), `${hash}.md`);
  }
  async get(model: string, hash: string): Promise<string | null> {
    try {
      return await fs.promises.readFile(this.file(model, hash), 'utf-8');
    } catch {
      return null;
    }
  }
  async set(model: string, hash: string, card: string): Promise<void> {
    const target = this.file(model, hash);
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    await fs.promises.writeFile(`${target}.tmp`, card, 'utf-8');
    await fs.promises.rename(`${target}.tmp`, target);
  }
}

/** Headings plus the paragraph sharing most words with the question: no model needed. */
export function excerptCard(doc: PipelineDoc, question: string): string {
  const headings = (doc.body.match(/^#{1,3}\s+.+$/gm) || []).slice(0, 12).map((h) => h.replace(/^#+\s+/, '').trim());
  const words = new Set((question.toLowerCase().match(/[a-z0-9][a-z0-9_-]{2,}/g) || []).filter((w) => w.length > 3));
  let best = '';
  let bestScore = -1;
  for (const p of doc.body.split(/\r?\n\s*\r?\n/)) {
    const t = p.trim();
    if (t.length < 20 || /^#/.test(t)) continue;
    const lower = t.toLowerCase();
    let s = 0;
    for (const w of words) if (lower.includes(w)) s++;
    if (s > bestScore) {
      bestScore = s;
      best = t;
    }
  }
  const parts = [];
  if (headings.length) parts.push(`Sections: ${headings.join(' · ')}`);
  if (best) parts.push(`Excerpt:\n${best.slice(0, 1200)}`);
  return parts.join('\n\n') || doc.body.slice(0, 1200);
}

/**
 * New cards written for one question, at most. Each takes 5–10 s on a laptop GPU; the best hits come
 * first, so later long hits use a cached card if there is one, else an instant excerpt. Cards accumulate
 * in the cache, so later questions get more of them. (Measured: 8 new cards made a first question on a
 * 3,000-doc project take 50–80 s.)
 */
export const MAX_NEW_CARDS = 4;

/**
 * Condenses the hits in order. Cards are written one at a time (a local GPU runs one model at a time);
 * a failing card model drops to excerpt cards for the rest instead of failing the question.
 */
export async function condense(
  docs: PipelineDoc[],
  question: string,
  opts: { model?: string; write?: CardWriter; cache: CardCache; onProgress?: (done: number, total: number) => void; maxNewCards?: number }
): Promise<Condensed[]> {
  const out: Condensed[] = [];
  const long = docs.filter((d) => d.body.length > WHOLE_DOC_CHARS);
  let done = 0;
  let written = 0;
  const maxNew = opts.maxNewCards ?? MAX_NEW_CARDS;
  let writer = opts.model && opts.write ? opts.write : undefined;
  if (long.length) opts.onProgress?.(0, long.length);
  for (const doc of docs) {
    if (doc.body.length <= WHOLE_DOC_CHARS) {
      out.push({ doc, kind: 'whole', text: doc.body });
      continue;
    }
    let card: string | null = null;
    if (writer && opts.model) {
      const hash = hashText(`${CARD_SYSTEM}\n${doc.path}\n${doc.body}`);
      card = await opts.cache.get(opts.model, hash);
      if (!card && written < maxNew) {
        written++;
        try {
          const raw = (await writer(CARD_SYSTEM, `Document: ${doc.path}\nTitle: ${doc.title}\n\n${doc.body.slice(0, CARD_INPUT_CHARS)}`)).trim();
          if (raw) {
            card = raw;
            await opts.cache.set(opts.model, hash, card);
          }
        } catch {
          writer = undefined; // the local model is unavailable: excerpts from here on
        }
      }
    }
    out.push(card ? { doc, kind: 'card', text: card } : { doc, kind: 'excerpt', text: excerptCard(doc, question) });
    opts.onProgress?.(++done, long.length);
  }
  return out;
}
