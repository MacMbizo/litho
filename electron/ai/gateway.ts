/**
 * The one place AI calls happen. Features send a task + prompt; the gateway picks the provider, model and
 * key from settings, and returns text. Node only (no Electron import): settings file, key store and the
 * provider functions are injected so tests can drive it.
 */
import fs from 'fs';
import path from 'path';
import type { KeyStore } from './keyStore';
import { isCloudProvider } from './keyStore';
import { CLAUDE_DEFAULT_MODEL, CLAUDE_FALLBACK_MODELS, claudeComplete, claudeConverse, claudeModels } from './claude';
import { geminiComplete, geminiModels, ollamaComplete, ollamaModels, openaiComplete, openaiModels } from './otherProviders';
import { addStarterPersonas, createPersona, isPersonaId, listPersonas, readPersona, type PersonaInfo } from './personas';
import { AI_TASKS, TASK_EFFORT, type ChatTurn, type ConverseRequest, type DocReader, type AIConfig, type AIProvider, type AITask, type CompletionResult, type ModelOption } from './types';

export const DEFAULT_AI_CONFIG: AIConfig = {
  provider: 'claude',
  models: { claude: CLAUDE_DEFAULT_MODEL, gemini: '', openai: '', ollama: '' },
  ollamaUrl: 'http://localhost:11434',
  personas: {},
  cacheTtl: '5m',
};

const PROVIDERS: AIProvider[] = ['claude', 'gemini', 'openai', 'ollama'];
const isProvider = (p: unknown): p is AIProvider => typeof p === 'string' && (PROVIDERS as string[]).includes(p);

/** Settings from disk or the renderer, reduced to known fields with sane values. */
export function normalizeConfig(raw: any): AIConfig {
  const c = raw && typeof raw === 'object' ? raw : {};
  const models = { ...DEFAULT_AI_CONFIG.models };
  for (const p of PROVIDERS) {
    const m = c.models?.[p];
    if (typeof m === 'string' && m.length <= 200 && !/[\s/\\]{2,}|[\r\n]/.test(m)) models[p] = m.trim();
  }
  if (!models.claude) models.claude = CLAUDE_DEFAULT_MODEL;
  const personas: AIConfig['personas'] = {};
  for (const t of AI_TASKS) if (isPersonaId(c.personas?.[t])) personas[t] = c.personas[t];
  return {
    provider: isProvider(c.provider) ? c.provider : DEFAULT_AI_CONFIG.provider,
    models,
    ollamaUrl: typeof c.ollamaUrl === 'string' && /^https?:\/\//.test(c.ollamaUrl) ? c.ollamaUrl.trim() : DEFAULT_AI_CONFIG.ollamaUrl,
    personas,
    cacheTtl: c.cacheTtl === '1h' ? '1h' : '5m',
  };
}

/** The pre-gateway localStorage config (keys in plain text, old field names). */
export interface LegacyAIConfig {
  provider?: string;
  ollamaUrl?: string;
  ollamaModel?: string;
  geminiApiKey?: string;
  geminiModel?: string;
  openaiApiKey?: string;
  openaiModel?: string;
}

export interface Providers {
  complete: (provider: AIProvider, key: string | undefined, ollamaUrl: string, req: Parameters<typeof claudeComplete>[1]) => Promise<CompletionResult>;
  models: (provider: AIProvider, key: string | undefined, ollamaUrl: string) => Promise<ModelOption[]>;
  /** Claude's tool-using conversation (the thinker). Optional so older test doubles still fit. */
  converse?: (key: string, req: ConverseRequest, read: DocReader) => Promise<CompletionResult>;
}

export const realProviders: Providers = {
  converse: claudeConverse,
  complete: (p, key, url, req) =>
    p === 'claude' ? claudeComplete(key!, req) : p === 'gemini' ? geminiComplete(key!, req) : p === 'openai' ? openaiComplete(key!, req) : ollamaComplete(url, req),
  models: (p, key, url) => (p === 'claude' ? claudeModels(key!) : p === 'gemini' ? geminiModels(key!) : p === 'openai' ? openaiModels(key!) : ollamaModels(url)),
};

const LABEL: Record<AIProvider, string> = { claude: 'Claude', gemini: 'Gemini', openai: 'OpenAI', ollama: 'Ollama' };

export class AIGateway {
  constructor(
    private configFile: string,
    private keys: KeyStore,
    private providers: Providers = realProviders,
    /** The Personas folder (inside the Notes folder in use); null where there is none. */
    private personasDir: () => Promise<string | null> = async () => null
  ) {}

  async getConfig(): Promise<AIConfig> {
    try {
      return normalizeConfig(JSON.parse(await fs.promises.readFile(this.configFile, 'utf-8')));
    } catch {
      return { ...DEFAULT_AI_CONFIG, models: { ...DEFAULT_AI_CONFIG.models }, personas: {}, cacheTtl: '5m' };
    }
  }

  async personasFolder(): Promise<string | null> {
    return this.personasDir();
  }

  async listPersonas(): Promise<{ folder: string | null; personas: PersonaInfo[] }> {
    const folder = await this.personasDir();
    return { folder, personas: folder ? await listPersonas(folder) : [] };
  }

  async createPersona(name: string): Promise<string> {
    const folder = await this.personasDir();
    if (!folder) throw new Error('There is no Personas folder.');
    return createPersona(folder, name);
  }

