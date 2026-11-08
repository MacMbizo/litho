import React, { useState } from 'react';
import { CheckSquare, Square, FileText, Bot, Layers, Wrench, ExternalLink, CheckCircle2 } from 'lucide-react';
import { MarkdownFile, TaskItem } from '../../types/document';
import { MarkdownService } from '../../services/markdown';

interface GlobalTaskRolodexProps {
  files: MarkdownFile[];
  onSelectFile: (id: string) => void;
  onUpdateFileContent: (fileId: string, updatedContent: string) => void;
}

export const GlobalTaskRolodex: React.FC<GlobalTaskRolodexProps> = ({
  files,
  onSelectFile,
  onUpdateFileContent,
}) => {
  const [filter, setFilter] = useState<'all' | 'pending' | 'completed'>('pending');
  const [selectedFileFilter, setSelectedFileFilter] = useState<string>('all');

  // Aggregate all tasks across files
  const allTasks: TaskItem[] = [];
  files.forEach((file) => {
    (file.tasks || []).forEach((t) => allTasks.push(t));
  });

  const pendingCount = allTasks.filter((t) => !t.completed).length;
  const completedCount = allTasks.filter((t) => t.completed).length;

  const filteredTasks = allTasks.filter((t) => {
    if (filter === 'pending' && t.completed) return false;
    if (filter === 'completed' && !t.completed) return false;
    if (selectedFileFilter !== 'all' && t.filePath !== selectedFileFilter) return false;
    return true;
  });

  const handleToggleTask = (task: TaskItem) => {
    const targetFile = files.find((f) => f.path === task.filePath);
    if (!targetFile) return;

    const newBody = MarkdownService.toggleTask(targetFile.body, task.line, !task.completed);
    const fullMarkdown = MarkdownService.stringify(targetFile.frontmatter, newBody);
    onUpdateFileContent(targetFile.id, fullMarkdown);
  };

  const getDocTypeIcon = (path: string) => {
    const file = files.find((f) => f.path === path);
    const type = file?.frontmatter.type;
    switch (type) {
      case 'agent':
        return <Bot className="w-3.5 h-3.5 text-purple-400" />;
      case 'skill':
        return <Wrench className="w-3.5 h-3.5 text-emerald-400" />;
      case 'project':
        return <Layers className="w-3.5 h-3.5 text-blue-400" />;
      default:
        return <FileText className="w-3.5 h-3.5 text-neutral-400" />;
    }
  };

  return (
    <div className="flex-1 h-full flex flex-col bg-[#191919] font-sans overflow-hidden">
      {/* Header */}
      <div className="p-6 border-b border-[#2b2b2b] shrink-0 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-neutral-100 tracking-tight flex items-center gap-2">
              <CheckSquare className="w-5 h-5 text-emerald-400" />
              <span>Global Tasks Rolodex</span>
            </h1>
            <p className="text-xs text-neutral-400 mt-0.5">
              Aggregated action items and checklist checkboxes parsed across all Markdown vault files.
            </p>
          </div>

          {/* Overall Progress Stats */}
          <div className="flex items-center gap-3 bg-[#202020] px-3.5 py-2 rounded-xl border border-[#303030]">
            <div className="text-right">
              <div className="text-xs font-semibold text-neutral-200">
                {completedCount} / {allTasks.length} Done
              </div>
              <div className="text-[10px] text-neutral-500">
                {allTasks.length > 0 ? Math.round((completedCount / allTasks.length) * 100) : 0}% Completion
              </div>
            </div>
            <div className="w-12 h-12 flex items-center justify-center">
              <CheckCircle2 className="w-8 h-8 text-emerald-400" />
            </div>
          </div>
        </div>

        {/* Filter Controls */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          {/* Status Tabs */}
          <div className="flex items-center bg-[#222222] p-1 rounded-lg border border-[#333333] text-xs">
            <button
              onClick={() => setFilter('pending')}
              className={`px-3 py-1 rounded transition font-medium ${
                filter === 'pending' ? 'bg-[#303030] text-emerald-400 shadow-sm' : 'text-neutral-400 hover:text-white'
              }`}
            >
              Pending ({pendingCount})
            </button>
            <button
              onClick={() => setFilter('completed')}
              className={`px-3 py-1 rounded transition font-medium ${
                filter === 'completed' ? 'bg-[#303030] text-white shadow-sm' : 'text-neutral-400 hover:text-white'
              }`}
            >
              Completed ({completedCount})
            </button>
            <button
              onClick={() => setFilter('all')}
              className={`px-3 py-1 rounded transition font-medium ${
                filter === 'all' ? 'bg-[#303030] text-white shadow-sm' : 'text-neutral-400 hover:text-white'
              }`}
            >
              All ({allTasks.length})
            </button>
          </div>

          {/* Filter by Document dropdown */}
          <select
            value={selectedFileFilter}
            onChange={(e) => setSelectedFileFilter(e.target.value)}
            className="bg-[#202020] border border-[#333333] rounded-lg px-3 py-1.5 text-xs text-neutral-300 focus:outline-none"
          >
            <option value="all">All Documents</option>
            {files.filter((f) => (f.tasks || []).length > 0).map((f) => (
              <option key={f.path} value={f.path}>
                {f.frontmatter.title || f.name} ({(f.tasks || []).length})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Task List */}
      <div className="flex-1 p-6 overflow-y-auto space-y-2">
        {filteredTasks.length === 0 ? (
          <div className="py-16 text-center text-xs text-neutral-500">
            No tasks found matching this filter.
          </div>
        ) : (
          filteredTasks.map((task) => (
            <div
              key={task.id}
              onClick={() => handleToggleTask(task)}
              className="flex items-center justify-between p-3 rounded-xl bg-[#1e1e1e] hover:bg-[#252525] border border-[#2b2b2b] hover:border-neutral-500 transition cursor-pointer select-none group"
            >
              <div className="flex items-center gap-3">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleToggleTask(task);
                  }}
                  className="text-neutral-400 hover:text-white transition"
                >
                  {task.completed ? (
                    <CheckSquare className="w-4 h-4 text-emerald-400" />
                  ) : (
                    <Square className="w-4 h-4 text-neutral-500" />
                  )}
                </button>
                <span className={`text-xs leading-relaxed transition ${
                  task.completed ? 'line-through text-neutral-500' : 'text-neutral-200'
                }`}>
                  {task.text}
                </span>
              </div>

              {/* Source Document Tag & Jump Button */}
              <div className="flex items-center gap-2">
                <span className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-[#282828] text-[10px] text-neutral-400 border border-[#383838]">
                  {getDocTypeIcon(task.filePath)}
                  <span className="truncate max-w-[140px]">{task.fileName}</span>
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectFile(task.filePath);
                  }}
                  className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-[#333] text-neutral-400 hover:text-white transition"
                  title="Open source file"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
