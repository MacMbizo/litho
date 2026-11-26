import React, { useState, useEffect, useCallback } from 'react';
import { Settings, Check, X, RefreshCw, Cpu, Cloud, KeyRound, AlertCircle, NotebookPen, FolderOpen, RotateCcw, Lock, Trash2, Drama, FilePlus } from 'lucide-react';
import { AIService, type AIConfig, type AIProvider, type AITask, type PersonaInfo } from '../../services/aiService';
import type { ModelOption } from '../../../electron/ai/types';
import type { KeyStatus } from '../../../electron/ai/keyStore';
import { STARTER_PERSONAS } from '../../../electron/ai/starterPersonas';

/** Desktop only: where Ctrl+N notes are kept. Changes apply immediately (not on "Save"). */
export interface NotesFolderSettings {
  folder: string | null;
  defaultFolder: string | null;
  onChoose: () => void;
  onUseDefault: () => void;
  onReveal: () => void;
}

interface AISettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  notes?: NotesFolderSettings;
  /** Opens a Markdown file in the editor (a new persona, ready to write). */
  onOpenFile?: (fullPath: string) => void;
}

/** Tasks a persona can be picked for, in the order shown. */
const PERSONA_TASKS: Array<{ task: AITask; label: string; hint: string }> = [
  { task: 'chat', label: 'Project chat', hint: 'Questions about a project' },
  { task: 'summarize', label: 'Summaries', hint: 'Summarize a document' },
  { task: 'categorize', label: 'Classify', hint: 'Suggest type and tags' },
  { task: 'agent', label: 'Agent sandbox', hint: 'Added before the agent file' },
];

// Claude caches nothing under 512 tokens; the estimate is rough, so warn with some margin.
const personaSize = (p: PersonaInfo) => `${p.words.toLocaleString('en-US')} words${p.approxTokens < 600 ? ', no cache' : ''}`;

const sameFolder = (a: string | null, b: string | null) =>
  Boolean(a && b) && a!.replace(/[\\/]+$/, '').replace(/\\/g, '/').toLowerCase() === b!.replace(/[\\/]+$/, '').replace(/\\/g, '/').toLowerCase();

const PROVIDERS: Array<{ id: AIProvider; label: string; sub: string; Icon: React.FC<{ className?: string }>; keyHint?: string }> = [
  { id: 'claude', label: 'Claude', sub: 'Anthropic', Icon: Cloud, keyHint: 'sk-ant-…' },
  { id: 'gemini', label: 'Gemini', sub: 'Google', Icon: Cloud, keyHint: 'AIza…' },
  { id: 'openai', label: 'OpenAI', sub: 'GPT models', Icon: Cloud, keyHint: 'sk-…' },
  { id: 'ollama', label: 'Ollama', sub: 'On this PC', Icon: Cpu },
];

const input = 'w-full bg-[#222] border border-[#333] rounded px-2.5 py-1.5 text-neutral-200 focus:outline-none focus:border-purple-500 font-mono text-[11px]';

