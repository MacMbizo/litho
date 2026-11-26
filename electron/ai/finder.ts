/**
 * The finder (AI pipeline, step 1): picks the project documents most relevant to a question.
 *
 * Each document is split into a few chunks and embedded with a local Ollama embedding model
 * (nomic-embed-text). Vectors are cached on disk by content hash, so only new or changed documents are
 * embedded again, and the same file in two projects is embedded once. A document scores as its best chunk.
 * Without Ollama or the model, it falls back to keyword scoring, so questions still work.
 * Node only, with the embedder injected so tests can run it.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export interface PipelineDoc {
  /** The renderer's file id; answers link back with it. */
  id: string;
  /** Path relative to the project, shown to the model and used by read_doc. */
  path: string;
  title: string;
  body: string;
}

export const EMBED_MODEL = 'nomic-embed-text';
/** nomic-embed-text's context is 2,048 tokens; 1,500 characters stays well inside it. */
export const CHUNK_CHARS = 1500;
/** The first 6k characters of a document decide whether it's relevant; the thinker can read the rest. */
export const MAX_CHUNKS_PER_DOC = 4;
const EMBED_BATCH = 64;

export const hashText = (text: string) => crypto.createHash('sha256').update(text).digest('hex');

/** Splits on blank lines and headings, packing paragraphs up to CHUNK_CHARS; the title leads the first chunk. */
export function chunkDoc(doc: Pick<PipelineDoc, 'title' | 'path' | 'body'>): string[] {
  const paras = doc.body
    .replace(/^﻿/, '')
    .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '') // frontmatter
    .split(/\r?\n\s*\r?\n|\r?\n(?=#{1,6}\s)/)
    .map((p) => p.trim())
    .filter(Boolean);
  const chunks: string[] = [];
  let cur = `${doc.title} (${doc.path})`;
  for (const p of paras) {
    for (let i = 0; i < p.length; i += CHUNK_CHARS) {
      const piece = p.slice(i, i + CHUNK_CHARS);
      if (cur.length + piece.length + 2 > CHUNK_CHARS && cur) {
        chunks.push(cur);
        if (chunks.length >= MAX_CHUNKS_PER_DOC) return chunks;
        cur = piece;
      } else {
        cur = cur ? `${cur}\n\n${piece}` : piece;
      }
    }
  }
  if (cur && chunks.length < MAX_CHUNKS_PER_DOC) chunks.push(cur);
  return chunks;
}

/** Vectors per document hash, as raw float32 files: <dir>/<model>/<hh>/<hash>.bin (first 4 bytes = dimension). */
export class VectorCache {
  constructor(private dir: string) {}

  private file(model: string, hash: string) {
    return path.join(this.dir, model.replace(/[^a-zA-Z0-9._-]/g, '_'), hash.slice(0, 2), `${hash}.bin`);
  }

  async get(model: string, hash: string): Promise<Float32Array[] | null> {
    try {
      const buf = await fs.promises.readFile(this.file(model, hash));
      const dim = buf.readUInt32LE(0);
      const count = (buf.length - 4) / (dim * 4);
      if (!dim || !Number.isInteger(count)) return null;
      const all = new Float32Array(buf.buffer.slice(buf.byteOffset + 4, buf.byteOffset + buf.length));
      return Array.from({ length: count }, (_, i) => all.subarray(i * dim, (i + 1) * dim));
    } catch {
      return null;
    }
  }

  async set(model: string, hash: string, vectors: number[][]): Promise<void> {
    if (!vectors.length) return;
    const dim = vectors[0].length;
    const buf = Buffer.alloc(4 + vectors.length * dim * 4);
    buf.writeUInt32LE(dim, 0);
    vectors.forEach((v, i) => v.forEach((x, j) => buf.writeFloatLE(x, 4 + (i * dim + j) * 4)));
    const target = this.file(model, hash);
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    await fs.promises.writeFile(`${target}.tmp`, buf);
    await fs.promises.rename(`${target}.tmp`, target);
  }
}

function normalize(v: ArrayLike<number>): Float32Array {
  let n = 0;
  for (let i = 0; i < v.length; i++) n += v[i] * v[i];
  n = Math.sqrt(n) || 1;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / n;
  return out;
}

const dot = (a: Float32Array, b: Float32Array) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
};

export type Embedder = (inputs: string[]) => Promise<number[][]>;

/** A build stopped on purpose (another project's index took over); not a failure. */
export class IndexCancelled extends Error {
  constructor() {
    super('Indexing paused');
  }
}
export interface IndexProgress {
  done: number;
  total: number;
}

export interface Hit {
  doc: PipelineDoc;
  score: number;
}

