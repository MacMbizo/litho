/**
 * Project chat, run as the finder → condenser → thinker pipeline:
 *
 * 1. Finder: the documents most relevant to the question (local embeddings, cached; keywords as fallback).
 * 2. Condenser: short documents whole, long ones as cached doc cards from a local model.
 * 3. Thinker: the chosen provider gets the persona, DocAtlas's audit facts and the condensed documents.
 *    Claude can also read any document in full (read_doc); other providers get the top few inlined.
 *
 * The renderer sends the project's documents once per index (it already holds them), so the main process
 * never reads paths it was handed. Node only; Ollama calls are injected so tests can run it.
 */
import path from 'path';
import { CardCache, condense, type Condensed } from './condenser';
import { EMBED_MODEL, IndexCancelled, ProjectIndex, VectorCache, hashText, type Hit, type PipelineDoc } from './finder';
import type { AIGateway } from './gateway';
import type { AIProvider, ChatTurn, CompletionResult } from './types';

export const TOP_DOCS = 8;
/** Without read_doc, this many of the top documents are inlined in full (each cut at INLINE_DOC_CHARS). */
const INLINE_FULL_DOCS = 3;
const INLINE_DOC_CHARS = 12000;
/** Other documents listed by path so the thinker can ask for them. */
const LISTED_DOCS = 150;
export const MAX_INDEX_DOCS = 10000;
export const MAX_INDEX_CHARS = 60_000_000;
/**
 * Local models for doc cards, best first (measured 2026-11-26 on an 8 GB GPU): qwen3.5:4b writes specific,
 * faithful cards; llama3.2 is quicker to load but mis-states purposes and invents open questions.
 */
export const CARD_MODELS = ['qwen3.5:4b', 'llama3.2:latest'];

export type ChatStage = 'index' | 'find' | 'cards' | 'think';
export interface ChatProgress {
  stage: ChatStage;
  done?: number;
  total?: number;
}

export interface IndexSummary {
  docs: number;
  mode: 'embeddings' | 'keywords';
  /** Why matching is by keywords, as a sentence for the UI. */
  reason?: string;
}

export interface ChatSource {
  id: string;
  path: string;
  title: string;
  /** How the thinker saw it: whole text, a doc card, an excerpt, or read in full on request. */
  kind: Condensed['kind'] | 'read';
}

export type AskResult = CompletionResult & {
  provider: AIProvider;
  persona?: { id: string; name: string };
  sources: ChatSource[];
  mode: IndexSummary['mode'];
  reason?: string;
  cardModel?: string;
};

export interface OllamaDeps {
  installed: (baseUrl: string) => Promise<string[] | null>;
  embed: (baseUrl: string, model: string, inputs: string[]) => Promise<number[][]>;
  /** One local completion for a doc card. */
  write: (baseUrl: string, model: string, system: string, user: string) => Promise<string>;
}

export function thinkerSystem(projectName: string): string {
  return `You answer questions about the project "${projectName}" from its documentation, inside Litho, a Markdown studio that audits projects (DocAtlas).

You are given DocAtlas's audit facts about the project, the documents most relevant to the question (whole, or as short "doc cards" and excerpts when long), and a list of the project's other documents.
- If a read_doc tool is available, read a document in full whenever a card or excerpt is not enough to answer precisely, and before quoting details from it. Prefer reading to guessing.
- Answer from the documents and facts. Say plainly when they don't cover something, and what would.
- Name the documents you rely on by path, so the reader can open them.
- Documents can be out of date or contradict each other; when they do, say which and why it matters.
- Write clean Markdown. Lead with the answer.`;
}

const kindLabel: Record<Condensed['kind'], string> = { whole: 'full text', card: 'doc card', excerpt: 'excerpt' };

export function buildUserMessage(opts: {
  facts: string;
  question: string;
  condensed: Condensed[];
  others: PipelineDoc[];
  inline?: { count: number; maxChars: number };
}): string {
  const parts: string[] = [];
  if (opts.facts.trim()) parts.push(`## Project facts (from DocAtlas)\n\n${opts.facts.trim()}`);
  if (opts.condensed.length) {
    const docs = opts.condensed.map((c, i) => {
      const full = opts.inline && i < opts.inline.count && c.kind !== 'whole';
      const text = full ? c.doc.body.slice(0, opts.inline!.maxChars) : c.text;
      const label = full ? (c.doc.body.length > opts.inline!.maxChars ? 'full text, cut' : 'full text') : kindLabel[c.kind];
      return `### ${c.doc.path} (${label})\nTitle: ${c.doc.title}\n\n${text}`;
    });
    parts.push(`## Most relevant documents\n\n${docs.join('\n\n')}`);
  } else {
    parts.push('## Most relevant documents\n\nNo document matched the question closely.');
  }
  if (opts.others.length) {
    const shown = opts.others.slice(0, LISTED_DOCS).map((d) => `- ${d.path}${d.title && d.title !== path.basename(d.path, '.md') ? ` (${d.title})` : ''}`);
    const more = opts.others.length - shown.length;
    parts.push(`## Other documents in the project\n\n${shown.join('\n')}${more > 0 ? `\n- …and ${more} more` : ''}`);
  }
  parts.push(`## Question\n\n${opts.question}`);
  return parts.join('\n\n');
}

