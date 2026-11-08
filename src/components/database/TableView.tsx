import React, { useState } from 'react';
import { Bot, Wrench, Layers, FileText, ArrowUpDown, ChevronRight, MoreHorizontal, ExternalLink } from 'lucide-react';
import { MarkdownFile, DocType } from '../../types/document';

interface TableViewProps {
  files: MarkdownFile[];
  onSelectFile: (id: string) => void;
  onUpdateMetadata: (fileId: string, updatedMetadata: any) => void;
}

export const TableView: React.FC<TableViewProps> = ({
  files,
  onSelectFile,
  onUpdateMetadata,
}) => {
  const [sortField, setSortField] = useState<'title' | 'type' | 'status' | 'priority'>('title');
  const [sortAsc, setSortAsc] = useState(true);

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
        return <Bot className="w-3.5 h-3.5 text-purple-400" />;
      case 'skill':
        return <Wrench className="w-3.5 h-3.5 text-emerald-400" />;
      case 'project':
        return <Layers className="w-3.5 h-3.5 text-blue-400" />;
      default:
        return <FileText className="w-3.5 h-3.5 text-neutral-400" />;
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

  return (
    <div className="w-full overflow-x-auto rounded-lg border border-[#2f2f2f] bg-[#1a1a1a]">
      <table className="w-full text-left text-xs font-sans border-collapse">
        <thead>
          <tr className="border-b border-[#2f2f2f] bg-[#222222] text-neutral-400 select-none">
            <th 
              onClick={() => handleSort('title')}
              className="py-2.5 px-4 font-semibold hover:text-white cursor-pointer w-1/3"
            >
              <div className="flex items-center gap-1.5">
                <span>Name / Title</span>
                <ArrowUpDown className="w-3 h-3 text-neutral-500" />
              </div>
            </th>
            <th 
              onClick={() => handleSort('type')}
              className="py-2.5 px-3 font-semibold hover:text-white cursor-pointer"
            >
              <div className="flex items-center gap-1.5">
                <span>Type</span>
                <ArrowUpDown className="w-3 h-3 text-neutral-500" />
              </div>
            </th>
            <th 
              onClick={() => handleSort('status')}
              className="py-2.5 px-3 font-semibold hover:text-white cursor-pointer"
            >
              <div className="flex items-center gap-1.5">
                <span>Status</span>
                <ArrowUpDown className="w-3 h-3 text-neutral-500" />
              </div>
            </th>
            <th 
              onClick={() => handleSort('priority')}
              className="py-2.5 px-3 font-semibold hover:text-white cursor-pointer"
            >
              <div className="flex items-center gap-1.5">
                <span>Priority</span>
                <ArrowUpDown className="w-3 h-3 text-neutral-500" />
              </div>
            </th>
            <th className="py-2.5 px-3 font-semibold">Model / Category</th>
            <th className="py-2.5 px-3 font-semibold">Tags</th>
            <th className="py-2.5 px-3 font-semibold w-16 text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#272727]">
          {sortedFiles.map((file) => {
            const meta = file.frontmatter;
            return (
              <tr
                key={file.id}
                onClick={() => onSelectFile(file.id)}
                className="hover:bg-[#232323] transition group cursor-pointer"
              >
                {/* Title */}
                <td className="py-2.5 px-4">
                  <div className="flex items-center gap-2.5">
                    {getDocIcon(meta.type)}
                    <span className="font-medium text-neutral-200 group-hover:text-white truncate">
                      {meta.title || file.name}
                    </span>
                  </div>
                </td>

                {/* Type */}
                <td className="py-2.5 px-3">
                  <span className="capitalize text-neutral-400">
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

                {/* Priority */}
                <td className="py-2.5 px-3">
                  <span className={`px-2 py-0.5 rounded text-[11px] ${
                    meta.priority === 'Critical' ? 'text-rose-400 font-semibold' :
                    meta.priority === 'High' ? 'text-amber-400' : 'text-neutral-400'
                  }`}>
                    {meta.priority || 'Medium'}
                  </span>
                </td>

                {/* Model or Category */}
                <td className="py-2.5 px-3 font-mono text-[11px] text-neutral-400 truncate max-w-[140px]">
                  {meta.model || meta.category || '-'}
                </td>

                {/* Tags */}
                <td className="py-2.5 px-3">
                  <div className="flex flex-wrap gap-1 max-w-[200px]">
                    {(meta.tags || []).slice(0, 3).map((tag) => (
                      <span
                        key={tag}
                        className="px-1.5 py-0.2 rounded bg-[#282828] text-neutral-400 text-[10px] border border-[#333]"
                      >
                        #{tag}
                      </span>
                    ))}
                    {(meta.tags || []).length > 3 && (
                      <span className="text-[10px] text-neutral-500">
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
                    className="p-1 rounded hover:bg-[#333] text-neutral-400 hover:text-white transition"
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
