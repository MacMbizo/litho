/**
 * Claude through the official Anthropic SDK (main process only; the key never reaches the renderer).
 * Adaptive thinking with effort set per task, the server-side refusal fallback, and stop_reason checked
 * before any text is read.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { CompletionRequest, CompletionResult, ModelOption } from './types';

export const CLAUDE_DEFAULT_MODEL = 'claude-opus-5-5';
/** Shown until the live list arrives (Models API). */
export const CLAUDE_FALLBACK_MODELS: ModelOption[] = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' },
];

const client = (apiKey: string) => new Anthropic({ apiKey, maxRetries: 2 });

/** A plain sentence for each failure the person can act on. */
export function claudeErrorMessage(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return 'Claude rejected the API key. Check it in AI Settings.';
  if (e instanceof Anthropic.PermissionDeniedError) return 'This Claude API key is not allowed to use that model.';
  if (e instanceof Anthropic.NotFoundError) return 'That Claude model was not found. Pick another in AI Settings.';
  if (e instanceof Anthropic.RateLimitError) return 'Claude is rate limiting this key. Try again in a moment.';
  if (e instanceof Anthropic.BadRequestError) return `Claude refused the request: ${e.message}`;
  if (e instanceof Anthropic.APIConnectionError) return 'Could not reach Claude. Check the internet connection.';
  if (e instanceof Anthropic.APIError) return `Claude error ${e.status ?? ''}: ${e.message}`.trim();
  return e instanceof Error ? e.message : String(e);
}

export async function claudeComplete(apiKey: string, req: CompletionRequest): Promise<CompletionResult> {
  try {
    // Streaming keeps long inputs and outputs clear of HTTP timeouts; finalMessage() collects the result.
    const stream = client(apiKey).beta.messages.stream({
      model: req.model || CLAUDE_DEFAULT_MODEL,
      max_tokens: req.maxTokens ?? 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      thinking: { type: 'adaptive' },
      output_config: { effort: req.effort },
      system: req.system,
      messages: [{ role: 'user', content: req.user }],
    });
    const message = await stream.finalMessage();
    if (message.stop_reason === 'refusal') {
      const category = message.stop_details?.category;
      throw new Error(`Claude declined this request${category ? ` (${category})` : ''}.`);
    }
    const text = message.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    return {
      text,
      model: message.model,
      truncated: message.stop_reason === 'max_tokens',
      usage: {
        input: message.usage.input_tokens,
        output: message.usage.output_tokens,
        cacheRead: message.usage.cache_read_input_tokens ?? 0,
      },
    };
  } catch (e) {
    throw new Error(claudeErrorMessage(e));
  }
}

export async function claudeModels(apiKey: string): Promise<ModelOption[]> {
  try {
    const out: ModelOption[] = [];
    for await (const m of client(apiKey).models.list()) out.push({ id: m.id, label: m.display_name || m.id });
    return out;
  } catch (e) {
    throw new Error(claudeErrorMessage(e));
  }
}
