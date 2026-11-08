import React from 'react';
import { X, Plus, Bot, Wrench, Layers, FileText } from 'lucide-react';
import { MarkdownFile, DocType } from '../../types/document';

interface TabBarProps {
  openFileIds: string[];
  activeFileId: string | null;
  files: MarkdownFile[];
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string, e: React.MouseEvent) => void;
  onNewTab: () => void;
}

export const TabBar: React.FC<TabBarProps> = ({
  openFileIds,
  activeFileId,
  files,
  onSelectTab,
  onCloseTab,
  onNewTab,
}) => {
  if (openFileIds.length === 0) return null;

  const getDocIcon = (type?: string) => {
    switch (type) {
      case 'agent':
        return <Bot className="w-3.5 h-3.5 text-purple-400 shrink-0" />;
      case 'skill':
        return <Wrench className="w-3.5 h-3.5 text-emerald-400 shrink-0" />;
      case 'project':
        return <Layers className="w-3.5 h-3.5 text-blue-400 shrink-0" />;
      default:
        return <FileText className="w-3.5 h-3.5 text-neutral-400 shrink-0" />;
    }
  };

  return (
    <div className="flex items-center bg-[#151517] border-b border-[#26262a] px-2 h-9 overflow-x-auto select-none font-sans shrink-0">
      <div className="flex items-center gap-1 overflow-x-auto max-w-full">
        {openFileIds.map((id) => {
          const file = files.find((f) => f.id === id);
          if (!file) return null;

          const isActive = file.id === activeFileId;
          const type = file.frontmatter.type || 'document';

          return (
            <div
              key={file.id}
              onClick={() => onSelectTab(file.id)}
              className={`group flex items-center gap-2 px-3 py-1.5 rounded-t-lg text-xs cursor-pointer transition border-t border-l border-r ${
                isActive
                  ? 'bg-[#1a1a1c] text-white border-[#2c2c30] font-medium'
                  : 'bg-transparent text-neutral-400 hover:text-neutral-200 hover:bg-[#1a1a1c]/60 border-transparent'
              }`}
            >
              {getDocIcon(type)}
              <span className="truncate max-w-[130px]">
                {file.frontmatter.title || file.name}
              </span>

              {file.isDirty ? (
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" title="Unsaved" />
              ) : null}

              <button
                onClick={(e) => onCloseTab(file.id, e)}
                className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-[#2b2b32] text-neutral-500 hover:text-white rounded transition ml-0.5"
                title="Close Tab"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          );
        })}
      </div>

      {/* Add Tab Button */}
      <button
        onClick={onNewTab}
        className="p-1 rounded hover:bg-[#202024] text-neutral-400 hover:text-white transition ml-1"
        title="New Document"
      >
        <Plus className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};
