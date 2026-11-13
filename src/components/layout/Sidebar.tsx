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
  Edit3,
  PanelLeftClose,
  PanelLeftOpen,
  FolderGit2
} from 'lucide-react';
import { MarkdownFile, ViewMode, DocType, FileTreeNode, ProjectWorkspace } from '../../types/document';
import { PortfolioProjectSummary, ProjectDocAuditReport, DocInventoryItem } from '../../types/docAudit';
import { STATUS_META, passportLabel } from '../project/docPassport';
import { FileContextMenu, ContextMenuState } from './FileContextMenu';

interface SidebarProps {
  files: MarkdownFile[];
  tree?: FileTreeNode | null;
  project?: ProjectWorkspace | null;
  portfolioProjects?: PortfolioProjectSummary[];
  portfolioRootPath?: string | null;
  onSelectPortfolioProject?: (workspace: ProjectWorkspace, fileId?: string) => void;
  onOpenSampleVault?: () => void;
  auditReport?: ProjectDocAuditReport;
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
  width: number;
  onWidthChange: (w: number) => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  files,
  tree,
  project,
  portfolioProjects,
  portfolioRootPath,
  onSelectPortfolioProject,
  onOpenSampleVault,
  auditReport,
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
  width,
  onWidthChange,
  isCollapsed,
  onToggleCollapse,
}) => {
  const [collapsedFolders, setCollapsedFolders] = useState<Record<string, boolean>>({});
  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({});
  const [treeTab, setTreeTab] = useState<'files' | 'portfolio'>('files');
  const [showProjectSwitcher, setShowProjectSwitcher] = useState<boolean>(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const passportById = React.useMemo(() => {
    const map = new Map<string, DocInventoryItem>();
    for (const item of auditReport?.inventory || []) map.set(item.fileId, item);
    return map;
  }, [auditReport]);
  const isResizingRef = React.useRef(false);

  const startResizing = (e: React.MouseEvent) => {
    e.preventDefault();
    isResizingRef.current = true;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!isResizingRef.current) return;
      const newWidth = Math.min(Math.max(moveEvent.clientX, 200), 480);
      onWidthChange(newWidth);
    };

    const handleMouseUp = () => {
      isResizingRef.current = false;
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };
  
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
            {(() => {
              const passport = matchingFile ? passportById.get(matchingFile.id) : undefined;
              if (!passport || !['stale', 'duplicate', 'orphan', 'deprecated'].includes(passport.status)) return null;
              return (
                <span
                  className={`w-1.5 h-1.5 rounded-full ${STATUS_META[passport.status].dotClass}`}
                  title={`DocPassport: ${passportLabel(passport)}`}
                  aria-label={passportLabel(passport)}
                />
              );
            })()}
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

  if (isCollapsed) return null;

  return (
    <aside 
      style={{ width: `${width}px` }}
      className="relative h-screen bg-[#1e1e21] text-[#9b9b9b] flex flex-col border-r border-[#2c2c30] select-none text-sm font-sans shrink-0"
    >
      {/* Workspace Header & Quick Switcher */}
      <div className="relative p-3 border-b border-[#2c2c30] flex items-center justify-between">
        <div
          onClick={() => {
            if (portfolioProjects && portfolioProjects.length > 0) {
              setShowProjectSwitcher((prev) => !prev);
            } else {
              onSelectViewMode('project-overview');
            }
          }}
          className="flex items-center gap-2 cursor-pointer group truncate flex-1 min-w-0"
          title={
            portfolioProjects && portfolioProjects.length > 0
              ? 'Switch active project'
              : 'Click to view Project Health Dashboard'
          }
        >
          <div className="w-6 h-6 rounded bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold text-xs shadow-sm shrink-0">
            {project ? project.name[0].toUpperCase() : 'N'}
          </div>
          <div className="truncate flex-1">
            <div className="font-semibold text-neutral-200 text-xs truncate group-hover:text-white transition flex items-center gap-1">
              <span className="truncate">{project ? project.name : 'Markdown Studio'}</span>
              {portfolioProjects && portfolioProjects.length > 0 && (
                <ChevronDown className="w-3 h-3 text-neutral-500 shrink-0" />
              )}
            </div>
            <div className="text-[10px] text-neutral-500 truncate">
              {project?.isLocalFolder ? 'Local Workspace' : 'Sample Vault'}
            </div>
          </div>
        </div>

        {showProjectSwitcher && portfolioProjects && portfolioProjects.length > 0 && (
          <div
            className="absolute left-2 right-2 top-full mt-1 bg-[#222226] border border-[#383840] rounded-lg shadow-2xl py-1.5 z-50 max-h-72 overflow-y-auto"
            onMouseLeave={() => setShowProjectSwitcher(false)}
          >
            <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
              Switch Active Project
            </div>
            {portfolioProjects.map((entry) => {
              const proj = entry.workspace;
              const isCurrent = project?.rootPath === proj.rootPath;
              return (
                <button
                  key={proj.rootPath}
                  onClick={() => {
                    onSelectPortfolioProject?.(proj);
                    setShowProjectSwitcher(false);
                    setTreeTab('files');
                  }}
                  className={`w-full text-left px-3 py-1.5 text-xs flex items-center justify-between gap-2 transition ${
                    isCurrent
                      ? 'bg-indigo-500/20 text-indigo-200 font-medium'
                      : 'text-neutral-300 hover:bg-[#2c2c32]'
                  }`}
                >
                  <span className="truncate flex items-center gap-1.5">
                    <Folder className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                    <span className="truncate">{proj.name}</span>
                  </span>
                  <span className="text-[10px] font-mono text-neutral-400 shrink-0">
                    {entry.auditReport.grade} • {proj.files.length}
                  </span>
                </button>
              );
            })}
            <div className="border-t border-[#323238] mt-1 pt-1">
              {onOpenSampleVault && (
                <button
                  onClick={() => {
                    onOpenSampleVault();
                    setShowProjectSwitcher(false);
                    setTreeTab('files');
                  }}
                  className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-1.5 transition ${
                    project && !project.isLocalFolder ? 'bg-indigo-500/20 text-indigo-200' : 'text-neutral-300 hover:bg-[#2c2c32]'
                  }`}
                >
                  <BookOpen className="w-3.5 h-3.5 text-amber-400" />
                  <span>Sample Vault</span>
                </button>
              )}
              <button
                onClick={() => {
                  onSelectViewMode('portfolio');
                  setShowProjectSwitcher(false);
                }}
                className="w-full text-left px-3 py-1.5 text-xs text-indigo-300 hover:bg-[#2c2c32] flex items-center gap-1.5"
              >
                <FolderGit2 className="w-3.5 h-3.5" />
                <span>All Projects Portfolio</span>
              </button>
            </div>
          </div>
        )}

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
          <button
            onClick={onToggleCollapse}
            className="p-1.5 rounded hover:bg-[#2c2c2c] text-neutral-400 hover:text-white transition"
            title="Collapse sidebar (Ctrl+\)"
          >
            <PanelLeftClose className="w-3.5 h-3.5" />
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
          onClick={() => onSelectViewMode('portfolio')}
          className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-md text-xs font-medium transition ${
            viewMode === 'portfolio' ? 'bg-[#2c2c2c] text-neutral-100' : 'hover:bg-[#262626] text-neutral-400 hover:text-neutral-200'
          }`}
        >
          <span className="flex items-center gap-2.5">
            <FolderGit2 className="w-4 h-4 text-indigo-400" />
            <span>Projects Portfolio</span>
          </span>
          {portfolioProjects && portfolioProjects.length > 0 && (
            <span className="px-1.5 py-0.2 text-[10px] rounded-full bg-indigo-500/20 text-indigo-300 font-semibold">
              {portfolioProjects.length}
            </span>
          )}
        </button>

        <div className="px-2.5 pt-2 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-600 truncate">
          Workspace: {project?.name || 'Vault'}
        </div>

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

      {/* Adaptive Explorer Header: Segmented Active Files vs Portfolio Projects */}
      <div className="px-3 pt-3 pb-1.5 border-t border-[#2c2c30] mt-1 space-y-2">
        {portfolioProjects && portfolioProjects.length > 0 ? (
          <div className="flex items-center gap-1 p-0.5 rounded-lg bg-[#161618] border border-[#2c2c30]">
            <button
              onClick={() => setTreeTab('files')}
              className={`flex-1 py-1 px-2 rounded-md text-[11px] font-medium transition truncate ${
                treeTab === 'files'
                  ? 'bg-[#2a2a2f] text-neutral-100 shadow-sm'
                  : 'text-neutral-500 hover:text-neutral-300'
              }`}
              title={`Files in ${project?.name || 'active workspace'}`}
            >
              Active Files
            </button>
            <button
              onClick={() => setTreeTab('portfolio')}
              className={`flex-1 py-1 px-2 rounded-md text-[11px] font-medium transition truncate ${
                treeTab === 'portfolio'
                  ? 'bg-indigo-500/20 text-indigo-200 shadow-sm'
                  : 'text-neutral-500 hover:text-neutral-300'
              }`}
              title={portfolioRootPath || 'All scanned portfolio projects'}
            >
              Portfolio ({portfolioProjects.length})
            </button>
          </div>
        ) : null}

        {(!portfolioProjects || portfolioProjects.length === 0 || treeTab === 'files') && (
          <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
            <span className="truncate">{project ? `${project.name} Files` : 'Files & Structure'}</span>
            <div className="relative group shrink-0">
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
        )}
      </div>

      {/* Tree Content Area */}
      <div className="flex-1 overflow-y-auto px-2 space-y-0.5 pb-4">
        {portfolioProjects && portfolioProjects.length > 0 && treeTab === 'portfolio' ? (
          portfolioProjects.map((entry) => {
            const proj = entry.workspace;
            const isCurrentProject = project?.rootPath === proj.rootPath;
            const isExpanded = expandedProjects[proj.rootPath] ?? isCurrentProject;
            const grade = entry.auditReport.grade;
            const gradeClass =
              grade === 'A'
                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                : grade === 'B'
                  ? 'bg-sky-500/20 text-sky-300 border-sky-500/30'
                  : grade === 'C'
                    ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                    : 'bg-rose-500/20 text-rose-300 border-rose-500/30';

            return (
              <div key={proj.rootPath} className="select-none">
                <div
                  onClick={() => {
                    setExpandedProjects((prev) => ({
                      ...prev,
                      [proj.rootPath]: !isExpanded,
                    }));
                    onSelectPortfolioProject?.(proj);
                  }}
                  className={`group flex items-center justify-between py-1 px-2 rounded text-xs cursor-pointer transition ${
                    isCurrentProject
                      ? 'bg-indigo-500/15 text-indigo-200 font-medium border border-indigo-500/30'
                      : 'text-neutral-300 hover:bg-[#262626] hover:text-neutral-100'
                  }`}
                >
                  <div className="flex items-center gap-1.5 truncate">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setExpandedProjects((prev) => ({
                          ...prev,
                          [proj.rootPath]: !isExpanded,
                        }));
                      }}
                      className="p-0.5 hover:text-white"
                    >
                      {isExpanded ? (
                        <ChevronDown className="w-3 h-3 text-neutral-500" />
                      ) : (
                        <ChevronRight className="w-3 h-3 text-neutral-500" />
                      )}
                    </button>
                    <Folder className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                    <span className="truncate">{proj.name}</span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="text-[10px] text-neutral-500 font-mono">
                      {proj.files.length}
                    </span>
                    <span
                      className={`text-[9px] font-bold px-1.5 py-0.2 rounded border ${gradeClass}`}
                    >
                      {grade}
                    </span>
                  </div>
                </div>

                {isExpanded && proj.files.length > 0 && (
                  <div className="pl-5 pr-1 py-0.5 space-y-0.5 border-l border-[#2c2c30] ml-3 my-0.5">
                    {proj.files.map((f) => {
                      const isSelectedFile = isCurrentProject && activeFileId === f.id;
                      return (
                        <div
                          key={f.id}
                          onClick={() => onSelectPortfolioProject?.(proj, f.id)}
                          className={`flex items-center justify-between py-1 px-2 rounded text-[11px] cursor-pointer transition ${
                            isSelectedFile
                              ? 'bg-[#2f2f2f] text-white font-medium'
                              : 'text-neutral-400 hover:bg-[#262626] hover:text-neutral-200'
                          }`}
                          title={f.path}
                        >
                          <div className="flex items-center gap-1.5 truncate">
                            {getDocIcon(f.frontmatter?.type)}
                            <span className="truncate">{f.path}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        ) : tree && tree.children && tree.children.length > 0 ? (
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
      {/* Draggable Resizer Edge */}
      <div
        onMouseDown={startResizing}
        onDoubleClick={() => onWidthChange(256)}
        className="absolute right-0 top-0 bottom-0 w-1 hover:w-1.5 cursor-col-resize hover:bg-amber-500/70 active:bg-amber-500 transition-colors z-30"
        title="Drag to resize sidebar (Double-click to reset)"
      />
    </aside>
  );
};
