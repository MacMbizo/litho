import React, { useState } from 'react';
import { 
  MessageSquare, 
  Send, 
  Sparkles, 
  X, 
  RefreshCw, 
  Bot, 
  FileText, 
  CheckCircle2, 
  ExternalLink 
} from 'lucide-react';
import { MarkdownFile } from '../../types/document';
import { AIService } from '../../services/aiService';

interface ProjectChatDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  projectName: string;
  files: MarkdownFile[];
  onSelectFile: (id: string) => void;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  sources?: { fileId: string; fileName: string; snippet: string }[];
}

export const ProjectChatDrawer: React.FC<ProjectChatDrawerProps> = ({
  isOpen,
  onClose,
  projectName,
  files,
  onSelectFile,
}) => {
  const [query, setQuery] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  // Retrieve relevant excerpts from files
  const retrieveContext = (question: string) => {
    const qLower = question.toLowerCase();
    const keywords = qLower.split(/\s+/).filter((w) => w.length > 2);
    const scoredFiles: { file: MarkdownFile; score: number; snippet: string }[] = [];

    files.forEach((file) => {
      let score = 0;
      const titleLower = (file.frontmatter.title || file.name).toLowerCase();
      const bodyLower = file.body.toLowerCase();

      keywords.forEach((kw) => {
        if (titleLower.includes(kw)) score += 5;
        if ((file.frontmatter.tags || []).some((t) => t.toLowerCase().includes(kw))) score += 4;
        const matches = (bodyLower.match(new RegExp(kw, 'g')) || []).length;
        score += Math.min(matches, 6);
      });

      if (score > 0) {
        // Find best snippet
        const firstMatch = bodyLower.indexOf(keywords[0] || '');
        const start = Math.max(0, firstMatch - 30);
        const snippet = file.body.slice(start, start + 160).trim();

        scoredFiles.push({ file, score, snippet });
      }
    });

    scoredFiles.sort((a, b) => b.score - a.score);
    return scoredFiles.slice(0, 4);
  };

  const handleSend = async (userQuestion?: string) => {
    const questionText = userQuestion || query.trim();
    if (!questionText || loading) return;

    setQuery('');
    setLoading(true);

    // 1. Retrieve top matching documents
    const topMatches = retrieveContext(questionText);
    const sources = topMatches.map((m) => ({
      fileId: m.file.id,
      fileName: m.file.frontmatter.title || m.file.name,
      snippet: m.snippet,
    }));

    // Add user message immediately
    setMessages((prev) => [...prev, { role: 'user', content: questionText }]);

    try {
      // Build context prompt
      const contextBlocks = topMatches.map(
        (m) => `--- DOCUMENT: ${m.file.name} (Type: ${m.file.frontmatter.type || 'doc'}) ---\n${m.file.body.slice(0, 2000)}`
      ).join('\n\n');

      const systemPrompt = `You are an expert technical intelligence assistant for the project "${projectName}".
You have access to the project's local Markdown documentation below.
Answer the user's inquiry clearly, factually, and concisely using the provided context. If relevant, mention the source document names.
Always format your response using clean Markdown.`;

      const promptPayload = `Context Documents from Vault:\n\n${contextBlocks}\n\nUser Question: ${questionText}`;
      const answer = await AIService.prompt(systemPrompt, promptPayload);

      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: answer,
          sources: sources.length > 0 ? sources : undefined,
        },
      ]);
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: `⚠️ Failed to query project intelligence: ${err.message}`,
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-y-0 right-0 z-50 w-full max-w-md bg-[#1d1d20] border-l border-[#2e2e34] shadow-2xl flex flex-col font-sans select-none animate-in slide-in-from-right duration-200"
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-[#28282c] bg-[#18181a]">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-xs font-semibold text-neutral-100">Project Assistant</h3>
            <p className="text-[10px] text-neutral-400">Ask anything across {projectName}</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded hover:bg-[#2c2c30] text-neutral-400 hover:text-white transition"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Preset Quick Chips */}
      {messages.length === 0 && (
        <div className="p-4 border-b border-[#26262a] space-y-2">
          <div className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">
            Quick Inquiries
          </div>
          <div className="flex flex-wrap gap-1.5">
            {[
              'Summarize Project Status',
              'List Pending Action Items',
              'What AI Agents are available?',
              'Key Architecture Decisions',
            ].map((preset) => (
              <button
                key={preset}
                onClick={() => handleSend(preset)}
                className="text-[11px] px-2.5 py-1 rounded-lg bg-[#242428] hover:bg-[#2c2c32] text-neutral-300 hover:text-white border border-[#333338] transition"
              >
                {preset}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Chat Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-center text-neutral-500 p-6">
            <MessageSquare className="w-8 h-8 text-neutral-600 mb-2" />
            <p className="text-xs font-medium text-neutral-300">Semantic Vault Intelligence</p>
            <p className="text-[11px] text-neutral-500 mt-1 max-w-xs leading-relaxed">
              Ask questions about your roadmaps, agent definitions, or architecture specs. The assistant will retrieve relevant markdown files and summarize them.
            </p>
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex flex-col gap-1.5 text-xs ${
              msg.role === 'user' ? 'items-end' : 'items-start'
            }`}
          >
            <div
              className={`p-3.5 rounded-2xl whitespace-pre-wrap leading-relaxed max-w-[90%] ${
                msg.role === 'user'
                  ? 'bg-blue-600 text-white font-medium rounded-br-none'
                  : 'bg-[#252529] border border-[#333338] text-neutral-200 rounded-bl-none shadow-sm'
              }`}
            >
              {msg.content}
            </div>

            {/* Sources / Citations */}
            {msg.sources && msg.sources.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1 pl-1">
                <span className="text-[10px] text-neutral-500">Sources:</span>
                {msg.sources.map((src) => (
                  <button
                    key={src.fileId}
                    onClick={() => {
                      onSelectFile(src.fileId);
                      onClose();
                    }}
                    className="text-[10px] px-2 py-0.5 rounded bg-[#18181a] hover:bg-[#222226] text-blue-400 hover:text-blue-300 border border-[#2d2d33] transition flex items-center gap-1"
                  >
                    <span>{src.fileName}</span>
                    <ExternalLink className="w-2.5 h-2.5" />
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div className="flex items-center gap-2 text-xs text-indigo-400 italic">
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            <span>Scanning project documents and synthesizing answer...</span>
          </div>
        )}
      </div>

      {/* Input Box */}
      <div className="p-3 bg-[#18181a] border-t border-[#28282c]">
        <div className="flex items-center gap-2 bg-[#222226] border border-[#33333a] rounded-xl px-3 py-1.5 shadow-inner">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSend();
            }}
            placeholder="Ask question across this project..."
            disabled={loading}
            className="flex-1 bg-transparent text-xs text-neutral-100 placeholder-neutral-500 focus:outline-none"
          />
          <button
            onClick={() => handleSend()}
            disabled={loading || !query.trim()}
            className="p-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white transition shadow-sm"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
