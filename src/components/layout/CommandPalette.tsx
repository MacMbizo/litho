import React, { useState, useEffect } from 'react';
import { 
  Search, 
  FileText, 
  Bot, 
  Wrench, 
  Layers, 
  CheckSquare, 
  Plus, 
  ArrowRight, 
  Share2, 
  Clock, 
  CornerDownLeft 
} from 'lucide-react';
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

  const actions = [
    { id: 'db', label: 'Go to Notion Database Hub', icon: <Layers className="w-4 h-4 text-amber-400" />, action: () => onSelectViewMode('database') },
    { id: 'agent-hub', label: 'Go to Agents & Skills Testbed', icon: <Bot className="w-4 h-4 text-purple-400" />, action: () => onSelectViewMode('agent-hub') },
    { id: 'tasks', label: 'Go to Global Tasks Rolodex', icon: <CheckSquare className="w-4 h-4 text-emerald-400" />, action: () => onSelectViewMode('tasks') },
    { id: 'graph', label: 'Go to Knowledge Graph View', icon: <Share2 className="w-4 h-4 text-violet-400" />, action: () => onSelectViewMode('graph') },
    { id: 'new-agent', label: 'Create New AI Agent', icon: <Plus className="w-4 h-4 text-purple-400" />, action: () => onNewFile('agent') },
    { id: 'new-skill', label: 'Create New Skill Definition', icon: <Plus className="w-4 h-4 text-emerald-400" />, action: () => onNewFile('skill') },
    { id: 'new-project', label: 'Create New Project', icon: <Plus className="w-4 h-4 text-blue-400" />, action: () => onNewFile('project') },
  ];

  const filteredActions = actions.filter((a) => a.label.toLowerCase().includes(query.toLowerCase()));

  const filteredFiles = files.filter((f) => {
    const title = f.frontmatter.title || f.name;
    const tags = (f.frontmatter.tags || []).join(' ');
    const text = `${title} ${f.path} ${tags}`.toLowerCase();
    return text.includes(query.toLowerCase());
  });

  const totalItems = filteredActions.length + filteredFiles.length;

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Execute currently selected item via Enter
  const executeSelected = () => {
    if (selectedIndex < filteredActions.length) {
      filteredActions[selectedIndex]?.action();
      onClose();
    } else {
      const fileIdx = selectedIndex - filteredActions.length;
      const targetFile = filteredFiles[fileIdx];
      if (targetFile) {
        onSelectFile(targetFile.id);
        onSelectViewMode('editor');
        onClose();
      }
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (isOpen) onClose();
        else setQuery('');
      } else if (e.key === 'Escape' && isOpen) {
        onClose();
      } else if (isOpen) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setSelectedIndex((prev) => (totalItems > 0 ? (prev + 1) % totalItems : 0));
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          setSelectedIndex((prev) => (totalItems > 0 ? (prev - 1 + totalItems) % totalItems : 0));
        } else if (e.key === 'Enter') {
          e.preventDefault();
          executeSelected();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, selectedIndex, totalItems]);

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 z-50 bg-black/65 backdrop-blur-sm flex items-start justify-center pt-20"
      onClick={onClose}
    >
      <div 
        className="w-full max-w-xl bg-[#202024] border border-[#38383e] rounded-2xl shadow-2xl overflow-hidden flex flex-col font-sans animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search Input Bar */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-[#2c2c30] bg-[#1a1a1c]">
          <Search className="w-5 h-5 text-neutral-400" />
          <input
            type="text"
            placeholder="Type a command or search documents, tags, agents..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
            className="w-full bg-transparent text-sm text-neutral-100 placeholder-neutral-500 focus:outline-none"
          />
          <kbd className="px-2 py-0.5 text-xs bg-[#28282c] rounded border border-[#38383e] text-neutral-400 font-mono">ESC</kbd>
        </div>

        {/* Results List */}
        <div className="max-h-96 overflow-y-auto p-2 space-y-4">
          {/* Quick Actions */}
          {filteredActions.length > 0 && (
            <div>
              <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                Navigation & Actions
              </div>
              <div className="space-y-0.5 mt-1">
                {filteredActions.map((item, i) => {
                  const isSelected = i === selectedIndex;
                  return (
                    <div
                      key={item.id}
                      onClick={() => {
                        item.action();
                        onClose();
                      }}
                      onMouseEnter={() => setSelectedIndex(i)}
                      className={`flex items-center justify-between px-3 py-2 rounded-xl text-xs transition cursor-pointer ${
                        isSelected
                          ? 'bg-[#2b2b32] text-white border border-blue-500/40 shadow-sm'
                          : 'text-neutral-300 hover:bg-[#25252a] hover:text-white border border-transparent'
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        {item.icon}
                        <span className="font-medium">{item.label}</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-neutral-500">
                        {isSelected && <CornerDownLeft className="w-3.5 h-3.5 text-blue-400" />}
                        <ArrowRight className="w-3.5 h-3.5" />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Files */}
          <div>
            <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
              {query ? `Documents (${filteredFiles.length})` : 'Recent Documents'}
            </div>
            <div className="space-y-0.5 mt-1">
              {filteredFiles.length === 0 ? (
                <div className="px-3 py-6 text-center text-xs text-neutral-500">
                  No documents found matching "{query}"
                </div>
              ) : (
                filteredFiles.slice(0, 8).map((file, fileIdx) => {
                  const itemIndex = filteredActions.length + fileIdx;
                  const isSelected = itemIndex === selectedIndex;

                  return (
                    <div
                      key={file.id}
                      onClick={() => {
                        onSelectFile(file.id);
                        onSelectViewMode('editor');
                        onClose();
                      }}
                      onMouseEnter={() => setSelectedIndex(itemIndex)}
                      className={`flex items-center justify-between px-3 py-2 rounded-xl text-xs transition cursor-pointer ${
                        isSelected
                          ? 'bg-[#2b2b32] text-white border border-blue-500/40 shadow-sm'
                          : 'text-neutral-300 hover:bg-[#25252a] hover:text-white border border-transparent'
                      }`}
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

                      <div className="flex items-center gap-2 shrink-0">
                        {file.frontmatter.status && (
                          <span className="px-2 py-0.5 text-[10px] rounded-full bg-[#2a2a2e] text-neutral-400">
                            {file.frontmatter.status}
                          </span>
                        )}
                        {isSelected && <CornerDownLeft className="w-3.5 h-3.5 text-blue-400" />}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* Footer info */}
        <div className="px-4 py-2 border-t border-[#2a2a2e] bg-[#1a1a1c] flex items-center justify-between text-[11px] text-neutral-500">
          <span>Navigate with <kbd className="px-1 py-0.5 bg-[#252528] rounded border border-[#35353c] text-neutral-400 font-mono">↑</kbd> <kbd className="px-1 py-0.5 bg-[#252528] rounded border border-[#35353c] text-neutral-400 font-mono">↓</kbd></span>
          <span>Open with <kbd className="px-1.5 py-0.5 bg-[#252528] rounded border border-[#35353c] text-neutral-400 font-mono">Enter</kbd></span>
        </div>
      </div>
    </div>
  );
};
