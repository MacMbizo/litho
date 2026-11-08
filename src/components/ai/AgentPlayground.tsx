import React, { useState } from 'react';
import { 
  Bot, 
  Send, 
  Sparkles, 
  Wrench, 
  Download, 
  Copy, 
  Check, 
  RefreshCw, 
  Sliders, 
  Layers,
  Terminal,
  Play
} from 'lucide-react';
import { MarkdownFile } from '../../types/document';
import { AIService } from '../../services/aiService';

interface AgentPlaygroundProps {
  files: MarkdownFile[];
  initialAgentId?: string;
  onSelectAgentFile: (id: string) => void;
}

interface ChatMessage {
  role: 'user' | 'agent';
  content: string;
}

export const AgentPlayground: React.FC<AgentPlaygroundProps> = ({
  files,
  initialAgentId,
  onSelectAgentFile,
}) => {
  const agentFiles = files.filter((f) => f.frontmatter.type === 'agent' || f.frontmatter.type === 'skill');
  const [selectedId, setSelectedId] = useState<string>(
    initialAgentId || (agentFiles[0]?.id || '')
  );

  const activeAgent = agentFiles.find((f) => f.id === selectedId) || agentFiles[0];
  const [userQuery, setUserQuery] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [copiedExport, setCopiedExport] = useState(false);

  // Extract system prompt from body or frontmatter
  const getSystemPrompt = (file?: MarkdownFile) => {
    if (!file) return 'You are a helpful AI assistant.';
    if (file.frontmatter.system_prompt) return file.frontmatter.system_prompt;
    const match = file.body.match(/## System Prompt\r?\n([\s\S]*?)(?=\r?\n##|$)/);
    return match ? match[1].trim() : file.body.slice(0, 1000);
  };

  const handleRun = async () => {
    if (!userQuery.trim() || !activeAgent || isRunning) return;

    const query = userQuery.trim();
    setUserQuery('');
    setMessages((prev) => [...prev, { role: 'user', content: query }]);
    setIsRunning(true);

    try {
      const systemPrompt = getSystemPrompt(activeAgent);
      const tools = activeAgent.frontmatter.tools || [];
      const response = await AIService.runAgentSandbox(systemPrompt, query, tools);

      setMessages((prev) => [...prev, { role: 'agent', content: response }]);
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        { role: 'agent', content: `⚠️ Error executing agent: ${err.message}` },
      ]);
    } finally {
      setIsRunning(false);
    }
  };

  const handleExportAntigravity = () => {
    if (!activeAgent) return;
    const exportSpec = {
      name: activeAgent.name.replace('.md', ''),
      description: activeAgent.frontmatter.title || 'Custom Agent',
      model: activeAgent.frontmatter.model || 'inherit',
      tools: activeAgent.frontmatter.tools || [],
      systemPrompt: getSystemPrompt(activeAgent),
    };

    navigator.clipboard.writeText(JSON.stringify(exportSpec, null, 2));
    setCopiedExport(true);
    setTimeout(() => setCopiedExport(false), 2000);
  };

  if (agentFiles.length === 0) {
    return (
      <div className="flex-1 h-full flex flex-col items-center justify-center p-8 text-neutral-400 font-sans">
        <Bot className="w-12 h-12 text-purple-400/50 mb-3" />
        <h2 className="text-base font-semibold text-neutral-200">No AI Agents or Skills Found</h2>
        <p className="text-xs text-neutral-500 mt-1 max-w-sm text-center">
          Create a new document with type "agent" or "skill" in the sidebar to test and execute it here.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 h-full flex bg-[#191919] font-sans overflow-hidden">
      {/* Left: Agent Selector & Inspector */}
      <div className="w-80 border-r border-[#2b2b2b] bg-[#1e1e1e] flex flex-col shrink-0">
        <div className="p-4 border-b border-[#2b2b2b]">
          <h2 className="text-sm font-semibold text-neutral-100 flex items-center gap-2">
            <Bot className="w-4 h-4 text-purple-400" />
            <span>Agent & Skill Registry</span>
          </h2>
          <p className="text-[11px] text-neutral-400 mt-0.5">
            Select an agent markdown spec to inspect and test
          </p>
        </div>

        {/* List of Agents */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {agentFiles.map((agent) => {
            const isSelected = agent.id === selectedId;
            return (
              <div
                key={agent.id}
                onClick={() => {
                  setSelectedId(agent.id);
                  setMessages([]);
                }}
                className={`p-2.5 rounded-lg cursor-pointer transition flex items-start gap-2.5 ${
                  isSelected
                    ? 'bg-[#2a2a2a] border border-purple-500/40 text-white'
                    : 'text-neutral-400 hover:bg-[#252525] hover:text-neutral-200'
                }`}
              >
                <div className="p-1.5 rounded bg-[#1c1c1c] border border-[#333] shrink-0 mt-0.5">
                  <Bot className="w-4 h-4 text-purple-400" />
                </div>
                <div className="flex-1 truncate">
                  <div className="font-medium text-xs truncate">
                    {agent.frontmatter.title || agent.name}
                  </div>
                  <div className="text-[10px] text-neutral-500 font-mono mt-0.5 truncate">
                    {agent.frontmatter.model || 'model unspecified'}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Active Agent Spec Inspector */}
        {activeAgent && (
          <div className="p-4 border-t border-[#2b2b2b] bg-[#181818] space-y-3">
            <div className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider flex items-center justify-between">
              <span>Spec & Tools</span>
              <button
                onClick={handleExportAntigravity}
                className="flex items-center gap-1 text-[10px] text-purple-400 hover:text-purple-300 transition"
                title="Copy Antigravity JSON Spec"
              >
                {copiedExport ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                <span>{copiedExport ? 'Copied Spec' : 'Export JSON'}</span>
              </button>
            </div>

            <div className="space-y-1.5 text-xs">
              <div className="flex items-center justify-between text-neutral-400">
                <span>Model:</span>
                <span className="font-mono text-purple-300 text-[11px]">
                  {activeAgent.frontmatter.model || 'llama3:latest'}
                </span>
              </div>
              <div className="flex items-center justify-between text-neutral-400">
                <span>Status:</span>
                <span className="text-emerald-400 font-medium text-[11px]">
                  {activeAgent.frontmatter.status || 'Active'}
                </span>
              </div>
            </div>

            {/* Tools list */}
            <div>
              <span className="text-[10px] text-neutral-500 block mb-1">Registered Tools:</span>
              <div className="flex flex-wrap gap-1">
                {(activeAgent.frontmatter.tools || []).map((t) => (
                  <span
                    key={t}
                    className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#222] border border-[#333] text-purple-300"
                  >
                    {t}
                  </span>
                ))}
                {(!activeAgent.frontmatter.tools || activeAgent.frontmatter.tools.length === 0) && (
                  <span className="text-[11px] text-neutral-600 italic">None configured</span>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Right: Live Interactive Sandbox Playground */}
      <div className="flex-1 flex flex-col bg-[#141414] overflow-hidden">
        {/* Sandbox Header */}
        <div className="p-4 border-b border-[#242424] bg-[#191919] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Terminal className="w-4 h-4 text-emerald-400" />
            <h3 className="text-xs font-semibold text-neutral-200">
              Interactive Execution Sandbox: {activeAgent?.frontmatter.title || activeAgent?.name}
            </h3>
          </div>
          <button
            onClick={() => activeAgent && onSelectAgentFile(activeAgent.id)}
            className="text-xs text-neutral-400 hover:text-white transition flex items-center gap-1"
          >
            <span>Edit Agent Spec</span>
            <span className="text-neutral-600">→</span>
          </button>
        </div>

        {/* Message Log */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {messages.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center text-center text-neutral-500">
              <Bot className="w-10 h-10 text-neutral-600 mb-2" />
              <p className="text-xs font-medium text-neutral-400">Agent Ready for Execution</p>
              <p className="text-[11px] text-neutral-600 max-w-sm mt-1">
                Enter a test prompt below to evaluate this agent's reasoning against its markdown system prompt.
              </p>
            </div>
          )}

          {messages.map((msg, i) => (
            <div
              key={i}
              className={`flex items-start gap-3 text-xs leading-relaxed ${
                msg.role === 'user' ? 'justify-end' : 'justify-start'
              }`}
            >
              {msg.role === 'agent' && (
                <div className="w-6 h-6 rounded bg-purple-900/40 border border-purple-500/30 flex items-center justify-center text-purple-300 shrink-0 mt-0.5">
                  <Bot className="w-3.5 h-3.5" />
                </div>
              )}
              <div
                className={`max-w-xl p-3.5 rounded-xl whitespace-pre-wrap ${
                  msg.role === 'user'
                    ? 'bg-blue-600 text-white font-medium rounded-br-none'
                    : 'bg-[#202020] border border-[#2d2d2d] text-neutral-200 rounded-bl-none shadow-sm'
                }`}
              >
                {msg.content}
              </div>
            </div>
          ))}

          {isRunning && (
            <div className="flex items-center gap-2 text-xs text-purple-400 italic">
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              <span>Agent is reasoning and synthesizing response...</span>
            </div>
          )}
        </div>

        {/* Prompt Input Box */}
        <div className="p-4 bg-[#191919] border-t border-[#242424]">
          <div className="flex items-center gap-2 bg-[#202020] border border-[#333333] rounded-xl px-3 py-2 shadow-inner">
            <input
              type="text"
              value={userQuery}
              onChange={(e) => setUserQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleRun();
                }
              }}
              placeholder={`Send test prompt to ${activeAgent?.frontmatter.title || 'agent'}...`}
              disabled={isRunning}
              className="flex-1 bg-transparent text-xs text-neutral-100 placeholder-neutral-500 focus:outline-none"
            />
            <button
              onClick={handleRun}
              disabled={isRunning || !userQuery.trim()}
              className="p-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white transition shadow-sm"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
