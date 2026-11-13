import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { MarkdownFile, ViewMode, DocType, ProjectWorkspace, FileTreeNode } from './types/document';
import { getSampleWorkspace } from './services/sampleVault';
import { MarkdownService } from './services/markdown';
import { ProjectScannerService } from './services/projectScanner';
import { Sidebar } from './components/layout/Sidebar';
import { TopNav } from './components/layout/TopNav';
import { TabBar } from './components/layout/TabBar';
import { CommandPalette } from './components/layout/CommandPalette';
import { NotionEditor } from './components/editor/NotionEditor';
import { DatabaseHub } from './components/database/DatabaseHub';
import { AgentPlayground } from './components/ai/AgentPlayground';
import { GlobalTaskRolodex } from './components/tasks/GlobalTaskRolodex';
import { KnowledgeGraph } from './components/graph/KnowledgeGraph';
import { ProjectDashboard } from './components/project/ProjectDashboard';
import { PortfolioView } from './components/project/PortfolioView';
import { DocActionModal } from './components/project/DocActionModal';
import { PortfolioProjectSummary } from './types/docAudit';
import { inspectProjectStack } from './services/stackInspector';
import { auditProjectDocumentation } from './services/docHealthAuditor';
import { AISummaryModal } from './components/ai/AISummaryModal';
import { AISettingsModal } from './components/ai/AISettingsModal';
import { ProjectChatDrawer } from './components/ai/ProjectChatDrawer';
import { ToastProvider, useToast } from './components/ui/Toast';

const SAVED_WORKSPACE_PATH_KEY = 'notion_active_project_path';
const SAVED_PORTFOLIO_ROOT_KEY = 'notion_portfolio_root_path';
const SAVED_SIDEBAR_WIDTH_KEY = 'notion_sidebar_width';