export const AISettingsModal: React.FC<AISettingsModalProps> = ({ isOpen, onClose, notes, onOpenFile }) => {
  const desktop = AIService.isDesktop();
  const [config, setConfig] = useState<AIConfig | null>(null);
  const [keys, setKeys] = useState<KeyStatus | null>(null);
  const [keyDraft, setKeyDraft] = useState('');
  const [keyError, setKeyError] = useState<string | null>(null);
  const [models, setModels] = useState<{ provider: AIProvider; list: ModelOption[]; error?: string; loading: boolean } | null>(null);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Browser dev build: a local Ollama only.
  const [browserOllama, setBrowserOllama] = useState(AIService.getBrowserOllama());
  const [browserModels, setBrowserModels] = useState<{ ok: boolean; models: string[] } | null>(null);
  // Personas (desktop only).
  const [personas, setPersonas] = useState<{ folder: string | null; personas: PersonaInfo[] } | null>(null);
  const [newPersonaName, setNewPersonaName] = useState<string | null>(null);
  const [personaError, setPersonaError] = useState<string | null>(null);

  const loadPersonas = useCallback(async () => {
    try {
      setPersonas(await AIService.listPersonas());
    } catch (e: any) {
      setPersonaError(e?.message || String(e));
    }
  }, []);

  const missingStarters = STARTER_PERSONAS.map((p) => p.id).filter(
    (id) => !personas?.personas.some((x) => x.id.toLowerCase() === id.toLowerCase())
  );

  const addStarters = async () => {
    setPersonaError(null);
    try {
      await window.electronAPI!.aiAddStarterPersonas!();
      await loadPersonas();
    } catch (e: any) {
      setPersonaError(String(e?.message || e).replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, ''));
    }
  };

  const createPersona = async () => {
    const name = (newPersonaName || '').trim();
    if (!name || !config) return;
    setPersonaError(null);
    try {
      const { path: file } = await window.electronAPI!.aiCreatePersona!(name);
      setNewPersonaName(null);
      await loadPersonas();
      if (onOpenFile) {
        // Keep any unsaved choices, then open the new persona to write it.
        await window.electronAPI!.aiSetConfig!(config);
        onClose();
        onOpenFile(file);
      }
    } catch (e: any) {
      setPersonaError(String(e?.message || e).replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, ''));
    }
  };

  const loadModels = useCallback(async (provider: AIProvider) => {
    setModels({ provider, list: [], loading: true });
    try {
      const r = await window.electronAPI!.aiListModels!(provider);
      setModels({ provider, list: r.models, error: r.error, loading: false });
      // No model chosen yet: start from the suggested one (still changeable before Save).
      if (r.suggested) setConfig((c) => (c && !c.models[provider] ? { ...c, models: { ...c.models, [provider]: r.suggested! } } : c));
    } catch (e: any) {
      setModels({ provider, list: [], error: e?.message || String(e), loading: false });
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setKeyDraft('');
    setKeyError(null);
    setSaveError(null);
    if (desktop) {
      Promise.all([AIService.getConfig(), window.electronAPI!.aiKeyStatus!()]).then(([c, k]) => {
        setConfig(c);
        setKeys(k);
        if (c) loadModels(c.provider);
      });
      setNewPersonaName(null);
      setPersonaError(null);
      loadPersonas();
    } else {
      const b = AIService.getBrowserOllama();
      setBrowserOllama(b);
      AIService.checkOllama(b.url).then(setBrowserModels);
    }
  }, [isOpen, desktop, loadModels, loadPersonas]);

  const pickProvider = (p: AIProvider) => {
    if (!config) return;
    setConfig({ ...config, provider: p });
    setKeyDraft('');
    setKeyError(null);
    loadModels(p);
  };

  // Keys are saved straight away (encrypted in the main process), separately from the rest of the settings.
  const saveKey = async () => {
    if (!config || config.provider === 'ollama' || !keyDraft.trim()) return;
    setKeyError(null);
    try {
      setKeys(await window.electronAPI!.aiSetKey!(config.provider, keyDraft));
      setKeyDraft('');
      loadModels(config.provider);
    } catch (e: any) {
      setKeyError(e?.message || String(e));
    }
  };

  const removeKey = async () => {
    if (!config || config.provider === 'ollama') return;
    setKeys(await window.electronAPI!.aiClearKey!(config.provider));
    loadModels(config.provider);
  };

  const testOllama = async () => {
    if (!config) return;
    // The gateway lists models from the saved address, so save it first.
    await window.electronAPI!.aiSetConfig!(config);
    loadModels('ollama');
  };

  const handleSave = async () => {
    setSaveError(null);
    try {
      if (desktop && config) await window.electronAPI!.aiSetConfig!(config);
      if (!desktop) AIService.setBrowserOllama(browserOllama);
      setSavedSuccess(true);
      setTimeout(() => {
        setSavedSuccess(false);
        onClose();
      }, 700);
    } catch (e: any) {
      setSaveError(e?.message || String(e));
    }
  };

  if (!isOpen) return null;

  const p = config?.provider;
  const meta = PROVIDERS.find((x) => x.id === p);
  const keyInfo = p && p !== 'ollama' ? keys?.[p] : undefined;
  const list = models && models.provider === p ? models : null;
  const current = p && config ? config.models[p] : '';
  const options = list ? [...list.list] : [];
  if (current && !options.some((o) => o.id === current)) options.unshift({ id: current, label: `${current} (saved)` });

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 font-sans" onClick={onClose}>
      <div className="w-full max-w-lg bg-[#202020] border border-[#383838] rounded-xl shadow-2xl overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#2f2f2f] bg-[#242424]">
          <div className="flex items-center gap-2">
            <Settings className="w-4 h-4 text-neutral-300" />
            <h2 className="text-sm font-semibold text-neutral-100">Settings</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-[#333] text-neutral-400 hover:text-white transition" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-5 text-xs max-h-[70vh] overflow-y-auto">
          {/* Notes folder */}
          {notes && (
            <div className="space-y-2">
              <label className="font-semibold text-neutral-300 flex items-center gap-1.5">
                <NotebookPen className="w-3.5 h-3.5 text-sky-400" />
                Notes folder
              </label>
              <div className="p-3 rounded-lg bg-[#181818] border border-[#2e2e2e] space-y-2.5">
                <div className="flex items-center gap-2 min-w-0">
                  <button
                    type="button"
                    onClick={notes.onReveal}
                    disabled={!notes.folder}
                    className="flex-1 min-w-0 text-left font-mono text-[11px] text-neutral-200 truncate hover:text-white disabled:text-neutral-500"
                    title={notes.folder ? `${notes.folder} (show in File Explorer)` : undefined}
                    data-testid="notes-folder-path"
                  >
                    {notes.folder || 'Loading…'}
                  </button>
                  {sameFolder(notes.folder, notes.defaultFolder) && (
                    <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-[#262626] text-neutral-400">Default</span>
                  )}
                </div>
                <p className="text-[11px] text-neutral-500 leading-relaxed">
                  New notes (Ctrl+N) are saved here. Changing it doesn't move existing notes; they stay in the old folder.
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={notes.onChoose}
                    className="px-2.5 py-1.5 rounded-md bg-[#262626] hover:bg-[#303030] border border-[#363636] text-neutral-200 flex items-center gap-1.5 transition"
                  >
                    <FolderOpen className="w-3.5 h-3.5 text-sky-400" />
                    <span>Change…</span>
                  </button>
                  {notes.defaultFolder && notes.folder && !sameFolder(notes.folder, notes.defaultFolder) && (
                    <button
                      type="button"
                      onClick={notes.onUseDefault}
                      className="px-2.5 py-1.5 rounded-md hover:bg-[#2a2a2a] text-neutral-400 hover:text-neutral-200 flex items-center gap-1.5 transition"
                      title={notes.defaultFolder}
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Use default</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {!desktop ? (
            /* Browser dev build: local Ollama only */
            <div className="space-y-3 p-3.5 rounded-lg bg-[#181818] border border-[#2e2e2e]" data-testid="ai-browser-ollama">
              <span className="font-medium text-neutral-300 block">AI in the browser: local Ollama only</span>
              <p className="text-[11px] text-neutral-500">Claude, Gemini and OpenAI keys are stored only by the desktop app, which keeps them encrypted.</p>
              <input className={input} value={browserOllama.url} onChange={(e) => setBrowserOllama({ ...browserOllama, url: e.target.value })} aria-label="Ollama address" />
              <select className={input} value={browserOllama.model} onChange={(e) => setBrowserOllama({ ...browserOllama, model: e.target.value })} aria-label="Ollama model">
                <option value="">Choose a model…</option>
                {(browserModels?.models || []).map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              {browserModels && !browserModels.ok && <p className="text-amber-400 text-[11px]">Ollama isn't running at that address.</p>}
            </div>
          ) : !config ? (
            <p className="text-neutral-500">Loading AI settings…</p>
          ) : (
            <>
              {/* Provider */}
              <div className="space-y-2">
                <label className="font-semibold text-neutral-300 block">AI provider</label>
                <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label="AI provider">
                  {PROVIDERS.map(({ id, label, sub, Icon }) => {
                    const ready = id === 'ollama' || keys?.[id as 'claude']?.set;
                    return (
                      <button
                        key={id}
                        type="button"
                        role="radio"
                        aria-checked={p === id}
                        onClick={() => pickProvider(id)}
                        className={`flex flex-col items-center justify-center gap-1 p-2.5 rounded-lg border transition ${
                          p === id ? 'bg-purple-950/30 border-purple-500 text-purple-200' : 'bg-[#1a1a1a] border-[#303030] text-neutral-400 hover:text-white hover:bg-[#252525]'
                        }`}
                      >
                        <Icon className="w-3.5 h-3.5" />
                        <span className="font-medium text-[11px]">{label}</span>
                        <span className="text-[9px] text-neutral-500 flex items-center gap-0.5">
                          {id !== 'ollama' && ready && <KeyRound className="w-2.5 h-2.5 text-emerald-400" />}
                          {sub}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-3 p-3.5 rounded-lg bg-[#181818] border border-[#2e2e2e]">
                {/* Key (cloud providers) */}
                {p !== 'ollama' && meta && (
                  <div className="space-y-1.5">
                    <label className="text-[11px] text-neutral-500 block">{meta.label} API key</label>
                    {keyInfo?.set ? (
                      <div className="flex items-center gap-2">
                        <span className="flex-1 font-mono text-[11px] text-neutral-200 flex items-center gap-1.5" data-testid="ai-key-saved">
                          <Lock className="w-3 h-3 text-emerald-400" /> Saved ••••{keyInfo.last4}
                        </span>
                        <button type="button" onClick={removeKey} className="px-2 py-1 rounded hover:bg-[#2a2a2a] text-neutral-400 hover:text-rose-300 flex items-center gap-1">
                          <Trash2 className="w-3 h-3" /> Remove
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <input
                          type="password"
                          value={keyDraft}
                          onChange={(e) => setKeyDraft(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && saveKey()}
                          placeholder={meta.keyHint}
                          className={input}
                          aria-label={`${meta.label} API key`}
                          autoComplete="off"
                        />
                        <button
                          type="button"
                          onClick={saveKey}
                          disabled={!keyDraft.trim()}
                          className="shrink-0 px-2.5 py-1.5 rounded bg-[#2a2a3a] hover:bg-purple-600/40 border border-purple-500/40 text-purple-100 disabled:opacity-40"
                        >
                          Save key
                        </button>
                      </div>
                    )}
                    {keyError && <p className="text-rose-300 text-[11px]">{keyError}</p>}
                    <p className="text-[10px] text-neutral-500 leading-relaxed">
                      Encrypted with Windows' secure storage and used only by this app to call {meta.label}. Documents you ask about are sent to {meta.sub === 'GPT models' ? 'OpenAI' : meta.sub}.
                    </p>
                  </div>
                )}

                {/* Ollama address */}
                {p === 'ollama' && (
                  <div className="space-y-1.5">
                    <label className="text-[11px] text-neutral-500 block">Ollama address</label>
                    <div className="flex items-center gap-2">
                      <input className={input} value={config.ollamaUrl} onChange={(e) => setConfig({ ...config, ollamaUrl: e.target.value })} aria-label="Ollama address" />
                      <button type="button" onClick={testOllama} className="shrink-0 flex items-center gap-1 text-[11px] text-purple-400 hover:text-purple-300">
                        <RefreshCw className="w-3 h-3" /> Test
                      </button>
                    </div>
                    <p className="text-[10px] text-neutral-500">Runs on this PC: nothing leaves it.</p>
                  </div>
                )}

                {/* Model */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] text-neutral-500">Model</label>
                    <button type="button" onClick={() => p && loadModels(p)} className="text-[10px] text-neutral-500 hover:text-neutral-300 flex items-center gap-1">
                      <RefreshCw className={`w-3 h-3 ${list?.loading ? 'animate-spin' : ''}`} /> Refresh list
                    </button>
                  </div>
                  <select
                    value={current}
                    onChange={(e) => p && setConfig({ ...config, models: { ...config.models, [p]: e.target.value } })}
                    className={input}
                    aria-label="Model"
                  >
                    {!current && <option value="">Choose a model…</option>}
                    {options.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label.startsWith(o.id) ? o.label : `${o.label} (${o.id})`}
                      </option>
                    ))}
                  </select>
                  {list?.loading && <p className="text-[11px] text-neutral-500">Fetching the model list…</p>}
                  {list?.error && (
                    <p className="text-[11px] text-amber-400 flex items-start gap-1.5">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" /> {list.error}
                    </p>
                  )}
                </div>
              </div>

              {/* Personas */}
              <div className="space-y-2" data-testid="ai-personas">
                <label className="font-semibold text-neutral-300 flex items-center gap-1.5">
                  <Drama className="w-3.5 h-3.5 text-fuchsia-400" />
                  Personas
                </label>
                <div className="p-3.5 rounded-lg bg-[#181818] border border-[#2e2e2e] space-y-3">
                  <p className="text-[11px] text-neutral-500 leading-relaxed">
                    A persona is a Markdown brief that tells the AI who to be for a task. Long is fine: with Claude it's cached, so after the first answer it costs about a
                    twentieth as much. Under about 450 words it's too short to cache ("no cache").
                  </p>
                  {PERSONA_TASKS.map(({ task, label, hint }) => {
                    const chosen = config.personas[task] || '';
                    const known = personas?.personas.find((x) => x.id === chosen);
                    return (
                      <div key={task} className="grid grid-cols-[7.5rem_1fr] items-center gap-2">
                        <span className="text-[11px] text-neutral-300" title={hint}>
                          {label}
                        </span>
                        <select
                          value={chosen}
                          onChange={(e) => {
                            const next = { ...config.personas };
                            if (e.target.value) next[task] = e.target.value;
                            else delete next[task];
                            setConfig({ ...config, personas: next });
                          }}
                          className={input}
                          aria-label={`Persona for ${label}`}
                        >
                          <option value="">None</option>
                          {chosen && personas && !known && <option value={chosen}>{chosen.replace(/\.md$/i, '')} (missing)</option>}
                          {(personas?.personas || []).map((x) => (
                            <option key={x.id} value={x.id} disabled={x.tooLarge}>
                              {x.name} ({personaSize(x)}){x.tooLarge ? ': too long' : ''}
                            </option>
                          ))}
                        </select>
                      </div>
                    );
                  })}
                  {personas && personas.personas.length === 0 && (
                    <p className="text-[11px] text-neutral-500">No personas yet. Add the starters, create your own, or put .md files in the Personas folder.</p>
                  )}
                  {missingStarters.length > 0 && personas && (
                    <button
                      type="button"
                      onClick={addStarters}
                      className="text-[11px] text-fuchsia-300 hover:text-fuchsia-200 flex items-center gap-1.5"
                      title={missingStarters.map((id) => id.replace(/\.md$/i, '')).join(', ')}
                      data-testid="add-starter-personas"
                    >
                      <FilePlus className="w-3.5 h-3.5" />
                      {missingStarters.length === STARTER_PERSONAS.length
                        ? `Add ${STARTER_PERSONAS.length} starter personas (${STARTER_PERSONAS.map((p) => p.id.replace(/\.md$/i, '')).join(', ')})`
                        : `Add the missing starter persona${missingStarters.length > 1 ? 's' : ''}`}
                    </button>
                  )}
                  <label className="flex items-start gap-2 text-[11px] text-neutral-300 cursor-pointer">
                    <input
                      type="checkbox"
                      className="mt-0.5 accent-fuchsia-500"
                      checked={config.cacheTtl === '1h'}
                      onChange={(e) => setConfig({ ...config, cacheTtl: e.target.checked ? '1h' : '5m' })}
                      aria-label="Keep personas cached for an hour"
                    />
                    <span>
                      Keep personas cached for an hour <span className="text-neutral-500">(Claude)</span>
                      <span className="block text-[10px] text-neutral-500 leading-relaxed">
                        Off: cached for 5 minutes, cheapest when you ask several questions in a row. On: the first answer costs a bit more, but the persona stays cheap if you come back
                        within the hour.
                      </span>
                    </span>
                  </label>
                  {newPersonaName !== null ? (
                    <div className="flex items-center gap-2">
                      <input
                        autoFocus
                        value={newPersonaName}
                        onChange={(e) => setNewPersonaName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') createPersona();
                          if (e.key === 'Escape') setNewPersonaName(null);
                        }}
                        placeholder="e.g. Software architect"
                        className={input}
                        aria-label="New persona name"
                        maxLength={120}
                      />
                      <button
                        type="button"
                        onClick={createPersona}
                        disabled={!newPersonaName.trim()}
                        className="shrink-0 px-2.5 py-1.5 rounded bg-[#2a2a3a] hover:bg-purple-600/40 border border-purple-500/40 text-purple-100 disabled:opacity-40"
                      >
                        Create
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setNewPersonaName('')}
                        className="px-2.5 py-1.5 rounded-md bg-[#262626] hover:bg-[#303030] border border-[#363636] text-neutral-200 flex items-center gap-1.5 transition"
                      >
                        <FilePlus className="w-3.5 h-3.5 text-fuchsia-400" />
                        <span>New persona…</span>
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          await window.electronAPI!.aiOpenPersonasFolder!();
                          loadPersonas();
                        }}
                        className="px-2.5 py-1.5 rounded-md hover:bg-[#2a2a2a] text-neutral-400 hover:text-neutral-200 flex items-center gap-1.5 transition"
                        title={personas?.folder || undefined}
                      >
                        <FolderOpen className="w-3.5 h-3.5" />
                        <span>Open folder</span>
                      </button>
                      <button
                        type="button"
                        onClick={loadPersonas}
                        className="ml-auto text-[10px] text-neutral-500 hover:text-neutral-300 flex items-center gap-1"
                      >
                        <RefreshCw className="w-3 h-3" /> Refresh
                      </button>
                    </div>
                  )}
                  {personaError && <p className="text-rose-300 text-[11px]">{personaError}</p>}
                </div>
              </div>
            </>
          )}
          {saveError && <p className="text-rose-300 text-[11px]">{saveError}</p>}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-[#2f2f2f] bg-[#242424]">
          <button onClick={onClose} className="px-3 py-1.5 rounded hover:bg-[#333] text-neutral-400 hover:text-white transition text-xs">
            Cancel
          </button>
          <button onClick={handleSave} className="flex items-center gap-1.5 px-4 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white font-medium transition text-xs shadow-sm">
            {savedSuccess ? <Check className="w-3.5 h-3.5" /> : null}
            <span>{savedSuccess ? 'Saved!' : 'Save'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
