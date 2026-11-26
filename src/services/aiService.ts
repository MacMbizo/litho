/**
 * The renderer's door to AI. On the desktop app every call goes to the main-process gateway, which holds
 * the API keys (encrypted with the OS keychain) and picks provider and model from AI Settings. The browser
 * dev build has no gateway: it can use a local Ollama directly and nothing else, and stores no keys.
 */
import type { AIConfig, AIProvider, AITask, CompletionResult } from '../../electron/ai/types';
import type { PersonaInfo } from '../../electron/ai/personas';

export type { AIConfig, AIProvider, AITask, PersonaInfo };

/** One finished AI call: the answer plus what ran it. */
export type AIRun = CompletionResult & { provider: AIProvider; persona?: { id: string; name: string } };

/**
 * A short line about a run, e.g. "Persona: Architect · 18,240 tokens from cache". Shown under answers so
 * the caching can be seen working; empty when there's nothing worth saying.
 */
export function describeRun(run: AIRun | null | undefined): string {
  if (!run) return '';
  const parts: string[] = [];
  if (run.persona) parts.push(`Persona: ${run.persona.name}`);
  const u = run.usage;
  if (u?.cacheRead) parts.push(`${u.cacheRead.toLocaleString('en-US')} tokens from cache`);
  else if (u?.cacheWrite) parts.push(`${u.cacheWrite.toLocaleString('en-US')} tokens cached for next time`);
  if (parts.length && run.model) parts.push(run.model);
  return parts.join(' · ');
}

export interface CategorizationResult {
  suggestedType: 'project' | 'agent' | 'skill' | 'document' | 'note';
  suggestedTags: string[];
  category: string;
  summary: string;
  statusRecommendation?: 'Backlog' | 'In Progress' | 'Review' | 'Done' | 'Active' | 'Draft';
}

/** The pre-gateway config, which kept keys in localStorage. Read once to migrate, then removed. */
const LEGACY_KEY = 'notion_markdown_ai_config';
/** Browser dev build only: which local Ollama model and address to use. */
const BROWSER_OLLAMA_KEY = 'litho_browser_ollama';

const hasGateway = () => typeof window !== 'undefined' && typeof window.electronAPI?.aiPrompt === 'function';

export class AIService {
  static isDesktop(): boolean {
    return hasGateway();
  }

  /**
   * Moves keys from the old localStorage config into the gateway's encrypted store, then deletes the old
   * copy. Safe to call on every launch; does nothing once migrated.
   */
  static async migrateLegacyKeys(): Promise<string[]> {
    if (!hasGateway()) return [];
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return [];
    try {
      const { movedKeys } = await window.electronAPI!.aiMigrateLegacy!(JSON.parse(raw));
      localStorage.removeItem(LEGACY_KEY);
      return movedKeys;
    } catch {
      return []; // keep the old copy; try again next launch
    }
  }

  static async getConfig(): Promise<AIConfig | null> {
    return hasGateway() ? window.electronAPI!.aiGetConfig!() : null;
  }

  static getBrowserOllama(): { url: string; model: string } {
    try {
      const v = JSON.parse(localStorage.getItem(BROWSER_OLLAMA_KEY) || '{}');
      return { url: typeof v.url === 'string' ? v.url : 'http://localhost:11434', model: typeof v.model === 'string' ? v.model : '' };
    } catch {
      return { url: 'http://localhost:11434', model: '' };
    }
  }

  static setBrowserOllama(v: { url: string; model: string }): void {
    localStorage.setItem(BROWSER_OLLAMA_KEY, JSON.stringify(v));
  }

  /** Browser build: is Ollama running, and which models can answer prompts? */
  static async checkOllama(baseUrl = 'http://localhost:11434'): Promise<{ ok: boolean; models: string[] }> {
    try {
      const res = await fetch(`${baseUrl}/api/tags`);
      if (!res.ok) return { ok: false, models: [] };
      const data = await res.json();
      return {
        ok: true,
        models: (data.models || [])
          .filter((m: any) => !Array.isArray(m.capabilities) || m.capabilities.includes('completion'))
          .map((m: any) => m.name),
      };
    } catch {
      return { ok: false, models: [] };
    }
  }

