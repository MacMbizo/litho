import React, { useState, useEffect } from 'react';
import { Search, FileText, Bot, Wrench, Layers, CheckSquare, Plus, ArrowRight, Share2 } from 'lucide-react';
import { MarkdownFile, ViewMode, DocType } from '../../types/document';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  files: MarkdownFile[];
  onSelectFile: (id: string) => void;
  onSelectViewMode: (mode: ViewMode) => void;
  onNewFile: (type: DocType) => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  isOpen,
  onClose,
  files,
  onSelectFile,
  onSelectViewMode,
  onNewFile,
}) => {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (isOpen) onClose();
        else setQuery('');
      } else if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const filteredFiles = files.filter((f) => {
    const title = f.frontmatter.title || f.name;
    const tags = (f.frontmatter.tags || []).join(' ');
    const text = `${title} ${f.path} ${tags}`.toLowerCase();
    return text.includes(query.toLowerCase());
  });

  const actions = [
    { label: 'Go to Notion Database Hub', icon: <Layers className="w-4 h-4 text-amber-400" />, action: () => onSelectViewMode('database') },
    { label: 'Go to Agents & Skills Testbed', icon: <Bot className="w-4 h-4 text-purple-400" />, action: () => onSelectViewMode('agent-hub') },
    { label: 'Go to Global Tasks Rolodex', icon: <CheckSquare className="w-4 h-4 text-emerald-400" />, action: () => onSelectViewMode('tasks') },
    { label: 'Go to Knowledge Graph View', icon: <Share2 className="w-4 h-4 text-violet-400" />, action: () => onSelectViewMode('graph') },
    { label: 'Create New AI Agent', icon: <Plus className="w-4 h-4 text-purple-400" />, action: () => onNewFile('agent') },
    { label: 'Create New Skill Definition', icon: <Plus className="w-4 h-4 text-emerald-400" />, action: () => onNewFile('skill') },
    { label: 'Create New Project', icon: <Plus className="w-4 h-4 text-blue-400" />, action: () => onNewFile('project') },
  ];

  const filteredActions = actions.filter((a) => a.label.toLowerCase().includes(query.toLowerCase()));

  return (
    <div 
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-start justify-center pt-24"
      onClick={onClose}
    >
      <div 
        className="w-full max-w-xl bg-[#202020] border border-[#383838] rounded-xl shadow-2xl overflow-hidden flex flex-col font-sans"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search Input Bar */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[#2f2f2f]">
          <Search className="w-5 h-5 text-neutral-400" />
          <input
            type="text"
            placeholder="Type a command or search documents, tags, agents..."
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            autoFocus
            className="w-full bg-transparent text-sm text-neutral-100 placeholder-neutral-500 focus:outline-none"
          />
          <kbd className="px-2 py-0.5 text-xs bg-[#2c2c2c] rounded border border-[#3a3a3a] text-neutral-400">ESC</kbd>
        </div>

        {/* Results List */}
        <div className="max-h-96 overflow-y-auto p-2 space-y-4">
          {/* Quick Actions */}
          {filteredActions.length > 0 && (
            <div>
              <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                Actions
              </div>
              <div className="space-y-0.5 mt-1">
                {filteredActions.map((item, i) => (
                  <div
                    key={i}
                    onClick={() => {
                      item.action();
                      onClose();
                    }}
                    className="flex items-center justify-between px-3 py-2 rounded-lg text-xs text-neutral-300 hover:bg-[#2c2c2c] hover:text-white cursor-pointer transition"
                  >
                    <div className="flex items-center gap-2.5">
                      {item.icon}
                      <span>{item.label}</span>
                    </div>
                    <ArrowRight className="w-3.5 h-3.5 text-neutral-500" />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Files */}
          <div>
            <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
              Documents & Files ({filteredFiles.length})
            </div>
            <div className="space-y-0.5 mt-1">
              {filteredFiles.length === 0 ? (
                <div className="px-3 py-4 text-center text-xs text-neutral-500">
                  No documents found matching "{query}"
                </div>
              ) : (
                filteredFiles.slice(0, 8).map((file) => (
                  <div
                    key={file.id}
                    onClick={() => {
                      onSelectFile(file.id);
                      onSelectViewMode('editor');
                      onClose();
                    }}
                    className="flex items-center justify-between px-3 py-2 rounded-lg text-xs text-neutral-300 hover:bg-[#2c2c2c] hover:text-white cursor-pointer transition"
                  >
                    <div className="flex items-center gap-2.5 truncate">
                      {file.frontmatter.type === 'agent' ? (
                        <Bot className="w-4 h-4 text-purple-400 shrink-0" />
                      ) : file.frontmatter.type === 'skill' ? (
                        <Wrench className="w-4 h-4 text-emerald-400 shrink-0" />
                      ) : file.frontmatter.type === 'project' ? (
                        <Layers className="w-4 h-4 text-blue-400 shrink-0" />
                      ) : (
                        <FileText className="w-4 h-4 text-neutral-400 shrink-0" />
                      )}
                      <div className="truncate">
                        <div className="font-medium truncate">{file.frontmatter.title || file.name}</div>
                        <div className="text-[10px] text-neutral-500 truncate">{file.path}</div>
                      </div>
                    </div>
                    {file.frontmatter.status && (
                      <span className="px-2 py-0.5 text-[10px] rounded bg-[#333333] text-neutral-400 shrink-0">
                        {file.frontmatter.status}
                      </span>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