export class ProjectChat {
  private indexes = new Map<string, { index: ProjectIndex; signature: string }>();
  private building = new Map<string, { signature: string; promise: Promise<IndexSummary> }>();
  private generation = 0;
  /** Questions being answered right now, and index builds waiting for them to finish. */
  private asking = 0;
  private waiters: Array<() => void> = [];
  private vectors: VectorCache;
  private cards: CardCache;

  constructor(
    private gateway: AIGateway,
    cacheDir: string,
    private ollama: OllamaDeps
  ) {
    this.vectors = new VectorCache(path.join(cacheDir, 'embeddings'));
    this.cards = new CardCache(path.join(cacheDir, 'cards'));
  }

  /**
   * Builds (or reuses) the index for a project's documents. Embeds only what the disk cache lacks. The
   * index is usable at once: questions asked while it's still embedding are matched by keywords.
   */
  async index(key: string, docs: PipelineDoc[], onProgress?: (p: ChatProgress) => void): Promise<IndexSummary> {
    const signature = hashText(docs.map((d) => `${d.id}\0${d.path}\0${d.title}\0${hashText(d.body)}`).join('\n'));
    const existing = this.indexes.get(key);
    // Reuse when nothing changed, unless it fell back to keywords and Ollama may be up now.
    if (existing && existing.signature === signature && existing.index.mode === 'embeddings') return summary(existing.index);
    const running = this.building.get(key);
    if (running && running.signature === signature) return running.promise;
    const promise = this.build(key, signature, docs, onProgress).finally(() => {
      if (this.building.get(key)?.promise === promise) this.building.delete(key);
    });
    this.building.set(key, { signature, promise });
    return promise;
  }

  private async build(key: string, signature: string, docs: PipelineDoc[], onProgress?: (p: ChatProgress) => void): Promise<IndexSummary> {
    // Only the newest build embeds: one local GPU can't serve two big builds and a question at once.
    // An older build pauses at its next batch; its vectors are on disk, so it resumes cheaply later.
    const generation = ++this.generation;
    const ollamaUrl = (await this.gateway.getConfig()).ollamaUrl;
    const index = new ProjectIndex(docs);
    index.reason = 'Still indexing, so this answer matched documents by keywords.';
    this.remember(key, index, signature);
    const installed = await this.ollama.installed(ollamaUrl);
    const embedModel = installed?.find((m) => m === EMBED_MODEL || m.startsWith(`${EMBED_MODEL}:`));
    if (!installed) index.reason = 'Ollama is not running, so documents are matched by keywords.';
    else if (!embedModel) index.reason = `Matching by keywords. For matching by meaning, install ${EMBED_MODEL} in Ollama (ollama pull ${EMBED_MODEL}).`;
    else {
      try {
        await index.embedAll(
          embedModel,
          async (inputs) => {
            await this.questionsDone();
            return this.ollama.embed(ollamaUrl, embedModel, inputs);
          },
          this.vectors,
          (p) => onProgress?.({ stage: 'index', ...p }),
          () => generation !== this.generation
        );
      } catch (e: any) {
        index.mode = 'keywords';
        index.reason =
          e instanceof IndexCancelled
            ? 'Indexing paused while another project was indexed; it resumes when you open this chat again.'
            : `Matching by keywords: embedding failed (${e?.message || e}).`;
      }
    }
    return summary(index);
  }

  private remember(key: string, index: ProjectIndex, signature: string) {
    this.indexes.delete(key);
    this.indexes.set(key, { index, signature });
    // Keep the few most recent projects in memory.
    while (this.indexes.size > 4) this.indexes.delete(this.indexes.keys().next().value!);
  }

  /**
   * Answers a question. While it runs, index builds pause between batches: the person is waiting on the
   * answer, and a local GPU can't run embeddings, cards and the thinker at full speed together.
   */
  async ask(
    key: string,
    input: { projectName: string; question: string; history: ChatTurn[]; facts: string },
    onProgress?: (p: ChatProgress) => void
  ): Promise<AskResult> {
    this.asking++;
    try {
      return await this.answer(key, input, onProgress);
    } finally {
      if (--this.asking === 0) this.waiters.splice(0).forEach((resume) => resume());
    }
  }

  /** Resolves once no question is being answered. */
  private async questionsDone(): Promise<void> {
    while (this.asking > 0) await new Promise<void>((resume) => this.waiters.push(resume));
  }