  /** Runs a prompt for a task (the task sets how hard Claude thinks). */
  static async complete(task: AITask, systemPrompt: string, userPrompt: string): Promise<AIRun> {
    if (hasGateway()) {
      try {
        return await window.electronAPI!.aiPrompt!({ task, system: systemPrompt, user: userPrompt });
      } catch (e: any) {
        // Electron wraps main-process errors ("Error invoking remote method 'ai:prompt': Error: …"): show the sentence only.
        throw new Error(String(e?.message || e).replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, ''));
      }
    }
    const { url, model } = this.getBrowserOllama();
    if (!model) throw new Error('In the browser, AI works only with a local Ollama: pick a model in AI Settings. Claude, Gemini and OpenAI need the desktop app.');
    const res = await fetch(`${url}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        options: { num_ctx: 16384 },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    }).catch(() => {
      throw new Error(`Ollama is not running at ${url}.`);
    });
    if (!res.ok) throw new Error(`Ollama error ${res.status}`);
    const data = await res.json();
    return { text: data?.message?.content || '', model, provider: 'ollama' };
  }

  static async prompt(systemPrompt: string, userPrompt: string, task: AITask = 'chat'): Promise<string> {
    return (await this.complete(task, systemPrompt, userPrompt)).text;
  }

  /** Summarize document content */
  /** Personas (desktop only): the files in the Personas folder, which lives in the Notes folder. */
  static async listPersonas(): Promise<{ folder: string | null; personas: PersonaInfo[] }> {
    if (!hasGateway() || !window.electronAPI?.aiListPersonas) return { folder: null, personas: [] };
    return window.electronAPI.aiListPersonas();
  }

  static async summarize(content: string, mode: 'bullet' | 'executive' | 'actions' = 'executive'): Promise<string> {
    return (await this.summarizeRun(content, mode)).text;
  }

  /** Like summarize, with the run's details (persona, cache use) for display. */
  static async summarizeRun(content: string, mode: 'bullet' | 'executive' | 'actions' = 'executive'): Promise<AIRun> {
    const instructions = {
      bullet: 'Summarize the following document into 5-7 crisp, high-impact bullet points with bold keywords.',
      executive: 'Produce a 2-paragraph executive briefing summarizing the core goal, current progress, and key challenges.',
      actions: 'Extract all action items, decisions, and next steps as a markdown checklist (- [ ] task).',
    }[mode];
    const systemPrompt = 'You are an expert executive project assistant and technical summarizer. Output clean, well-formatted Markdown.';
    return this.complete('summarize', systemPrompt, `${instructions}\n\nDocument Content:\n${content.slice(0, 15000)}`);
  }

  /** Categorize content, recommend tags, and suggest a document type */
  static async categorize(content: string): Promise<CategorizationResult> {
    const systemPrompt = `You are a taxonomy and metadata classifier for a Markdown project and agent knowledge base.
Analyze the markdown text and return a STRICT JSON object with no wrapping quotes or code fences.
Format:
{
  "suggestedType": "project" | "agent" | "skill" | "document" | "note",
  "suggestedTags": ["tag1", "tag2", "tag3"],
  "category": "Architecture | AI Ops | Documentation | Infrastructure | Frontend | Backend | General",
  "statusRecommendation": "Backlog" | "In Progress" | "Active" | "Draft" | "Done",
  "summary": "1-2 sentence overview"
}`;
    const rawResponse = await this.prompt(systemPrompt, `Analyze this markdown and classify it:\n\n${content.slice(0, 8000)}`, 'categorize');
    try {
      const clean = rawResponse.replace(/```json/g, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(clean);
      return {
        suggestedType: parsed.suggestedType || 'document',
        suggestedTags: Array.isArray(parsed.suggestedTags) ? parsed.suggestedTags : ['notes'],
        category: parsed.category || 'General',
        statusRecommendation: parsed.statusRecommendation || 'Active',
        summary: parsed.summary || 'Summary unavailable',
      };
    } catch {
      return {
        suggestedType: 'document',
        suggestedTags: ['auto-tagged', 'documentation'],
        category: 'General',
        statusRecommendation: 'Active',
        summary: rawResponse.slice(0, 160) + '...',
      };
    }
  }

  /** Interactive agent sandbox runner */
  static async runAgentSandbox(systemPrompt: string, userQuery: string, tools: string[] = []): Promise<string> {
    const toolContext = tools.length > 0 ? `\nYou have access to the following simulated tools: ${tools.join(', ')}.` : '';
    const fullSystem = `${systemPrompt}${toolContext}\nAlways act strictly according to your defined persona and return clear, actionable answers.`;
    return this.prompt(fullSystem, userQuery, 'agent');
  }
}
