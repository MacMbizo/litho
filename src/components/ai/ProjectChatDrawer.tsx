import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MessageSquare, Send, Sparkles, X, RefreshCw, ExternalLink, BookOpenCheck, AlertCircle } from 'lucide-react';
import { MarkdownFile } from '../../types/document';
import { AIService, describeRun } from '../../services/aiService';
import type { ChatProgress, ChatSource, IndexSummary } from '../../../electron/ai/projectChat';

interface ProjectChatDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  projectName: string;
  /** Identifies the project to the main process's chat index (its root path, or "notes"). */
  projectKey: string;
  /** DocAtlas's audit of the project as a short brief (projectFactsForAI). */
  facts: string;
  files: MarkdownFile[];
  onSelectFile: (id: string) => void;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  sources?: { fileId: string; fileName: string; kind?: ChatSource['kind'] }[];
  /** Persona and cache use for an answer (describeRun). */
  info?: string;
  /** An error shown in the chat: never sent back to the model as history. */
  failed?: boolean;
}

const stripRemote = (e: any) => String(e?.message || e).replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '');

const KIND_LABEL: Record<ChatSource['kind'], string> = {
  whole: 'Sent in full',
  card: 'Sent as a doc card',
  excerpt: 'Sent as an excerpt',
  read: 'Read in full by the AI',
};

function progressText(p: ChatProgress | null): string {
  if (!p) return 'Working…';
  const n = p.total ? ` (${p.done ?? 0}/${p.total})` : '';
  if (p.stage === 'index') return `Indexing documents${n}…`;
  if (p.stage === 'find') return 'Finding the relevant documents…';
  if (p.stage === 'cards') return `Writing doc cards${n}…`;
  return 'Thinking…';
}

