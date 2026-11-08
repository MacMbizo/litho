import React, { useState, useEffect } from 'react';
import { Settings, Check, X, RefreshCw, Cpu, Cloud, Key, AlertCircle } from 'lucide-react';
import { AIService, AIConfig, AIProvider } from '../../services/aiService';

interface AISettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AISettingsModal: React.FC<AISettingsModalProps> = ({ isOpen, onClose }) => {
  const [config, setConfig] = useState<AIConfig>(AIService.getConfig());
  const [ollamaStatus, setOllamaStatus] = useState<{ checked: boolean; ok: boolean; models: string[] }>({
    checked: false,
    ok: false,
    models: [],
  });
  const [checkingOllama, setCheckingOllama] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setConfig(AIService.getConfig());
      testOllama();
    }
  }, [isOpen]);

  const testOllama = async () => {
    setCheckingOllama(true);
    const result = await AIService.checkOllama(config.ollamaUrl);
    setOllamaStatus({
      checked: true,
      ok: result.ok,
      models: result.models,
    });
    setCheckingOllama(false);
  };

  const handleSave = () => {
    AIService.saveConfig(config);
    setSavedSuccess(true);
    setTimeout(() => {
      setSavedSuccess(false);
      onClose();
    }, 800);
  };

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 font-sans"
      onClick={onClose}
    >
      <div 
        className="w-full max-w-lg bg-[#202020] border border-[#383838] rounded-xl shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#2f2f2f] bg-[#242424]">
          <div className="flex items-center gap-2">
            <Settings className="w-4 h-4 text-neutral-300" />
            <h2 className="text-sm font-semibold text-neutral-100">AI Intelligence Settings</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-[#333] text-neutral-400 hover:text-white transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-5 text-xs">
          {/* Provider Selection */}
          <div className="space-y-2">
            <label className="font-semibold text-neutral-300 block">Active AI Provider</label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: 'ollama', label: 'Local Ollama', icon: <Cpu className="w-3.5 h-3.5" /> },
                { id: 'gemini', label: 'Google Gemini', icon: <Cloud className="w-3.5 h-3.5" /> },
                { id: 'openai', label: 'OpenAI', icon: <Cloud className="w-3.5 h-3.5" /> },
              ].map((prov) => (
                <button
                  key={prov.id}
                  onClick={() => setConfig({ ...config, provider: prov.id as AIProvider })}
                  className={`flex flex-col items-center justify-center gap-1.5 p-3 rounded-lg border transition ${
                    config.provider === prov.id
                      ? 'bg-purple-950/30 border-purple-500 text-purple-200'
                      : 'bg-[#1a1a1a] border-[#303030] text-neutral-400 hover:text-white hover:bg-[#252525]'
                  }`}
                >
                  {prov.icon}
                  <span className="font-medium text-[11px]">{prov.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Ollama Section */}
          {config.provider === 'ollama' && (
            <div className="space-y-3 p-3.5 rounded-lg bg-[#181818] border border-[#2e2e2e]">
              <div className="flex items-center justify-between">
                <span className="font-medium text-neutral-300">Local Ollama Configuration</span>
                <button
                  onClick={testOllama}
                  disabled={checkingOllama}
                  className="flex items-center gap-1 text-[11px] text-purple-400 hover:text-purple-300"
                >
                  <RefreshCw className={`w-3 h-3 ${checkingOllama ? 'animate-spin' : ''}`} />
                  <span>Test Connection</span>
                </button>
              </div>

              <div>
                <label className="text-[11px] text-neutral-500 block mb-1">Server URL</label>
                <input
                  type="text"
                  value={config.ollamaUrl}
                  onChange={(e) => setConfig({ ...config, ollamaUrl: e.target.value })}
                  className="w-full bg-[#222] border border-[#333] rounded px-2.5 py-1.5 text-neutral-200 focus:outline-none focus:border-purple-500 font-mono text-[11px]"
                />
              </div>

              <div>
                <label className="text-[11px] text-neutral-500 block mb-1">Model Name</label>
                {ollamaStatus.models.length > 0 ? (
                  <select
                    value={config.ollamaModel}
                    onChange={(e) => setConfig({ ...config, ollamaModel: e.target.value })}
                    className="w-full bg-[#222] border border-[#333] rounded px-2.5 py-1.5 text-neutral-200 focus:outline-none font-mono text-[11px]"
                  >
                    {ollamaStatus.models.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={config.ollamaModel}
                    onChange={(e) => setConfig({ ...config, ollamaModel: e.target.value })}
                    placeholder="llama3:latest"
                    className="w-full bg-[#222] border border-[#333] rounded px-2.5 py-1.5 text-neutral-200 focus:outline-none focus:border-purple-500 font-mono text-[11px]"
                  />
                )}
              </div>

              {ollamaStatus.checked && (
                <div className={`p-2 rounded text-[11px] flex items-center gap-2 ${
                  ollamaStatus.ok ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                }`}>
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  <span>
                    {ollamaStatus.ok
                      ? `Connected to Ollama (${ollamaStatus.models.length} models installed)`
                      : 'Ollama is not running. Start Ollama with `ollama serve`.'}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Gemini Section */}
          {config.provider === 'gemini' && (
            <div className="space-y-3 p-3.5 rounded-lg bg-[#181818] border border-[#2e2e2e]">
              <span className="font-medium text-neutral-300 block">Google Gemini API</span>

              <div>
                <label className="text-[11px] text-neutral-500 block mb-1">Gemini API Key</label>
                <input
                  type="password"
                  value={config.geminiApiKey}
                  onChange={(e) => setConfig({ ...config, geminiApiKey: e.target.value })}
                  placeholder="AIzaSy..."
                  className="w-full bg-[#222] border border-[#333] rounded px-2.5 py-1.5 text-neutral-200 focus:outline-none focus:border-purple-500 font-mono text-[11px]"
                />
              </div>

              <div>
                <label className="text-[11px] text-neutral-500 block mb-1">Model</label>
                <select
                  value={config.geminiModel}
                  onChange={(e) => setConfig({ ...config, geminiModel: e.target.value })}
                  className="w-full bg-[#222] border border-[#333] rounded px-2.5 py-1.5 text-neutral-200 focus:outline-none font-mono text-[11px]"
                >
                  <option value="gemini-1.5-flash">gemini-1.5-flash (Fast & Recommended)</option>
                  <option value="gemini-1.5-pro">gemini-1.5-pro (High Reasoning)</option>
                  <option value="gemini-2.0-flash">gemini-2.0-flash</option>
                </select>
              </div>
            </div>
          )}

          {/* OpenAI Section */}
          {config.provider === 'openai' && (
            <div className="space-y-3 p-3.5 rounded-lg bg-[#181818] border border-[#2e2e2e]">
              <span className="font-medium text-neutral-300 block">OpenAI API</span>

              <div>
                <label className="text-[11px] text-neutral-500 block mb-1">OpenAI API Key</label>
                <input
                  type="password"
                  value={config.openaiApiKey}
                  onChange={(e) => setConfig({ ...config, openaiApiKey: e.target.value })}
                  placeholder="sk-..."
                  className="w-full bg-[#222] border border-[#333] rounded px-2.5 py-1.5 text-neutral-200 focus:outline-none focus:border-purple-500 font-mono text-[11px]"
                />
              </div>

              <div>
                <label className="text-[11px] text-neutral-500 block mb-1">Model</label>
                <select
                  value={config.openaiModel}
                  onChange={(e) => setConfig({ ...config, openaiModel: e.target.value })}
                  className="w-full bg-[#222] border border-[#333] rounded px-2.5 py-1.5 text-neutral-200 focus:outline-none font-mono text-[11px]"
                >
                  <option value="gpt-4o-mini">gpt-4o-mini</option>
                  <option value="gpt-4o">gpt-4o</option>
                  <option value="o3-mini">o3-mini</option>
                </select>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-[#2f2f2f] bg-[#242424]">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded hover:bg-[#333] text-neutral-400 hover:text-white transition text-xs"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white font-medium transition text-xs shadow-sm"
          >
            {savedSuccess ? <Check className="w-3.5 h-3.5" /> : null}
            <span>{savedSuccess ? 'Saved!' : 'Save Configuration'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
