import React, { useState } from 'react';
import { Bot, Wrench, Layers, FileText, Plus, CheckSquare, MoreVertical, ArrowRight } from 'lucide-react';
import { MarkdownFile } from '../../types/document';

interface KanbanViewProps {
  files: MarkdownFile[];
  onSelectFile: (id: string) => void;
  onUpdateMetadata: (fileId: string, updatedMetadata: any) => void;
  onNewFile: (type: any, initialStatus?: string) => void;
}

const COLUMNS = [
  { id: 'Backlog', label: 'Backlog', color: 'border-neutral-500', glow: 'hover:border-neutral-400' },
  { id: 'In Progress', label: 'In Progress', color: 'border-blue-500', glow: 'hover:border-blue-400' },
  { id: 'Review', label: 'Review', color: 'border-amber-500', glow: 'hover:border-amber-400' },
  { id: 'Active', label: 'Active', color: 'border-purple-500', glow: 'hover:border-purple-400' },
  { id: 'Done', label: 'Done', color: 'border-emerald-500', glow: 'hover:border-emerald-400' },
];

export const KanbanView: React.FC<KanbanViewProps> = ({
  files,
  onSelectFile,
  onUpdateMetadata,
  onNewFile,
}) => {
  const [dragOverColId, setDragOverColId] = useState<string | null>(null);

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

  const handleDragOver = (e: React.DragEvent, colId: string) => {
    e.preventDefault();
    if (dragOverColId !== colId) {
      setDragOverColId(colId);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOverColId(null);
  };

  const handleDrop = (e: React.DragEvent, targetStatus: string) => {
    e.preventDefault();
    setDragOverColId(null);
    const fileId = e.dataTransfer.getData('text/plain');
    const targetFile = files.find((f) => f.id === fileId);
    if (targetFile) {
      onUpdateMetadata(fileId, { ...targetFile.frontmatter, status: targetStatus });
    }
  };

  return (
    <div className="flex gap-4 overflow-x-auto pb-6 h-full font-sans select-none">
      {COLUMNS.map((col) => {
        const columnFiles = files.filter(
          (f) => (f.frontmatter.status || 'Backlog') === col.id
        );
        const isDragTarget = dragOverColId === col.id;

        return (
          <div
            key={col.id}
            onDragOver={(e) => handleDragOver(e, col.id)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, col.id)}
            className={`w-72 shrink-0 flex flex-col rounded-xl p-3 max-h-[calc(100vh-210px)] transition-all duration-150 ${
              isDragTarget
                ? 'bg-[#202026] border-2 border-dashed border-blue-500/80 shadow-lg'
                : 'bg-[#1b1b1e] border border-[#2b2b30]'
            }`}
          >
            {/* Column Header */}
            <div className="flex items-center justify-between pb-2.5 mb-2 border-b border-[#26262a]">
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full border-2 ${col.color}`} />
                <span className="font-semibold text-xs text-neutral-200">{col.label}</span>
                <span className="text-[10px] text-neutral-500 font-medium px-1.5 py-0.2 bg-[#242428] rounded-full">
                  {columnFiles.length}
                </span>
              </div>
              <button
                onClick={() => onNewFile('document', col.id)}
                className="p-1 rounded hover:bg-[#28282c] text-neutral-400 hover:text-white transition"
                title={`Add card to ${col.label}`}
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Column Cards */}
            <div className="flex-1 overflow-y-auto space-y-2.5 pr-0.5">
              {columnFiles.map((file) => {
                const meta = file.frontmatter;
                const completedTasks = (file.tasks || []).filter((t) => t.completed).length;
                const totalTasks = (file.tasks || []).length;

                return (
                  <div
                    key={file.id}
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData('text/plain', file.id)}
                    onClick={() => onSelectFile(file.id)}
                    className="p-3.5 rounded-xl bg-[#232326] hover:bg-[#29292e] border border-[#323238] hover:border-neutral-500 transition-all cursor-grab active:cursor-grabbing shadow-sm group hover:-translate-y-0.5"
                  >
                    {/* Header: Icon + Title */}
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2">
                        {getDocIcon(meta.type)}
                        <span className="font-semibold text-xs text-neutral-200 group-hover:text-white line-clamp-2">
                          {meta.title || file.name}
                        </span>
                      </div>
                    </div>

                    {/* Metadata tags & details */}
                    <div className="space-y-2 mt-2">
                      {/* Priority and Model badge */}
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {meta.priority && (
                          <span className={`text-[10px] px-1.5 py-0.2 rounded font-medium ${
                            meta.priority === 'Critical' ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30' :
                            meta.priority === 'High' ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' : 'bg-neutral-800 text-neutral-400 border border-neutral-700'
                          }`}>
                            {meta.priority}
                          </span>
                        )}
                        {meta.model && (
                          <span className="text-[10px] px-1.5 py-0.2 rounded bg-purple-950/40 text-purple-300 border border-purple-800/40 font-mono truncate max-w-[120px]">
                            {meta.model}
                          </span>
                        )}
                      </div>

                      {/* Tags */}
                      {(meta.tags || []).length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {meta.tags!.slice(0, 2).map((tag) => (
                            <span key={tag} className="text-[10px] text-neutral-400">
                              #{tag}
                            </span>
                          ))}
                          {meta.tags!.length > 2 && (
                            <span className="text-[10px] text-neutral-500">
                              +{meta.tags!.length - 2}
                            </span>
                          )}
                        </div>
                      )}

                      {/* Task checklist progress */}
                      {totalTasks > 0 && (
                        <div className="flex items-center justify-between pt-1.5 border-t border-[#2e2e34] text-[10px] text-neutral-400">
                          <span className="flex items-center gap-1">
                            <CheckSquare className="w-3 h-3 text-emerald-400" />
                            <span>{completedTasks}/{totalTasks} tasks</span>
                          </span>
                          <div className="w-16 h-1.5 bg-[#141416] rounded-full overflow-hidden">
                            <div
                              className="h-full bg-emerald-500 rounded-full"
                              style={{ width: `${(completedTasks / totalTasks) * 100}%` }}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

              {columnFiles.length === 0 && (
                <div className={`py-8 text-center text-xs rounded-xl border border-dashed transition ${
                  isDragTarget
                    ? 'border-blue-400 text-blue-300 bg-blue-500/10'
                    : 'border-[#28282c] text-neutral-600'
                }`}>
                  {isDragTarget ? 'Drop card here' : 'Empty column'}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};
