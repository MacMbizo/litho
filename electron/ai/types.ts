export type AIProvider = 'claude' | 'gemini' | 'openai' | 'ollama';
export type Effort = 'low' | 'medium' | 'high';

/** What a feature asks for: the gateway picks provider, model and key. */
export interface CompletionRequest {
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
  usage?: { input: number; output: number; cacheRead?: number };
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
}

/** Tasks the app runs; each maps to an effort level. */
export type AITask = 'categorize' | 'summarize' | 'chat' | 'agent';
export const TASK_EFFORT: Record<AITask, Effort> = { categorize: 'low', summarize: 'medium', chat: 'medium', agent: 'medium' };