/** Browser build only (no gateway): the top 4 keyword matches, 2,000 characters each. */
function keywordContext(files: MarkdownFile[], question: string) {
  const keywords = question.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  const scored = files
    .map((file) => {
      let score = 0;
      const title = (file.frontmatter.title || file.name).toLowerCase();
      const body = file.body.toLowerCase();
      for (const kw of keywords) {
        if (title.includes(kw)) score += 5;
        if ((file.frontmatter.tags || []).some((t) => t.toLowerCase().includes(kw))) score += 4;
        score += Math.min(body.split(kw).length - 1, 6);
      }
      return { file, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, 4);
}

export const ProjectChatDrawer: React.FC<ProjectChatDrawerProps> = ({ isOpen, onClose, projectName, projectKey, facts, files, onSelectFile }) => {
  const desktop = AIService.isDesktop() && typeof window.electronAPI?.aiProjectAsk === 'function';
  const [query, setQuery] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [index, setIndex] = useState<{ status: 'idle' | 'indexing' | 'ready' | 'error'; summary?: IndexSummary; error?: string }>({ status: 'idle' });
  const [progress, setProgress] = useState<ChatProgress | null>(null);
  const indexRun = useRef(0);

  // A new project starts a new conversation.
  useEffect(() => {
    setMessages([]);
    setIndex({ status: 'idle' });
  }, [projectKey]);

  const docs = useMemo(
    () => files.map((f) => ({ id: f.id, path: f.path.replace(/\\/g, '/'), title: f.frontmatter.title || f.name.replace(/\.mdx?$/i, ''), body: f.body })),
    [files]
  );

  useEffect(() => {
    if (!isOpen || !desktop) return;
    return window.electronAPI!.onAiProgress!((e) => {
      if (e.key === projectKey) setProgress(e);
    });
  }, [isOpen, desktop, projectKey]);

  // Index when the chat opens and when the documents change (the main process reuses cached vectors).
  useEffect(() => {
    if (!isOpen || !desktop) return;
    const run = ++indexRun.current;
    const t = setTimeout(async () => {
      setIndex((s) => ({ ...s, status: 'indexing' }));
      try {
        const summary = await window.electronAPI!.aiProjectIndex!(projectKey, docs);
        if (run === indexRun.current) setIndex({ status: 'ready', summary });
      } catch (e) {
        if (run === indexRun.current) setIndex({ status: 'error', error: stripRemote(e) });
      } finally {
        if (run === indexRun.current) setProgress(null);
      }
    }, 400);
    return () => clearTimeout(t);
  }, [isOpen, desktop, projectKey, docs]);

  if (!isOpen) return null;

  const busy = loading || (desktop && index.status === 'indexing');

  const handleSend = async (userQuestion?: string) => {
    const questionText = (userQuestion || query).trim();
    if (!questionText || busy) return;
    setQuery('');
    setLoading(true);
    setProgress(null);
    const history = messages.filter((m) => !m.failed).map((m) => ({ role: m.role, text: m.content }));
    setMessages((prev) => [...prev, { role: 'user', content: questionText }]);

    try {
      if (desktop) {
        const r = await window.electronAPI!.aiProjectAsk!(projectKey, { projectName, question: questionText, history, facts });
        const readNote = r.read?.length ? `read ${r.read.length} doc${r.read.length > 1 ? 's' : ''} in full` : '';
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: r.text,
            info: [describeRun(r), readNote].filter(Boolean).join(' · ') || undefined,
            sources: r.sources.map((s) => ({ fileId: s.id, fileName: s.title || s.path, kind: s.kind })),
          },
        ]);
      } else {
        const top = keywordContext(files, questionText);
        const context = top.map((m) => `--- DOCUMENT: ${m.file.name} ---\n${m.file.body.slice(0, 2000)}`).join('\n\n');
        const system = `You answer questions about the project "${projectName}" from its Markdown documents below. Be clear and factual, name the documents you use, and write clean Markdown.`;
        const run = await AIService.complete('chat', system, `Documents:\n\n${context}\n\nQuestion: ${questionText}`);
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: run.text,
            info: describeRun(run) || undefined,
            sources: top.map((m) => ({ fileId: m.file.id, fileName: m.file.frontmatter.title || m.file.name })),
          },
        ]);
      }
    } catch (err) {
      setMessages((prev) => [...prev, { role: 'assistant', content: `⚠️ ${stripRemote(err)}`, failed: true }]);
    } finally {
      setLoading(false);
      setProgress(null);
    }
  };

  const summary = index.summary;

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-full max-w-md bg-[#1d1d20] border-l border-[#2e2e34] shadow-2xl flex flex-col font-sans select-none animate-in slide-in-from-right duration-200">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-[#28282c] bg-[#18181a]">
        <div className="flex items-center gap-2 min-w-0">
          <div className="p-1.5 rounded-lg bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
            <Sparkles className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h3 className="text-xs font-semibold text-neutral-100">Project Assistant</h3>
            <p className="text-[10px] text-neutral-400 truncate">Ask anything across {projectName}</p>
          </div>
        </div>
        <button onClick={onClose} className="p-1.5 rounded hover:bg-[#2c2c30] text-neutral-400 hover:text-white transition" aria-label="Close project chat">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* How documents are matched */}
      {desktop && (
        <div className="px-4 py-2 border-b border-[#26262a] text-[10px] flex items-start gap-1.5" data-testid="chat-index-status">
          {index.status === 'indexing' ? (
            <>
              <RefreshCw className="w-3 h-3 mt-px animate-spin text-indigo-400 shrink-0" />
              <span className="text-neutral-400">{progressText(progress?.stage === 'index' ? progress : { stage: 'index' })}</span>
            </>
          ) : index.status === 'error' ? (
            <>
              <AlertCircle className="w-3 h-3 mt-px text-rose-400 shrink-0" />
              <span className="text-rose-300">{index.error}</span>
            </>
          ) : summary ? (
            summary.mode === 'embeddings' ? (
              <>
                <BookOpenCheck className="w-3 h-3 mt-px text-emerald-400 shrink-0" />
                <span className="text-neutral-400">
                  {summary.docs.toLocaleString('en-US')} documents indexed. Matching by meaning, on this PC.
                </span>
              </>
            ) : (
              <>
                <AlertCircle className="w-3 h-3 mt-px text-amber-400 shrink-0" />
                <span className="text-amber-300/90">{summary.reason || 'Matching by keywords.'}</span>
              </>
            )
          ) : null}
        </div>
      )}

      {/* Preset Quick Chips */}
      {messages.length === 0 && (
        <div className="p-4 border-b border-[#26262a] space-y-2">
          <div className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">Quick Inquiries</div>
          <div className="flex flex-wrap gap-1.5">
            {['Summarize Project Status', 'List Pending Action Items', 'What AI Agents are available?', 'Key Architecture Decisions'].map((preset) => (
              <button
                key={preset}
                onClick={() => handleSend(preset)}
                disabled={busy}
                className="text-[11px] px-2.5 py-1 rounded-lg bg-[#242428] hover:bg-[#2c2c32] text-neutral-300 hover:text-white border border-[#333338] transition disabled:opacity-40"
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
            <p className="text-xs font-medium text-neutral-300">Ask about this project</p>
            <p className="text-[11px] text-neutral-500 mt-1 max-w-xs leading-relaxed">
              {desktop
                ? 'The assistant finds the relevant documents on this PC, condenses long ones, and reads any document in full when it needs to.'
                : 'The assistant reads the best-matching documents and answers from them.'}
            </p>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex flex-col gap-1.5 text-xs ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
            <div
              className={`p-3.5 rounded-2xl whitespace-pre-wrap leading-relaxed max-w-[90%] select-text ${
                msg.role === 'user'
                  ? 'bg-blue-600 text-white font-medium rounded-br-none'
                  : 'bg-[#252529] border border-[#333338] text-neutral-200 rounded-bl-none shadow-sm'
              }`}
              data-testid={msg.role === 'assistant' ? 'chat-answer' : undefined}
            >
              {msg.content}
            </div>

            {msg.info && (
              <span className="text-[10px] text-neutral-500 pl-1" data-testid="ai-run-info">
                {msg.info}
              </span>
            )}

            {/* Sources */}
            {msg.sources && msg.sources.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1 pl-1" data-testid="chat-sources">
                <span className="text-[10px] text-neutral-500">Sources:</span>
                {msg.sources.map((src) => (
                  <button
                    key={src.fileId}
                    onClick={() => {
                      onSelectFile(src.fileId);
                      onClose();
                    }}
                    title={src.kind ? KIND_LABEL[src.kind] : undefined}
                    className={`text-[10px] px-2 py-0.5 rounded bg-[#18181a] hover:bg-[#222226] border transition flex items-center gap-1 ${
                      src.kind === 'read' ? 'text-emerald-300 border-emerald-700/50' : 'text-blue-400 hover:text-blue-300 border-[#2d2d33]'
                    }`}
                  >
                    {src.kind === 'read' && <BookOpenCheck className="w-2.5 h-2.5" />}
                    <span>{src.fileName}</span>
                    <ExternalLink className="w-2.5 h-2.5" />
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div className="flex items-center gap-2 text-xs text-indigo-400 italic" data-testid="chat-progress">
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            <span>{desktop ? progressText(progress) : 'Reading the documents…'}</span>
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
            placeholder="Ask a question about this project…"
            disabled={loading}
            aria-label="Question"
            className="flex-1 bg-transparent text-xs text-neutral-100 placeholder-neutral-500 focus:outline-none"
          />
          <button
            onClick={() => handleSend()}
            disabled={busy || !query.trim()}
            aria-label="Send question"
            className="p-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white transition shadow-sm"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
