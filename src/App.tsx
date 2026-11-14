import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { PanelLeftOpen } from 'lucide-react';
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
import { FixProvider } from './components/project/fix/FixProvider';
import { assessStackFreshness } from './services/stackFreshness';
import { DocActionModal } from './components/project/DocActionModal';
import { DetectedStackProfile, PortfolioProjectSummary } from './types/docAudit';
import { inspectProjectStack, checkLiveStackVersions } from './services/stackInspector';
import { auditProjectDocumentation } from './services/docHealthAuditor';
import {
  adoptIntoReadme,
  applyDriftFixes,
  deprecateInPlace,
  restoreActive,
  restorePathFor,
  todayIso,
} from './services/docRemediation';
import { DocumentMetadata } from './types/document';
import { buildTreeFromFiles } from './services/fileTree';
import {
  SNAPSHOT_STALE_MS,
  fromSnapshot,
  loadPortfolioSnapshot,
  savePortfolioSnapshot,
} from './services/portfolioStore';
import { AISummaryModal } from './components/ai/AISummaryModal';
import { AISettingsModal } from './components/ai/AISettingsModal';
import { ProjectChatDrawer } from './components/ai/ProjectChatDrawer';
import { ToastProvider, useToast } from './components/ui/Toast';
import {
  ELSEWHERE_PREFIX,
  newNoteContent,
  findOwningRoot,
  isElsewhereId,
  baseName,
  newNoteFileName,
  normalizeFsPath,
  noteNameFromHeading,
  relativeInside,
  samePath,
} from './services/notesWorkspace';
import {
  getDefaultNotesFolder,
  getNotesFolder,
  loadExternalPaths,
  loadNotesWorkspace,
  saveExternalPaths,
  setNotesFolder,
  withExternalPaths,
} from './services/notesStore';

const SAVED_WORKSPACE_PATH_KEY = 'notion_active_project_path';
const SAVED_PORTFOLIO_ROOT_KEY = 'notion_portfolio_root_path';
const SAVED_SIDEBAR_WIDTH_KEY = 'notion_sidebar_width';
const SAVED_LAST_VIEW_KEY = 'notion_last_view';

