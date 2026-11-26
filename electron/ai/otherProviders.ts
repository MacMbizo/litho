/**
 * Gemini, OpenAI and Ollama over their own HTTP APIs (main process). Keys travel in headers, never in URLs.
 * Model lists come live from each provider instead of being hardcoded.
 */
import { systemWithPersona, type CompletionRequest, type CompletionResult, type ConverseRequest, type DocReader, type ModelOption } from './types';
import { ollamaContextFor } from './personas';

async function readError(res: Response): Promise<string> {
  try {
    const j: any = await res.json();
    return j?.error?.message || j?.error || res.statusText;
  } catch {
    return res.statusText;
  }
}

function friendly(provider: string, status: number, detail: string): string {
  if (status === 401 || status === 403) return `${provider} rejected the API key. Check it in AI Settings.`;
  if (status === 404) return `${provider}: that model was not found. Pick another in AI Settings.`;
  if (status === 429) return `${provider} is rate limiting this key. Try again in a moment.`;
  return `${provider} error ${status}: ${detail}`;
}

async function call(provider: string, url: string, init: RequestInit, timeoutMs = 300_000): Promise<any> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e: any) {
    throw new Error(e?.name === 'TimeoutError' ? `${provider} took too long to answer.` : `Could not reach ${provider}: ${e?.message || e}`);
  }
  if (!res.ok) throw new Error(friendly(provider, res.status, await readError(res)));
  return res.json();
}

// --- Gemini -----------------------------------------------------------------------

let GEMINI = 'https://generativelanguage.googleapis.com/v1beta';
/** Tests point Gemini calls at a local stub. */
export function setGeminiBaseForTests(url: string) {
  GEMINI = url;
}

const geminiUsage = (u: any) =>
  u
    ? {
        input: u.promptTokenCount ?? 0,
        // Thinking tokens are billed as output.
        output: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0),
        cacheRead: u.cachedContentTokenCount ?? 0,
      }
    : undefined;

/** The answer text of a candidate: text parts only, never thought summaries. */
const geminiText = (cand: any) =>
  (cand?.content?.parts || [])
    .filter((p: any) => typeof p.text === 'string' && !p.thought)
    .map((p: any) => p.text)
    .join('');

/** A candidate that carries no usable answer, as a plain sentence. */
function geminiNoAnswer(data: any, cand: any): Error | null {
  if (!cand) return new Error(`Gemini returned no answer${data?.promptFeedback?.blockReason ? ` (blocked: ${data.promptFeedback.blockReason})` : ''}.`);
  const reason = cand.finishReason;
  if (reason && !['STOP', 'MAX_TOKENS'].includes(reason) && !cand.content?.parts?.length) return new Error(`Gemini stopped without an answer (${reason}).`);
  return null;
}

