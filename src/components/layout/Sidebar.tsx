import React, { useState } from 'react';
import { 
  Folder, 
  FolderOpen, 
  FileText, 
  Bot, 
  Sparkles, 
  CheckSquare, 
  LayoutGrid, 
  Plus, 
  Search, 
  Settings, 
  ChevronRight, 
  ChevronDown, 
  BookOpen, 
  Layers,
  Wrench,
  Sun,
  Moon,
  Trash2,
  Share2,
  HardDrive,
  Activity,
  MoreVertical,
  Edit3
} from 'lucide-react';
import { MarkdownFile, ViewMode, DocType, FileTreeNode, ProjectWorkspace } from '../../types/document';
import { FileContextMenu, ContextMenuState } from './FileContextMenu';

interface SidebarProps {
  files: MarkdownFile[];
  tree?: FileTreeNode | null;
  project?: ProjectWorkspace | null;
  activeFileId: string | null;
  onSelectFile: (id: string) => void;
  onNewFile: (type: DocType, targetFolder?: string) => void;
  onNewFolder?: (parentFolder: string, folderName: string) => void;
  onRenameNode?: (node: FileTreeNode, newName: string) => void;
  onDeleteFile: (id: string, fullPath?: string) => void;
  onOpenProjectFolder: () => void;
  viewMode: ViewMode;
  onSelectViewMode: (mode: ViewMode) => void;
  onOpenSettings: () => void;
  onOpenCommandPalette: () => void;
  taskCount: { total: number; pending: number };
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  onAIAssist?: (file: MarkdownFile) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  files,
  tree,
  project,
  activeFileId,
  onSelectFile,
  onNewFile,
  onNewFolder,
  onRenameNode,
  onDeleteFile,
  onOpenProjectFolder,
  viewMode,
  onSelectViewMode,
  onOpenSettings,
  onOpenCommandPalette,
  taskCount,
  theme,
  onToggleTheme,
  onAIAssist,
}) => {
  const [collapsedFolders, setCollapsedFolders] = useState<Record<string, boolean>>({});
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  
  // Prompt modals for rename / new folder
  const [modalType, setModalType] = useState<'new-folder' | 'rename' | null>(null);
  const [targetNode, setTargetNode] = useState<FileTreeNode | null>(null);
  const [inputVal, setInputVal] = useState('');

  const toggleFolder = (folderId: string) => {
    setCollapsedFolders((prev) => ({ ...prev, [folderId]: !prev[folderId] }));
  };

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

  const handleContextMenu = (e: React.MouseEvent, node: FileTreeNode) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      node,
    });
  };

  const handleModalSubmit = () => {
    if (!inputVal.trim()) return;
    if (modalType === 'new-folder' && targetNode && onNewFolder) {
      onNewFolder(targetNode.fullPath || targetNode.path, inputVal.trim());
    } else if (modalType === 'rename' && targetNode && onRenameNode) {
      onRenameNode(targetNode, inputVal.trim());
    }
    setModalType(null);
    setInputVal('');
    setTargetNode(null);
  };

  // Render a recursive tree node
  const renderTreeNode = (node: FileTreeNode, depth: number = 0) => {
    if (node.isFolder) {
      const isCollapsed = collapsedFolders[node.id];
      const hasChildren = node.children && node.children.length > 0;

      return (
        <div key={node.id} className="select-none">
          {/* Folder row */}
          <div
            onClick={() => toggleFolder(node.id)}
            onContextMenu={(e) => handleContextMenu(e, node)}
            style={{ paddingLeft: `${depth * 12 + 6}px` }}
            className="group flex items-center justify-between py-1 px-2 rounded text-xs text-neutral-400 hover:text-neutral-200 hover:bg-[#262626] cursor-pointer transition"
          >
            <div className="flex items-center gap-1.5 truncate">
              {hasChildren ? (
                isCollapsed ? <ChevronRight className="w-3 h-3 text-neutral-500" /> : <ChevronDown className="w-3 h-3 text-neutral-500" />
              ) : (
                <div className="w-3" />
              )}
              {isCollapsed ? (
                <Folder className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
              ) : (
                <FolderOpen className="w-3.5 h-3.5 text-amber-500/80 shrink-0" />
              )}
              <span className="truncate font-medium">{node.name}</span>
            </div>

            <div className="flex items-center gap-1">
              {node.itemCount !== undefined && node.itemCount > 0 && (
                <span className="text-[10px] text-neutral-600 font-mono">
                  {node.itemCount}
                </span>
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onNewFile('document', node.fullPath || node.path);
                }}
                className="opacity-0 group-hover:opacity-100 p-0.5 hover:text-white rounded transition"
                title="New file in this folder"
              >
                <Plus className="w-3 h-3" />
              </button>
            </div>
          </div>

          {/* Children nodes */}
          {!isCollapsed && hasChildren && (
            <div>
              {node.children!.map((child) => renderTreeNode(child, depth + 1))}
            </div>
          )}
        </div>
      );
    } else {
      // File Node
      const matchingFile = files.find((f) => f.id === node.id || f.path === node.path);
      const isActive = matchingFile?.id === activeFileId;
      const type = matchingFile?.frontmatter?.type || node.docType || 'document';

      return (
        <div
          key={node.id}
          onClick={() => {
            if (matchingFile) {
              onSelectFile(matchingFile.id);
              onSelectViewMode('editor');
            }
          }}
          onContextMenu={(e) => handleContextMenu(e, node)}
          style={{ paddingLeft: `${depth * 12 + 18}px` }}
          className={`group flex items-center justify-between py-1 px-2 rounded text-xs transition cursor-pointer ${
            isActive
              ? 'bg-[#2f2f2f] text-neutral-100 font-medium'
              : 'text-neutral-400 hover:bg-[#262626] hover:text-neutral-200'
          }`}
        >
          <div className="flex items-center gap-2 truncate">
            {getDocIcon(type)}
            <span className="truncate">
              {matchingFile?.frontmatter?.title || node.name}
            </span>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {matchingFile?.isDirty && (
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400" title="Unsaved" />
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (confirm(`Delete ${node.name}?`)) {
                  onDeleteFile(matchingFile?.id || node.id, node.fullPath);
                }
              }}
              className="opacity-0 group-hover:opacity-100 p-0.5 hover:text-rose-400 rounded transition"
              title="Delete"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        </div>
      );
    }
  };

  return (
    <aside className="w-64 h-screen bg-[#202020] text-[#9b9b9b] flex flex-col border-r border-[#2f2f2f] select-none text-sm font-sans shrink-0">
      {/* Workspace Header & Project Folder Button */}
      <div className="p-3 border-b border-[#2f2f2f] flex items-center justify-between">
        <div 
          onClick={() => onSelectViewMode('project-overview')}
          className="flex items-center gap-2 cursor-pointer group truncate"
          title="Click to view Project Health Dashboard"
        >
          <div className="w-6 h-6 rounded bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold text-xs shadow-sm shrink-0">
            {project ? project.name[0].toUpperCase() : 'N'}
          </div>
          <div className="truncate">
            <div className="font-semibold text-neutral-200 text-xs truncate group-hover:text-white transition">
              {project ? project.name : 'Markdown Studio'}
            </div>
            <div className="text-[10px] text-neutral-500 truncate">
              {project?.isLocalFolder ? 'Local Project' : 'Sample Vault'}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={onOpenProjectFolder}
            className="p-1.5 rounded hover:bg-[#2c2c2c] text-neutral-400 hover:text-white transition"
            title="Open Local Project Folder..."
          >
            <FolderOpen className="w-3.5 h-3.5 text-blue-400" />
          </button>
          <button
            onClick={onToggleTheme}
            className="p-1.5 rounded hover:bg-[#2c2c2c] text-neutral-400 hover:text-neutral-200 transition"
            title="Toggle theme"
          >
            {theme === 'dark' ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Quick Search Button */}
      <div className="px-3 pt-3">
        <button
          onClick={onOpenCommandPalette}
          className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-md bg-[#282828] hover:bg-[#303030] border border-[#333333] text-neutral-400 hover:text-neutral-200 transition text-xs shadow-inner"
        >
          <span className="flex items-center gap-2">
            <Search className="w-3.5 h-3.5" />
            <span>Search or jump...</span>
          </span>
          <kbd className="px-1.5 py-0.5 text-[10px] bg-[#1d1d1d] rounded border border-[#3a3a3a] text-neutral-400">Ctrl K</kbd>
        </button>
      </div>

      {/* Primary Navigation Views */}
      <div className="px-2 pt-3 pb-1 space-y-0.5">
        <button
          onClick={() => onSelectViewMode('project-overview')}
          className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition ${
            viewMode === 'project-overview' ? 'bg-[#2c2c2c] text-neutral-100' : 'hover:bg-[#262626] text-neutral-400 hover:text-neutral-200'
          }`}
        >
          <Activity className="w-4 h-4 text-emerald-400" />
          <span>Project Overview</span>
        </button>

        <button
          onClick={() => onSelectViewMode('editor')}
          className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition ${
            viewMode === 'editor' ? 'bg-[#2c2c2c] text-neutral-100' : 'hover:bg-[#262626] text-neutral-400 hover:text-neutral-200'
          }`}
        >
          <BookOpen className="w-4 h-4 text-sky-400" />
          <span>Editor & Notes</span>
        </button>

        <button
          onClick={() => onSelectViewMode('database')}
          className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition ${
            viewMode === 'database' ? 'bg-[#2c2c2c] text-neutral-100' : 'hover:bg-[#262626] text-neutral-400 hover:text-neutral-200'
          }`}
        >
          <LayoutGrid className="w-4 h-4 text-amber-400" />
          <span>Notion Database Hub</span>
        </button>

        <button
          onClick={() => onSelectViewMode('agent-hub')}
          className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition ${
            viewMode === 'agent-hub' ? 'bg-[#2c2c2c] text-neutral-100' : 'hover:bg-[#262626] text-neutral-400 hover:text-neutral-200'
          }`}
        >
          <Bot className="w-4 h-4 text-purple-400" />
          <span>Agents & Skills Testbed</span>
        </button>

        <button
          onClick={() => onSelectViewMode('tasks')}
          className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-md text-xs font-medium transition ${
            viewMode === 'tasks' ? 'bg-[#2c2c2c] text-neutral-100' : 'hover:bg-[#262626] text-neutral-400 hover:text-neutral-200'
          }`}
        >
          <span className="flex items-center gap-2.5">
            <CheckSquare className="w-4 h-4 text-emerald-400" />
            <span>Tasks Rolodex</span>
          </span>
          {taskCount.pending > 0 && (
            <span className="px-1.5 py-0.2 text-[10px] rounded-full bg-emerald-500/20 text-emerald-300 font-semibold">
              {taskCount.pending}
            </span>
          )}
        </button>

        <button
          onClick={() => onSelectViewMode('graph')}
          className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition ${
            viewMode === 'graph' ? 'bg-[#2c2c2c] text-neutral-100' : 'hover:bg-[#262626] text-neutral-400 hover:text-neutral-200'
          }`}
        >
          <Share2 className="w-4 h-4 text-violet-400" />
          <span>Knowledge Graph</span>
        </button>
      </div>

      {/* Project Hierarchy Header */}
      <div className="px-3 pt-3 pb-1 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
        <span>Files & Structure</span>
        <div className="relative group">
          <button 
            className="p-1 rounded hover:bg-[#2c2c2c] text-neutral-400 hover:text-neutral-200 transition"
            title="Create New Item"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
          <div className="absolute right-0 top-full mt-1 w-36 bg-[#252525] border border-[#383838] rounded-md shadow-xl py-1 hidden group-hover:block z-50">
            <button
              onClick={() => onNewFile('document')}
              className="w-full text-left px-3 py-1.5 text-xs text-neutral-300 hover:bg-[#303030] flex items-center gap-2"
            >
              <FileText className="w-3.5 h-3.5 text-blue-400" /> Page
            </button>
            <button
              onClick={() => onNewFile('project')}
              className="w-full text-left px-3 py-1.5 text-xs text-neutral-300 hover:bg-[#303030] flex items-center gap-2"
            >
              <Layers className="w-3.5 h-3.5 text-sky-400" /> Project
            </button>
            <button
              onClick={() => onNewFile('agent')}
              className="w-full text-left px-3 py-1.5 text-xs text-neutral-300 hover:bg-[#303030] flex items-center gap-2"
            >
              <Bot className="w-3.5 h-3.5 text-purple-400" /> Agent
            </button>
            <button
              onClick={() => onNewFile('skill')}
              className="w-full text-left px-3 py-1.5 text-xs text-neutral-300 hover:bg-[#303030] flex items-center gap-2"
            >
              <Wrench className="w-3.5 h-3.5 text-emerald-400" /> Skill
            </button>
          </div>
        </div>
      </div>

      {/* Recursive Project Tree */}
      <div className="flex-1 overflow-y-auto px-2 space-y-0.5 pb-4">
        {tree && tree.children && tree.children.length > 0 ? (
          tree.children.map((child) => renderTreeNode(child, 0))
        ) : (
          <div className="py-8 text-center text-xs text-neutral-500">
            No Markdown files detected in this folder.
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="p-2 border-t border-[#2f2f2f] flex items-center justify-between">
        <button
          onClick={onOpenSettings}
          className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-[#2c2c2c] text-neutral-400 hover:text-neutral-200 transition text-xs"
        >
          <Settings className="w-3.5 h-3.5" />
          <span>AI & Settings</span>
        </button>
        <span className="text-[10px] text-neutral-600">v1.2.0</span>
      </div>

      {/* Right-Click Context Menu */}
      <FileContextMenu
        menu={contextMenu}
        onClose={() => setContextMenu(null)}
        onNewFile={(folderNode) => onNewFile('document', folderNode.fullPath || folderNode.path)}
        onNewFolder={(folderNode) => {
          setTargetNode(folderNode);
          setModalType('new-folder');
          setInputVal('');
        }}
        onRename={(node) => {
          setTargetNode(node);
          setModalType('rename');
          setInputVal(node.name);
        }}
        onDelete={(node) => onDeleteFile(node.id, node.fullPath)}
        onAIAssist={(node) => {
          const match = files.find((f) => f.id === node.id || f.path === node.path);
          if (match && onAIAssist) onAIAssist(match);
        }}
      />

      {/* Simple Inline Dialog for New Folder / Rename */}
      {modalType && (
        <div 
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 font-sans"
          onClick={() => setModalType(null)}
        >
          <div 
            className="w-80 bg-[#222] border border-[#383838] rounded-xl shadow-2xl p-4 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-xs font-semibold text-neutral-200">
              {modalType === 'new-folder' ? 'Create New Subfolder' : 'Rename'}
            </h3>
            <input
              type="text"
              value={inputVal}
              onChange={(e) => setInputVal(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleModalSubmit();
                if (e.key === 'Escape') setModalType(null);
              }}
              autoFocus
              placeholder={modalType === 'new-folder' ? 'Folder name...' : 'New file name...'}
              className="w-full bg-[#181818] border border-[#333] rounded px-3 py-1.5 text-xs text-neutral-100 focus:outline-none focus:border-blue-500"
            />
            <div className="flex justify-end gap-2 text-xs">
              <button
                onClick={() => setModalType(null)}
                className="px-3 py-1 rounded hover:bg-[#333] text-neutral-400"
              >
                Cancel
              </button>
              <button
                onClick={handleModalSubmit}
                className="px-3 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white font-medium"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
};
