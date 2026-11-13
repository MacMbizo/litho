import React, { useMemo, useState } from 'react';
import {
  FolderSearch,
  RefreshCw,
  Search,
  Cpu,
  FileText,
  Copy,
  Clock,
  FilePlus2,
  ArrowRight,
  ArrowUpDown,
  FolderGit2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Monitor,
  PackageOpen,
  Unlink,
} from 'lucide-react';
import { PortfolioProjectSummary } from '../../types/docAudit';
import { ProjectWorkspace } from '../../types/document';
import { DocPassportBadge, GRADE_CLASS, countStackDrift } from './docPassport';

interface PortfolioViewProps {
  portfolioRootPath: string | null;
  /** Parent folder of the active local project (e.g. C:\Prj for C:\Prj\app), offered as a one-click root. */
  currentWorkspaceParent: string | null;
  activeProjectRoot: string;
  projects: PortfolioProjectSummary[];
  scanning: boolean;
  isDesktop: boolean;
  onScanPortfolioRoot: () => void;
  onScanCurrentWorkspaceParent: () => void;
  onRefreshPortfolio: () => void;
  onOpenProject: (workspace: ProjectWorkspace, targetFileId?: string) => void;
}

type PortfolioFilter = 'all' | 'attention' | 'duplicates' | 'missing' | 'sdk-drift';
type PortfolioSort = 'name' | 'health';