  async addStarterPersonas(): Promise<string[]> {
    const folder = await this.personasDir();
    if (!folder) throw new Error('There is no Personas folder.');
    return addStarterPersonas(folder);
  }

  async setConfig(raw: unknown): Promise<AIConfig> {
    const config = normalizeConfig(raw);
    await fs.promises.mkdir(path.dirname(this.configFile), { recursive: true });
    await fs.promises.writeFile(this.configFile, JSON.stringify(config, null, 2), 'utf-8');
    return config;
  }

  /**
   * One-time move from the old localStorage config: keys into the key store, the rest into settings.
   * Returns what moved so the renderer can blank its copy. Never overwrites a key already stored.
   */
  async migrateLegacy(legacy: LegacyAIConfig): Promise<{ movedKeys: string[] }> {
    const movedKeys: string[] = [];
    const status = await this.keys.status();
    for (const [provider, key] of [
      ['gemini', legacy.geminiApiKey],
      ['openai', legacy.openaiApiKey],
    ] as const) {
      if (typeof key === 'string' && key.trim() && !status[provider].set) {
        await this.keys.set(provider, key);
        movedKeys.push(provider);
      }
    }
    const current = await this.getConfig();
    const fresh = !(await fs.promises.access(this.configFile).then(() => true, () => false));
    if (fresh) {
      await this.setConfig({
        provider: isProvider(legacy.provider) ? legacy.provider : current.provider,
        ollamaUrl: legacy.ollamaUrl || current.ollamaUrl,
        models: {
          ...current.models,
          // Old default model names (llama3, gemini-1.5-*) are likely gone; keep only what the person chose.
          ollama: legacy.ollamaModel && legacy.ollamaModel !== 'llama3:latest' ? legacy.ollamaModel : current.models.ollama,
          gemini: legacy.geminiModel && !/^gemini-1\.5/.test(legacy.geminiModel) ? legacy.geminiModel : current.models.gemini,
          openai: legacy.openaiModel || current.models.openai,
        },
      });
    }
    return { movedKeys };
  }

  async listModels(provider: AIProvider): Promise<{ models: ModelOption[]; error?: string }> {
    const config = await this.getConfig();
    const key = isCloudProvider(provider) ? await this.keys.get(provider) : undefined;
    if (isCloudProvider(provider) && !key) {
      return { models: provider === 'claude' ? CLAUDE_FALLBACK_MODELS : [], error: `Add a ${LABEL[provider]} API key to list its models.` };
    }
    try {
      return { models: await this.providers.models(provider, key, config.ollamaUrl) };
    } catch (e: any) {
      return { models: provider === 'claude' ? CLAUDE_FALLBACK_MODELS : [], error: e?.message || String(e) };
    }
  }

  /**
   * Runs a task. The persona is the one Settings picked for the task, unless `override.persona` names
   * another (a file id) or turns it off (null).
   */
  async prompt(
    task: AITask,
    system: string,
    user: string,
    override?: { provider?: AIProvider; persona?: string | null }
  ): Promise<CompletionResult & { provider: AIProvider; persona?: { id: string; name: string } }> {
    const r = await this.resolve(task, override);
    const result = await this.providers.complete(r.provider, r.key, r.config.ollamaUrl, { ...r.base, system, user });
    return { ...result, provider: r.provider, ...(r.persona ? { persona: r.persona } : {}) };
  }

  /** Provider, key, persona and model settings for a task: the part every call shares. */
  async resolve(task: AITask, override?: { provider?: AIProvider; persona?: string | null }) {
    const config = await this.getConfig();
    const provider = override?.provider && isProvider(override.provider) ? override.provider : config.provider;
    const key = isCloudProvider(provider) ? await this.keys.get(provider) : undefined;
    if (isCloudProvider(provider) && !key) throw new Error(`Add a ${LABEL[provider]} API key in AI Settings first.`);
    const personaId = override && 'persona' in override ? override.persona : config.personas[task];
    let persona: Awaited<ReturnType<typeof readPersona>> | undefined;
    if (personaId) {
      const folder = await this.personasDir();
      if (!folder) throw new Error('Personas need the desktop app.');
      persona = await readPersona(folder, personaId);
    }
    return {
      config,
      provider,
      key,
      persona: persona ? { id: persona.id, name: persona.name } : undefined,
      base: { persona: persona?.text, cacheTtl: config.cacheTtl, model: config.models[provider], effort: TASK_EFFORT[task] ?? ('medium' as const) },
    };
  }

  /**
   * The thinker: Claude converses with a read_doc tool. Other providers have no tool loop here, so the
   * caller inlines the documents they need (`fallbackUser`) and they get one ordinary request.
   */
  async converse(
    task: AITask,
    system: string,
    user: string,
    history: ChatTurn[],
    read: DocReader,
    fallbackUser: () => string
  ): Promise<CompletionResult & { provider: AIProvider; persona?: { id: string; name: string } }> {
    const r = await this.resolve(task);
    const result =
      r.provider === 'claude' && this.providers.converse
        ? await this.providers.converse(r.key!, { ...r.base, system, user, history }, read)
        : await this.providers.complete(r.provider, r.key, r.config.ollamaUrl, {
            ...r.base,
            system,
            user: [...history.map((t) => `${t.role === 'user' ? 'Earlier question' : 'Your earlier answer'}:\n${t.text}`), fallbackUser()].join('\n\n---\n\n'),
          });
    return { ...result, provider: r.provider, ...(r.persona ? { persona: r.persona } : {}) };
  }
}