async function geminiGenerate(apiKey: string, model: string, body: unknown): Promise<any> {
  return call('Gemini', `${GEMINI}/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify(body),
  });
}

export async function geminiComplete(apiKey: string, req: CompletionRequest): Promise<CompletionResult> {
  if (!req.model) throw new Error('Pick a Gemini model in AI Settings.');
  const data = await geminiGenerate(apiKey, req.model, {
    systemInstruction: { parts: [{ text: systemWithPersona(req) }] },
    contents: [{ role: 'user', parts: [{ text: req.user }] }],
    generationConfig: { maxOutputTokens: req.maxTokens ?? 16000 },
  });
  const cand = data?.candidates?.[0];
  const err = geminiNoAnswer(data, cand);
  if (err) throw err;
  return { text: geminiText(cand), model: data?.modelVersion || req.model, truncated: cand.finishReason === 'MAX_TOKENS', usage: geminiUsage(data.usageMetadata) };
}

export const GEMINI_MAX_TOOL_ROUNDS = 5;
const GEMINI_READ_DOC_MAX_CHARS = 60000;

const GEMINI_READ_DOC = {
  name: 'read_doc',
  description:
    "Read the full text of one of this project's documents. Use it when a doc card or excerpt is not enough to answer precisely, or to check a detail before stating it. Pass the document path exactly as listed.",
  parameters: {
    type: 'object',
    properties: { path: { type: 'string', description: 'The document path as listed, e.g. docs/architecture.md' } },
    required: ['path'],
  },
};

/**
 * The thinker on Gemini: like Claude's, it may read project documents in full (read_doc, a function
 * call) before answering. The model's turns are sent back unchanged so thought signatures survive, and
 * all results of a turn go back together in one user turn. After GEMINI_MAX_TOOL_ROUNDS, further calls get
 * an error telling it to answer with what it has, and one more refusal ends the loop.
 */
export async function geminiConverse(apiKey: string, req: ConverseRequest, read: DocReader): Promise<CompletionResult> {
  if (!req.model) throw new Error('Pick a Gemini model in AI Settings.');
  const contents: any[] = [
    ...req.history.map((t) => ({ role: t.role === 'assistant' ? 'model' : 'user', parts: [{ text: t.text }] })),
    { role: 'user', parts: [{ text: req.user }] },
  ];
  const usage = { input: 0, output: 0, cacheRead: 0 };
  const readPaths: string[] = [];
  for (let round = 0; ; round++) {
    const data = await geminiGenerate(apiKey, req.model, {
      systemInstruction: { parts: [{ text: systemWithPersona(req) }] },
      contents,
      tools: [{ functionDeclarations: [GEMINI_READ_DOC] }],
      generationConfig: { maxOutputTokens: req.maxTokens ?? 32000 },
    });
    const u = geminiUsage(data?.usageMetadata);
    if (u) {
      usage.input += u.input;
      usage.output += u.output;
      usage.cacheRead += u.cacheRead;
    }
    const cand = data?.candidates?.[0];
    const err = geminiNoAnswer(data, cand);
    if (err) throw err;
    const calls = (cand.content?.parts || []).filter((p: any) => p.functionCall);
    const done = { text: geminiText(cand), model: data?.modelVersion || req.model, truncated: cand.finishReason === 'MAX_TOKENS', usage, read: readPaths };
    if (!calls.length || round > GEMINI_MAX_TOOL_ROUNDS) return done;
    contents.push(cand.content);
    const overLimit = round >= GEMINI_MAX_TOOL_ROUNDS;
    contents.push({
      role: 'user',
      parts: calls.map((p: any) => {
        const { id, name, args } = p.functionCall;
        let response: Record<string, string>;
        if (overLimit) response = { error: 'No more documents can be read for this question. Answer now with what you have.' };
        else if (name !== 'read_doc') response = { error: `Unknown function ${name}.` };
        else if (typeof args?.path !== 'string' || !args.path.trim()) response = { error: 'read_doc needs a "path" string.' };
        else {
          const r = read(args.path);
          if ('error' in r) response = { error: r.error };
          else {
            if (!readPaths.includes(r.path)) readPaths.push(r.path);
            const cut = r.text.length > GEMINI_READ_DOC_MAX_CHARS;
            response = { path: r.path, content: r.text.slice(0, GEMINI_READ_DOC_MAX_CHARS) + (cut ? '\n\n[Cut at 60,000 characters.]' : '') };
          }
        }
        return { functionResponse: { ...(id ? { id } : {}), name, response } };
      }),
    });
  }
}

export async function geminiModels(apiKey: string): Promise<ModelOption[]> {
  const data = await call('Gemini', `${GEMINI}/models?pageSize=200`, { headers: { 'x-goog-api-key': apiKey } }, 20_000);
  return (data?.models || [])
    .filter((m: any) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m: any) => ({ id: String(m.name).replace(/^models\//, ''), label: m.displayName || m.name }));
}

/**
 * A sensible model from Gemini's live list, so Gemini works as soon as a key is added. Google renames and
 * retires models often (2.5 Flash/Pro reroute on 2026-12-01), so nothing is hardcoded: prefer the newest
 * stable general-purpose Flash, skipping previews, lite, image, audio, TTS, live and embedding variants.
 */
export function suggestGeminiModel(models: ModelOption[]): string | undefined {
  const general = models.filter((m) => /^gemini-/.test(m.id) && !/(preview|exp|lite|image|tts|audio|live|transcribe|embed|thinking|latest|omni)/i.test(m.id));
  const version = (id: string) => (id.match(/^gemini-(\d+(?:\.\d+)?)/)?.[1] ? parseFloat(id.match(/^gemini-(\d+(?:\.\d+)?)/)![1]) : 0);
  const flash = general.filter((m) => /-flash(-\d+)?$/.test(m.id)).sort((a, b) => version(b.id) - version(a.id));
  if (flash.length) return flash[0].id;
  // Newer families may not say "flash" (e.g. gemini-4-hydrogen): the newest stable general model.
  return general.sort((a, b) => version(b.id) - version(a.id))[0]?.id;
}

// --- OpenAI -----------------------------------------------------------------------

export async function openaiComplete(apiKey: string, req: CompletionRequest): Promise<CompletionResult> {
  if (!req.model) throw new Error('Pick an OpenAI model in AI Settings.');
  const data = await call('OpenAI', 'https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: req.model,
      messages: [
        { role: 'system', content: systemWithPersona(req) },
        { role: 'user', content: req.user },
      ],
    }),
  });
  const choice = data?.choices?.[0];
  return {
    text: choice?.message?.content || '',
    model: data?.model || req.model,
    truncated: choice?.finish_reason === 'length',
    usage: data?.usage
      ? { input: data.usage.prompt_tokens ?? 0, output: data.usage.completion_tokens ?? 0, cacheRead: data.usage.prompt_tokens_details?.cached_tokens ?? 0 }
      : undefined,
  };
}

export async function openaiModels(apiKey: string): Promise<ModelOption[]> {
  const data = await call('OpenAI', 'https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${apiKey}` } }, 20_000);
  return (data?.data || [])
    .map((m: any) => String(m.id))
    .filter((id: string) => /^(gpt-|o\d|chatgpt-)/.test(id) && !/(audio|realtime|transcribe|tts|image|search|embedding)/.test(id))
    .sort()
    .map((id: string) => ({ id, label: id }));
}