export const PortfolioView: React.FC<PortfolioViewProps> = ({
  portfolioRootPath,
  currentWorkspaceParent,
  activeProjectRoot,
  projects,
  scanning,
  isDesktop,
  onScanPortfolioRoot,
  onScanCurrentWorkspaceParent,
  onRefreshPortfolio,
  onOpenProject,
}) => {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<PortfolioFilter>('all');
  const [sortBy, setSortBy] = useState<PortfolioSort>('name');
  const [expandedCards, setExpandedCards] = useState<Record<string, boolean>>({});

  const toggleCardFiles = (rootPath: string) => {
    setExpandedCards((prev) => ({ ...prev, [rootPath]: !prev[rootPath] }));
  };

  const stats = useMemo(() => {
    const total = projects.length;
    const avgScore =
      total > 0
        ? Math.round(projects.reduce((acc, p) => acc + p.auditReport.healthScore, 0) / total)
        : 0;
    const withDuplicates = projects.filter((p) => p.auditReport.counts.duplicate > 0).length;
    const withSdkDrift = projects.filter((p) => countStackDrift(p.auditReport) > 0).length;
    const totalDuplicates = projects.reduce((acc, p) => acc + p.auditReport.counts.duplicate, 0);
    const avgGrade = avgScore >= 85 ? 'A' : avgScore >= 70 ? 'B' : avgScore >= 50 ? 'C' : 'D';
    const checkedLive = projects.filter((p) => p.auditReport.stackProfile.checkedLiveAt).length;
    const withDeps = projects.filter((p) => p.auditReport.stackProfile.dependencies.length > 0).length;
    return { total, avgScore, avgGrade, withDuplicates, totalDuplicates, withSdkDrift, checkedLive, withDeps };
  }, [projects]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return projects.filter((item) => {
      const { workspace, auditReport } = item;
      if (q) {
        const hay = `${workspace.name} ${workspace.rootPath} ${auditReport.stackProfile.frameworks.join(' ')}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }

      if (filter === 'duplicates') return auditReport.counts.duplicate > 0;
      if (filter === 'missing') return auditReport.missingDocs.length > 0;
      if (filter === 'sdk-drift') return countStackDrift(auditReport) > 0;
      if (filter === 'attention') {
        return (
          auditReport.healthScore < 80 ||
          auditReport.counts.duplicate > 0 ||
          auditReport.missingDocs.length > 0
        );
      }
      return true;
    }).sort((a, b) =>
      sortBy === 'health'
        ? a.auditReport.healthScore - b.auditReport.healthScore || a.workspace.name.localeCompare(b.workspace.name)
        : a.workspace.name.localeCompare(b.workspace.name)
    );
  }, [projects, query, filter, sortBy]);

  const scanParentButton = currentWorkspaceParent && portfolioRootPath !== currentWorkspaceParent && (
    <button
      onClick={onScanCurrentWorkspaceParent}
      disabled={scanning}
      className="px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-2 transition disabled:opacity-50"
      title="Scan the folder that contains the current project"
    >
      <FolderSearch className="w-4 h-4" />
      <span className="truncate max-w-[220px]">Scan {currentWorkspaceParent}</span>
    </button>
  );

  return (
    <div className="h-full overflow-y-auto bg-[#191919] text-neutral-100">
      {/* Header */}
      <div className="border-b border-[#2a2a2a] bg-[#1e1e1e] px-8 py-6">
        <div className="max-w-5xl mx-auto flex flex-col gap-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-xl font-bold text-white flex items-center gap-2.5">
                <FolderGit2 className="w-6 h-6 text-indigo-400" />
                <span>DocAtlas Portfolio</span>
              </h1>
              <p className="text-xs text-neutral-400 mt-1 truncate">
                {portfolioRootPath ? (
                  <>
                    Root: <span className="font-mono text-neutral-200">{portfolioRootPath}</span>
                    {stats.withDeps > 0 && (
                      <span className="ml-2 text-neutral-500">
                        · registry checked {stats.checkedLive}/{stats.withDeps}
                        {stats.checkedLive < stats.withDeps && scanning === false ? '…' : ''}
                      </span>
                    )}
                  </>
                ) : (
                  'Audit documentation health and tech-stack drift across every project in a folder.'
                )}
              </p>
            </div>

            {isDesktop && (
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                {scanParentButton}
                {portfolioRootPath && (
                  <button
                    onClick={onRefreshPortfolio}
                    disabled={scanning}
                    className="px-3 py-2 rounded-lg bg-[#262626] hover:bg-[#303030] border border-[#363636] text-xs font-medium text-neutral-200 flex items-center gap-1.5 transition disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${scanning ? 'animate-spin' : ''}`} />
                    <span>Rescan</span>
                  </button>
                )}
                <button
                  onClick={onScanPortfolioRoot}
                  disabled={scanning}
                  className="px-4 py-2 rounded-lg bg-indigo-500 hover:bg-indigo-600 text-white text-xs font-semibold flex items-center gap-2 transition disabled:opacity-50"
                >
                  <FolderSearch className="w-4 h-4" />
                  <span>{scanning ? 'Scanning Projects…' : 'Choose Root Folder…'}</span>
                </button>
              </div>
            )}
          </div>

          {/* KPI Strip */}
          {projects.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="p-3.5 rounded-xl bg-[#252525] border border-[#303030]">
                <div className="text-[11px] text-neutral-400">Projects Discovered</div>
                <div className="text-xl font-bold text-white mt-0.5">{stats.total}</div>
              </div>
              <div className="p-3.5 rounded-xl bg-[#252525] border border-[#303030]">
                <div className="text-[11px] text-neutral-400">Avg. Doc Health</div>
                <div className="text-xl font-bold mt-0.5 flex items-baseline gap-2">
                  <span className={`px-1.5 rounded border text-base ${GRADE_CLASS[stats.avgGrade as 'A']}`}>{stats.avgGrade}</span>
                  <span className="text-neutral-100">{stats.avgScore}</span>
                  <span className="text-xs text-neutral-500 font-medium">/100</span>
                </div>
              </div>
              <div className="p-3.5 rounded-xl bg-[#252525] border border-[#303030]">
                <div className="text-[11px] text-neutral-400">Duplicate Docs</div>
                <div className="text-xl font-bold text-orange-300 mt-0.5">
                  {stats.totalDuplicates}
                  <span className="text-xs text-neutral-500 font-medium ml-1.5">in {stats.withDuplicates} projects</span>
                </div>
              </div>
              <div className="p-3.5 rounded-xl bg-[#252525] border border-[#303030]">
                <div className="text-[11px] text-neutral-400">Projects with SDK Drift</div>
                <div className="text-xl font-bold text-amber-300 mt-0.5">{stats.withSdkDrift}</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="max-w-5xl mx-auto p-8 space-y-6">
        {!isDesktop ? (
          <div className="p-12 rounded-2xl border border-dashed border-[#303030] bg-[#1d1d1d] text-center space-y-3">
            <Monitor className="w-10 h-10 text-indigo-400 mx-auto opacity-80" />
            <h2 className="text-sm font-semibold text-neutral-100">Portfolio scanning runs in the desktop app</h2>
            <p className="text-xs text-neutral-400 max-w-md mx-auto leading-relaxed">
              Browsers can only open one folder at a time, so multi-project scanning needs the Electron build. Run{' '}
              <code className="font-mono text-neutral-200">npm run build &amp;&amp; npm start</code>. In the browser you can
              still open a single project folder and use its DocAtlas audit on the Project Overview page.
            </p>
          </div>
        ) : projects.length === 0 ? (
          <div className="p-12 rounded-2xl border border-dashed border-[#303030] bg-[#1d1d1d] text-center space-y-4">
            <FolderSearch className="w-10 h-10 text-indigo-400 mx-auto opacity-80" />
            <div className="space-y-1">
              <h2 className="text-sm font-semibold text-neutral-100">
                {scanning ? 'Scanning projects…' : 'No portfolio scanned yet'}
              </h2>
              <p className="text-xs text-neutral-400 max-w-md mx-auto">
                Choose a parent folder such as <code className="font-mono text-neutral-200">C:\Prj</code>. Each subfolder is
                audited as a project: health grade, missing docs, duplicates, broken links and stack drift.
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2.5">
              {scanParentButton}
              <button
                onClick={onScanPortfolioRoot}
                disabled={scanning}
                className="px-4 py-2 rounded-lg bg-indigo-500 hover:bg-indigo-600 text-white text-xs font-semibold inline-flex items-center gap-2 transition disabled:opacity-50"
              >
                <FolderSearch className="w-4 h-4" />
                <span>Choose Root Folder…</span>
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Search, Filters & Sort */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="relative flex-1 max-w-sm">
                <Search className="w-3.5 h-3.5 text-neutral-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Filter by project name or framework..."
                  aria-label="Filter projects"
                  className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-[#222] border border-[#333] text-xs text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {(
                  [
                    ['all', 'All'],
                    ['attention', 'Needs Attention'],
                    ['duplicates', 'Has Duplicates'],
                    ['missing', 'Missing Docs'],
                    ['sdk-drift', 'SDK Drift'],
                  ] as Array<[PortfolioFilter, string]>
                ).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setFilter(key)}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-medium border transition ${
                      filter === key
                        ? 'bg-indigo-500/20 text-indigo-200 border-indigo-500/40'
                        : 'bg-[#222] text-neutral-400 border-[#333] hover:text-neutral-200'
                    }`}
                  >
                    {label}
                  </button>
                ))}
                <span className="w-px h-4 bg-[#333] mx-1" />
                <button
                  onClick={() => setSortBy(sortBy === 'name' ? 'health' : 'name')}
                  className="px-2.5 py-1 rounded-md text-[11px] font-medium border bg-[#222] text-neutral-300 border-[#333] hover:text-white flex items-center gap-1 transition"
                  title="Toggle sort order"
                >
                  <ArrowUpDown className="w-3 h-3" />
                  <span>{sortBy === 'name' ? 'Name' : 'Worst health first'}</span>
                </button>
              </div>
            </div>

            {filtered.length === 0 && (
              <div className="p-6 rounded-xl border border-dashed border-[#2d2d2d] text-center text-xs text-neutral-500">
                No projects match this filter.
              </div>
            )}

            {/* Project Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filtered.map(({ workspace, auditReport }) => {
                const brokenCount = auditReport.inventory.reduce((acc, i) => acc + i.brokenLinks.length, 0);
                const driftCount = countStackDrift(auditReport);
                const isActive = workspace.rootPath === activeProjectRoot;

                return (
                  <div
                    key={workspace.rootPath}
                    className={`p-5 rounded-xl bg-[#202020] border transition flex flex-col justify-between gap-4 ${
                      isActive ? 'border-indigo-500/50' : 'border-[#2d2d2d] hover:border-indigo-500/40'
                    }`}
                  >
                    <div className="space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="text-sm font-bold text-white truncate flex items-center gap-2">
                            <span className="truncate">{workspace.name}</span>
                            {isActive && (
                              <span className="text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 shrink-0">
                                Open
                              </span>
                            )}
                          </h3>
                          <p className="text-[11px] font-mono text-neutral-500 truncate mt-0.5">{workspace.rootPath}</p>
                        </div>

                        <div className={`px-2.5 py-1 rounded-lg border text-xs font-bold shrink-0 ${GRADE_CLASS[auditReport.grade]}`}>
                          {auditReport.grade} · {auditReport.healthScore}
                        </div>
                      </div>

                      {/* Frameworks */}
                      {auditReport.stackProfile.frameworks.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Cpu className="w-3 h-3 text-indigo-400 mr-0.5" />
                          {auditReport.stackProfile.frameworks.map((fw) => (
                            <span
                              key={fw}
                              className="text-[10px] px-2 py-0.5 rounded bg-[#2a2a2a] text-neutral-300 border border-[#363636]"
                            >
                              {fw}
                            </span>
                          ))}
                          {auditReport.stackProfile.expoSdkVersion && (
                            <span className="text-[10px] px-2 py-0.5 rounded bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 font-mono">
                              Expo SDK {parseInt(auditReport.stackProfile.expoSdkVersion, 10)}
                            </span>
                          )}
                        </div>
                      )}

                      {/* Doc Metrics */}
                      <div className="flex flex-wrap items-center gap-3 text-[11px] text-neutral-400">
                        <span className="flex items-center gap-1">
                          <FileText className="w-3 h-3 text-sky-400" />
                          {auditReport.inventory.length} docs
                        </span>
                        {auditReport.missingDocs.length > 0 && (
                          <span className="flex items-center gap-1 text-amber-300" title={auditReport.missingDocs.map((m) => m.fileName).join(', ')}>
                            <FilePlus2 className="w-3 h-3" />
                            {auditReport.missingDocs.length} missing
                          </span>
                        )}
                        {auditReport.counts.duplicate > 0 && (
                          <span className="flex items-center gap-1 text-orange-300">
                            <Copy className="w-3 h-3" />
                            {auditReport.counts.duplicate} duplicate{auditReport.counts.duplicate === 1 ? '' : 's'}
                          </span>
                        )}
                        {auditReport.counts.stale > 0 && (
                          <span className="flex items-center gap-1 text-amber-300">
                            <Clock className="w-3 h-3" />
                            {auditReport.counts.stale} stale
                          </span>
                        )}
                        {brokenCount > 0 && (
                          <span className="flex items-center gap-1 text-rose-300">
                            <Unlink className="w-3 h-3" />
                            {brokenCount} broken link{brokenCount === 1 ? '' : 's'}
                          </span>
                        )}
                        {driftCount > 0 && (
                          <span className="flex items-center gap-1 text-amber-300">
                            <PackageOpen className="w-3 h-3" />
                            {driftCount} outdated SDK{driftCount === 1 ? '' : 's'}
                          </span>
                        )}
                      </div>

                      {/* Expandable Inline File Drawer */}
                      {expandedCards[workspace.rootPath] && (
                        <div className="mt-2 pt-2.5 border-t border-[#2d2d2d] space-y-1 max-h-56 overflow-y-auto">
                          {auditReport.inventory.length === 0 ? (
                            <div className="text-[11px] text-neutral-500 py-1">No markdown files found.</div>
                          ) : (
                            auditReport.inventory.map((doc) => (
                              <button
                                key={doc.fileId}
                                onClick={() => onOpenProject(workspace, doc.fileId)}
                                className="w-full text-left flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-[#191919] hover:bg-[#27272a] border border-[#2a2a2a] transition group"
                                title={doc.issues[0] || doc.path}
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  <FileText className="w-3 h-3 text-neutral-400 shrink-0" />
                                  <span className="text-[11px] font-mono text-neutral-200 truncate">{doc.path}</span>
                                </div>
                                <div className="flex items-center gap-1.5 shrink-0">
                                  <DocPassportBadge item={doc} size="xs" />
                                  <ExternalLink className="w-3 h-3 text-neutral-500 group-hover:text-white" />
                                </div>
                              </button>
                            ))
                          )}
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => toggleCardFiles(workspace.rootPath)}
                        aria-expanded={Boolean(expandedCards[workspace.rootPath])}
                        className="py-2 px-3 rounded-lg bg-[#252525] hover:bg-[#2f2f2f] border border-[#353535] text-xs font-medium text-neutral-300 hover:text-white flex items-center gap-1.5 transition shrink-0"
                        title="Preview and open files directly"
                      >
                        {expandedCards[workspace.rootPath] ? (
                          <ChevronUp className="w-3.5 h-3.5" />
                        ) : (
                          <ChevronDown className="w-3.5 h-3.5" />
                        )}
                        <span>Files ({auditReport.inventory.length})</span>
                      </button>

                      <button
                        onClick={() => onOpenProject(workspace)}
                        className="flex-1 py-2 px-3 rounded-lg bg-[#282828] hover:bg-indigo-500/20 border border-[#363636] hover:border-indigo-500/40 text-xs font-medium text-neutral-200 hover:text-white flex items-center justify-center gap-1.5 transition"
                      >
                        <span>Open Project Audit</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