const AppContent: React.FC = () => {
  const { toast } = useToast();

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

  const [openFileIds, setOpenFileIds] = useState<string[]>(() => {
    return files[0] ? [files[0].id] : [];
  });

  const [viewMode, setViewMode] = useState<ViewMode>('editor');
  const [isRawMarkdown, setIsRawMarkdown] = useState<boolean>(false);
  const [portfolioRootPath, setPortfolioRootPath] = useState<string | null>(null);
  const [portfolioProjects, setPortfolioProjects] = useState<PortfolioProjectSummary[]>([]);
  const [scanningPortfolio, setScanningPortfolio] = useState<boolean>(false);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  // Sidebar layout state
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    const saved = localStorage.getItem(SAVED_SIDEBAR_WIDTH_KEY);
    return saved ? parseInt(saved, 10) : 260;
  });
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(false);

  // Modals & Drawers
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [projectChatOpen, setProjectChatOpen] = useState(false);
  const [editorPassportOpen, setEditorPassportOpen] = useState(false);

  const handleWidthChange = (w: number) => {
    setSidebarWidth(w);
    localStorage.setItem(SAVED_SIDEBAR_WIDTH_KEY, w.toString());
  };

  // Switch/Open active file with multi-document tabs
  const handleSelectFile = useCallback((id: string) => {
    setActiveFileId(id);
    setOpenFileIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
    setViewMode('editor');
  }, []);

  // Close tab
  const handleCloseTab = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const nextOpen = openFileIds.filter((tabId) => tabId !== id);
    setOpenFileIds(nextOpen);
    if (activeFileId === id) {
      if (nextOpen.length > 0) {
        setActiveFileId(nextOpen[nextOpen.length - 1]);
      } else {
        setActiveFileId(null);
      }
    }
  };

  // Restore previous project path and portfolio root if in Electron on first boot
  useEffect(() => {
    if (!ProjectScannerService.isElectron()) return;

    const savedPath = localStorage.getItem(SAVED_WORKSPACE_PATH_KEY);
    if (savedPath) {
      ProjectScannerService.scanPath(savedPath).then((ws) => {
        if (ws) {
          setWorkspace(ws);
          setFiles(ws.files);
          const firstId = ws.files[0]?.id || null;
          setActiveFileId(firstId);
          setOpenFileIds(firstId ? [firstId] : []);
          toast('Project Restored', ws.name, 'info');
        }
      });
    }

    const savedPortfolioRoot = localStorage.getItem(SAVED_PORTFOLIO_ROOT_KEY);
    if (savedPortfolioRoot) {
      setPortfolioRootPath(savedPortfolioRoot);
      ProjectScannerService.scanPortfolioRoot(savedPortfolioRoot)
        .then((result) => {
          setPortfolioRootPath(result.rootPath);
          setPortfolioProjects(
            result.projects.map((proj) => ({
              workspace: proj,
              auditReport: auditProjectDocumentation(proj, inspectProjectStack(proj)),
            }))
          );
        })
        .catch(() => {
          // Silently ignore if folder no longer exists
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
              toast('Disk Change Detected', `Updated ${data.changedFile}`, 'info');
            }
          });
        }
      });
    }
  }, [workspace.isLocalFolder, workspace.rootPath]);

  // Global Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+S to save
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        handleSave();
      }
      // Ctrl+\ to toggle sidebar
      if ((e.ctrlKey || e.metaKey) && e.key === '\\') {
        e.preventDefault();
        setIsSidebarCollapsed((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const activeFile = files.find((f) => f.id === activeFileId) || null;

  // Live DocPassport audit for active workspace & active file
  const liveWorkspace = useMemo(() => ({ ...workspace, files }), [workspace, files]);
  const activeStackProfile = useMemo(() => inspectProjectStack(liveWorkspace), [liveWorkspace]);
  const activeAuditReport = useMemo(
    () => auditProjectDocumentation(liveWorkspace, activeStackProfile),
    [liveWorkspace, activeStackProfile]
  );
  const activeDocAudit = useMemo(
    () => (activeFile ? activeAuditReport.inventory.find((i) => i.fileId === activeFile.id) || null : null),
    [activeAuditReport.inventory, activeFile]
  );

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
      const readme = scanned.files.find((f) => f.name.toLowerCase().startsWith('readme'));
      const initialId = readme ? readme.id : scanned.files[0]?.id || null;
      setActiveFileId(initialId);
      setOpenFileIds(initialId ? [initialId] : []);
      setViewMode('project-overview');
      toast('Project Opened', `${scanned.name} (${scanned.files.length} markdown files)`, 'success');
    }
  };

  // Refresh current project
  const handleRefreshProject = async () => {
    if (workspace.isLocalFolder && workspace.rootPath) {
      const refreshed = await ProjectScannerService.scanPath(workspace.rootPath);
      if (refreshed) {
        setWorkspace(refreshed);
        setFiles(refreshed.files);
        setOpenFileIds((prev) => prev.filter((id) => refreshed.files.some((f) => f.id === id)));
        setPortfolioProjects((prev) =>
          prev.map((entry) =>
            entry.workspace.rootPath === refreshed.rootPath
              ? {
                  workspace: refreshed,
                  auditReport: auditProjectDocumentation(refreshed, inspectProjectStack(refreshed)),
                }
              : entry
          )
        );
        toast('Project Rescanned', `${refreshed.files.length} files found`, 'info');
      }
    } else {
      const sample = getSampleWorkspace();
      setWorkspace(sample);
      setFiles(sample.files);
      setOpenFileIds((prev) => prev.filter((id) => sample.files.some((f) => f.id === id)));
      toast('Vault Reset', 'Sample files restored', 'info');
    }
  };

  // Create new document
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

    if (workspace.isLocalFolder && fullPath) {
      await ProjectScannerService.createFile(relPath ? `${workspace.rootPath}/${relPath}` : workspace.rootPath, fileName, raw);
      handleRefreshProject();
    } else {
      setFiles((prev) => [newFile, ...prev]);
    }

    setActiveFileId(newFile.id);
    setOpenFileIds((prev) => (prev.includes(newFile.id) ? prev : [...prev, newFile.id]));
    setViewMode('editor');
    toast('Document Created', fileName, 'success');
  };

  // Create or scaffold a specific document path with provided markdown content
  const handleCreateDocWithContent = async (relativePath: string, content: string) => {
    const normalizedPath = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
    const lastSlash = normalizedPath.lastIndexOf('/');
    const relDir = lastSlash !== -1 ? normalizedPath.slice(0, lastSlash) : '';
    const fileName = lastSlash !== -1 ? normalizedPath.slice(lastSlash + 1) : normalizedPath;
    const fullPath = workspace.isLocalFolder ? `${workspace.rootPath}/${normalizedPath}`.replace(/\\/g, '/') : undefined;

    const parsed = MarkdownService.parse(content, normalizedPath);
    const newFile: MarkdownFile = {
      id: normalizedPath,
      path: normalizedPath,
      fullPath,
      name: fileName,
      content,
      frontmatter: parsed.frontmatter,
      body: parsed.body,
      wordCount: parsed.wordCount,
      tasks: parsed.tasks,
      isDirty: false,
      lastModifiedMs: Date.now(),
    };

    if (workspace.isLocalFolder && fullPath) {
      const targetDir = relDir ? `${workspace.rootPath}/${relDir}` : workspace.rootPath;
      await ProjectScannerService.createFile(targetDir, fileName, content);
      await handleRefreshProject();
    } else {
      setFiles((prev) => {
        const filtered = prev.filter((f) => f.id !== normalizedPath);
        return [newFile, ...filtered];
      });
    }

    setActiveFileId(newFile.id);
    setOpenFileIds((prev) => (prev.includes(newFile.id) ? prev : [...prev, newFile.id]));
    setViewMode('editor');
    toast('Document Scaffolded', normalizedPath, 'success');
  };

  // Safe document actions from ProjectDashboard / DocActionModal
  const handleArchiveFile = async (file: MarkdownFile) => {
    const archiveRel = await ProjectScannerService.archiveFile(workspace, file);
    if (!archiveRel) return;
    setOpenFileIds((prev) => prev.filter((id) => id !== file.id));
    if (workspace.isLocalFolder) {
      await handleRefreshProject();
    } else {
      setFiles((prev) =>
        prev.map((f) =>
          f.id === file.id ? { ...f, id: archiveRel, path: archiveRel } : f
        )
      );
    }
    toast('Archived Safely', `Moved to ${archiveRel}`, 'success');
  };

  const handleMarkDeprecated = async (file: MarkdownFile, supersededByPath?: string) => {
    const updatedFrontmatter = {
      ...file.frontmatter,
      status: 'Archived' as const,
      updated_at: new Date().toISOString().slice(0, 10),
    };
    const banner = supersededByPath
      ? `> [!WARNING] **Deprecated:** Superseded by [${supersededByPath}](${supersededByPath}).\n\n`
      : `> [!WARNING] **Deprecated:** This document is marked archived/deprecated.\n\n`;
    const nextBody = file.body.includes('**Deprecated:**') ? file.body : `${banner}${file.body.trimStart()}`;
    const fullMarkdown = MarkdownService.stringify(updatedFrontmatter, nextBody);
    const parsed = MarkdownService.parse(fullMarkdown, file.path);
    const updatedFile: MarkdownFile = {
      ...file,
      content: fullMarkdown,
      frontmatter: updatedFrontmatter,
      body: parsed.body,
      wordCount: parsed.wordCount,
      tasks: parsed.tasks,
      isDirty: false,
      lastModifiedMs: Date.now(),
    };
    if (workspace.isLocalFolder && file.fullPath) {
      await ProjectScannerService.saveFileToDisk(updatedFile);
      await handleRefreshProject();
    } else {
      setFiles((prev) => prev.map((f) => (f.id === file.id ? updatedFile : f)));
    }
    toast('Marked Deprecated', `${file.path} preserved in-place`, 'info');
  };

  const handleRestoreActive = async (file: MarkdownFile) => {
    const updatedFrontmatter = {
      ...file.frontmatter,
      status: 'Active' as const,
      updated_at: new Date().toISOString().slice(0, 10),
    };
    const cleanedBody = file.body
      .replace(/^>\s*\[!WARNING\]\s*\*\*Deprecated:\*\*[^\n]*\n+/im, '')
      .trimStart();
    const fullMarkdown = MarkdownService.stringify(updatedFrontmatter, cleanedBody);
    const parsed = MarkdownService.parse(fullMarkdown, file.path);
    const updatedFile: MarkdownFile = {
      ...file,
      content: fullMarkdown,
      frontmatter: updatedFrontmatter,
      body: parsed.body,
      wordCount: parsed.wordCount,
      tasks: parsed.tasks,
      isDirty: false,
      lastModifiedMs: Date.now(),
    };
    if (workspace.isLocalFolder && file.fullPath) {
      await ProjectScannerService.saveFileToDisk(updatedFile);
      await handleRefreshProject();
    } else {
      setFiles((prev) => prev.map((f) => (f.id === file.id ? updatedFile : f)));
    }
    toast('Restored to Active', `${file.path} is now active`, 'success');
  };

  const handleAutoFixStale = async (file: MarkdownFile) => {
    const stack = inspectProjectStack(workspace);
    let nextBody = file.body;
    if (stack.localPort) {
      nextBody = nextBody.replace(/localhost:(\d{4,5})/g, `localhost:${stack.localPort}`);
    }
    if (stack.expoSdkVersion) {
      const sdkMajor = parseInt(stack.expoSdkVersion, 10);
      if (!isNaN(sdkMajor)) {
        nextBody = nextBody.replace(/Expo\s+SDK\s*(\d{2})/gi, `Expo SDK ${sdkMajor}`);
      }
    }
    const updatedFrontmatter = {
      ...file.frontmatter,
      status: file.frontmatter.status === 'Archived' ? ('Active' as const) : file.frontmatter.status,
      updated_at: new Date().toISOString().slice(0, 10),
    };
    const fullMarkdown = MarkdownService.stringify(updatedFrontmatter, nextBody);
    const parsed = MarkdownService.parse(fullMarkdown, file.path);
    const updatedFile: MarkdownFile = {
      ...file,
      content: fullMarkdown,
      frontmatter: updatedFrontmatter,
      body: parsed.body,
      wordCount: parsed.wordCount,
      tasks: parsed.tasks,
      isDirty: false,
      lastModifiedMs: Date.now(),
    };
    if (workspace.isLocalFolder && file.fullPath) {
      await ProjectScannerService.saveFileToDisk(updatedFile);
      await handleRefreshProject();
    } else {
      setFiles((prev) => prev.map((f) => (f.id === file.id ? updatedFile : f)));
    }
    toast('Drift Synced & Reviewed', `Updated ${file.path}`, 'success');
  };

  const handleLinkOrphanInReadme = async (file: MarkdownFile) => {
    const readme = files.find((f) => f.name.toLowerCase() === 'readme.md');
    const linkLine = `- [${file.frontmatter.title || file.name}](${file.path})`;
    if (readme) {
      if (readme.body.includes(file.path)) {
        toast('Already Linked', `${file.path} is already linked in README.md`, 'info');
        return;
      }
      const nextBody = readme.body.includes('## Documentation')
        ? readme.body.replace(/## Documentation\s*\n/, `## Documentation\n\n${linkLine}\n`)
        : `${readme.body.trimEnd()}\n\n## Documentation\n\n${linkLine}\n`;
      const fullMarkdown = MarkdownService.stringify(readme.frontmatter, nextBody);
      const parsed = MarkdownService.parse(fullMarkdown, readme.path);
      const updatedReadme: MarkdownFile = {
        ...readme,
        content: fullMarkdown,
        body: parsed.body,
        wordCount: parsed.wordCount,
        tasks: parsed.tasks,
        isDirty: false,
        lastModifiedMs: Date.now(),
      };
      if (workspace.isLocalFolder && readme.fullPath) {
        await ProjectScannerService.saveFileToDisk(updatedReadme);
        await handleRefreshProject();
      } else {
        setFiles((prev) => prev.map((f) => (f.id === readme.id ? updatedReadme : f)));
      }
      toast('Orphan Adopted', `Added link to ${file.path} in README.md`, 'success');
    } else {
      const content = `# ${workspace.name}\n\n## Documentation\n\n${linkLine}\n`;
      await handleCreateDocWithContent('README.md', content);
      toast('README Created & Linked', `Linked ${file.path} in new README.md`, 'success');
    }
  };

  const handleMarkScopedDoc = async (file: MarkdownFile) => {
    const updatedFrontmatter = {
      ...file.frontmatter,
      scope: 'module',
      updated_at: new Date().toISOString().slice(0, 10),
    };
    const fullMarkdown = MarkdownService.stringify(updatedFrontmatter, file.body);
    const parsed = MarkdownService.parse(fullMarkdown, file.path);
    const updatedFile: MarkdownFile = {
      ...file,
      content: fullMarkdown,
      frontmatter: updatedFrontmatter,
      body: parsed.body,
      wordCount: parsed.wordCount,
      tasks: parsed.tasks,
      isDirty: false,
      lastModifiedMs: Date.now(),
    };
    if (workspace.isLocalFolder && file.fullPath) {
      await ProjectScannerService.saveFileToDisk(updatedFile);
      await handleRefreshProject();
    } else {
      setFiles((prev) => prev.map((f) => (f.id === file.id ? updatedFile : f)));
    }
    toast('Marked as Module Doc', `${file.path} will be kept as a scoped document`, 'success');
  };

  const handleDeleteDoc = async (file: MarkdownFile) => {
    await handleDeleteFile(file.id, file.fullPath);
  };

  const buildPortfolioSummaries = (projects: ProjectWorkspace[]): PortfolioProjectSummary[] =>
    projects.map((proj) => {
      const stack = inspectProjectStack(proj);
      const auditReport = auditProjectDocumentation(proj, stack);
      return { workspace: proj, auditReport };
    });

  const handleScanPortfolioRoot = async () => {
    setScanningPortfolio(true);
    try {
      const result = await ProjectScannerService.openAndScanPortfolioRoot();
      if (!result) return;
      setPortfolioRootPath(result.rootPath);
      localStorage.setItem(SAVED_PORTFOLIO_ROOT_KEY, result.rootPath);
      setPortfolioProjects(buildPortfolioSummaries(result.projects));
      setViewMode('portfolio');
      toast('Portfolio Scanned', `Found ${result.projects.length} projects`, 'success');
    } catch (err: any) {
      toast('Scan Failed', err?.message || 'Could not scan portfolio root', 'error');
    } finally {
      setScanningPortfolio(false);
    }
  };

  const handleScanPortfolioPath = async (targetPath: string) => {
    setScanningPortfolio(true);
    try {
      const result = await ProjectScannerService.scanPortfolioRoot(targetPath);
      setPortfolioRootPath(result.rootPath);
      localStorage.setItem(SAVED_PORTFOLIO_ROOT_KEY, result.rootPath);
      setPortfolioProjects(buildPortfolioSummaries(result.projects));
      setViewMode('portfolio');
      toast('Portfolio Scanned', `Found ${result.projects.length} projects`, 'success');
    } catch (err: any) {
      toast('Scan Failed', err?.message || 'Could not scan portfolio root', 'error');
    } finally {
      setScanningPortfolio(false);
    }
  };

  const handleRefreshPortfolio = async () => {
    if (!portfolioRootPath) return;
    await handleScanPortfolioPath(portfolioRootPath);
  };

  const handleOpenPortfolioProject = (projWorkspace: ProjectWorkspace, targetFileId?: string) => {
    setWorkspace(projWorkspace);
    setFiles(projWorkspace.files);
    const chosenId = targetFileId || projWorkspace.files[0]?.id || null;
    setActiveFileId(chosenId);
    setOpenFileIds((prev) => {
      if (!chosenId) return [];
      return prev.includes(chosenId) ? prev : [...prev.filter((id) => projWorkspace.files.some((f) => f.id === id)), chosenId];
    });
    if (projWorkspace.isLocalFolder) {
      localStorage.setItem(SAVED_WORKSPACE_PATH_KEY, projWorkspace.rootPath);
    }
    if (targetFileId) {
      setViewMode('editor');
    } else {
      setViewMode('project-overview');
      toast('Opened Project', projWorkspace.name, 'success');
    }
  };

  // Create new subfolder
  const handleNewFolder = async (parentFolder: string, folderName: string) => {
    if (workspace.isLocalFolder) {
      const targetPath = `${parentFolder}/${folderName}`.replace(/\\/g, '/');
      await ProjectScannerService.createFolder(targetPath);
      handleRefreshProject();
      toast('Folder Created', folderName, 'success');
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
      toast('Renamed', newName, 'success');
    }
  };

  // Delete file or folder
  const handleDeleteFile = async (id: string, fullPath?: string) => {
    setOpenFileIds((prev) => prev.filter((tabId) => tabId !== id));
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
    toast('Deleted Item', id, 'info');
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

      if (workspace.isLocalFolder && f.fullPath) {
        ProjectScannerService.saveFileToDisk(updatedFile);
      }

      return updatedFile;
    });

    setFiles(updatedFiles);
  };

  // Update specific metadata properties
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
    toast('Properties Updated', 'Frontmatter synchronized', 'success');
  };

  // Save active file
  const handleSave = () => {
    if (!activeFileId || !activeFile) return;
    if (workspace.isLocalFolder && activeFile.fullPath) {
      ProjectScannerService.saveFileToDisk(activeFile);
      toast('Saved to Disk', activeFile.name, 'success');
    } else {
      toast('Document Saved', activeFile.frontmatter.title || activeFile.name, 'success');
    }
    setFiles((prev) =>
      prev.map((f) => (f.id === activeFileId ? { ...f, isDirty: false } : f))
    );
  };

  return (
    <div className={`flex h-screen w-screen bg-[#161618] text-neutral-200 overflow-hidden font-sans ${theme}`}>
      {/* Resizable Notion Sidebar */}
      <Sidebar
        files={files}
        tree={workspace.tree}
        project={workspace}
        portfolioProjects={portfolioProjects}
        portfolioRootPath={portfolioRootPath}
        onSelectPortfolioProject={handleOpenPortfolioProject}
        activeFileId={activeFileId}
        onSelectFile={handleSelectFile}
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
          handleSelectFile(file.id);
          setAiModalOpen(true);
        }}
        width={sidebarWidth}
        onWidthChange={handleWidthChange}
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
      />

      {/* Main Workspace Area */}
      <main className="flex-1 flex flex-col h-full overflow-hidden bg-[#161618]">
        {/* Top Navbar */}
        <TopNav
          activeFile={activeFile}
          projectName={workspace.name}
          activeDocAudit={activeDocAudit}
          onOpenDocPassport={() => setEditorPassportOpen(true)}
          hasPortfolio={portfolioProjects.length > 0}
          onBackToPortfolio={() => setViewMode('portfolio')}
          onOpenAIModal={() => setAiModalOpen(true)}
          onOpenAgentTester={() => setViewMode('agent-hub')}
          onOpenProjectChat={() => setProjectChatOpen(true)}
          isRawMarkdown={isRawMarkdown}
          onToggleRawMarkdown={() => setIsRawMarkdown(!isRawMarkdown)}
          onSave={handleSave}
          isSidebarCollapsed={isSidebarCollapsed}
          onToggleSidebar={() => setIsSidebarCollapsed(false)}
          onOpenProjectOverview={() => setViewMode('project-overview')}
        />

        {/* Multi-Document Tab Bar */}
        <TabBar
          openFileIds={openFileIds}
          activeFileId={activeFileId}
          files={files}
          onSelectTab={handleSelectFile}
          onCloseTab={handleCloseTab}
          onNewTab={() => handleNewFile('document')}
        />

        {/* View Switcher Container */}
        <div className="flex-1 overflow-hidden relative">
          {viewMode === 'portfolio' && (
            <PortfolioView
              portfolioRootPath={portfolioRootPath}
              currentWorkspaceRoot={workspace.isLocalFolder ? workspace.rootPath : null}
              projects={portfolioProjects}
              scanning={scanningPortfolio}
              onScanPortfolioRoot={handleScanPortfolioRoot}
              onScanCurrentWorkspaceRoot={() => handleScanPortfolioPath(workspace.rootPath)}
              onRefreshPortfolio={handleRefreshPortfolio}
              onOpenProject={handleOpenPortfolioProject}
            />
          )}

          {viewMode === 'project-overview' && (
            <ProjectDashboard
              project={workspace}
              onSelectFile={handleSelectFile}
              onSelectViewMode={setViewMode}
              onNewFile={() => handleNewFile('document')}
              onRefreshProject={handleRefreshProject}
              onCreateDocWithContent={handleCreateDocWithContent}
              onArchiveFile={handleArchiveFile}
              onMarkDeprecated={handleMarkDeprecated}
              onRestoreActive={handleRestoreActive}
              onAutoFixStale={handleAutoFixStale}
              onLinkOrphanInReadme={handleLinkOrphanInReadme}
              onMarkScopedDoc={handleMarkScopedDoc}
              onDeleteDoc={handleDeleteDoc}
              onOpenPortfolio={() => setViewMode('portfolio')}
            />
          )}

          {viewMode === 'editor' && activeFile && (
            <NotionEditor
              file={activeFile}
              onChange={handleFileChange}
              isRawMarkdown={isRawMarkdown}
              onOpenAIModal={() => setAiModalOpen(true)}
              allFiles={files}
              onSelectFile={handleSelectFile}
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
              onSelectFile={handleSelectFile}
              onUpdateMetadata={handleUpdateMetadata}
              onNewFile={handleNewFile}
              onRunAgent={(agent) => {
                handleSelectFile(agent.id);
                setViewMode('agent-hub');
              }}
            />
          )}

          {viewMode === 'agent-hub' && (
            <AgentPlayground
              files={files}
              initialAgentId={activeFile?.frontmatter.type === 'agent' ? activeFile.id : undefined}
              onSelectAgentFile={handleSelectFile}
            />
          )}

          {viewMode === 'tasks' && (
            <GlobalTaskRolodex
              files={files}
              onSelectFile={(path) => {
                const target = files.find((f) => f.path === path || f.id === path);
                if (target) {
                  handleSelectFile(target.id);
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
              onSelectFile={handleSelectFile}
            />
          )}
        </div>
      </main>

      {/* Global Command Palette (Ctrl+K) */}
      <CommandPalette
        isOpen={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        files={files}
        onSelectFile={handleSelectFile}
        onSelectViewMode={setViewMode}
        onNewFile={handleNewFile}
      />

      {/* Vault / Project RAG Chat Drawer */}
      <ProjectChatDrawer
        isOpen={projectChatOpen}
        onClose={() => setProjectChatOpen(false)}
        projectName={workspace.name}
        files={files}
        onSelectFile={(id) => {
          handleSelectFile(id);
          setProjectChatOpen(false);
        }}
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

      {/* DocPassport Action Modal (from Editor TopNav Pill) */}
      {editorPassportOpen && activeDocAudit && (
        <DocActionModal
          item={activeDocAudit}
          canonicalItem={
            activeDocAudit.duplicateOf
              ? activeAuditReport.inventory.find((i) => i.path === activeDocAudit.duplicateOf)
              : undefined
          }
          files={files}
          stackProfile={activeStackProfile}
          isLocalFolder={workspace.isLocalFolder}
          onClose={() => setEditorPassportOpen(false)}
          onOpenInEditor={handleSelectFile}
          onRevealInExplorer={(f) => {
            if (f.fullPath) ProjectScannerService.revealInExplorer(f.fullPath);
          }}
          onArchiveFile={handleArchiveFile}
          onMarkDeprecated={handleMarkDeprecated}
          onRestoreActive={handleRestoreActive}
          onAutoFixStale={handleAutoFixStale}
          onLinkOrphanInReadme={handleLinkOrphanInReadme}
          onMarkScopedDoc={handleMarkScopedDoc}
          onDeleteFile={handleDeleteDoc}
        />
      )}
    </div>
  );
};

export const App: React.FC = () => {
  return (
    <ToastProvider>
      <AppContent />
    </ToastProvider>
  );
};
