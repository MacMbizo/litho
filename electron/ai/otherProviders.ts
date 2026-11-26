/**
 * Gemini, OpenAI and Ollama over their own HTTP APIs (main process). Keys travel in headers, never in URLs.
 * Model lists come live from each provider instead of being hardcoded.
 */
import { systemWithPersona, type CompletionRequest, type CompletionResult, type ModelOption } from './types';
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

const GEMINI = 'https://generativelanguage.googleapis.com/v1beta';

export async function geminiComplete(apiKey: string, req: CompletionRequest): Promise<CompletionResult> {
  if (!req.model) throw new Error('Pick a Gemini model in AI Settings.');
  const data = await call('Gemini', `${GEMINI}/models/${encodeURIComponent(req.model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemWithPersona(req) }] },
      contents: [{ role: 'user', parts: [{ text: req.user }] }],
      generationConfig: { maxOutputTokens: req.maxTokens ?? 16000 },
    }),
  });
  const cand = data?.candidates?.[0];
  if (!cand) throw new Error(`Gemini returned no answer${data?.promptFeedback?.blockReason ? ` (${data.promptFeedback.blockReason})` : ''}.`);
  return {
    text: (cand.content?.parts || []).map((p: any) => p.text || '').join(''),
    model: req.model,
    truncated: cand.finishReason === 'MAX_TOKENS',
    usage: data.usageMetadata
      ? { input: data.usageMetadata.promptTokenCount ?? 0, output: data.usageMetadata.candidatesTokenCount ?? 0, cacheRead: data.usageMetadata.cachedContentTokenCount ?? 0 }
      : undefined,
  };
}

export async function geminiModels(apiKey: string): Promise<ModelOption[]> {
  const data = await call('Gemini', `${GEMINI}/models?pageSize=200`, { headers: { 'x-goog-api-key': apiKey } }, 20_000);
  return (data?.models || [])
    .filter((m: any) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m: any) => ({ id: String(m.name).replace(/^models\//, ''), label: m.displayName || m.name }));
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
    throw new Error(/Could not reach Ollama/.test(e.message) ? `Ollama is not running at ${baseUrl}. Start it, then try again.` : e.message);
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
