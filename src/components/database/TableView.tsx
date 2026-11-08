import React, { useState, useRef } from 'react';
import { 
  Bot, 
  Wrench, 
  Layers, 
  FileText, 
  ArrowUpDown, 
  Edit2, 
  Check, 
  X, 
  ExternalLink,
  ChevronDown
} from 'lucide-react';
import { MarkdownFile, DocType } from '../../types/document';

interface TableViewProps {
  files: MarkdownFile[];
  onSelectFile: (id: string) => void;
  onUpdateMetadata: (fileId: string, updatedMetadata: any) => void;
}

interface ColumnWidths {
  title: number;
  type: number;
  status: number;
  priority: number;
  model: number;
  tags: number;
}

export const TableView: React.FC<TableViewProps> = ({
  files,
  onSelectFile,
  onUpdateMetadata,
}) => {
  const [sortField, setSortField] = useState<'title' | 'type' | 'status' | 'priority'>('title');
  const [sortAsc, setSortAsc] = useState(true);

  // Column Resizing State
  const [widths, setWidths] = useState<ColumnWidths>({
    title: 320,
    type: 110,
    status: 130,
    priority: 110,
    model: 150,
    tags: 220,
  });

  const resizingColRef = useRef<keyof ColumnWidths | null>(null);
  const startXRef = useRef<number>(0);
  const startWidthRef = useRef<number>(0);

  // Inline Title Editing
  const [editingFileId, setEditingFileId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState<string>('');

  const startResizing = (e: React.MouseEvent, col: keyof ColumnWidths) => {
    e.preventDefault();
    e.stopPropagation();
    resizingColRef.current = col;
    startXRef.current = e.clientX;
    startWidthRef.current = widths[col];

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!resizingColRef.current) return;
      const delta = moveEvent.clientX - startXRef.current;
      const newWidth = Math.max(startWidthRef.current + delta, 80);
      setWidths((prev) => ({ ...prev, [resizingColRef.current!]: newWidth }));
    };

    const handleMouseUp = () => {
      resizingColRef.current = null;
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  const handleSort = (field: 'title' | 'type' | 'status' | 'priority') => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(true);
    }
  };

  const sortedFiles = [...files].sort((a, b) => {
    const valA = (a.frontmatter[sortField] || a.name || '').toString().toLowerCase();
    const valB = (b.frontmatter[sortField] || b.name || '').toString().toLowerCase();
    return sortAsc ? valA.localeCompare(valB) : valB.localeCompare(valA);
  });

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

  const getStatusBadge = (status?: string) => {
    switch (status) {
      case 'Active':
      case 'Done':
        return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
      case 'In Progress':
        return 'bg-blue-500/15 text-blue-300 border-blue-500/30';
      case 'Review':
        return 'bg-amber-500/15 text-amber-300 border-amber-500/30';
      case 'Critical':
        return 'bg-rose-500/15 text-rose-300 border-rose-500/30';
      default:
        return 'bg-neutral-800 text-neutral-400 border-neutral-700';
    }
  };

  const saveInlineTitle = (file: MarkdownFile) => {
    if (editingTitle.trim() && editingTitle !== file.frontmatter.title) {
      onUpdateMetadata(file.id, { ...file.frontmatter, title: editingTitle.trim() });
    }
    setEditingFileId(null);
  };

  return (
    <div className="w-full overflow-x-auto rounded-xl border border-[#2c2c30] bg-[#1a1a1c] shadow-sm font-sans">
      <table className="w-full text-left text-xs border-collapse table-fixed">
        <thead>
          <tr className="border-b border-[#2c2c30] bg-[#202024] text-neutral-400 select-none">
            {/* Title Column */}
            <th 
              style={{ width: `${widths.title}px` }}
              className="py-2.5 px-4 font-semibold hover:text-white cursor-pointer relative group"
              onClick={() => handleSort('title')}
            >
              <div className="flex items-center gap-1.5">
                <span>Name / Title</span>
                <ArrowUpDown className="w-3 h-3 text-neutral-500" />
              </div>
              <div
                onMouseDown={(e) => startResizing(e, 'title')}
                className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-blue-500/70"
                title="Drag to resize column"
              />
            </th>

            {/* Type Column */}
            <th 
              style={{ width: `${widths.type}px` }}
              className="py-2.5 px-3 font-semibold hover:text-white cursor-pointer relative"
              onClick={() => handleSort('type')}
            >
              <div className="flex items-center gap-1.5">
                <span>Type</span>
                <ArrowUpDown className="w-3 h-3 text-neutral-500" />
              </div>
              <div
                onMouseDown={(e) => startResizing(e, 'type')}
                className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-blue-500/70"
              />
            </th>

            {/* Status Column */}
            <th 
              style={{ width: `${widths.status}px` }}
              className="py-2.5 px-3 font-semibold hover:text-white cursor-pointer relative"
              onClick={() => handleSort('status')}
            >
              <div className="flex items-center gap-1.5">
                <span>Status</span>
                <ArrowUpDown className="w-3 h-3 text-neutral-500" />
              </div>
              <div
                onMouseDown={(e) => startResizing(e, 'status')}
                className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-blue-500/70"
              />
            </th>

            {/* Priority Column */}
            <th 
              style={{ width: `${widths.priority}px` }}
              className="py-2.5 px-3 font-semibold hover:text-white cursor-pointer relative"
              onClick={() => handleSort('priority')}
            >
              <div className="flex items-center gap-1.5">
                <span>Priority</span>
                <ArrowUpDown className="w-3 h-3 text-neutral-500" />
              </div>
              <div
                onMouseDown={(e) => startResizing(e, 'priority')}
                className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-blue-500/70"
              />
            </th>

            {/* Model / Category */}
            <th 
              style={{ width: `${widths.model}px` }}
              className="py-2.5 px-3 font-semibold relative"
            >
              <span>Model / Spec</span>
              <div
                onMouseDown={(e) => startResizing(e, 'model')}
                className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-blue-500/70"
              />
            </th>

            {/* Tags */}
            <th 
              style={{ width: `${widths.tags}px` }}
              className="py-2.5 px-3 font-semibold relative"
            >
              <span>Tags</span>
              <div
                onMouseDown={(e) => startResizing(e, 'tags')}
                className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-blue-500/70"
              />
            </th>

            <th className="py-2.5 px-3 font-semibold w-16 text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#26262a]">
          {sortedFiles.map((file) => {
            const meta = file.frontmatter;
            const isEditing = editingFileId === file.id;

            return (
              <tr
                key={file.id}
                onClick={() => onSelectFile(file.id)}
                className="hover:bg-[#222226] transition group cursor-pointer"
              >
                {/* Title (with inline rename support) */}
                <td className="py-2.5 px-4" onClick={(e) => isEditing && e.stopPropagation()}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5 truncate flex-1">
                      {getDocIcon(meta.type)}
                      {isEditing ? (
                        <div className="flex items-center gap-1 flex-1">
                          <input
                            type="text"
                            value={editingTitle}
                            onChange={(e) => setEditingTitle(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') saveInlineTitle(file);
                              if (e.key === 'Escape') setEditingFileId(null);
                            }}
                            autoFocus
                            className="bg-[#18181a] border border-blue-500 rounded px-2 py-0.5 text-xs text-white focus:outline-none w-full"
                          />
                          <button
                            onClick={() => saveInlineTitle(file)}
                            className="p-1 rounded hover:bg-emerald-600/30 text-emerald-400"
                          >
                            <Check className="w-3 h-3" />
                          </button>
                          <button
                            onClick={() => setEditingFileId(null)}
                            className="p-1 rounded hover:bg-rose-600/30 text-rose-400"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ) : (
                        <span 
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                            setEditingFileId(file.id);
                            setEditingTitle(meta.title || file.name);
                          }}
                          className="font-medium text-neutral-200 group-hover:text-white truncate"
                          title="Double-click to rename"
                        >
                          {meta.title || file.name}
                        </span>
                      )}
                    </div>

                    {!isEditing && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingFileId(file.id);
                          setEditingTitle(meta.title || file.name);
                        }}
                        className="opacity-0 group-hover:opacity-100 p-1 hover:text-white text-neutral-500 rounded transition"
                        title="Edit title inline"
                      >
                        <Edit2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </td>

                {/* Type */}
                <td className="py-2.5 px-3">
                  <span className="capitalize text-neutral-400 font-mono text-[11px]">
                    {meta.type || 'document'}
                  </span>
                </td>

                {/* Status Selector */}
                <td className="py-2.5 px-3" onClick={(e) => e.stopPropagation()}>
                  <select
                    value={meta.status || 'Draft'}
                    onChange={(e) =>
                      onUpdateMetadata(file.id, { ...meta, status: e.target.value })
                    }
                    className={`px-2 py-0.5 rounded border text-[11px] font-medium cursor-pointer focus:outline-none ${getStatusBadge(meta.status)}`}
                  >
                    <option value="Draft" className="bg-[#242424] text-neutral-300">Draft</option>
                    <option value="Backlog" className="bg-[#242424] text-neutral-300">Backlog</option>
                    <option value="In Progress" className="bg-[#242424] text-blue-300">In Progress</option>
                    <option value="Review" className="bg-[#242424] text-amber-300">Review</option>
                    <option value="Active" className="bg-[#242424] text-emerald-300">Active</option>
                    <option value="Done" className="bg-[#242424] text-emerald-300">Done</option>
                  </select>
                </td>

                {/* Priority Selector */}
                <td className="py-2.5 px-3" onClick={(e) => e.stopPropagation()}>
                  <select
                    value={meta.priority || 'Medium'}
                    onChange={(e) =>
                      onUpdateMetadata(file.id, { ...meta, priority: e.target.value })
                    }
                    className={`bg-transparent px-1.5 py-0.5 rounded text-[11px] font-medium cursor-pointer focus:outline-none ${
                      meta.priority === 'Critical' ? 'text-rose-400 font-semibold' :
                      meta.priority === 'High' ? 'text-amber-400' : 'text-neutral-400'
                    }`}
                  >
                    <option value="Low" className="bg-[#242424] text-neutral-300">Low</option>
                    <option value="Medium" className="bg-[#242424] text-neutral-300">Medium</option>
                    <option value="High" className="bg-[#242424] text-amber-300">High</option>
                    <option value="Critical" className="bg-[#242424] text-rose-400">Critical</option>
                  </select>
                </td>

                {/* Model or Category */}
                <td className="py-2.5 px-3 font-mono text-[11px] text-neutral-400 truncate">
                  {meta.model || meta.category || '-'}
                </td>

                {/* Tags */}
                <td className="py-2.5 px-3">
                  <div className="flex flex-wrap gap-1">
                    {(meta.tags || []).slice(0, 3).map((tag) => (
                      <span
                        key={tag}
                        className="px-1.5 py-0.2 rounded bg-[#242428] text-neutral-400 text-[10px] border border-[#333338]"
                      >
                        #{tag}
                      </span>
                    ))}
                    {(meta.tags || []).length > 3 && (
                      <span className="text-[10px] text-neutral-500 font-mono">
                        +{meta.tags!.length - 3}
                      </span>
                    )}
                  </div>
                </td>

                {/* Action */}
                <td className="py-2.5 px-3 text-right">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectFile(file.id);
                    }}
                    className="p-1 rounded hover:bg-[#323238] text-neutral-400 hover:text-white transition"
                    title="Open document"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
