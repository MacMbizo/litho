/**
 * Claude through the official Anthropic SDK (main process only; the key never reaches the renderer).
 * Adaptive thinking with effort set per task, the server-side refusal fallback, and stop_reason checked
 * before any text is read.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { CompletionRequest, CompletionResult, ConverseRequest, DocReader, ModelOption } from './types';

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

/**
 * The system prompt as blocks. A persona goes first with a cache breakpoint, so repeat requests read it from
 * the cache (cache reads cost 1/20 of normal input on Opus 5.5); the task's own instructions follow, and the
 * documents and question stay in the user message after it. Nothing volatile may go before the breakpoint.
 * The cache is per model and effort, so each task (fixed effort) keeps its own warm copy.
 */
export function claudeSystem(req: Pick<CompletionRequest, 'persona' | 'system' | 'cacheTtl'>): string | Anthropic.Beta.BetaTextBlockParam[] {
  if (!req.persona) return req.system;
  // 5 minutes is the API default, so it's left implicit; 1 hour must be asked for.
  const cache_control: Anthropic.Beta.BetaCacheControlEphemeral = req.cacheTtl === '1h' ? { type: 'ephemeral', ttl: '1h' } : { type: 'ephemeral' };
  const blocks: Anthropic.Beta.BetaTextBlockParam[] = [{ type: 'text', text: req.persona, cache_control }];
  // The API refuses empty text blocks.
  if (req.system.trim()) blocks.push({ type: 'text', text: req.system });
  return blocks;
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
      system: claudeSystem(req),
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
        cacheWrite: message.usage.cache_creation_input_tokens ?? 0,
      },
    };
  } catch (e) {
    throw new Error(claudeErrorMessage(e));
  }
}

/** Tool rounds before the model must answer with what it has (each round can read several docs). */
export const MAX_TOOL_ROUNDS = 5;
/** A document read in full is cut here; the model is told it was cut. */
export const READ_DOC_MAX_CHARS = 60000;

export const READ_DOC_TOOL: Anthropic.Beta.BetaTool = {
  name: 'read_doc',
  description:
    'Read the full text of one of this project\'s documents. Use it when a doc card or excerpt is not enough to answer precisely, or to check a detail before stating it. Pass the document path exactly as listed.',
  input_schema: {
    type: 'object',
    properties: { path: { type: 'string', description: 'The document path as listed, e.g. docs/architecture.md' } },
    required: ['path'],
    additionalProperties: false,
  },
  // Inputs stream as generated; the server no longer validates them, so the loop below does.
  eager_input_streaming: true,
};

function runReadDoc(input: unknown, read: DocReader, readPaths: string[]): { content: string; is_error?: boolean } {
  const ref = input && typeof input === 'object' ? (input as any).path : undefined;
  if (typeof ref !== 'string' || !ref.trim()) return { content: 'read_doc needs a "path" string.', is_error: true };
  const r = read(ref);
  if ('error' in r) return { content: r.error, is_error: true };
  if (!readPaths.includes(r.path)) readPaths.push(r.path);
  const cut = r.text.length > READ_DOC_MAX_CHARS;
  return { content: `${r.path}\n\n${r.text.slice(0, READ_DOC_MAX_CHARS)}${cut ? `\n\n[Cut at ${READ_DOC_MAX_CHARS.toLocaleString('en-US')} characters.]` : ''}` };
}

/**
 * The thinker on Claude: a conversation where Claude may read project documents in full (read_doc) before
 * answering. The persona and task instructions are cached in `system`; automatic caching also covers the
 * growing message tail, so the doc cards aren't billed in full again on each tool round. Assistant turns
 * are sent back unchanged (thinking and fallback blocks included), as the API requires.
 */
export async function claudeConverse(apiKey: string, req: ConverseRequest, read: DocReader): Promise<CompletionResult> {
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    ...req.history.map((t) => ({ role: t.role, content: t.text })),
    { role: 'user', content: req.user },
  ];
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const readPaths: string[] = [];
  let jsonRetries = 0;
  try {
    for (let round = 0; ; round++) {
      const lastRound = round >= MAX_TOOL_ROUNDS;
      const stream = client(apiKey).beta.messages.stream({
        model: req.model || CLAUDE_DEFAULT_MODEL,
        max_tokens: req.maxTokens ?? 32000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        thinking: { type: 'adaptive' },
        output_config: { effort: req.effort },
        cache_control: { type: 'ephemeral' },
        system: claudeSystem(req),
        tools: [READ_DOC_TOOL],
        // After the last round the tool stays defined (so the cache holds) but can't be called.
        tool_choice: lastRound ? { type: 'none' } : { type: 'auto' },
        messages,
      });
      let message: Anthropic.Beta.BetaMessage;
      try {
        message = await stream.finalMessage();
        jsonRetries = 0;
      } catch (e) {
        // An unparseable streamed tool input or a dropped connection: re-issue the turn (twice at most).
        if (e instanceof Anthropic.APIError || jsonRetries++ >= 2) throw e;
        round--;
        continue;
      }
      usage.input += message.usage.input_tokens;
      usage.output += message.usage.output_tokens;
      usage.cacheRead += message.usage.cache_read_input_tokens ?? 0;
      usage.cacheWrite += message.usage.cache_creation_input_tokens ?? 0;
      if (message.stop_reason === 'refusal') {
        const category = message.stop_details?.category;
        throw new Error(`Claude declined this request${category ? ` (${category})` : ''}.`);
      }
      if (message.stop_reason === 'pause_turn') {
        messages.push({ role: 'assistant', content: message.content });
        continue;
      }
      const toolUses = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
      if (message.stop_reason !== 'tool_use' || !toolUses.length) {
        const text = message.content
          .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('');
        return { text, model: message.model, truncated: message.stop_reason === 'max_tokens', usage, read: readPaths };
      }
      messages.push({ role: 'assistant', content: message.content });
      messages.push({
        role: 'user',
        content: toolUses.map((t) => ({
          type: 'tool_result' as const,
          tool_use_id: t.id,
          ...(t.name === 'read_doc' ? runReadDoc(t.input, read, readPaths) : { content: `Unknown tool ${t.name}.`, is_error: true }),
        })),
      });
    }
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