function parentFolderOf(p: string): string | null {
  const norm = p.replace(/[\\/]+$/, '');
  const idx = Math.max(norm.lastIndexOf('/'), norm.lastIndexOf('\\'));
  if (idx <= 0) return null;
  const parent = norm.slice(0, idx);
  return /^[A-Za-z]:$/.test(parent) ? `${parent}\\` : parent;
}

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
  const [portfolioRoots, setPortfolioRoots] = useState<string[]>([]);
  const [portfolioProjects, setPortfolioProjects] = useState<PortfolioProjectSummary[]>([]);
  const [scanningPortfolio, setScanningPortfolio] = useState<boolean>(false);
  /** Quiet background refresh of a remembered portfolio (UI stays usable). */
  const [refreshingPortfolio, setRefreshingPortfolio] = useState<boolean>(false);
  const [portfolioSavedAt, setPortfolioSavedAt] = useState<string | null>(null);
  const portfolioRootPath = portfolioRoots[0] ?? null;
  const portfolioProjectsRef = useRef<PortfolioProjectSummary[]>([]);
  portfolioProjectsRef.current = portfolioProjects;
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

  // Notes (see showNotes): folder path and the outside files listed in it, loaded on first use.
  const notesDirRef = useRef<string | null>(null);
  const externalPathsRef = useRef<string[] | null>(null);
  const showNotesRef = useRef<(opts?: { keepView?: boolean }) => Promise<unknown>>(async () => null);
  const openPathsRef = useRef<(paths: string[]) => Promise<void>>(async () => {});
  const renameNoteRef = useRef<(note: MarkdownFile) => Promise<void>>(async () => {});
  const [notesFolderShown, setNotesFolderShown] = useState<string | null>(null);
  const [defaultNotesFolder, setDefaultNotesFolder] = useState<string | null>(null);

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
    // Closing the active note is handled by the note-rename effect; a background tab is handled here.
    const closing = files.find((f) => f.id === id);
    if (closing && id !== activeFileId && workspace.kind === 'notes') renameNoteRef.current(closing);
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

  // ---------------------------------------------------------------------------
  // Live workspace, stack profile and DocPassport audit (single source of truth)
  // ---------------------------------------------------------------------------
  const activeFile = files.find((f) => f.id === activeFileId) || null;
  const liveWorkspace = useMemo(() => ({ ...workspace, files }), [workspace, files]);
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;

  // Local inspection is instant; live registry data (cached 24h) is layered on asynchronously.
  const baseStackProfile = useMemo(() => inspectProjectStack(workspace), [workspace]);
  const [liveStack, setLiveStack] = useState<{ base: DetectedStackProfile; profile: DetectedStackProfile } | null>(null);
  const [checkingLiveVersions, setCheckingLiveVersions] = useState(false);
  const liveCheckToken = useRef(0);

  const runLiveStackCheck = useCallback(
    async (force = false) => {
      const token = ++liveCheckToken.current;
      if (baseStackProfile.dependencies.length === 0) return;
      setCheckingLiveVersions(true);
      try {
        const profile = await checkLiveStackVersions(baseStackProfile, force);
        if (liveCheckToken.current === token) setLiveStack({ base: baseStackProfile, profile });
      } catch {
        // offline: keep local inspection results
      } finally {
        if (liveCheckToken.current === token) setCheckingLiveVersions(false);
      }
    },
    [baseStackProfile]
  );

  useEffect(() => {
    runLiveStackCheck(false);
  }, [runLiveStackCheck]);

  const activeStackProfile =
    liveStack && liveStack.base === baseStackProfile ? liveStack.profile : baseStackProfile;
  const activeAuditReport = useMemo(
    () => auditProjectDocumentation(liveWorkspace, activeStackProfile),
    [liveWorkspace, activeStackProfile]
  );
  const activeDocAudit = useMemo(
    () =>
      activeFile && workspace.kind !== 'notes'
        ? activeAuditReport.inventory.find((i) => i.fileId === activeFile.id) || null
        : null,
    [activeAuditReport.inventory, activeFile, workspace.kind]
  );

  // Portfolio: summaries are audited locally first, then enriched with live registry drift in the background.
  // Results are remembered on disk (portfolioStore) so the next launch opens instantly.
  const enrichWithRegistry = useCallback(async (summaries: PortfolioProjectSummary[], force = false) => {
    for (const summary of summaries) {
      const base = summary.auditReport.stackProfile;
      if (base.dependencies.length === 0 && (base.apps || []).length === 0) continue;
      try {
        const live = await checkLiveStackVersions(base, force);
        setPortfolioProjects((prev) =>
          prev.map((e) =>
            e.workspace.rootPath === summary.workspace.rootPath
              ? {
                  ...e,
                  // Snapshot entries have no file contents to re-audit; only their stack data changes.
                  auditReport: e.fromSnapshot
                    ? { ...e.auditReport, stackProfile: live }
                    : auditProjectDocumentation(e.workspace, live),
                }
              : e
          )
        );
      } catch {
        // registry unreachable: keep local audit
      }
    }
  }, []);

  const applyPortfolioScan = useCallback(
    (rootPath: string, projects: ProjectWorkspace[]) => {
      const scannedAt = new Date().toISOString();
      const summaries: PortfolioProjectSummary[] = projects.map((proj) => ({
        workspace: proj,
        auditReport: auditProjectDocumentation(proj, inspectProjectStack(proj)),
        scannedAt,
      }));
      const norm = (p: string | null) => (p || '').replace(/[\\/]+$/, '').toLowerCase();
      setPortfolioRoots((prev) => (prev.some((r) => norm(r) === norm(rootPath)) ? prev : [...prev, rootPath]));
      setPortfolioProjects((prev) =>
        [...prev.filter((e) => norm(parentFolderOf(e.workspace.rootPath)) !== norm(rootPath)), ...summaries].sort((a, b) =>
          a.workspace.name.localeCompare(b.workspace.name)
        )
      );
      setPortfolioSavedAt(scannedAt);
      enrichWithRegistry(summaries);
    },
    [enrichWithRegistry]
  );

  // Persist the portfolio whenever it changes (debounced in the store), but only after the saved one was loaded.
  const portfolioLoadedRef = useRef(false);
  useEffect(() => {
    if (!portfolioLoadedRef.current) return;
    savePortfolioSnapshot(portfolioRoots, portfolioProjects);
  }, [portfolioRoots, portfolioProjects]);

  // The active project's portfolio entry always reflects live, in-editor state.
  const displayedPortfolio = useMemo(
    () =>
      portfolioProjects.map((entry) =>
        entry.workspace.rootPath === workspace.rootPath
          ? { workspace: liveWorkspace, auditReport: activeAuditReport }
          : entry
      ),
    [portfolioProjects, workspace.rootPath, liveWorkspace, activeAuditReport]
  );

  const applyRefreshedWorkspace = useCallback((refreshed: ProjectWorkspace) => {
    setWorkspace(refreshed);
    setFiles(refreshed.files);
    setOpenFileIds((prev) => prev.filter((id) => refreshed.files.some((f) => f.id === id)));
    setActiveFileId((prev) => (prev && refreshed.files.some((f) => f.id === prev) ? prev : prev ? null : prev));
    const summary: PortfolioProjectSummary = {
      workspace: refreshed,
      auditReport: auditProjectDocumentation(refreshed, inspectProjectStack(refreshed)),
      scannedAt: new Date().toISOString(),
    };
    if (!portfolioProjectsRef.current.some((e) => e.workspace.rootPath === refreshed.rootPath)) return;
    setPortfolioProjects((prev) => prev.map((entry) => (entry.workspace.rootPath === refreshed.rootPath ? summary : entry)));
    enrichWithRegistry([summary]);
  }, [enrichWithRegistry]);

  const refreshAllPortfolioRoots = useCallback(
    async (roots: string[], quiet: boolean) => {
      if (roots.length === 0) return;
      setRefreshingPortfolio(true);
      let found = 0;
      try {
        for (const root of roots) {
          try {
            const result = await ProjectScannerService.scanPortfolioRoot(root);
            applyPortfolioScan(result.rootPath, result.projects);
            found += result.projects.length;
          } catch (err: any) {
            if (!quiet) toast('Scan Failed', `${root}: ${err?.message || 'could not scan'}`, 'error');
          }
        }
        if (!quiet) toast('Portfolio Rescanned', `${found} projects across ${roots.length} folder${roots.length === 1 ? '' : 's'}`, 'success');
      } finally {
        setRefreshingPortfolio(false);
      }
    },
    [applyPortfolioScan, toast]
  );

  // Restore previous project path and portfolio root if in Electron on first boot
  useEffect(() => {
    if (!ProjectScannerService.isElectron()) return;

    const savedPath = localStorage.getItem(SAVED_WORKSPACE_PATH_KEY);
    // Files the app was launched with ("Open with", command line) win over restoring the last workspace.
    const launchFiles: Promise<string[]> = window.electronAPI?.takeLaunchFiles
      ? window.electronAPI.takeLaunchFiles().catch(() => [])
      : Promise.resolve([]);
    launchFiles.then((launched) => {
    if (launched.length > 0) return;
    if (savedPath) {
      getNotesFolder()
        .then((dir) => {
          notesDirRef.current = dir;
          // Notes reopen through their own loader so files opened from elsewhere come back too.
          return dir && samePath(dir, savedPath) ? showNotesRef.current({ keepView: true }).then(() => null) : ProjectScannerService.scanPath(savedPath);
        })
        .then((ws) => {
          if (ws) {
            setWorkspace(ws);
            setFiles(ws.files);
            const firstId = ws.files[0]?.id || null;
            setActiveFileId(firstId);
            setOpenFileIds(firstId ? [firstId] : []);
            toast('Project Restored', ws.name, 'info');
          }
        })
        .catch(() => localStorage.removeItem(SAVED_WORKSPACE_PATH_KEY));
    }
    });

    // Portfolio: show the remembered scan instantly, then refresh quietly only when it's old.
    loadPortfolioSnapshot().then((snap) => {
      if (snap) {
        const restored = fromSnapshot(snap);
        // Launch files are opened right after this; let them see which projects exist before React re-renders.
        portfolioProjectsRef.current = restored;
        setPortfolioRoots(snap.roots);
        setPortfolioProjects(restored);
        setPortfolioSavedAt(snap.projects.length > 0 ? snap.savedAt : null);
        if (restored.length > 0 && (localStorage.getItem(SAVED_LAST_VIEW_KEY) === 'portfolio' || !savedPath)) {
          setViewMode('portfolio');
        }
        const age = Date.now() - Date.parse(snap.savedAt);
        if (restored.length === 0 || !(age < SNAPSHOT_STALE_MS)) {
          refreshAllPortfolioRoots(snap.roots, true);
        } else {
          // Registry answers are cached for 24h, so this is cheap and keeps freshness current.
          enrichWithRegistry(restored);
        }
      }
      portfolioLoadedRef.current = true;
      launchFiles.then((launched) => {
        if (launched.length > 0) openPathsRef.current(launched);
      });
    });
  }, []);

  // Remember whether the user was last on the portfolio so the app reopens there.
  useEffect(() => {
    if (!portfolioLoadedRef.current) return;
    try {
      localStorage.setItem(SAVED_LAST_VIEW_KEY, viewMode === 'portfolio' ? 'portfolio' : 'project');
    } catch {
      // ignore
    }
  }, [viewMode]);

  // Live disk changes (Electron). One subscription for the app lifetime; reads the current workspace via ref.
  useEffect(() => {
    if (!ProjectScannerService.isElectron() || !window.electronAPI?.onFsChanged) return;
    const unsubscribe = window.electronAPI.onFsChanged((data) => {
      const ws = workspaceRef.current;
      if (!ws.isLocalFolder || !ws.rootPath || (data?.rootDir && data.rootDir !== ws.rootPath)) return;
      if (ws.kind === 'notes') {
        showNotesRef.current().then(() => toast('Disk Change Detected', `Updated ${data.changedFile}`, 'info'));
        return;
      }
      ProjectScannerService.scanPath(ws.rootPath).then((refreshed) => {
        if (!refreshed || workspaceRef.current.rootPath !== refreshed.rootPath) return;
        applyRefreshedWorkspace(refreshed);
        toast('Disk Change Detected', `Updated ${data.changedFile}`, 'info');
      });
    });
    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, [applyRefreshedWorkspace]);

  // Global keyboard shortcuts. Handlers are read through a ref so they never act on stale state.
  const saveRef = useRef<() => void>(() => {});
  const saveAsRef = useRef<() => void>(() => {});
  const newNoteRef = useRef<() => void>(() => {});
  const openFileRef = useRef<() => void>(() => {});
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (e.shiftKey) saveAsRef.current();
        else saveRef.current();
      }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        newNoteRef.current();
      }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        openFileRef.current();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '\\') {
        e.preventDefault();
        setIsSidebarCollapsed((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

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
  const handleRefreshProject = async (silent = false) => {
    if (workspace.kind === 'notes') {
      await showNotes();
      if (!silent) toast('Notes Rescanned', `${workspaceRef.current.files.length} files`, 'info');
    } else if (workspace.isLocalFolder && workspace.rootPath) {
      const refreshed = await ProjectScannerService.scanPath(workspace.rootPath);
      if (refreshed) {
        applyRefreshedWorkspace(refreshed);
        if (!silent) toast('Project Rescanned', `${refreshed.files.length} files found`, 'info');
      }
    } else if (!silent) {
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
    if (workspace.isLocalFolder && folderPath && /^([A-Za-z]:|[\\/])/.test(folderPath)) {
      // Tree folders pass their absolute path; files are created relative to the workspace root.
      folderPath = samePath(folderPath, workspace.rootPath) ? '' : relativeInside(folderPath, workspace.rootPath) ?? '';
    }
    if (workspace.kind === 'notes' && isElsewhereId(folderPath)) folderPath = '';
    if (!folderPath && workspace.kind !== 'notes') {
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
      await handleRefreshProject(true);
    } else {
      setFiles((prev) => [newFile, ...prev]);
    }

    setActiveFileId(newFile.id);
    setOpenFileIds((prev) => (prev.includes(newFile.id) ? prev : [...prev, newFile.id]));
    setViewMode('editor');
    toast('Document Created', fileName, 'success');
  };

  // Create or scaffold a specific document path with provided markdown content. Never overwrites:
  // if the path already exists, a dated sibling is created instead.
  const handleCreateDocWithContent = async (relativePath: string, content: string) => {
    let normalizedPath = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
    if (files.some((f) => f.path.toLowerCase() === normalizedPath.toLowerCase())) {
      normalizedPath = normalizedPath.replace(/(\.[a-z]+)$/i, `-${todayIso()}$1`);
    }
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
      await handleRefreshProject(true);
    } else {
      setFiles((prev) => [newFile, ...prev.filter((f) => f.id !== normalizedPath)]);
    }

    setActiveFileId(newFile.id);
    setOpenFileIds((prev) => (prev.includes(newFile.id) ? prev : [...prev, newFile.id]));
    setViewMode('editor');
    toast('Document Created', normalizedPath, 'success');
  };

  // ---------------------------------------------------------------------------
  // DocPassport safe actions (shared by the dashboard and the editor pill)
  // ---------------------------------------------------------------------------

  /** Writes new frontmatter/body for a file to memory and (for local projects) disk. */
  const persistFile = async (file: MarkdownFile, frontmatter: DocumentMetadata, body: string): Promise<MarkdownFile> => {
    const content = MarkdownService.rebuild(file, frontmatter, body);
    const parsed = MarkdownService.parse(content, file.path);
    const updated: MarkdownFile = {
      ...file,
      content,
      frontmatter: parsed.frontmatter,
      body: parsed.body,
      wordCount: parsed.wordCount,
      tasks: parsed.tasks,
      isDirty: false,
      lastModifiedMs: Date.now(),
    };
    if (workspace.isLocalFolder && file.fullPath) {
      const ok = await ProjectScannerService.saveFileToDisk(updated);
      if (!ok) throw new Error(`Could not write ${file.path} to disk`);
    }
    setFiles((prev) => prev.map((f) => (f.id === file.id ? updated : f)));
    return updated;
  };

  /** Runs a DocPassport action with uniform error reporting. */
  const runDocAction = async (label: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (err: any) {
      toast(`${label} Failed`, err?.message || 'Unexpected error', 'error');
    }
  };

  /** Moves a file (archive / restore), keeping tabs and selection pointed at its new path. */
  const relocateFile = async (file: MarkdownFile, move: () => Promise<{ path: string; content: string }>) => {
    const result = await move();
    const remapId = (id: string) => (id === file.id ? result.path : id);
    setOpenFileIds((prev) => prev.map(remapId));
    setActiveFileId((prev) => (prev ? remapId(prev) : prev));
    if (workspace.isLocalFolder && file.fullPath) {
      await handleRefreshProject(true);
    } else {
      const parsed = MarkdownService.parse(result.content, result.path);
      setFiles((prev) =>
        prev.map((f) =>
          f.id === file.id
            ? {
                ...f,
                id: result.path,
                path: result.path,
                content: result.content,
                frontmatter: parsed.frontmatter,
                body: parsed.body,
                wordCount: parsed.wordCount,
                tasks: parsed.tasks,
                lastModifiedMs: Date.now(),
              }
            : f
        )
      );
    }
    return result.path;
  };

  const handleArchiveFile = (file: MarkdownFile) =>
    runDocAction('Archive', async () => {
      const newPath = await relocateFile(file, () => ProjectScannerService.archiveFile(workspace, file));
      toast('Archived Safely', `Moved to ${newPath} (links inside it were updated)`, 'success');
    });

  const handleMarkDeprecated = (file: MarkdownFile, supersededByPath?: string) =>
    runDocAction('Deprecate', async () => {
      const next = deprecateInPlace(file, supersededByPath, todayIso());
      await persistFile(file, next.frontmatter, next.body);
      toast('Marked Deprecated', `${file.path} kept in place so existing links still work`, 'info');
    });

  const handleRestoreActive = (file: MarkdownFile) =>
    runDocAction('Restore', async () => {
      const next = restoreActive(file, todayIso());
      const originalPath = restorePathFor(file.path);
      if (originalPath) {
        const restoredFile: MarkdownFile = {
          ...file,
          frontmatter: next.frontmatter,
          body: next.body,
          content: MarkdownService.stringify(next.frontmatter, next.body),
        };
        const newPath = await relocateFile(file, () => ProjectScannerService.moveFile(workspace, restoredFile, originalPath));
        toast('Restored to Active', `Moved back to ${newPath}`, 'success');
      } else {
        await persistFile(file, next.frontmatter, next.body);
        toast('Restored to Active', `${file.path} is active again`, 'success');
      }
    });

  const handleAutoFixStale = (file: MarkdownFile) =>
    runDocAction('Drift Sync', async () => {
      const { body, changes } = applyDriftFixes(file.body, activeStackProfile);
      await persistFile(file, { ...file.frontmatter, updated_at: todayIso() }, body);
      toast(
        'Drift Synced & Reviewed',
        changes.length > 0 ? `${file.path}: ${changes.join(', ')}` : `${file.path} marked reviewed today`,
        'success'
      );
    });

  /** Batch heal: syncs port/SDK drift in every drifting document in one pass. */
  const handleAutoHealProject = () =>
    runDocAction('Auto-Heal', async () => {
      const drifting = activeAuditReport.inventory.filter((i) =>
        i.issues.some((iss) => iss.startsWith('Port drift') || iss.startsWith('SDK drift'))
      );
      let fixed = 0;
      for (const item of drifting) {
        const file = files.find((f) => f.id === item.fileId);
        if (!file) continue;
        const { body, changes } = applyDriftFixes(file.body, activeStackProfile);
        if (changes.length === 0) continue;
        await persistFile(file, { ...file.frontmatter, updated_at: todayIso() }, body);
        fixed++;
      }
      toast('Project Auto-Healed', `Synced drift in ${fixed} document${fixed === 1 ? '' : 's'}`, 'success');
    });

  const handleLinkOrphanInReadme = (file: MarkdownFile) =>
    runDocAction('Adopt', async () => {
      const readme = files.find((f) => /^readme\.mdx?$/i.test(f.path));
      const title = file.frontmatter.title || file.name.replace(/\.mdx?$/i, '');
      if (!readme) {
        const body = adoptIntoReadme({ path: 'README.md', body: `# ${workspace.name}` }, file.path, title)!;
        await handleCreateDocWithContent('README.md', `${body}`);
        toast('README Created & Linked', `Linked ${file.path} in a new README.md`, 'success');
        return;
      }
      const nextBody = adoptIntoReadme(readme, file.path, title);
      if (nextBody === null) {
        toast('Already Linked', `${readme.path} already links to ${file.path}`, 'info');
        return;
      }
      await persistFile(readme, readme.frontmatter, nextBody);
      toast('Orphan Adopted', `Added ${file.path} to ${readme.path} → Documentation`, 'success');
    });

  const handleMarkScopedDoc = (file: MarkdownFile) =>
    runDocAction('Mark Module Doc', async () => {
      await persistFile(file, { ...file.frontmatter, scope: 'module', updated_at: todayIso() }, file.body);
      toast('Marked as Module Doc', `${file.path} will no longer be flagged as a duplicate`, 'success');
    });

  const handleClearScope = (file: MarkdownFile) =>
    runDocAction('Edit Scope', async () => {
      const { scope: _scope, audit_exempt: _exempt, ...rest } = file.frontmatter;
      await persistFile(file, { ...rest, updated_at: todayIso() }, file.body);
      toast('Module Scope Removed', `${file.path} will be re-audited against the canonical doc`, 'info');
    });

  const handleDeleteDoc = (file: MarkdownFile) =>
    runDocAction('Delete', async () => {
      await handleDeleteFile(file.id, file.fullPath);
    });

  const handleScanPortfolioRoot = async () => {
    setScanningPortfolio(true);
    try {
      const result = await ProjectScannerService.openAndScanPortfolioRoot();
      if (!result) return;
      applyPortfolioScan(result.rootPath, result.projects);
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
      applyPortfolioScan(result.rootPath, result.projects);
      setViewMode('portfolio');
      toast('Portfolio Scanned', `Found ${result.projects.length} projects`, 'success');
    } catch (err: any) {
      toast('Scan Failed', err?.message || 'Could not scan portfolio root', 'error');
    } finally {
      setScanningPortfolio(false);
    }
  };

  const handleRefreshPortfolio = () => refreshAllPortfolioRoots(portfolioRoots, false);

  const handleRemovePortfolioRoot = (root: string) => {
    const norm = (p: string | null) => (p || '').replace(/[\\/]+$/, '').toLowerCase();
    setPortfolioRoots((prev) => prev.filter((r) => norm(r) !== norm(root)));
    setPortfolioProjects((prev) => prev.filter((e) => norm(parentFolderOf(e.workspace.rootPath)) !== norm(root)));
    toast('Folder Removed', `${root} is no longer part of the portfolio`, 'info');
  };

  const [rescanningProjectRoot, setRescanningProjectRoot] = useState<string | null>(null);
  const handleRescanPortfolioProject = async (rootPath: string) => {
    if (rootPath === workspace.rootPath) {
      await handleRefreshProject(true);
      return;
    }
    await rescanPortfolioEntry(rootPath);
  };

  // After a stack fix (or its undo): rescan the open project and its portfolio card, with live registry data.
  const handleStackFixed = async (rootPath: string) => {
    if (rootPath === workspace.rootPath) await handleRefreshProject(true);
    if (portfolioProjects.some((e) => e.workspace.rootPath === rootPath)) await rescanPortfolioEntry(rootPath);
  };

  const getFreshnessReport = (rootPath: string) => {
    const entry = portfolioProjects.find((e) => e.workspace.rootPath === rootPath);
    return entry ? assessStackFreshness(entry.auditReport.stackProfile) : undefined;
  };

  const rescanPortfolioEntry = async (rootPath: string) => {
    setRescanningProjectRoot(rootPath);
    try {
      const fresh = await ProjectScannerService.scanPath(rootPath, { watch: false });
      if (!fresh) return;
      const summary: PortfolioProjectSummary = {
        workspace: fresh,
        auditReport: auditProjectDocumentation(fresh, inspectProjectStack(fresh)),
        scannedAt: new Date().toISOString(),
      };
      setPortfolioProjects((prev) => prev.map((e) => (e.workspace.rootPath === rootPath ? summary : e)));
      await enrichWithRegistry([summary], true);
    } catch (err: any) {
      toast('Rescan Failed', err?.message || rootPath, 'error');
    } finally {
      setRescanningProjectRoot(null);
    }
  };

  const handleOpenPortfolioProject = async (projWorkspace: ProjectWorkspace, targetFileId?: string) => {
    // Already the active project: keep in-memory state (open tabs, unsaved edits) and just navigate.
    if (projWorkspace.rootPath === workspace.rootPath) {
      if (targetFileId) handleSelectFile(targetFileId);
      else setViewMode('project-overview');
      return;
    }

    // Remembered entries carry no file contents: always load them from disk before showing an editor.
    const entry = portfolioProjects.find((e) => e.workspace.rootPath === projWorkspace.rootPath);
    if (entry?.fromSnapshot && projWorkspace.isLocalFolder) {
      try {
        const fresh = await ProjectScannerService.scanPath(projWorkspace.rootPath);
        if (!fresh) throw new Error('Folder could not be read');
        setWorkspace(fresh);
        setFiles(fresh.files);
        const chosen = (targetFileId && fresh.files.some((f) => f.id === targetFileId) ? targetFileId : null) || fresh.files[0]?.id || null;
        setActiveFileId(chosen);
        setOpenFileIds(chosen ? [chosen] : []);
        localStorage.setItem(SAVED_WORKSPACE_PATH_KEY, fresh.rootPath);
        applyRefreshedWorkspace(fresh);
        setViewMode(targetFileId && chosen === targetFileId ? 'editor' : 'project-overview');
        if (!targetFileId) toast('Opened Project', fresh.name, 'success');
      } catch (err: any) {
        toast('Could Not Open Project', `${projWorkspace.rootPath}: ${err?.message || 'unreadable'}`, 'error');
      }
      return;
    }

    setWorkspace(projWorkspace);
    setFiles(projWorkspace.files);
    const chosenId = targetFileId || projWorkspace.files[0]?.id || null;
    setActiveFileId(chosenId);
    setOpenFileIds(chosenId ? [chosenId] : []);
    if (projWorkspace.isLocalFolder) {
      localStorage.setItem(SAVED_WORKSPACE_PATH_KEY, projWorkspace.rootPath);
      // Refresh from disk in the background (the portfolio snapshot may be old) and start watching it.
      ProjectScannerService.scanPath(projWorkspace.rootPath)
        .then((fresh) => {
          if (fresh && workspaceRef.current.rootPath === fresh.rootPath) applyRefreshedWorkspace(fresh);
        })
        .catch(() => {
          // keep snapshot
        });
    }
    if (targetFileId) {
      setViewMode('editor');
    } else {
      setViewMode('project-overview');
      toast('Opened Project', projWorkspace.name, 'success');
    }
  };

  const handleOpenSampleVault = () => {
    const sample = getSampleWorkspace();
    setWorkspace(sample);
    setFiles(sample.files);
    const firstId = sample.files[0]?.id || null;
    setActiveFileId(firstId);
    setOpenFileIds(firstId ? [firstId] : []);
    localStorage.removeItem(SAVED_WORKSPACE_PATH_KEY);
    setViewMode('project-overview');
    toast('Sample Vault', 'Switched to the built-in sample workspace', 'info');
  };

  // ---------------------------------------------------------------------------
  // Notes: Markdown outside any project (desktop). A watched folder under Documents, plus files the
  // user opened from elsewhere, which stay where they are and are saved in place.
  // ---------------------------------------------------------------------------
  const canUseNotes = ProjectScannerService.isElectron() && Boolean(window.electronAPI?.getNotesFolder);

  const ensureNotesFolder = async (): Promise<string> => {
    if (!notesDirRef.current) notesDirRef.current = await getNotesFolder();
    if (!notesDirRef.current) throw new Error('Notes need the desktop app');
    if (!externalPathsRef.current) externalPathsRef.current = await loadExternalPaths();
    setNotesFolderShown(notesDirRef.current);
    return notesDirRef.current;
  };

  /** Settings: point Notes at another folder (null = back to Documents\DocAtlas Notes). Files are not moved. */
  const handleChangeNotesFolder = async (choose: boolean) => {
    let picked: string | null = null;
    if (choose) {
      picked = await window.electronAPI?.openDirectory?.() ?? null;
      if (!picked) return;
    }
    const inUse = await setNotesFolder(picked);
    if (!inUse) return;
    if (picked && !samePath(inUse, picked)) {
      toast('Folder Not Usable', `${picked} could not be used; Notes stay in ${inUse}`, 'error');
    }
    const changed = !notesDirRef.current || !samePath(inUse, notesDirRef.current);
    notesDirRef.current = inUse;
    setNotesFolderShown(inUse);
    if (changed && workspaceRef.current.kind === 'notes') await showNotes(undefined, { reset: true });
    if (changed) toast('Notes Folder Changed', inUse, 'success');
  };

  /**
   * An auto-named note ("Note 2026-11-13 0905.md") takes its heading as file name once you move on
   * from it. Names you chose, and files opened from elsewhere, are never renamed; nothing is overwritten.
   */
  const renameNoteFromHeading = async (note: MarkdownFile) => {
    const dir = notesDirRef.current;
    if (!dir || !note.fullPath || isElsewhereId(note.id) || !window.electronAPI?.movePathSafe) return;
    if (relativeInside(note.fullPath, dir) === null) return;
    const target = noteNameFromHeading(note.name, note.body);
    if (!target) return;
    try {
      // Scanned paths use the OS separator (backslashes on Windows); normalize before splitting.
      const fullPath = normalizeFsPath(note.fullPath);
      const folder = fullPath.slice(0, fullPath.lastIndexOf('/'));
      const finalPath = normalizeFsPath(await window.electronAPI.movePathSafe(note.fullPath, `${folder}/${target}`));
      const newId = relativeInside(finalPath, dir);
      if (!newId) return;
      setOpenFileIds((prev) => prev.map((id) => (id === note.id ? newId : id)));
      setActiveFileId((prev) => (prev === note.id ? newId : prev));
      if (workspaceRef.current.kind === 'notes') await showNotes();
      toast('Note Renamed', baseName(finalPath), 'info');
    } catch (err: any) {
      toast('Could Not Rename Note', err?.message || target, 'error');
    }
  };

  /**
   * Loads Notes from disk and shows it, switching workspace if needed. `select` picks files to open as
   * tabs; when switching with nothing selected, the most recently edited note opens.
   */
  const showNotes = async (
    select?: (ws: ProjectWorkspace) => string[],
    opts?: { keepView?: boolean; reset?: boolean }
  ): Promise<ProjectWorkspace | null> => {
    try {
      const dir = await ensureNotesFolder();
      const { workspace: ws, kept } = await loadNotesWorkspace(dir, externalPathsRef.current ?? []);
      if (kept.length !== (externalPathsRef.current ?? []).length) {
        externalPathsRef.current = kept;
        saveExternalPaths(kept);
      }
      // reset: the folder changed, so old tabs would point at same-named files in the new folder.
      const wasNotes = workspaceRef.current.kind === 'notes' && !opts?.reset;
      const wanted = (select?.(ws) ?? []).filter((id) => ws.files.some((f) => f.id === id));
      applyRefreshedWorkspace(ws);
      if (wasNotes) {
        if (wanted.length > 0) {
          setOpenFileIds((prev) => [...prev, ...wanted.filter((id) => !prev.includes(id))]);
          setActiveFileId(wanted[wanted.length - 1]);
          setViewMode('editor');
        }
      } else {
        const recent = [...ws.files].sort((a, b) => (b.lastModifiedMs ?? 0) - (a.lastModifiedMs ?? 0))[0];
        const initial = wanted.length > 0 ? wanted : recent ? [recent.id] : [];
        setOpenFileIds(initial);
        setActiveFileId(initial[initial.length - 1] ?? null);
        localStorage.setItem(SAVED_WORKSPACE_PATH_KEY, ws.rootPath);
        if (!opts?.keepView) setViewMode('editor');
      }
      return ws;
    } catch (err: any) {
      toast('Could Not Open Notes', err?.message || 'Unknown error', 'error');
      return null;
    }
  };
  showNotesRef.current = (opts) => showNotes(undefined, opts);
  renameNoteRef.current = renameNoteFromHeading;

  // Moving on from a note (another tab, another workspace, closing it) is when it takes its heading as name.
  const currentNote = workspace.kind === 'notes' ? activeFile : null;
  const noteSnapshotRef = useRef<MarkdownFile | null>(null);
  useEffect(() => {
    const previous = noteSnapshotRef.current;
    noteSnapshotRef.current = currentNote;
    if (previous && previous.id !== currentNote?.id) renameNoteRef.current(previous);
  }, [currentNote]);

  const handleOpenNotes = () => {
    if (workspace.kind === 'notes') setViewMode('editor');
    else showNotes();
  };

  /** Ctrl+N: a blank note in the Notes folder, open and ready to type, from anywhere in the app. */
  const handleNewNote = async () => {
    if (!canUseNotes) {
      handleNewFile('document');
      return;
    }
    try {
      const dir = await ensureNotesFolder();
      const taken: string[] = [];
      let name = newNoteFileName(new Date(), taken);
      while ((await window.electronAPI!.fileInfo?.(`${dir}/${name}`))?.exists) {
        taken.push(name);
        name = newNoteFileName(new Date(), taken);
      }
      await ProjectScannerService.createFile(dir, name, newNoteContent(name));
      const ws = await showNotes(() => [name]);
      if (ws) toast('New Note', name, 'success');
    } catch (err: any) {
      toast('Could Not Create Note', err?.message || 'Unknown error', 'error');
    }
  };

  /**
   * Opens Markdown files from anywhere on disk. Files that all belong to one known project open in
   * that project (so DocPassport applies); anything else opens in Notes and is saved in place.
   */
  const openMarkdownPaths = async (paths: string[], quiet = false) => {
    if (paths.length === 0) return;
    // Read through refs: this also runs from startup and from other windows' "open file" requests.
    const workspace = workspaceRef.current;
    const projectRoots = [
      ...portfolioProjectsRef.current.map((e) => e.workspace.rootPath),
      ...(workspace.isLocalFolder && workspace.kind !== 'notes' ? [workspace.rootPath] : []),
    ];
    const owner = findOwningRoot(paths[0], projectRoots);
    if (owner && paths.every((p) => findOwningRoot(p, projectRoots) === owner)) {
      const ids = paths.map((p) => relativeInside(p, owner)!);
      const fresh = await ProjectScannerService.scanPath(owner).catch(() => null);
      // A file in an ignored folder (node_modules, dist...) isn't part of the project: fall through to Notes.
      if (fresh && ids.every((id) => fresh.files.some((f) => f.id === id))) {
        const isCurrent = workspace.isLocalFolder && workspace.kind !== 'notes' && samePath(workspace.rootPath, owner);
        applyRefreshedWorkspace(fresh);
        setOpenFileIds((prev) => (isCurrent ? [...prev, ...ids.filter((id) => !prev.includes(id))] : ids));
        setActiveFileId(ids[ids.length - 1]);
        if (!isCurrent) localStorage.setItem(SAVED_WORKSPACE_PATH_KEY, fresh.rootPath);
        setViewMode('editor');
        if (!quiet) toast('Opened in Project', `${fresh.name}: ${ids[ids.length - 1]}`, 'success');
        return;
      }
    }

    try {
      const dir = await ensureNotesFolder();
      const outside = paths.filter((p) => relativeInside(p, dir) === null);
      if (outside.length > 0) {
        externalPathsRef.current = withExternalPaths(externalPathsRef.current ?? [], outside);
        saveExternalPaths(externalPathsRef.current);
      }
      const ws = await showNotes((loaded) =>
        paths
          .map((p) => loaded.files.find((f) => f.fullPath && samePath(f.fullPath, p))?.id)
          .filter((id): id is string => Boolean(id))
      );
      if (ws && !quiet) {
        toast(
          paths.length === 1 ? 'Opened' : `Opened ${paths.length} files`,
          outside.length > 0 ? 'Listed in Notes and saved in place' : 'From your Notes folder',
          'success'
        );
      }
    } catch (err: any) {
      toast('Could Not Open File', err?.message || 'Unknown error', 'error');
    }
  };

  const handleOpenMarkdownFile = async () => {
    if (!window.electronAPI?.openMarkdownFiles) return;
    const paths = await window.electronAPI.openMarkdownFiles();
    await openMarkdownPaths(paths);
  };
  openPathsRef.current = (paths) => openMarkdownPaths(paths);

  // Settings shows where notes live; fetch it the first time the dialog opens.
  useEffect(() => {
    if (!settingsModalOpen || !canUseNotes) return;
    if (!notesFolderShown) getNotesFolder().then((dir) => dir && setNotesFolderShown(dir));
    if (!defaultNotesFolder) getDefaultNotesFolder().then(setDefaultNotesFolder);
  }, [settingsModalOpen]);

  // Files sent by a second launch (e.g. "Open with DocAtlas" while it's already running).
  useEffect(() => {
    const unsubscribe = window.electronAPI?.onOpenFiles?.((paths) => openPathsRef.current(paths));
    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, []);

  /** Writes the active document to a file the user picks, then keeps editing that file. */
  const handleSaveAs = async () => {
    const file = activeFile;
    if (!file || !window.electronAPI?.saveMarkdownFileAs) return;
    const dir = notesDirRef.current ?? (await getNotesFolder());
    const suggested = (file.fullPath || (dir ? `${dir}/${file.name}` : file.name)).replace(/\//g, '\\');
    const target = await window.electronAPI.saveMarkdownFileAs(suggested);
    if (!target) return;
    if (file.fullPath && samePath(target, file.fullPath)) {
      await handleSave();
      return;
    }
    try {
      await window.electronAPI.writeFile(target, file.content);
      await openMarkdownPaths([target], true);
      toast('Saved As', target, 'success');
    } catch (err: any) {
      toast('Save As Failed', err?.message || target, 'error');
    }
  };

  // Create new subfolder
  const handleNewFolder = async (parentFolder: string, folderName: string) => {
    if (isElsewhereId(parentFolder)) return;
    if (workspace.isLocalFolder) {
      const targetPath = `${parentFolder}/${folderName}`.replace(/\\/g, '/');
      await ProjectScannerService.createFolder(targetPath);
      handleRefreshProject();
      toast('Folder Created', folderName, 'success');
    }
  };

  // Rename node
  const handleRenameNode = async (node: FileTreeNode, newName: string) => {
    if (workspace.kind === 'notes' && isElsewhereId(node.id)) {
      if (node.isFolder || !node.fullPath) return;
      const oldPath = normalizeFsPath(node.fullPath);
      const newPath = `${oldPath.slice(0, oldPath.lastIndexOf('/'))}/${newName}`;
      try {
        await ProjectScannerService.renamePath(oldPath, newPath);
      } catch (err: any) {
        toast('Rename Failed', err?.message || newName, 'error');
        return;
      }
      externalPathsRef.current = (externalPathsRef.current ?? []).map((p) => (samePath(p, oldPath) ? newPath : p));
      saveExternalPaths(externalPathsRef.current);
      setOpenFileIds((prev) => prev.filter((id) => id !== node.id));
      await showNotes((ws) => ws.files.filter((f) => f.fullPath && samePath(f.fullPath, newPath)).map((f) => f.id));
      toast('Renamed', newName, 'success');
      return;
    }
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
    // Files opened from elsewhere are only listed in Notes: forget them, never delete them.
    if (workspace.kind === 'notes' && isElsewhereId(id)) {
      const all = id === ELSEWHERE_PREFIX;
      externalPathsRef.current = all ? [] : (externalPathsRef.current ?? []).filter((p) => !(fullPath && samePath(p, fullPath)));
      saveExternalPaths(externalPathsRef.current);
      setOpenFileIds((prev) => prev.filter((tabId) => (all ? !isElsewhereId(tabId) : tabId !== id)));
      await showNotes();
      toast('Removed from Notes', 'The file is still on disk', 'info');
      return;
    }
    setOpenFileIds((prev) => prev.filter((tabId) => tabId !== id));
    if (workspace.isLocalFolder && fullPath) {
      await ProjectScannerService.deletePath(fullPath);
      await handleRefreshProject(true);
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
  const handleSave = async () => {
    if (!activeFileId || !activeFile) return;
    if (workspace.isLocalFolder && activeFile.fullPath) {
      const ok = await ProjectScannerService.saveFileToDisk(activeFile);
      if (!ok) {
        toast('Save Failed', `Could not write ${activeFile.name} to disk`, 'error');
        return;
      }
      toast('Saved to Disk', activeFile.name, 'success');
    } else {
      toast('Document Saved', activeFile.frontmatter.title || activeFile.name, 'success');
    }
    setFiles((prev) =>
      prev.map((f) => (f.id === activeFileId ? { ...f, isDirty: false, lastModifiedMs: Date.now() } : f))
    );
  };
  saveRef.current = handleSave;
  saveAsRef.current = () => {
    if (canUseNotes) handleSaveAs();
  };
  newNoteRef.current = handleNewNote;
  openFileRef.current = () => {
    if (canUseNotes) handleOpenMarkdownFile();
  };

  // Every DocPassport action, shared by the project dashboard and the editor pill's modal.
  const docActions = {
    onArchiveFile: handleArchiveFile,
    onMarkDeprecated: handleMarkDeprecated,
    onRestoreActive: handleRestoreActive,
    onAutoFixStale: handleAutoFixStale,
    onLinkOrphanInReadme: handleLinkOrphanInReadme,
    onMarkScopedDoc: handleMarkScopedDoc,
    onClearScope: handleClearScope,
    onDeleteFile: handleDeleteDoc,
    onRunAgent: (fileId: string) => {
      handleSelectFile(fileId);
      setViewMode('agent-hub');
    },
    onRevealInExplorer: (f: MarkdownFile) => {
      if (f.fullPath) ProjectScannerService.revealInExplorer(f.fullPath);
    },
  };

  // In-memory workspaces (sample vault) have no disk to rescan, so derive the tree from live files.
  const sidebarTree = useMemo(
    () => (workspace.isLocalFolder ? workspace.tree : buildTreeFromFiles(files, workspace.name)),
    [workspace, files]
  );

  // Offer "scan the folder holding this project" only for real projects: the Notes folder's parent is
  // Documents, which is not a folder of projects.
  const currentWorkspaceParent =
    workspace.isLocalFolder && workspace.kind !== 'notes' ? parentFolderOf(workspace.rootPath) : null;

  return (
    <FixProvider onFixed={handleStackFixed} getReport={getFreshnessReport}>
    <div className={`flex h-screen w-screen bg-[#161618] text-neutral-200 overflow-hidden font-sans ${theme}`}>
      {/* Resizable Notion Sidebar */}
      <Sidebar
        files={files}
        tree={sidebarTree}
        project={workspace}
        portfolioProjects={displayedPortfolio}
        portfolioRootPath={portfolioRootPath}
        onSelectPortfolioProject={handleOpenPortfolioProject}
        onOpenSampleVault={handleOpenSampleVault}
        auditReport={workspace.kind === 'notes' ? undefined : activeAuditReport}
        activeFileId={activeFileId}
        onSelectFile={handleSelectFile}
        onNewFile={handleNewFile}
        onNewFolder={handleNewFolder}
        onRenameNode={handleRenameNode}
        onDeleteFile={handleDeleteFile}
        onOpenProjectFolder={handleOpenProjectFolder}
        onOpenNotes={canUseNotes ? handleOpenNotes : undefined}
        onNewNote={canUseNotes ? handleNewNote : undefined}
        onOpenMarkdownFile={canUseNotes ? handleOpenMarkdownFile : undefined}
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
        {/* The portfolio has its own header; editor chrome (file breadcrumb, tabs) would only distract there. */}
        {viewMode === 'portfolio' ? (
          isSidebarCollapsed && (
            <header className="h-10 border-b border-[#2f2f2f] bg-[#191919] px-3 flex items-center">
              <button
                type="button"
                onClick={() => setIsSidebarCollapsed(false)}
                className="p-1.5 rounded-md text-neutral-400 hover:text-white hover:bg-[#2a2a2a] transition"
                aria-label="Show sidebar"
                title="Show sidebar"
              >
                <PanelLeftOpen className="w-4 h-4" />
              </button>
            </header>
          )
        ) : (
        <>
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
          onSaveAs={canUseNotes ? handleSaveAs : undefined}
          isSidebarCollapsed={isSidebarCollapsed}
          onToggleSidebar={() => setIsSidebarCollapsed(false)}
          onOpenProjectOverview={() => (workspace.kind === 'notes' ? handleOpenNotes() : setViewMode('project-overview'))}
        />

        {/* Multi-Document Tab Bar */}
        <TabBar
          openFileIds={openFileIds}
          activeFileId={activeFileId}
          files={files}
          onSelectTab={handleSelectFile}
          onCloseTab={handleCloseTab}
          onNewTab={() => (workspace.kind === 'notes' ? handleNewNote() : handleNewFile('document'))}
        />
        </>
        )}

        {/* View Switcher Container */}
        <div className="flex-1 overflow-hidden relative">
          {viewMode === 'portfolio' && (
            <PortfolioView
              roots={portfolioRoots}
              savedAt={portfolioSavedAt}
              currentWorkspaceParent={currentWorkspaceParent}
              activeProjectRoot={workspace.rootPath}
              projects={displayedPortfolio}
              scanning={scanningPortfolio}
              refreshing={refreshingPortfolio}
              rescanningProjectRoot={rescanningProjectRoot}
              isDesktop={ProjectScannerService.isElectron()}
              onAddRoot={handleScanPortfolioRoot}
              onScanCurrentWorkspaceParent={() => currentWorkspaceParent && handleScanPortfolioPath(currentWorkspaceParent)}
              onRefreshPortfolio={handleRefreshPortfolio}
              onRemoveRoot={handleRemovePortfolioRoot}
              onRescanProject={handleRescanPortfolioProject}
              onOpenProject={handleOpenPortfolioProject}
              onNewNote={canUseNotes ? handleNewNote : undefined}
              onOpenMarkdownFile={canUseNotes ? handleOpenMarkdownFile : undefined}
            />
          )}

          {viewMode === 'project-overview' && (
            <ProjectDashboard
              project={liveWorkspace}
              auditReport={activeAuditReport}
              checkingLiveVersions={checkingLiveVersions}
              onRefreshLiveStack={() => runLiveStackCheck(true)}
              onSelectFile={handleSelectFile}
              onSelectViewMode={setViewMode}
              onNewFile={() => handleNewFile('document')}
              onRefreshProject={() => handleRefreshProject()}
              onCreateDocWithContent={handleCreateDocWithContent}
              onAutoHealProject={handleAutoHealProject}
              docActions={docActions}
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
        onNewNote={canUseNotes ? handleNewNote : undefined}
        onOpenNotes={canUseNotes ? handleOpenNotes : undefined}
        onOpenMarkdownFile={canUseNotes ? handleOpenMarkdownFile : undefined}
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
        notes={
          canUseNotes
            ? {
                folder: notesFolderShown,
                defaultFolder: defaultNotesFolder,
                onChoose: () => handleChangeNotesFolder(true),
                onUseDefault: () => handleChangeNotesFolder(false),
                onReveal: () => notesFolderShown && ProjectScannerService.revealInExplorer(notesFolderShown),
              }
            : undefined
        }
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
          actions={docActions}
        />
      )}
    </div>
    </FixProvider>
  );
};

export const App: React.FC = () => {
  return (
    <ToastProvider>
      <AppContent />
    </ToastProvider>
  );
};
