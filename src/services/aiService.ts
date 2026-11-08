export type AIProvider = 'ollama' | 'gemini' | 'openai';

export interface AIConfig {
  provider: AIProvider;
  ollamaUrl: string;
  ollamaModel: string;
  geminiApiKey: string;
  geminiModel: string;
  openaiApiKey: string;
  openaiModel: string;
}

export interface CategorizationResult {
  suggestedType: 'project' | 'agent' | 'skill' | 'document' | 'note';
  suggestedTags: string[];
  category: string;
  summary: string;
  statusRecommendation?: 'Backlog' | 'In Progress' | 'Review' | 'Done' | 'Active' | 'Draft';
}

export class AIService {
  private static DEFAULT_CONFIG_KEY = 'notion_markdown_ai_config';

  static getConfig(): AIConfig {
    const saved = localStorage.getItem(this.DEFAULT_CONFIG_KEY);
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        // fallback
      }
    }
    return {
      provider: 'ollama',
      ollamaUrl: 'http://localhost:11434',
      ollamaModel: 'llama3:latest',
      geminiApiKey: '',
      geminiModel: 'gemini-1.5-flash',
      openaiApiKey: '',
      openaiModel: 'gpt-4o-mini',
    };
  }

  static saveConfig(config: AIConfig): void {
    localStorage.setItem(this.DEFAULT_CONFIG_KEY, JSON.stringify(config));
  }

  /**
   * Check if Ollama is running and fetch available models
   */
  static async checkOllama(baseUrl: string = 'http://localhost:11434'): Promise<{ ok: boolean; models: string[] }> {
    try {
      const res = await fetch(`${baseUrl}/api/tags`, { method: 'GET' });
      if (!res.ok) return { ok: false, models: [] };
      const data = await res.json();
      const models = (data.models || []).map((m: any) => m.name);
      return { ok: true, models };
    } catch {
      return { ok: false, models: [] };
    }
  }

  /**
   * Execute general prompt across selected provider
   */
  static async prompt(systemPrompt: string, userPrompt: string, config?: AIConfig): Promise<string> {
    const activeConfig = config || this.getConfig();

    if (activeConfig.provider === 'ollama') {
      return this.callOllama(activeConfig, systemPrompt, userPrompt);
    } else if (activeConfig.provider === 'gemini') {
      return this.callGemini(activeConfig, systemPrompt, userPrompt);
    } else {
      return this.callOpenAI(activeConfig, systemPrompt, userPrompt);
    }
  }

  private static async callOllama(config: AIConfig, systemPrompt: string, userPrompt: string): Promise<string> {
    const res = await fetch(`${config.ollamaUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.ollamaModel || 'llama3',
        system: systemPrompt,
        prompt: userPrompt,
        stream: false,
      }),
    });

    if (!res.ok) {
      throw new Error(`Ollama error (${res.status}): Make sure Ollama is running locally at ${config.ollamaUrl}`);
    }

    const data = await res.json();
    return data.response || '';
  }

  private static async callGemini(config: AIConfig, systemPrompt: string, userPrompt: string): Promise<string> {
    if (!config.geminiApiKey) {
      throw new Error('Gemini API Key is missing. Please add it in AI Settings.');
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.geminiModel || 'gemini-1.5-flash'}:generateContent?key=${config.geminiApiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: `${systemPrompt}\n\nTask: ${userPrompt}` }],
          },
        ],
      }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(`Gemini error: ${err.error?.message || res.statusText}`);
    }

    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  }

  private static async callOpenAI(config: AIConfig, systemPrompt: string, userPrompt: string): Promise<string> {
    if (!config.openaiApiKey) {
      throw new Error('OpenAI API Key is missing. Please add it in AI Settings.');
    }

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.openaiApiKey}`,
      },
      body: JSON.stringify({
        model: config.openaiModel || 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(`OpenAI error: ${err.error?.message || res.statusText}`);
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
  }

  /**
   * Summarize document content
   */
  static async summarize(
    content: string,
    mode: 'bullet' | 'executive' | 'actions' = 'executive',
    config?: AIConfig
  ): Promise<string> {
    const instructions = {
      bullet: 'Summarize the following document into 5-7 crisp, high-impact bullet points with bold keywords.',
      executive: 'Produce a 2-paragraph executive briefing summarizing the core goal, current progress, and key challenges.',
      actions: 'Extract all action items, decisions, and next steps as a markdown checklist (- [ ] task).',
    }[mode];

    const systemPrompt = 'You are an expert executive project assistant and technical summarizer. Output clean, well-formatted Markdown.';
    return this.prompt(systemPrompt, `${instructions}\n\nDocument Content:\n${content.slice(0, 15000)}`, config);
  }

  /**
   * Automatically categorize content, recommend tags, and suggest document type
   */
  static async categorize(content: string, config?: AIConfig): Promise<CategorizationResult> {
    const systemPrompt = `You are a taxonomy and metadata classifier for a Notion-like project and agent knowledge base.
Analyze the markdown text and return a STRICT JSON object with no wrapping quotes or code fences.
Format:
{
  "suggestedType": "project" | "agent" | "skill" | "document" | "note",
  "suggestedTags": ["tag1", "tag2", "tag3"],
  "category": "Architecture | AI Ops | Documentation | Infrastructure | Frontend | Backend | General",
  "statusRecommendation": "Backlog" | "In Progress" | "Active" | "Draft" | "Done",
  "summary": "1-2 sentence overview"
}`;

    const rawResponse = await this.prompt(
      systemPrompt,
      `Analyze this markdown and classify it:\n\n${content.slice(0, 8000)}`,
      config
    );

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

  /**
   * Interactive Agent Sandbox Runner
   */
  static async runAgentSandbox(
    systemPrompt: string,
    userQuery: string,
    tools: string[] = [],
    config?: AIConfig
  ): Promise<string> {
    const toolContext = tools.length > 0 ? `\nYou have access to the following simulated tools: ${tools.join(', ')}.` : '';
    const fullSystem = `${systemPrompt}${toolContext}\nAlways act strictly according to your defined persona and return clear, actionable answers.`;
    return this.prompt(fullSystem, userQuery, config);
  }
}