// --- Ollama (local) ---------------------------------------------------------------

export function checkOllamaUrl(url: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error('The Ollama address is not a valid URL.');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('The Ollama address must start with http:// or https://');
  return u.origin;
}

export async function ollamaComplete(baseUrl: string, req: CompletionRequest): Promise<CompletionResult> {
  if (!req.model) throw new Error('Pick an Ollama model in AI Settings.');
  const data = await call('Ollama', `${checkOllamaUrl(baseUrl)}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: req.model,
      stream: false,
      // Sized to the prompt, so a long persona is never silently cut.
      options: { num_ctx: ollamaContextFor(systemWithPersona(req).length + req.user.length) },
      messages: [
        { role: 'system', content: systemWithPersona(req) },
        { role: 'user', content: req.user },
      ],
    }),
  }, 600_000).catch((e: Error) => {
    if (/Could not reach Ollama/.test(e.message)) throw new Error(`Ollama is not running at ${baseUrl}. Start it, then try again.`);
    // A model too big for the GPU at this context size fails to start (seen with qwen3-coder:30b on 8 GB).
    if (/out of memory|out-of-memory/i.test(e.message))
      throw new Error(`Ollama ran out of memory loading ${req.model} for a prompt this long. Pick a smaller model in AI Settings, or close other GPU apps.`);
    throw e;
  });
  return {
    text: data?.message?.content || '',
    model: data?.model || req.model,
    truncated: data?.done_reason === 'length',
    usage: { input: data?.prompt_eval_count ?? 0, output: data?.eval_count ?? 0 },
  };
}

export async function ollamaModels(baseUrl: string): Promise<ModelOption[]> {
  const data = await call('Ollama', `${checkOllamaUrl(baseUrl)}/api/tags`, {}, 5_000);
  return (data?.models || [])
    // Embedding-only models can't answer prompts.
    .filter((m: any) => !Array.isArray(m.capabilities) || m.capabilities.includes('completion'))
    .map((m: any) => ({ id: m.name, label: `${m.name}${m.details?.parameter_size ? ` (${m.details.parameter_size})` : ''}` }));
}

/**
 * A default Ollama model for answering, from the installed list: the largest general-purpose model of at
 * most 9B parameters (fits an 8 GB GPU with room for a long context). Coding and reasoning models are
 * skipped when a general one exists: they answer document questions worse or far slower.
 */
export function suggestOllamaModel(models: ModelOption[]): string | undefined {
  const size = (m: ModelOption) => parseFloat(m.label.match(/\((\d+(?:\.\d+)?)B\)/i)?.[1] || 'NaN');
  const special = (id: string) => /(coder|code|r1|reason|embed|vision|-vl|math)/i.test(id);
  const fits = models.filter((m) => !special(m.id) && size(m) <= 9).sort((a, b) => size(b) - size(a));
  if (fits.length) return fits[0].id;
  return models.filter((m) => !Number.isNaN(size(m))).sort((a, b) => size(a) - size(b))[0]?.id || models[0]?.id;
}

/** Every installed model name (including embedding models), or null when Ollama isn't reachable. */
export async function ollamaInstalled(baseUrl: string): Promise<string[] | null> {
  try {
    const data = await call('Ollama', `${checkOllamaUrl(baseUrl)}/api/tags`, {}, 3_000);
    return (data?.models || []).map((m: any) => String(m.name));
  } catch {
    return null;
  }
}

/** Embeddings for a batch of texts (/api/embed). Inputs past the model's context are truncated by Ollama. */
export async function ollamaEmbed(baseUrl: string, model: string, inputs: string[]): Promise<number[][]> {
  const data = await call(
    'Ollama',
    `${checkOllamaUrl(baseUrl)}/api/embed`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, input: inputs, truncate: true }) },
    120_000
  );
  const out = data?.embeddings;
  if (!Array.isArray(out) || out.length !== inputs.length) throw new Error('Ollama returned no embeddings.');
  return out;
}
