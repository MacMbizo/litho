import React, { useState } from 'react';
import { Sparkles, Check, Copy, Tag, RefreshCw, X, ArrowRight, Layers, Bot, Wrench } from 'lucide-react';
import { MarkdownFile } from '../../types/document';
import { AIService, CategorizationResult } from '../../services/aiService';

interface AISummaryModalProps {
  isOpen: boolean;
  onClose: () => void;
  file: MarkdownFile;
  onApplyMetadata: (updatedMetadata: any) => void;
  onAppendSummary: (summaryText: string) => void;
}

export const AISummaryModal: React.FC<AISummaryModalProps> = ({
  isOpen,
  onClose,
  file,
  onApplyMetadata,
  onAppendSummary,
}) => {
  const [activeTab, setActiveTab] = useState<'summarize' | 'categorize'>('summarize');
  const [summaryMode, setSummaryMode] = useState<'bullet' | 'executive' | 'actions'>('executive');
  const [loading, setLoading] = useState(false);
  const [summaryResult, setSummaryResult] = useState('');
  const [categoryResult, setCategoryResult] = useState<CategorizationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const handleGenerateSummary = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await AIService.summarize(file.body, summaryMode);
      setSummaryResult(res);
    } catch (err: any) {
      setError(err.message || 'Failed to generate summary');
    } finally {
      setLoading(false);
    }
  };

  const handleCategorize = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await AIService.categorize(file.body);
      setCategoryResult(res);
    } catch (err: any) {
      setError(err.message || 'Failed to categorize');
    } finally {
      setLoading(false);
    }
  };

  const handleApplyCategorization = () => {
    if (!categoryResult) return;
    const existingTags = file.frontmatter.tags || [];
    const mergedTags = Array.from(new Set([...existingTags, ...categoryResult.suggestedTags]));

    onApplyMetadata({
      ...file.frontmatter,
      type: categoryResult.suggestedType,
      tags: mergedTags,
      category: categoryResult.category || file.frontmatter.category,
      status: categoryResult.statusRecommendation || file.frontmatter.status,
    });
    onClose();
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(summaryResult);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div 
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 font-sans"
      onClick={onClose}
    >
      <div 
        className="w-full max-w-2xl bg-[#202020] border border-[#383838] rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#2f2f2f] bg-[#242424]">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-neutral-100">AI Intelligence Studio</h2>
              <p className="text-[11px] text-neutral-400">Analyzing: {file.frontmatter.title || file.name}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-[#333] text-neutral-400 hover:text-white transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="flex border-b border-[#2f2f2f] px-5 bg-[#1e1e1e]">
          <button
            onClick={() => setActiveTab('summarize')}
            className={`py-2.5 px-4 text-xs font-medium border-b-2 transition ${
              activeTab === 'summarize'
                ? 'border-purple-500 text-purple-300'
                : 'border-transparent text-neutral-400 hover:text-neutral-200'
            }`}
          >
            Summarize Document
          </button>
          <button
            onClick={() => {
              setActiveTab('categorize');
              if (!categoryResult) handleCategorize();
            }}
            className={`py-2.5 px-4 text-xs font-medium border-b-2 transition ${
              activeTab === 'categorize'
                ? 'border-purple-500 text-purple-300'
                : 'border-transparent text-neutral-400 hover:text-neutral-200'
            }`}
          >
            Auto-Categorize & Tag
          </button>
        </div>

        {/* Body Content */}
        <div className="p-5 overflow-y-auto space-y-4 flex-1">
          {error && (
            <div className="p-3 rounded-lg bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs">
              {error}
            </div>
          )}

          {activeTab === 'summarize' ? (
            <div className="space-y-4">
              {/* Summary Mode Controls */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1 bg-[#181818] p-1 rounded-lg border border-[#303030]">
                  <button
                    onClick={() => setSummaryMode('executive')}
                    className={`px-3 py-1 rounded text-xs transition ${
                      summaryMode === 'executive' ? 'bg-[#2c2c2c] text-white font-medium' : 'text-neutral-400 hover:text-white'
                    }`}
                  >
                    Executive Brief
                  </button>
                  <button
                    onClick={() => setSummaryMode('bullet')}
                    className={`px-3 py-1 rounded text-xs transition ${
                      summaryMode === 'bullet' ? 'bg-[#2c2c2c] text-white font-medium' : 'text-neutral-400 hover:text-white'
                    }`}
                  >
                    Key Bullet Points
                  </button>
                  <button
                    onClick={() => setSummaryMode('actions')}
                    className={`px-3 py-1 rounded text-xs transition ${
                      summaryMode === 'actions' ? 'bg-[#2c2c2c] text-white font-medium' : 'text-neutral-400 hover:text-white'
                    }`}
                  >
                    Action Checklist
                  </button>
                </div>

                <button
                  onClick={handleGenerateSummary}
                  disabled={loading}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white font-medium text-xs transition shadow-sm"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                  <span>{loading ? 'Synthesizing...' : 'Generate'}</span>
                </button>
              </div>

              {/* Output Display */}
              {summaryResult ? (
                <div className="space-y-3">
                  <div className="p-4 rounded-xl bg-[#161616] border border-[#2f2f2f] text-neutral-200 text-xs leading-relaxed max-h-72 overflow-y-auto whitespace-pre-wrap font-sans">
                    {summaryResult}
                  </div>
                  <div className="flex items-center justify-end gap-2">
                    <button
                      onClick={handleCopy}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-[#333] hover:bg-[#282828] text-neutral-300 text-xs transition"
                    >
                      {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copied ? 'Copied' : 'Copy'}</span>
                    </button>
                    <button
                      onClick={() => {
                        onAppendSummary(`\n\n## AI Executive Summary\n${summaryResult}\n`);
                        onClose();
                      }}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium transition"
                    >
                      <span>Append to Document</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="py-12 text-center text-xs text-neutral-500 border border-dashed border-[#2a2a2a] rounded-xl">
                  Select a mode above and click Generate to summarize.
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {loading ? (
                <div className="py-12 flex flex-col items-center justify-center text-xs text-neutral-400 gap-3">
                  <RefreshCw className="w-6 h-6 animate-spin text-purple-400" />
                  <span>Inspecting document structure and semantics...</span>
                </div>
              ) : categoryResult ? (
                <div className="space-y-4">
                  {/* Categorization Card */}
                  <div className="p-4 rounded-xl bg-[#181818] border border-[#2f2f2f] space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-neutral-400 font-medium">Recommended Type:</span>
                      <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-purple-500/20 text-purple-300 border border-purple-500/30 capitalize">
                        {categoryResult.suggestedType}
                      </span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-xs text-neutral-400 font-medium">Category:</span>
                      <span className="text-xs text-neutral-200 font-medium">
                        {categoryResult.category}
                      </span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-xs text-neutral-400 font-medium">Status:</span>
                      <span className="text-xs text-emerald-300 font-medium">
                        {categoryResult.statusRecommendation}
                      </span>
                    </div>

                    <div>
                      <span className="text-xs text-neutral-400 font-medium block mb-1.5">Suggested Tags:</span>
                      <div className="flex flex-wrap gap-1.5">
                        {categoryResult.suggestedTags.map((tag) => (
                          <span
                            key={tag}
                            className="px-2 py-0.5 rounded bg-[#252525] text-neutral-300 border border-[#383838] text-xs font-medium"
                          >
                            #{tag}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div>
                      <span className="text-xs text-neutral-400 font-medium block mb-1">Brief:</span>
                      <p className="text-xs text-neutral-300 italic bg-[#141414] p-2.5 rounded border border-[#262626]">
                        "{categoryResult.summary}"
                      </p>
                    </div>
                  </div>

                  <div className="flex justify-end gap-2">
                    <button
                      onClick={handleCategorize}
                      className="px-3 py-1.5 rounded border border-[#333] hover:bg-[#282828] text-neutral-300 text-xs transition"
                    >
                      Re-analyze
                    </button>
                    <button
                      onClick={handleApplyCategorization}
                      className="flex items-center gap-1.5 px-4 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium transition shadow-sm"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>Apply to Frontmatter</span>
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