/** One project's documents, searchable by meaning (vectors) or, failing that, by keywords. */
export class ProjectIndex {
  readonly byId = new Map<string, PipelineDoc>();
  readonly byPath = new Map<string, PipelineDoc>();
  private vectors = new Map<string, Float32Array[]>();
  mode: 'embeddings' | 'keywords' = 'keywords';
  /** Why the index fell back to keywords, for the UI. */
  reason?: string;

  constructor(readonly docs: PipelineDoc[]) {
    for (const d of docs) {
      this.byId.set(d.id, d);
      this.byPath.set(d.path.toLowerCase(), d);
    }
  }

  /** A doc by the path the model quotes (case-insensitive, either slash), or by id. */
  find(ref: string): PipelineDoc | undefined {
    const r = ref.trim().replace(/\\/g, '/').replace(/^\.\//, '');
    return this.byPath.get(r.toLowerCase()) || this.byId.get(ref);
  }

  /**
   * Embeds every document not already in the cache (batched), then holds all vectors in memory.
   * Throws on embedder failure, so the caller can fall back to keywords. `shouldStop` is checked between
   * batches: when it returns true this throws IndexCancelled, keeping everything embedded so far in the
   * disk cache, so a later build resumes where this one stopped.
   */
  async embedAll(
    model: string,
    embed: Embedder,
    cache: VectorCache,
    onProgress?: (p: IndexProgress) => void,
    shouldStop?: () => boolean
  ): Promise<void> {
    const pending: Array<{ doc: PipelineDoc; hash: string; chunks: string[] }> = [];
    for (const doc of this.docs) {
      const hash = hashText(`${doc.title}\n${doc.path}\n${doc.body}`);
      const cached = await cache.get(model, hash);
      if (cached) this.vectors.set(doc.id, cached.map(normalize));
      else pending.push({ doc, hash, chunks: chunkDoc(doc) });
    }
    const total = pending.length;
    let done = 0;
    onProgress?.({ done, total });
    // Batch chunks across documents; each document is written to the cache once all its chunks are back.
    let batch: Array<{ item: (typeof pending)[number]; text: string }> = [];
    const results = new Map<(typeof pending)[number], number[][]>();
    const flush = async () => {
      if (!batch.length) return;
      if (shouldStop?.()) throw new IndexCancelled();
      const out = await embed(batch.map((b) => `search_document: ${b.text}`));
      batch.forEach((b, i) => {
        const list = results.get(b.item) || [];
        list.push(out[i]);
        results.set(b.item, list);
      });
      batch = [];
      for (const [item, vecs] of results) {
        if (vecs.length === item.chunks.length) {
          await cache.set(model, item.hash, vecs);
          this.vectors.set(item.doc.id, vecs.map(normalize));
          results.delete(item);
          done++;
        }
      }
      onProgress?.({ done, total });
    };
    for (const item of pending) {
      if (!item.chunks.length) {
        done++;
        continue;
      }
      for (const text of item.chunks) {
        batch.push({ item, text });
        if (batch.length >= EMBED_BATCH) await flush();
      }
    }
    await flush();
    this.mode = 'embeddings';
    this.reason = undefined;
  }

  async search(question: string, k: number, embed?: Embedder): Promise<Hit[]> {
    if (this.mode === 'embeddings' && embed) {
      const [q] = await embed([`search_query: ${question}`]);
      const qv = normalize(q);
      const hits: Hit[] = [];
      for (const doc of this.docs) {
        const vecs = this.vectors.get(doc.id);
        if (!vecs?.length) continue;
        let best = -1;
        for (const v of vecs) best = Math.max(best, dot(qv, v));
        hits.push({ doc, score: best });
      }
      return hits.sort((a, b) => b.score - a.score).slice(0, k);
    }
    return keywordSearch(this.docs, question, k);
  }
}

const STOP = new Set('the and for with what how why does this that from are was were which into about have has will can its our your their there here when where who whom'.split(' '));

/** The fallback: title, path and body matches of the question's words. */
export function keywordSearch(docs: PipelineDoc[], question: string, k: number): Hit[] {
  const words = Array.from(new Set(question.toLowerCase().match(/[a-z0-9][a-z0-9_-]{2,}/g) || [])).filter((w) => !STOP.has(w));
  if (!words.length) return [];
  const hits: Hit[] = [];
  for (const doc of docs) {
    const head = `${doc.title} ${doc.path}`.toLowerCase();
    const body = doc.body.toLowerCase();
    let score = 0;
    for (const w of words) {
      if (head.includes(w)) score += 5;
      let n = 0;
      for (let i = body.indexOf(w); i !== -1 && n < 6; i = body.indexOf(w, i + w.length)) n++;
      score += n;
    }
    if (score > 0) hits.push({ doc, score });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, k);
}
