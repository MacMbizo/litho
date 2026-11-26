export type AIProvider = 'claude' | 'gemini' | 'openai' | 'ollama';
export type Effort = 'low' | 'medium' | 'high';

/** What a feature asks for: the gateway picks provider, model and key. */
export interface CompletionRequest {
  /**
   * A long, stable brief that goes first (personas.ts). Claude caches it; other providers get it joined to
   * the front of the system prompt, which keeps it a stable prefix for their own automatic caching.
   */
  persona?: string;
  system: string;
  user: string;
  model: string;
  /** How hard to think (Claude); other providers ignore it. */
  effort: Effort;
  maxTokens?: number;
}

export interface CompletionResult {
  text: string;
  model: string;
  /** The answer stopped at the token limit. */
  truncated?: boolean;
  usage?: {
    input: number;
    output: number;
    /** Prompt tokens served from the provider's cache (cheap). */
    cacheRead?: number;
    /** Prompt tokens written to the cache by this request (Claude). */
    cacheWrite?: number;
  };
}

export interface ModelOption {
  id: string;
  label: string;
}

/** Non-secret settings, kept in userData/docatlas/ai-config.json. Keys live in the KeyStore. */
export interface AIConfig {
  provider: AIProvider;
  models: Record<AIProvider, string>;
  ollamaUrl: string;
  /** Persona file (in the Personas folder) used for each task; absent = none. */
  personas: Partial<Record<AITask, string>>;
}

/** Tasks the app runs; each maps to an effort level. */
export type AITask = 'categorize' | 'summarize' | 'chat' | 'agent';
export const AI_TASKS: AITask[] = ['summarize', 'categorize', 'chat', 'agent'];
export const TASK_EFFORT: Record<AITask, Effort> = { categorize: 'low', summarize: 'medium', chat: 'medium', agent: 'medium' };

/** Joins a persona to the front of the system prompt, for providers without explicit cache blocks. */
export const systemWithPersona = (req: Pick<CompletionRequest, 'persona' | 'system'>) =>
  req.persona ? `${req.persona}\n\n---\n\n${req.system}` : req.system;
