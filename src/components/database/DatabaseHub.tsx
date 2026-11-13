import React, { useState } from 'react';
import { 
  Table as TableIcon, 
  Kanban as KanbanIcon, 
  LayoutGrid, 
  Search, 
  Plus, 
  Filter, 
  Bot, 
  Wrench, 
  Layers, 
  FileText 
} from 'lucide-react';
import { MarkdownFile, DatabaseViewType, DocType } from '../../types/document';
import { TableView } from './TableView';
import { KanbanView } from './KanbanView';
import { GalleryView } from './GalleryView';

interface DatabaseHubProps {
  files: MarkdownFile[];
  onSelectFile: (id: string) => void;
  onUpdateMetadata: (fileId: string, updatedMetadata: any) => void;
  onNewFile: (type: DocType, initialStatus?: string) => void;
  onRunAgent?: (file: MarkdownFile) => void;
  defaultTypeFilter?: string;
}

export const DatabaseHub: React.FC<DatabaseHubProps> = ({
  files,
  onSelectFile,
  onUpdateMetadata,
  onNewFile,
  onRunAgent,
  defaultTypeFilter = 'all',
}) => {
  const [viewType, setViewType] = useState<DatabaseViewType>('table');
  const [typeFilter, setTypeFilter] = useState<string>(defaultTypeFilter);
  const [searchQuery, setSearchQuery] = useState('');

  // Filter files
  const filteredFiles = files.filter((f) => {
    const meta = f.frontmatter;
    const matchesType = typeFilter === 'all' || meta.type === typeFilter;
    if (!matchesType) return false;

    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    const title = (meta.title || f.name).toLowerCase();
    const tags = (meta.tags || []).join(' ').toLowerCase();
    const model = (meta.model || '').toLowerCase();
    return title.includes(query) || tags.includes(query) || model.includes(query);
  });

  return (
    <div className="flex-1 h-full flex flex-col bg-[#191919] font-sans overflow-hidden">
      {/* Top Header & Filters */}
      <div className="p-6 border-b border-[#2b2b2b] shrink-0 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-neutral-100 tracking-tight">
              Database Hub
            </h1>
            <p className="text-xs text-neutral-400 mt-0.5">
              Multi-view reactive index of your markdown files, agents, skills, and projects.
            </p>
          </div>

          {/* Quick Add Button */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => onNewFile((typeFilter !== 'all' ? typeFilter : 'document') as DocType)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium text-xs transition shadow-sm"
            >
              <Plus className="w-4 h-4" />
              <span>New Record</span>
            </button>
          </div>
        </div>

        {/* View Switcher & Search Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          {/* View Mode Buttons */}
          <div className="flex items-center bg-[#222222] p-1 rounded-lg border border-[#333333]">
            <button
              onClick={() => setViewType('table')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition ${
                viewType === 'table' ? 'bg-[#303030] text-white shadow-sm' : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              <TableIcon className="w-3.5 h-3.5" />
              <span>Table</span>
            </button>
            <button
              onClick={() => setViewType('kanban')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition ${
                viewType === 'kanban' ? 'bg-[#303030] text-white shadow-sm' : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              <KanbanIcon className="w-3.5 h-3.5" />
              <span>Kanban Board</span>
            </button>
            <button
              onClick={() => setViewType('gallery')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition ${
                viewType === 'gallery' ? 'bg-[#303030] text-white shadow-sm' : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              <span>Gallery</span>
            </button>
          </div>

          {/* Category Tabs */}
          <div className="flex items-center gap-1 overflow-x-auto text-xs">
            {[
              { id: 'all', label: 'All Items' },
              { id: 'agent', label: 'Agents', icon: <Bot className="w-3 h-3 text-purple-400" /> },
              { id: 'skill', label: 'Skills', icon: <Wrench className="w-3 h-3 text-emerald-400" /> },
              { id: 'project', label: 'Projects', icon: <Layers className="w-3 h-3 text-blue-400" /> },
              { id: 'document', label: 'Documents', icon: <FileText className="w-3 h-3 text-neutral-400" /> },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setTypeFilter(tab.id)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md transition text-xs ${
                  typeFilter === tab.id
                    ? 'bg-[#2b2b2b] text-white font-medium border border-[#3a3a3a]'
                    : 'text-neutral-400 hover:text-neutral-200 hover:bg-[#222222]'
                }`}
              >
                {tab.icon}
                <span>{tab.label}</span>
              </button>
            ))}
          </div>

          {/* Search Box */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-neutral-500 absolute left-2.5 top-2.5" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter by name, tag, model..."
              className="bg-[#202020] border border-[#333333] rounded-lg pl-8 pr-3 py-1 text-xs text-neutral-200 placeholder-neutral-500 focus:outline-none focus:border-neutral-500 w-56"
            />
          </div>
        </div>
      </div>

      {/* Database Main Content Area */}
      <div className="flex-1 p-6 overflow-y-auto">
        {filteredFiles.length === 0 ? (
          <div className="h-64 flex flex-col items-center justify-center text-center text-neutral-500">
            <Filter className="w-8 h-8 mb-2 opacity-50" />
            <p className="text-sm font-medium">No records match the current filter</p>
            <p className="text-xs text-neutral-600 mt-1">Try changing the filter or search query</p>
          </div>
        ) : viewType === 'table' ? (
          <TableView
            files={filteredFiles}
            onSelectFile={onSelectFile}
            onUpdateMetadata={onUpdateMetadata}
          />
        ) : viewType === 'kanban' ? (
          <KanbanView
            files={filteredFiles}
            onSelectFile={onSelectFile}
            onUpdateMetadata={onUpdateMetadata}
            onNewFile={onNewFile}
          />
        ) : (
          <GalleryView
            files={filteredFiles}
            onSelectFile={onSelectFile}
            onRunAgent={onRunAgent}
          />
        )}
      </div>
    </div>
  );
};
