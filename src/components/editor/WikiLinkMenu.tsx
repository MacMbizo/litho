import React, { useState, useEffect } from 'react';
import { Bot, Wrench, Layers, FileText, Link2, Sparkles, ArrowRight } from 'lucide-react';
import { MarkdownFile } from '../../types/document';

interface WikiLinkMenuProps {
  isOpen: boolean;
  position: { top: number; left: number };
  query: string;
  files: MarkdownFile[];
  activeFileId: string;
  onSelect: (targetTitle: string, targetFile?: MarkdownFile) => void;
  onClose: () => void;
}

export const WikiLinkMenu: React.FC<WikiLinkMenuProps> = ({
  isOpen,
  position,
  query,
  files,
  activeFileId,
  onSelect,
  onClose,
}) => {
  const [selectedIndex, setSelectedIndex] = useState(0);

  const qLower = query.trim().toLowerCase();

  const candidates = files
    .filter((f) => f.id !== activeFileId)
    .filter((f) => {
      if (!qLower) return true;
      const title = (f.frontmatter.title || '').toLowerCase();
      const name = f.name.toLowerCase();
      const path = f.path.toLowerCase();
      const tags = (f.frontmatter.tags || []).join(' ').toLowerCase();
      return (
        title.includes(qLower) ||
        name.includes(qLower) ||
        path.includes(qLower) ||
        tags.includes(qLower)
      );
    })
    .slice(0, 8);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const totalItems = candidates.length > 0 ? candidates.length : query.trim() ? 1 : 0;
      if (totalItems === 0) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopPropagation();
        setSelectedIndex((prev) => (prev + 1) % totalItems);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        setSelectedIndex((prev) => (prev - 1 + totalItems) % totalItems);
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        e.stopPropagation();
        if (candidates[selectedIndex]) {
          const picked = candidates[selectedIndex];
          onSelect(picked.frontmatter.title || picked.name.replace(/\.md$/, ''), picked);
        } else if (query.trim()) {
          onSelect(query.trim());
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, candidates, selectedIndex, query, onSelect, onClose]);

  if (!isOpen) return null;

  const getDocIcon = (type?: string) => {
    switch (type) {
      case 'agent':
        return <Bot className="w-4 h-4 text-purple-400 shrink-0" />;
      case 'skill':
        return <Wrench className="w-4 h-4 text-emerald-400 shrink-0" />;
      case 'project':
        return <Layers className="w-4 h-4 text-blue-400 shrink-0" />;
      default:
        return <FileText className="w-4 h-4 text-neutral-400 shrink-0" />;
    }
  };

  return (
    <div
      style={{ top: position.top, left: position.left }}
      className="fixed z-50 w-80 bg-[#1e1e22] border border-[#34343c] rounded-xl shadow-2xl overflow-hidden font-sans animate-in fade-in zoom-in-95 duration-100"
    >
      {/* Header */}
      <div className="px-3 py-2 bg-[#18181b] border-b border-[#2b2b32] flex items-center justify-between text-[11px]">
        <div className="flex items-center gap-1.5 text-blue-400 font-semibold">
          <Link2 className="w-3.5 h-3.5" />
          <span>Link to Document</span>
        </div>
        <span className="text-neutral-500 font-mono">
          [[{query || '...'}]]
        </span>
      </div>

      {/* Results List */}
      <div className="max-h-64 overflow-y-auto p-1.5 space-y-0.5">
        {candidates.map((item, idx) => {
          const isSelected = idx === selectedIndex;
          const title = item.frontmatter.title || item.name.replace(/\.md$/, '');
          const type = item.frontmatter.type || 'document';

          return (
            <button
              key={item.id}
              onClick={() => onSelect(title, item)}
              onMouseEnter={() => setSelectedIndex(idx)}
              className={`w-full text-left px-2.5 py-2 rounded-lg flex items-center gap-2.5 transition ${
                isSelected
                  ? 'bg-blue-600/20 border border-blue-500/40 text-white'
                  : 'hover:bg-[#26262c] text-neutral-300 border border-transparent'
              }`}
            >
              <div className="p-1.5 rounded-md bg-[#25252b] border border-[#32323a]">
                {getDocIcon(type)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium truncate flex items-center gap-1.5">
                  <span className="truncate">{title}</span>
                </div>
                <div className="text-[10px] text-neutral-500 truncate flex items-center gap-1.5 mt-0.5">
                  <span className="font-mono">{item.path}</span>
                  {item.frontmatter.status && (
                    <>
                      <span>•</span>
                      <span className="text-neutral-400">{item.frontmatter.status}</span>
                    </>
                  )}
                </div>
              </div>
              <ArrowRight className={`w-3.5 h-3.5 shrink-0 transition ${isSelected ? 'text-blue-400 translate-x-0.5' : 'text-neutral-600'}`} />
            </button>
          );
        })}

        {candidates.length === 0 && query.trim() && (
          <button
            onClick={() => onSelect(query.trim())}
            className="w-full text-left px-3 py-2.5 rounded-lg bg-blue-600/15 border border-blue-500/30 text-blue-200 flex items-center gap-2 text-xs"
          >
            <Sparkles className="w-4 h-4 text-blue-400 shrink-0" />
            <div className="truncate">
              Insert reference <span className="font-mono font-semibold text-white">[[{query.trim()}]]</span>
            </div>
          </button>
        )}

        {candidates.length === 0 && !query.trim() && (
          <div className="px-3 py-4 text-center text-xs text-neutral-500">
            No other documents in workspace yet.
          </div>
        )}
      </div>

      {/* Footer Hint */}
      <div className="px-3 py-1.5 bg-[#161619] border-t border-[#28282e] flex items-center justify-between text-[10px] text-neutral-500">
        <span>↑↓ to navigate</span>
        <span>Enter to insert • Esc to close</span>
      </div>
    </div>
  );
};
