import React, { useMemo, useState } from 'react';
import {
  FolderSearch,
  RefreshCw,
  Search,
  ShieldCheck,
  AlertTriangle,
  Cpu,
  FileText,
  Copy,
  FilePlus2,
  ArrowRight,
  FolderGit2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
} from 'lucide-react';
import { PortfolioProjectSummary } from '../../types/docAudit';
import { ProjectWorkspace } from '../../types/document';

interface PortfolioViewProps {
  portfolioRootPath: string | null;
  currentWorkspaceRoot: string | null;
  projects: PortfolioProjectSummary[];
  scanning: boolean;
  onScanPortfolioRoot: () => void;
  onScanCurrentWorkspaceRoot: () => void;
  onRefreshPortfolio: () => void;
  onOpenProject: (workspace: ProjectWorkspace, targetFileId?: string) => void;
}

type PortfolioFilter = 'all' | 'attention' | 'duplicates' | 'missing' | 'sdk-drift';

export const PortfolioView: React.FC<PortfolioViewProps> = ({
  portfolioRootPath,
  currentWorkspaceRoot,
  projects,
  scanning,
  onScanPortfolioRoot,
  onScanCurrentWorkspaceRoot,
  onRefreshPortfolio,
  onOpenProject,
}) => {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<PortfolioFilter>('all');
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
    const withSdkDrift = projects.filter((p) =>
      p.auditReport.stackProfile.dependencies.some(
        (d) => d.severity === 'critical' || d.severity === 'outdated'
      )
    ).length;
    return { total, avgScore, withDuplicates, withSdkDrift };
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
      if (filter === 'sdk-drift') {
        return auditReport.stackProfile.dependencies.some(
          (d) => d.severity === 'critical' || d.severity === 'outdated'
        );
      }
      if (filter === 'attention') {
        return (
          auditReport.healthScore < 80 ||
          auditReport.counts.duplicate > 0 ||
          auditReport.missingDocs.length > 0
        );
      }
      return true;
    });
  }, [projects, query, filter]);

  return (
    <div className="flex-1 overflow-y-auto bg-[#191919] text-neutral-100">
      {/* Header */}
      <div className="border-b border-[#2a2a2a] bg-[#1e1e1e] px-8 py-6">
        <div className="max-w-5xl mx-auto flex flex-col gap-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-xl font-bold text-white flex items-center gap-2.5">
                <FolderGit2 className="w-6 h-6 text-indigo-400" />
                <span>Projects Portfolio Scanner</span>
              </h1>
              <p className="text-xs text-neutral-400 mt-1">
                {portfolioRootPath ? (
                  <>
                    Root directory: <span className="font-mono text-neutral-200">{portfolioRootPath}</span>
                  </>
                ) : (
                  'Point to a root folder containing multiple projects (e.g. C:\\Prj) to audit all docs and tech stacks at once.'
                )}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {currentWorkspaceRoot && portfolioRootPath !== currentWorkspaceRoot && (
                <button
                  onClick={onScanCurrentWorkspaceRoot}
                  disabled={scanning}
                  className="px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-2 transition disabled:opacity-50"
                >
                  <FolderSearch className="w-4 h-4" />
                  <span>Scan Current Folder</span>
                </button>
              )}
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
                <span>{scanning ? 'Scanning Projects...' : 'Choose Root Folder...'}</span>
              </button>
            </div>
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
                <div className="text-xl font-bold text-emerald-300 mt-0.5">{stats.avgScore}/100</div>
              </div>
              <div className="p-3.5 rounded-xl bg-[#252525] border border-[#303030]">
                <div className="text-[11px] text-neutral-400">With Duplicate Docs</div>
                <div className="text-xl font-bold text-orange-300 mt-0.5">{stats.withDuplicates}</div>
              </div>
              <div className="p-3.5 rounded-xl bg-[#252525] border border-[#303030]">
                <div className="text-[11px] text-neutral-400">With SDK Drift</div>
                <div className="text-xl font-bold text-amber-300 mt-0.5">{stats.withSdkDrift}</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="max-w-5xl mx-auto p-8 space-y-6">
        {projects.length === 0 ? (
          <div className="p-12 rounded-2xl border border-dashed border-[#303030] bg-[#1d1d1d] text-center space-y-4">
            <FolderSearch className="w-10 h-10 text-indigo-400 mx-auto opacity-80" />
            <div className="space-y-1">
              <h2 className="text-sm font-semibold text-neutral-100">
                No Portfolio Root Scanned Yet
              </h2>
              <p className="text-xs text-neutral-400 max-w-md mx-auto">
                Click <strong>Scan Projects Root Folder</strong> above and select a parent folder like{' '}
                <code className="font-mono text-neutral-200">C:\Prj</code> to list all your projects with
                their documentation health scores, missing docs, duplicates, and tech stack status.
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2.5">
              {currentWorkspaceRoot && (
                <button
                  onClick={onScanCurrentWorkspaceRoot}
                  disabled={scanning}
                  className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold inline-flex items-center gap-2 transition"
                >
                  <FolderSearch className="w-4 h-4" />
                  <span>Scan {currentWorkspaceRoot}</span>
                </button>
              )}
              <button
                onClick={onScanPortfolioRoot}
                disabled={scanning}
                className="px-4 py-2 rounded-lg bg-indigo-500 hover:bg-indigo-600 text-white text-xs font-semibold inline-flex items-center gap-2 transition"
              >
                <FolderSearch className="w-4 h-4" />
                <span>Choose Root Folder...</span>
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Search & Filters */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="relative flex-1 max-w-sm">
                <Search className="w-3.5 h-3.5 text-neutral-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Filter by project name or framework..."
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
              </div>
            </div>

            {/* Project Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filtered.map(({ workspace, auditReport }) => {
                const brokenCount = auditReport.inventory.reduce(
                  (acc, i) => acc + i.brokenLinks.length,
                  0
                );
                const driftCount = auditReport.stackProfile.dependencies.filter(
                  (d) => d.severity === 'critical' || d.severity === 'outdated'
                ).length;

                return (
                  <div
                    key={workspace.rootPath}
                    className="p-5 rounded-xl bg-[#202020] border border-[#2d2d2d] hover:border-indigo-500/50 transition flex flex-col justify-between gap-4"
                  >
                    <div className="space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="text-sm font-bold text-white truncate">{workspace.name}</h3>
                          <p className="text-[11px] font-mono text-neutral-500 truncate mt-0.5">
                            {workspace.rootPath}
                          </p>
                        </div>

                        <div
                          className={`px-2.5 py-1 rounded-lg border text-xs font-bold shrink-0 ${
                            auditReport.grade === 'A'
                              ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                              : auditReport.grade === 'B'
                                ? 'bg-sky-500/15 border-sky-500/40 text-sky-300'
                                : auditReport.grade === 'C'
                                  ? 'bg-amber-500/15 border-amber-500/40 text-amber-300'
                                  : 'bg-rose-500/15 border-rose-500/40 text-rose-300'
                          }`}
                        >
                          {auditReport.grade} • {auditReport.healthScore}
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
                              Expo SDK {auditReport.stackProfile.expoSdkVersion}
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
                          <span className="flex items-center gap-1 text-amber-300">
                            <FilePlus2 className="w-3 h-3" />
                            {auditReport.missingDocs.length} missing
                          </span>
                        )}
                        {auditReport.counts.duplicate > 0 && (
                          <span className="flex items-center gap-1 text-orange-300">
                            <Copy className="w-3 h-3" />
                            {auditReport.counts.duplicate} duplicates
                          </span>
                        )}
                        {brokenCount > 0 && (
                          <span className="flex items-center gap-1 text-rose-300">
                            <AlertTriangle className="w-3 h-3" />
                            {brokenCount} broken links
                          </span>
                        )}
                        {driftCount > 0 && (
                          <span className="flex items-center gap-1 text-amber-300">
                            <ShieldCheck className="w-3 h-3" />
                            {driftCount} outdated SDKs
                          </span>
                        )}
                      </div>

                      {/* Expandable Inline File List */}
                      {expandedCards[workspace.rootPath] && (
                        <div className="mt-2 pt-2.5 border-t border-[#2d2d2d] space-y-1 max-h-48 overflow-y-auto">
                          {auditReport.inventory.length === 0 ? (
                            <div className="text-[11px] text-neutral-500 py-1">No markdown files found.</div>
                          ) : (
                            auditReport.inventory.map((doc) => (
                              <div
                                key={doc.fileId}
                                onClick={() => onOpenProject(workspace, doc.fileId)}
                                className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-[#191919] hover:bg-[#27272a] border border-[#2a2a2a] cursor-pointer transition group"
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  <FileText className="w-3 h-3 text-neutral-400 shrink-0" />
                                  <span className="text-[11px] font-mono text-neutral-200 truncate">
                                    {doc.path}
                                  </span>
                                </div>
                                <div className="flex items-center gap-1.5 shrink-0">
                                  <span
                                    className={`text-[9px] font-medium px-1.5 py-0.5 rounded border uppercase ${
                                      doc.status === 'duplicate'
                                        ? 'bg-orange-500/15 text-orange-300 border-orange-500/30'
                                        : doc.status === 'stale'
                                          ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                                          : doc.status === 'canonical'
                                            ? 'bg-sky-500/15 text-sky-300 border-sky-500/30'
                                            : doc.status === 'orphan'
                                              ? 'bg-zinc-500/15 text-zinc-300 border-zinc-500/30'
                                              : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                                    }`}
                                  >
                                    {doc.isScopedModuleDoc ? 'Module Doc' : doc.status}
                                  </span>
                                  <ExternalLink className="w-3 h-3 text-neutral-500 group-hover:text-white" />
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => toggleCardFiles(workspace.rootPath)}
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