  private async answer(
    key: string,
    input: { projectName: string; question: string; history: ChatTurn[]; facts: string },
    onProgress?: (p: ChatProgress) => void
  ): Promise<AskResult> {
    const entry = this.indexes.get(key);
    if (!entry) throw new Error('This project is not indexed yet. Close the chat and open it again.');
    const { index } = entry;
    const config = await this.gateway.getConfig();
    const installed = await this.ollama.installed(config.ollamaUrl);

    onProgress?.({ stage: 'find' });
    const embedModel = installed?.find((m) => m === EMBED_MODEL || m.startsWith(`${EMBED_MODEL}:`));
    const hits = await index
      .search(input.question, TOP_DOCS, embedModel ? (inputs) => this.ollama.embed(config.ollamaUrl, embedModel, inputs) : undefined)
      .catch(() => index.search(input.question, TOP_DOCS)); // embeddings went away: keywords

    // Cards come from a small local model: the best installed one, else the Ollama model chosen in Settings.
    const chosen = config.models.ollama;
    const cardModel = CARD_MODELS.find((m) => installed?.includes(m)) || (chosen && installed?.includes(chosen) ? chosen : undefined);
    const condensed = await condense(
      hits.map((h) => h.doc),
      input.question,
      {
        model: cardModel,
        write: cardModel ? (system, user) => this.ollama.write(config.ollamaUrl, cardModel, system, user) : undefined,
        cache: this.cards,
        onProgress: (done, total) => onProgress?.({ stage: 'cards', done, total }),
      }
    );

    const shownIds = new Set(hits.map((h) => h.doc.id));
    const others = index.docs.filter((d) => !shownIds.has(d.id)).sort((a, b) => a.path.localeCompare(b.path));
    const facts = input.facts.slice(0, 8000);
    const user = buildUserMessage({ facts, question: input.question, condensed, others });
    onProgress?.({ stage: 'think' });
    const result = await this.gateway.converse(
      'chat',
      thinkerSystem(input.projectName),
      user,
      input.history.slice(-6),
      (ref) => {
        const doc = index.find(ref);
        return doc ? { path: doc.path, text: doc.body } : { error: `No document "${ref}" in this project. Use a path from the lists.` };
      },
      () => buildUserMessage({ facts, question: input.question, condensed, others, inline: { count: INLINE_FULL_DOCS, maxChars: INLINE_DOC_CHARS } })
    );

    // Every top hit is sent (broad questions need them), but only close matches are shown as sources.
    const strong = new Set(strongHits(hits, index.mode === 'embeddings' && !!embedModel).map((h) => h.doc.id));
    const sources: ChatSource[] = condensed
      .filter((c) => strong.has(c.doc.id))
      .map((c) => ({ id: c.doc.id, path: c.doc.path, title: c.doc.title, kind: c.kind }));
    for (const p of result.read || []) {
      const doc = index.find(p);
      const known = sources.find((s) => s.path === p);
      if (known) known.kind = 'read';
      else if (doc) sources.push({ id: doc.id, path: doc.path, title: doc.title, kind: 'read' });
    }
    return { ...result, sources, mode: index.mode, reason: index.reason, cardModel };
  }
}

/**
 * The hits close to the best one. Measured with nomic-embed-text: a specific question's document scores
 * 0.15–0.25 above the rest, while a broad question ("summarize the project") scores all within ~0.05.
 */
export function strongHits(hits: Hit[], byMeaning: boolean): Hit[] {
  if (!hits.length) return [];
  const best = hits[0].score;
  return hits.filter((h) => (byMeaning ? h.score >= best - 0.1 : h.score >= best / 2));
}

const summary = (index: ProjectIndex): IndexSummary => ({ docs: index.docs.length, mode: index.mode, ...(index.reason ? { reason: index.reason } : {}) });

/** Checks a renderer-sent document list: shape, count and total size. Returns clean copies. */
export function validateDocs(raw: unknown): PipelineDoc[] {
  if (!Array.isArray(raw)) throw new Error('Invalid document list');
  if (raw.length > MAX_INDEX_DOCS) throw new Error(`This project has more than ${MAX_INDEX_DOCS.toLocaleString('en-US')} documents; chat supports up to that many.`);
  let total = 0;
  return raw.map((d: any) => {
    if (!d || typeof d.id !== 'string' || typeof d.path !== 'string' || typeof d.body !== 'string') throw new Error('Invalid document');
    total += d.body.length;
    if (total > MAX_INDEX_CHARS) throw new Error('This project has too much text for chat.');
    return { id: d.id.slice(0, 2000), path: d.path.slice(0, 2000), title: typeof d.title === 'string' ? d.title.slice(0, 500) : d.path, body: d.body };
  });
}
