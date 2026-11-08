import React, { useState, useEffect, useCallback } from 'react';
import { MarkdownFile, ViewMode, DocType, ProjectWorkspace, FileTreeNode } from './types/document';
import { getSampleWorkspace } from './services/sampleVault';
import { MarkdownService } from './services/markdown';
import { ProjectScannerService } from './services/projectScanner';
import { Sidebar } from './components/layout/Sidebar';
import { TopNav } from './components/layout/TopNav';
import { CommandPalette } from './components/layout/CommandPalette';
import { NotionEditor } from './components/editor/NotionEditor';
import { DatabaseHub } from './components/database/DatabaseHub';
import { AgentPlayground } from './components/ai/AgentPlayground';
import { GlobalTaskRolodex } from './components/tasks/GlobalTaskRolodex';
import { KnowledgeGraph } from './components/graph/KnowledgeGraph';
import { ProjectDashboard } from './components/project/ProjectDashboard';
import { AISummaryModal } from './components/ai/AISummaryModal';
import { AISettingsModal } from './components/ai/AISettingsModal';

const SAVED_WORKSPACE_PATH_KEY = 'notion_active_project_path';
const SAVED_FILES_KEY = 'notion_markdown_vault_files';

export const App: React.FC = () => {
  // Active Project Workspace (sample or local directory)
  const [workspace, setWorkspace] = useState<ProjectWorkspace>(() => {
    return getSampleWorkspace();
  });

  const [files, setFiles] = useState<MarkdownFile[]>(() => {
    return workspace.files;
  });

  const [activeFileId, setActiveFileId] = useState<string | null>(() => {
    return files[0]?.id || null;
  });

  const [viewMode, setViewMode] = useState<ViewMode>('editor');
  const [isRawMarkdown, setIsRawMarkdown] = useState<boolean>(false);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  // Modals
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);

  // Restore previous project path if in Electron on first boot
  useEffect(() => {
    const savedPath = localStorage.getItem(SAVED_WORKSPACE_PATH_KEY);
    if (savedPath && ProjectScannerService.isElectron()) {
      ProjectScannerService.scanPath(savedPath).then((ws) => {
        if (ws) {
          setWorkspace(ws);
          setFiles(ws.files);
          setActiveFileId(ws.files[0]?.id || null);
        }
      });
    }
  }, []);

  // Listen for live disk file changes in Electron
  useEffect(() => {
    if (ProjectScannerService.isElectron() && window.electronAPI?.onFsChanged) {
      window.electronAPI.onFsChanged((data) => {
        console.log('[Live Disk Watcher]: External changes detected in', data.changedFile);
        if (workspace.isLocalFolder && workspace.rootPath) {
          ProjectScannerService.scanPath(workspace.rootPath).then((refreshed) => {
            if (refreshed) {
              setWorkspace(refreshed);
              setFiles(refreshed.files);
            }
          });
        }
      });
    }
  }, [workspace.isLocalFolder, workspace.rootPath]);

  // Global Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const activeFile = files.find((f) => f.id === activeFileId) || null;

  // Task count calculation
  const totalTasks = files.reduce((acc, f) => acc + (f.tasks?.length || 0), 0);
  const pendingTasks = files.reduce(
    (acc, f) => acc + (f.tasks?.filter((t) => !t.completed).length || 0),
    0
  );

  // Open & Scan Project Folder from disk
  const handleOpenProjectFolder = async () => {
    const scanned = await ProjectScannerService.openAndScanProject();
    if (scanned) {
      setWorkspace(scanned);
      setFiles(scanned.files);
      if (scanned.isLocalFolder && scanned.rootPath) {
        localStorage.setItem(SAVED_WORKSPACE_PATH_KEY, scanned.rootPath);
      }
      // Prioritize opening README or first document
      const readme = scanned.files.find((f) => f.name.toLowerCase().startsWith('readme'));
      setActiveFileId(readme ? readme.id : scanned.files[0]?.id || null);
      setViewMode('project-overview');
    }
  };

  // Refresh current project
  const handleRefreshProject = async () => {
    if (workspace.isLocalFolder && workspace.rootPath) {
      const refreshed = await ProjectScannerService.scanPath(workspace.rootPath);
      if (refreshed) {
        setWorkspace(refreshed);
        setFiles(refreshed.files);
      }
    } else {
      const sample = getSampleWorkspace();
      setWorkspace(sample);
      setFiles(sample.files);
    }
  };

  // Create new document (optionally in a target subfolder)
  const handleNewFile = async (type: DocType = 'document', targetFolder?: string) => {
    const template = MarkdownService.getTemplate(type as any);
    const timestamp = Date.now().toString().slice(-4);
    const fileName = `${type}-${timestamp}.md`;

    let folderPath = targetFolder || '';
    if (!folderPath) {
      folderPath = type === 'agent' ? 'agents' : type === 'skill' ? 'skills' : type === 'project' ? 'projects' : 'docs';
    }

    const relPath = folderPath.endsWith('.md') ? folderPath.slice(0, folderPath.lastIndexOf('/')) : folderPath;
    const filePath = relPath ? `${relPath}/${fileName}` : fileName;
    const fullPath = workspace.isLocalFolder ? `${workspace.rootPath}/${filePath}`.replace(/\\/g, '/') : undefined;

    const raw = MarkdownService.stringify(template.frontmatter, template.body);
    const parsed = MarkdownService.parse(raw, filePath);

    const newFile: MarkdownFile = {
      id: filePath,
      path: filePath,
      fullPath,
      name: fileName,
      content: raw,
      frontmatter: parsed.frontmatter,
      body: parsed.body,
      wordCount: parsed.wordCount,
      tasks: parsed.tasks,
      isDirty: false,
    };

    // If local folder, write immediately to disk
    if (workspace.isLocalFolder && fullPath) {
      await ProjectScannerService.createFile(relPath ? `${workspace.rootPath}/${relPath}` : workspace.rootPath, fileName, raw);
      handleRefreshProject();
    } else {
      setFiles((prev) => [newFile, ...prev]);
    }

    setActiveFileId(newFile.id);
    setViewMode('editor');
  };

  // Create new subfolder
  const handleNewFolder = async (parentFolder: string, folderName: string) => {
    if (workspace.isLocalFolder) {
      const targetPath = `${parentFolder}/${folderName}`.replace(/\\/g, '/');
      await ProjectScannerService.createFolder(targetPath);
      handleRefreshProject();
    }
  };

  // Rename node
  const handleRenameNode = async (node: FileTreeNode, newName: string) => {
    if (workspace.isLocalFolder && node.fullPath) {
      const lastSlash = Math.max(node.fullPath.lastIndexOf('/'), node.fullPath.lastIndexOf('\\'));
      const parentDir = lastSlash !== -1 ? node.fullPath.substring(0, lastSlash) : node.fullPath;
      const newFullPath = `${parentDir}/${newName}`.replace(/\\/g, '/');
      await ProjectScannerService.renamePath(node.fullPath, newFullPath);
      handleRefreshProject();
    }
  };

  // Delete file or folder
  const handleDeleteFile = async (id: string, fullPath?: string) => {
    if (workspace.isLocalFolder && fullPath) {
      await ProjectScannerService.deletePath(fullPath);
      handleRefreshProject();
    } else {
      setFiles((prev) => prev.filter((f) => f.id !== id));
      if (activeFileId === id) {
        const remaining = files.filter((f) => f.id !== id);
        setActiveFileId(remaining[0]?.id || null);
      }
    }
  };

  // Update file content
  const handleFileChange = async (updatedContent: string, updatedFrontmatter?: any) => {
    if (!activeFileId) return;

    const updatedFiles = files.map((f) => {
      if (f.id !== activeFileId) return f;
      const parsed = MarkdownService.parse(updatedContent, f.path);
      const updatedFile = {
        ...f,
        content: updatedContent,
        frontmatter: updatedFrontmatter || parsed.frontmatter,
        body: parsed.body,
        wordCount: parsed.wordCount,
        tasks: parsed.tasks,
        isDirty: true,
      };

      // If local file, save to disk
      if (workspace.isLocalFolder && f.fullPath) {
        ProjectScannerService.saveFileToDisk(updatedFile);
      }

      return updatedFile;
    });

    setFiles(updatedFiles);
  };

  // Update specific metadata properties (from Database Table or Kanban)
  const handleUpdateMetadata = async (fileId: string, updatedMetadata: any) => {
    const updatedFiles = files.map((f) => {
      if (f.id !== fileId) return f;
      const fullMarkdown = MarkdownService.stringify(updatedMetadata, f.body);
      const parsed = MarkdownService.parse(fullMarkdown, f.path);
      const updated = {
        ...f,
        content: fullMarkdown,
        frontmatter: updatedMetadata,
        body: parsed.body,
        wordCount: parsed.wordCount,
        tasks: parsed.tasks,
        isDirty: false,
      };

      if (workspace.isLocalFolder && f.fullPath) {
        ProjectScannerService.saveFileToDisk(updated);
      }

      return updated;
    });

    setFiles(updatedFiles);
  };

  // Save active file
  const handleSave = () => {
    if (!activeFileId || !activeFile) return;
    if (workspace.isLocalFolder && activeFile.fullPath) {
      ProjectScannerService.saveFileToDisk(activeFile);
    }
    setFiles((prev) =>
      prev.map((f) => (f.id === activeFileId ? { ...f, isDirty: false } : f))
    );
  };

  return (
    <div className={`flex h-screen w-screen bg-[#191919] text-neutral-200 overflow-hidden font-sans ${theme}`}>
      {/* Notion Sidebar with Hierarchical Tree */}
      <Sidebar
        files={files}
        tree={workspace.tree}
        project={workspace}
        activeFileId={activeFileId}
        onSelectFile={(id) => {
          setActiveFileId(id);
          setViewMode('editor');
        }}
        onNewFile={handleNewFile}
        onNewFolder={handleNewFolder}
        onRenameNode={handleRenameNode}
        onDeleteFile={handleDeleteFile}
        onOpenProjectFolder={handleOpenProjectFolder}
        viewMode={viewMode}
        onSelectViewMode={setViewMode}
        onOpenSettings={() => setSettingsModalOpen(true)}
        onOpenCommandPalette={() => setCommandPaletteOpen(true)}
        taskCount={{ total: totalTasks, pending: pendingTasks }}
        theme={theme}
        onToggleTheme={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        onAIAssist={(file) => {
          setActiveFileId(file.id);
          setAiModalOpen(true);
        }}
      />

      {/* Main Workspace Area */}
      <main className="flex-1 flex flex-col h-full overflow-hidden bg-[#191919]">
        {/* Top Navbar */}
        <TopNav
          activeFile={activeFile}
          onOpenAIModal={() => setAiModalOpen(true)}
          onOpenAgentTester={() => setViewMode('agent-hub')}
          isRawMarkdown={isRawMarkdown}
          onToggleRawMarkdown={() => setIsRawMarkdown(!isRawMarkdown)}
          onSave={handleSave}
        />

        {/* View Switcher Container */}
        <div className="flex-1 overflow-hidden relative">
          {viewMode === 'project-overview' && (
            <ProjectDashboard
              project={workspace}
              onSelectFile={(id) => {
                setActiveFileId(id);
                setViewMode('editor');
              }}
              onSelectViewMode={setViewMode}
              onNewFile={() => handleNewFile('document')}
              onRefreshProject={handleRefreshProject}
            />
          )}

          {viewMode === 'editor' && activeFile && (
            <NotionEditor
              file={activeFile}
              onChange={handleFileChange}
              isRawMarkdown={isRawMarkdown}
              onOpenAIModal={() => setAiModalOpen(true)}
            />
          )}

          {viewMode === 'editor' && !activeFile && (
            <div className="h-full flex flex-col items-center justify-center text-neutral-500 text-xs">
              <p>No document selected. Choose a file from the sidebar or press Ctrl+K.</p>
            </div>
          )}

          {viewMode === 'database' && (
            <DatabaseHub
              files={files}
              onSelectFile={(id) => {
                setActiveFileId(id);
                setViewMode('editor');
              }}
              onUpdateMetadata={handleUpdateMetadata}
              onNewFile={handleNewFile}
              onRunAgent={(agent) => {
                setActiveFileId(agent.id);
                setViewMode('agent-hub');
              }}
            />
          )}

          {viewMode === 'agent-hub' && (
            <AgentPlayground
              files={files}
              initialAgentId={activeFile?.frontmatter.type === 'agent' ? activeFile.id : undefined}
              onSelectAgentFile={(id) => {
                setActiveFileId(id);
                setViewMode('editor');
              }}
            />
          )}

          {viewMode === 'tasks' && (
            <GlobalTaskRolodex
              files={files}
              onSelectFile={(path) => {
                const target = files.find((f) => f.path === path || f.id === path);
                if (target) {
                  setActiveFileId(target.id);
                  setViewMode('editor');
                }
              }}
              onUpdateFileContent={(fileId, newContent) => {
                handleFileChange(newContent);
              }}
            />
          )}

          {viewMode === 'graph' && (
            <KnowledgeGraph
              files={files}
              onSelectFile={(id) => {
                setActiveFileId(id);
                setViewMode('editor');
              }}
            />
          )}
        </div>
      </main>

      {/* Global Command Palette (Ctrl+K) */}
      <CommandPalette
        isOpen={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        files={files}
        onSelectFile={(id) => {
          setActiveFileId(id);
          setViewMode('editor');
        }}
        onSelectViewMode={setViewMode}
        onNewFile={handleNewFile}
      />

      {/* AI Intelligence Modal */}
      {activeFile && (
        <AISummaryModal
          isOpen={aiModalOpen}
          onClose={() => setAiModalOpen(false)}
          file={activeFile}
          onApplyMetadata={(updatedMeta) => {
            handleUpdateMetadata(activeFile.id, updatedMeta);
          }}
          onAppendSummary={(summary) => {
            handleFileChange(activeFile.content + summary);
          }}
        />
      )}

      {/* Settings Modal */}
      <AISettingsModal
        isOpen={settingsModalOpen}
        onClose={() => setSettingsModalOpen(false)}
      />
    </div>
  );
};
