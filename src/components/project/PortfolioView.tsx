import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  ChevronDown,
  ChevronUp,
  Clock,
  Copy,
  ExternalLink,
  FilePlus2,
  FileInput,
  FileText,
  FolderGit2,
  FolderPlus,
  FolderSearch,
  Gauge,
  Layers3,
  Monitor,
  NotebookPen,
  Radar,
  RefreshCw,
  Search,
  ShieldAlert,
  Smartphone,
  Unlink,
  X,
} from 'lucide-react';
import type { FreshnessIssue, PortfolioProjectSummary, StackFreshnessReport } from '../../types/docAudit';
import type { ProjectWorkspace } from '../../types/document';
import { DocPassportBadge, GRADE_CLASS } from './docPassport';
import { DocAtlasMark } from '../brand/BrandMarks';
import { assessStackFreshness, issueWeight } from '../../services/stackFreshness';
import { FreshnessBadge, StackFreshnessPanel, timeAgo } from './StackFreshnessPanel';
import { parseSemverMajor } from '../../services/stackInspector';

interface PortfolioViewProps {
  roots: string[];
  savedAt: string | null;
  /** Parent folder of the active local project (e.g. C:\Prj for C:\Prj\app), offered as a one-click root. */
  currentWorkspaceParent: string | null;
  activeProjectRoot: string;
  projects: PortfolioProjectSummary[];
  scanning: boolean;
  refreshing: boolean;
  rescanningProjectRoot: string | null;
  isDesktop: boolean;
  onAddRoot: () => void;
  onScanCurrentWorkspaceParent: () => void;
  onRefreshPortfolio: () => void;
  onRemoveRoot: (root: string) => void;
  onRescanProject: (rootPath: string) => void;
  onOpenProject: (workspace: ProjectWorkspace, targetFileId?: string) => void;
  /** Notes outside any project (desktop only). */
  onNewNote?: () => void;
  onOpenMarkdownFile?: () => void;
}

type PortfolioTab = 'projects' | 'stack';
type PortfolioFilter = 'all' | 'at-risk' | 'upgrades' | 'expo' | 'docs';
type PortfolioSort = 'risk' | 'docs' | 'name';

const PREFS_KEY = 'docatlas_portfolio_prefs_v1';
const LEVEL_RANK: Record<StackFreshnessReport['level'], number> = { critical: 0, stale: 1, aging: 2, unchecked: 3, fresh: 4, none: 5 };
const ISSUE_DOT: Record<FreshnessIssue['severity'], string> = { critical: 'bg-rose-400', outdated: 'bg-amber-400', minor: 'bg-sky-400' };
const ISSUE_CHIP: Record<FreshnessIssue['severity'], string> = {
  critical: 'bg-rose-500/10 text-rose-200 border-rose-500/25',
  outdated: 'bg-amber-500/10 text-amber-200 border-amber-500/25',
  minor: 'bg-sky-500/10 text-sky-200 border-sky-500/20',
};

/** Packages shown in the cross-project version matrix, in display order. */
const MATRIX_PACKAGES: Array<{ name: string; label: string }> = [
  { name: 'expo', label: 'Expo SDK' },
  { name: 'react-native', label: 'React Native' },
  { name: 'next', label: 'Next.js' },
  { name: 'electron', label: 'Electron' },
  { name: 'react', label: 'React' },
  { name: 'vite', label: 'Vite' },
  { name: 'tailwindcss', label: 'Tailwind CSS' },
  { name: 'typescript', label: 'TypeScript' },
  { name: '@supabase/supabase-js', label: 'Supabase JS' },
  { name: 'firebase', label: 'Firebase' },
  { name: 'fastapi', label: 'FastAPI' },
];

function readPrefs(): { tab: PortfolioTab; filter: PortfolioFilter; sort: PortfolioSort } {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
    return {
      tab: raw.tab === 'stack' ? 'stack' : 'projects',
      filter: ['all', 'at-risk', 'upgrades', 'expo', 'docs'].includes(raw.filter) ? raw.filter : 'all',
      sort: ['risk', 'docs', 'name'].includes(raw.sort) ? raw.sort : 'risk',
    };
  } catch {
    return { tab: 'projects', filter: 'all', sort: 'risk' };
  }
}

function docNeedsAttention(p: PortfolioProjectSummary): boolean {
  const r = p.auditReport;
  return r.healthScore < 70 || r.counts.duplicate > 0 || r.missingDocs.some((m) => m.priority === 'critical');
}

export const PortfolioView: React.FC<PortfolioViewProps> = ({
  roots,
  savedAt,
  currentWorkspaceParent,
  activeProjectRoot,
  projects,
  scanning,
  refreshing,
  rescanningProjectRoot,
  isDesktop,
  onAddRoot,
  onScanCurrentWorkspaceParent,
  onRefreshPortfolio,
  onRemoveRoot,
  onRescanProject,
  onOpenProject,
  onNewNote,
  onOpenMarkdownFile,
}) => {
  const initial = useMemo(readPrefs, []);
  const [tab, setTab] = useState<PortfolioTab>(initial.tab);
  const [filter, setFilter] = useState<PortfolioFilter>(initial.filter);
  const [sortBy, setSortBy] = useState<PortfolioSort>(initial.sort);
  const [query, setQuery] = useState('');
  const [expandedCards, setExpandedCards] = useState<Record<string, boolean>>({});
  const [detailRoot, setDetailRoot] = useState<string | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ tab, filter, sort: sortBy }));
    } catch {
      // ignore
    }
  }, [tab, filter, sortBy]);

  useEffect(() => {
    if (!detailRoot) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDetailRoot(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [detailRoot]);

  const freshness = useMemo(() => {
    const map = new Map<string, StackFreshnessReport>();
    for (const p of projects) map.set(p.workspace.rootPath, assessStackFreshness(p.auditReport.stackProfile));
    return map;
  }, [projects]);
  const fr = (p: PortfolioProjectSummary) => freshness.get(p.workspace.rootPath)!;

  const stats = useMemo(() => {
    const total = projects.length;
    const avgScore = total ? Math.round(projects.reduce((a, p) => a + p.auditReport.healthScore, 0) / total) : 0;
    const avgGrade = avgScore >= 85 ? 'A' : avgScore >= 70 ? 'B' : avgScore >= 50 ? 'C' : 'D';
    const reports = projects.map(fr);
    const atRisk = reports.filter((r) => r.level === 'critical').length;
    const stale = reports.filter((r) => r.level === 'stale').length;
    const aging = reports.filter((r) => r.level === 'aging').length;
    const checking = reports.filter((r) => r.level === 'unchecked').length;
    const apps = projects.reduce((a, p) => a + Math.max(1, (p.auditReport.stackProfile.apps || []).length), 0);
    const expoApps = projects.flatMap((p) =>
      (p.auditReport.stackProfile.apps || []).filter((a) => a.expoSdkVersion).map((a) => ({ project: p, app: a }))
    );
    const latestSdk = projects
      .flatMap((p) => p.auditReport.stackProfile.dependencies)
      .filter((d) => d.name === 'expo' && d.latestMajor != null)
      .map((d) => d.latestMajor as number)[0];
    const expoBehind = latestSdk
      ? expoApps.filter(({ app }) => (parseSemverMajor(app.expoSdkVersion) ?? latestSdk) < latestSdk).length
      : 0;
    const upgrades = reports.reduce((a, r) => a + r.issues.filter((i) => i.severity !== 'minor').length, 0);
    const docAttention = projects.filter(docNeedsAttention).length;
    return { total, avgScore, avgGrade, atRisk, stale, aging, checking, apps, expoApps: expoApps.length, latestSdk, expoBehind, upgrades, docAttention };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects, freshness]);

  /** The most damaging platform problems across every project: the "what will bite me next" strip. */
  const radar = useMemo(() => {
    const items: Array<{ project: PortfolioProjectSummary; issue: FreshnessIssue }> = [];
    for (const p of projects) {
      for (const issue of fr(p).issues) {
        if (issue.tier === 'platform' && issue.severity !== 'minor') items.push({ project: p, issue });
      }
    }
    return items.sort((a, b) => issueWeight(b.issue) - issueWeight(a.issue)).slice(0, 8);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects, freshness]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return projects
      .filter((p) => {
        const r = fr(p);
        if (q) {
          const hay = `${p.workspace.name} ${p.workspace.rootPath} ${p.auditReport.stackProfile.frameworks.join(' ')} ${r.issues
            .map((i) => i.title)
            .join(' ')}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        if (filter === 'at-risk') return r.level === 'critical' || r.level === 'stale';
        if (filter === 'upgrades') return r.issues.some((i) => i.severity !== 'minor');
        if (filter === 'expo') return (p.auditReport.stackProfile.apps || []).some((a) => a.expoSdkVersion);
        if (filter === 'docs') return docNeedsAttention(p);
        return true;
      })
      .sort((a, b) => {
        if (sortBy === 'name') return a.workspace.name.localeCompare(b.workspace.name);
        if (sortBy === 'docs') return a.auditReport.healthScore - b.auditReport.healthScore || a.workspace.name.localeCompare(b.workspace.name);
        const ra = fr(a);
        const rb = fr(b);
        return (
          LEVEL_RANK[ra.level] - LEVEL_RANK[rb.level] ||
          (ra.score ?? 101) - (rb.score ?? 101) ||
          a.workspace.name.localeCompare(b.workspace.name)
        );
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects, freshness, query, filter, sortBy]);

  const matrix = useMemo(() => {
    return MATRIX_PACKAGES.map(({ name, label }) => {
      const rows = projects.flatMap((p) =>
        p.auditReport.stackProfile.dependencies
          .filter((d) => d.name === name)
          .map((d) => ({ project: p, dep: d }))
      );
      const latest = rows.find((r) => r.dep.latestVersion)?.dep.latestVersion;
      const behind = rows.filter((r) => r.dep.severity === 'critical' || r.dep.severity === 'outdated').length;
      rows.sort((a, b) => (a.dep.currentMajor ?? 0) - (b.dep.currentMajor ?? 0) || a.project.workspace.name.localeCompare(b.project.workspace.name));
      return { name, label, latest, behind, rows };
    }).filter((g) => g.rows.length > 0);
  }, [projects]);

  const detail = detailRoot ? projects.find((p) => p.workspace.rootPath === detailRoot) : undefined;
  const busy = scanning || refreshing;

  const scanParentButton = currentWorkspaceParent && !roots.some((r) => r.toLowerCase() === currentWorkspaceParent.toLowerCase()) && (
    <button
      onClick={onScanCurrentWorkspaceParent}
      disabled={busy}
      className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-2 transition disabled:opacity-50"
      title="Scan the folder that contains the current project"
    >
      <FolderSearch className="w-4 h-4" />
      <span className="truncate max-w-[220px]">Scan {currentWorkspaceParent}</span>
    </button>
  );

  // Writing that doesn't belong to a project starts here too, without leaving the landing page.
  const noteButtons = (onNewNote || onOpenMarkdownFile) && (
    <div className="flex items-center rounded-xl border border-[#363636] bg-[#262626] overflow-hidden">
      {onNewNote && (
        <button
          onClick={onNewNote}
          className="px-3 py-2 hover:bg-[#303030] text-xs font-medium text-neutral-200 flex items-center gap-1.5 transition"
          title="New note outside any project (Ctrl+N)"
        >
          <NotebookPen className="w-3.5 h-3.5 text-sky-400" />
          <span>New note</span>
        </button>
      )}
      {onNewNote && onOpenMarkdownFile && <div className="w-px self-stretch bg-[#363636]" />}
      {onOpenMarkdownFile && (
        <button
          onClick={onOpenMarkdownFile}
          className="px-2.5 py-2 hover:bg-[#303030] text-neutral-300 transition"
          title="Open any Markdown file (Ctrl+O)"
          aria-label="Open a Markdown file"
        >
          <FileInput className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );

  // ---------------------------------------------------------------------------
  // Empty / browser states
  // ---------------------------------------------------------------------------
  if (!isDesktop || projects.length === 0) {
    return (
      <div className="h-full overflow-y-auto bg-[#191919] text-neutral-100">
        <div className="max-w-3xl mx-auto px-6 py-16">
          <div className="rounded-2xl border border-[#2d2d2d] bg-gradient-to-b from-[#202020] to-[#1a1a1a] p-10 text-center space-y-6">
            {isDesktop && !busy ? (
              <DocAtlasMark className="w-14 h-14 mx-auto drop-shadow" />
            ) : (
              <div className="w-14 h-14 rounded-2xl bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 flex items-center justify-center mx-auto">
                {isDesktop ? <Radar className="w-7 h-7 animate-spin" /> : <Monitor className="w-7 h-7" />}
              </div>
            )}
            <div className="space-y-2">
              <h1 className="text-xl font-bold text-white">
                {!isDesktop ? 'DocAtlas runs in the desktop app' : busy ? 'Scanning your projects…' : 'See every project at a glance'}
              </h1>
              <p className="text-sm text-neutral-400 max-w-lg mx-auto leading-relaxed">
                {!isDesktop ? (
                  <>
                    Browsers can only open one folder at a time, so the portfolio needs the Electron build:{' '}
                    <code className="font-mono text-neutral-200">npm run build &amp;&amp; npm start</code>. You can still open a single
                    project here and use its audit on the Project Overview page.
                  </>
                ) : (
                  <>
                    Pick the folder that holds your projects (for example <code className="font-mono text-neutral-200">C:\Prj</code>).
                    DocAtlas checks each one's Expo SDK, frameworks and Node/Python versions against the live registries, and grades its
                    documentation. Results are remembered, so next time this page opens instantly.
                  </>
                )}
              </p>
            </div>
            {isDesktop && (
              <div className="flex flex-wrap items-center justify-center gap-2.5">
                {scanParentButton}
                <button
                  onClick={onAddRoot}
                  disabled={busy}
                  className="px-4 py-2 rounded-xl bg-indigo-500 hover:bg-indigo-600 text-white text-xs font-semibold inline-flex items-center gap-2 transition disabled:opacity-50"
                >
                  <FolderPlus className="w-4 h-4" />
                  <span>{busy ? 'Scanning…' : 'Choose a projects folder…'}</span>
                </button>
                {noteButtons}
              </div>
            )}
            {isDesktop && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 text-left">
                {[
                  { Icon: Smartphone, title: 'Will it still run?', text: 'Expo SDK, React Native, Next.js and Electron versions vs the latest release.' },
                  { Icon: ShieldAlert, title: 'End-of-life runtimes', text: 'Node and Python pins in .nvmrc, engines, Dockerfile and pyproject.' },
                  { Icon: FileText, title: 'Doc health', text: 'Duplicates, stale and orphan docs, broken links and missing READMEs.' },
                ].map(({ Icon, title, text }) => (
                  <div key={title} className="p-3.5 rounded-xl bg-[#1d1d1d] border border-[#2a2a2a]">
                    <Icon className="w-4 h-4 text-indigo-300 mb-2" />
                    <div className="text-xs font-semibold text-neutral-100">{title}</div>
                    <p className="text-[11px] text-neutral-500 mt-1 leading-relaxed">{text}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Main view
  // ---------------------------------------------------------------------------
  const kpis: Array<{
    key: string;
    label: string;
    value: React.ReactNode;
    sub: string;
    Icon: React.FC<{ className?: string }>;
    accent: string;
    onClick: () => void;
    active: boolean;
  }> = [
    {
      key: 'projects',
      label: 'Projects',
      value: stats.total,
      sub: `${stats.apps} app${stats.apps === 1 ? '' : 's'} · ${roots.length} folder${roots.length === 1 ? '' : 's'}`,
      Icon: FolderGit2,
      accent: 'text-indigo-300',
      onClick: () => {
        setTab('projects');
        setFilter('all');
      },
      active: tab === 'projects' && filter === 'all',
    },
    {
      key: 'risk',
      label: 'Stack at risk',
      value: <span className={stats.atRisk ? 'text-rose-300' : 'text-emerald-300'}>{stats.atRisk}</span>,
      sub: stats.checking ? `checking ${stats.checking} project${stats.checking === 1 ? '' : 's'}…` : `${stats.stale} stale · ${stats.aging} aging`,
      Icon: ShieldAlert,
      accent: 'text-rose-300',
      onClick: () => {
        setTab('projects');
        setFilter('at-risk');
        setSortBy('risk');
      },
      active: tab === 'projects' && filter === 'at-risk',
    },
    stats.expoApps > 0
      ? {
          key: 'expo',
          label: 'Expo apps',
          value: stats.expoApps,
          sub: stats.latestSdk
            ? stats.expoBehind
              ? `${stats.expoBehind} behind SDK ${stats.latestSdk}`
              : `all on SDK ${stats.latestSdk}`
            : 'checking latest SDK…',
          Icon: Smartphone,
          accent: stats.expoBehind ? 'text-amber-300' : 'text-emerald-300',
          onClick: () => {
            setTab('projects');
            setFilter('expo');
          },
          active: tab === 'projects' && filter === 'expo',
        }
      : {
          key: 'upgrades',
          label: 'Upgrades waiting',
          value: stats.upgrades,
          sub: 'majors behind or end-of-life',
          Icon: Layers3,
          accent: 'text-amber-300',
          onClick: () => setTab('stack'),
          active: tab === 'stack',
        },
    {
      key: 'docs',
      label: 'Doc health',
      value: (
        <span className="flex items-baseline gap-2">
          <span className={`px-1.5 rounded border text-base ${GRADE_CLASS[stats.avgGrade as 'A']}`}>{stats.avgGrade}</span>
          <span>{stats.avgScore}</span>
        </span>
      ),
      sub: `${stats.docAttention} project${stats.docAttention === 1 ? '' : 's'} need attention`,
      Icon: FileText,
      accent: 'text-sky-300',
      onClick: () => {
        setTab('projects');
        setFilter('docs');
        setSortBy('docs');
      },
      active: tab === 'projects' && filter === 'docs',
    },
  ];

  return (
    <div className="h-full overflow-y-auto bg-[#191919] text-neutral-100">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-5">
        {/* Header */}
        <div className="rounded-2xl border border-[#2d2d2d] bg-[#1e1e1e] p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-start gap-3.5 min-w-0">
            <DocAtlasMark className="w-11 h-11 drop-shadow" />
            <div className="min-w-0 space-y-1.5">
              <h1 className="text-lg font-bold text-white leading-tight">DocAtlas</h1>
              <div className="flex flex-wrap items-center gap-1.5">
                {roots.map((root) => (
                  <span
                    key={root}
                    className="group inline-flex items-center gap-1 text-[11px] font-mono pl-2 pr-1 py-0.5 rounded-md bg-[#262626] border border-[#333] text-neutral-300"
                  >
                    {root}
                    <button
                      type="button"
                      onClick={() => onRemoveRoot(root)}
                      className="p-0.5 rounded text-neutral-500 hover:text-rose-300 hover:bg-rose-500/10 transition"
                      aria-label={`Remove ${root} from the portfolio`}
                      title="Remove folder"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
                <span className="text-[11px] text-neutral-500 flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {refreshing ? 'Refreshing in the background…' : `Scanned ${timeAgo(savedAt)}`}
                </span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <div className="relative w-full sm:w-64">
              <Search className="w-3.5 h-3.5 text-neutral-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Project, framework or package…"
                aria-label="Filter projects"
                className="w-full pl-8 pr-3 py-2 rounded-xl bg-[#161616] border border-[#333] text-xs text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:border-indigo-500"
              />
            </div>
            {noteButtons}
            {scanParentButton}
            <button
              onClick={onRefreshPortfolio}
              disabled={busy}
              className="px-3 py-2 rounded-xl bg-[#262626] hover:bg-[#303030] border border-[#363636] text-xs font-medium text-neutral-200 flex items-center gap-1.5 transition disabled:opacity-50"
              title="Rescan every folder from disk and recheck the registries"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin text-indigo-300' : ''}`} />
              <span>Rescan</span>
            </button>
            <button
              onClick={onAddRoot}
              disabled={busy}
              className="px-3 py-2 rounded-xl bg-indigo-500 hover:bg-indigo-600 text-white text-xs font-semibold flex items-center gap-1.5 transition disabled:opacity-50"
            >
              <FolderPlus className="w-3.5 h-3.5" />
              <span>Add folder</span>
            </button>
          </div>
        </div>

        {/* KPI tiles */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {kpis.map((k) => (
            <button
              key={k.key}
              type="button"
              onClick={k.onClick}
              className={`text-left rounded-2xl border p-4 transition ${
                k.active ? 'bg-[#232330] border-indigo-500/40' : 'bg-[#1e1e1e] border-[#2d2d2d] hover:bg-[#232323] hover:border-[#3a3a3a]'
              }`}
            >
              <div className="flex items-center justify-between text-[11px] text-neutral-400 mb-1">
                <span>{k.label}</span>
                <k.Icon className={`w-4 h-4 ${k.accent}`} />
              </div>
              <div className="text-2xl font-bold text-white font-mono">{k.value}</div>
              <div className="text-[11px] text-neutral-500 mt-1 truncate">{k.sub}</div>
            </button>
          ))}
        </div>

        {/* Upgrade radar */}
        <div className="rounded-2xl border border-[#2d2d2d] bg-[#1e1e1e] p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Gauge className={`w-4 h-4 ${radar.length ? 'text-amber-300' : 'text-emerald-300'}`} />
              <span className="text-xs font-bold uppercase tracking-wider text-neutral-200">Upgrade radar</span>
              <span
                className={`text-[11px] font-mono px-2 py-0.5 rounded-full border ${
                  radar.length ? 'bg-amber-500/10 text-amber-200 border-amber-500/30' : 'bg-emerald-500/10 text-emerald-200 border-emerald-500/30'
                }`}
              >
                {radar.length ? `${radar.length} platform upgrade${radar.length === 1 ? '' : 's'} first` : 'nothing blocking'}
              </span>
            </div>
            <span className="text-[11px] text-neutral-500">SDKs, frameworks and runtimes that decide whether a project still starts</span>
          </div>
          {radar.length === 0 ? (
            <p className="text-xs text-neutral-500">
              {stats.checking ? 'Comparing versions with npm and PyPI…' : 'Every Expo SDK, framework and runtime pin is on a supported version.'}
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {radar.map(({ project, issue }) => (
                <button
                  key={`${project.workspace.rootPath}:${issue.id}`}
                  type="button"
                  onClick={() => setDetailRoot(project.workspace.rootPath)}
                  className="px-3 py-1.5 rounded-xl bg-[#171717] hover:bg-[#232323] border border-[#2f2f2f] hover:border-[#444] text-xs flex items-center gap-2 transition max-w-full"
                  title={issue.detail}
                >
                  <span className={`w-2 h-2 rounded-full shrink-0 ${ISSUE_DOT[issue.severity]}`} />
                  <span className="font-semibold text-neutral-100 shrink-0">{project.workspace.name}</span>
                  <span className="text-neutral-400 truncate">{issue.title}</span>
                  <ArrowUpRight className="w-3 h-3 text-neutral-500 shrink-0" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Tabs + filters */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="inline-flex p-1 rounded-xl bg-[#1e1e1e] border border-[#2d2d2d]">
            {(
              [
                ['projects', 'Projects', FolderGit2],
                ['stack', 'Stack versions', Layers3],
              ] as Array<[PortfolioTab, string, React.FC<{ className?: string }>]>
            ).map(([key, label, Icon]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap flex items-center gap-1.5 transition ${
                  tab === key ? 'bg-[#2a2a35] text-white' : 'text-neutral-400 hover:text-neutral-200'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
              </button>
            ))}
          </div>

          {tab === 'projects' && (
            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  ['all', 'All'],
                  ['at-risk', 'At risk'],
                  ['upgrades', 'Needs upgrades'],
                  ['expo', 'Expo'],
                  ['docs', 'Doc issues'],
                ] as Array<[PortfolioFilter, string]>
              ).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setFilter(key)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border transition ${
                    filter === key ? 'bg-indigo-500/20 text-indigo-200 border-indigo-500/40' : 'bg-[#1e1e1e] text-neutral-400 border-[#2f2f2f] hover:text-neutral-200'
                  }`}
                >
                  {label}
                </button>
              ))}
              <span className="w-px h-4 bg-[#333] mx-1" />
              <label className="text-[11px] text-neutral-500 flex items-center gap-1.5">
                Sort
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as PortfolioSort)}
                  className="px-2 py-1 rounded-lg bg-[#1e1e1e] border border-[#2f2f2f] text-[11px] text-neutral-200 focus:outline-none focus:border-indigo-500"
                >
                  <option value="risk">Stack risk</option>
                  <option value="docs">Doc health</option>
                  <option value="name">Name</option>
                </select>
              </label>
            </div>
          )}
        </div>

        {tab === 'projects' ? (
          <>
            {filtered.length === 0 && (
              <div className="p-8 rounded-2xl border border-dashed border-[#2d2d2d] text-center text-xs text-neutral-500">
                No projects match {query ? `“${query}”` : 'this filter'}.
              </div>
            )}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {filtered.map((item) => {
                const { workspace, auditReport, scannedAt } = item;
                const report = fr(item);
                const brokenCount = auditReport.inventory.reduce((acc, i) => acc + i.brokenLinks.length, 0);
                const isActive = workspace.rootPath === activeProjectRoot;
                const topIssues = report.issues.slice(0, 3);
                const rescanning = rescanningProjectRoot === workspace.rootPath;
                const frameworks = auditReport.stackProfile.frameworks.filter((f) => f !== 'TypeScript');

                return (
                  <div
                    key={workspace.rootPath}
                    className={`rounded-2xl bg-[#1e1e1e] border p-5 flex flex-col gap-4 transition ${
                      isActive ? 'border-indigo-500/50' : 'border-[#2d2d2d] hover:border-[#3d3d4d]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <button type="button" onClick={() => onOpenProject(workspace)} className="min-w-0 text-left group">
                        <h3 className="text-[15px] font-bold text-white flex items-center gap-2">
                          <span className="truncate group-hover:text-indigo-300 transition">{workspace.name}</span>
                          <ArrowUpRight className="w-3.5 h-3.5 text-neutral-500 group-hover:text-indigo-300 shrink-0" />
                          {isActive && (
                            <span className="text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 shrink-0">
                              Open
                            </span>
                          )}
                        </h3>
                        <p className="text-[11px] font-mono text-neutral-500 truncate mt-0.5">
                          {workspace.rootPath}
                          {scannedAt && <span className="font-sans"> · scanned {timeAgo(scannedAt)}</span>}
                        </p>
                      </button>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button type="button" onClick={() => setDetailRoot(workspace.rootPath)} title="Stack freshness details">
                          <FreshnessBadge report={report} size="md" />
                        </button>
                        <span
                          className={`px-2 py-1 rounded-lg border text-xs font-bold ${GRADE_CLASS[auditReport.grade]}`}
                          title={`Documentation health ${auditReport.healthScore}/100`}
                        >
                          <FileText className="w-3 h-3 inline -mt-0.5 mr-1 opacity-70" />
                          {auditReport.grade}
                        </span>
                      </div>
                    </div>

                    {frameworks.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5">
                        {(auditReport.stackProfile.apps || [])
                          .filter((a) => a.expoSdkVersion)
                          .map((a) => (
                            <span
                              key={`sdk:${a.path}`}
                              className="text-[10px] px-2 py-0.5 rounded-md bg-indigo-500/15 text-indigo-200 border border-indigo-500/30 font-mono"
                            >
                              {a.path ? `${a.path}/ ` : ''}Expo SDK {parseInt(a.expoSdkVersion!, 10)}
                            </span>
                          ))}
                        {frameworks.slice(0, 6).map((fw) => (
                          <span key={fw} className="text-[10px] px-2 py-0.5 rounded-md bg-[#262626] text-neutral-300 border border-[#333]">
                            {fw}
                          </span>
                        ))}
                        {frameworks.length > 6 && <span className="text-[10px] text-neutral-500">+{frameworks.length - 6}</span>}
                      </div>
                    )}

                    {/* What to fix first */}
                    <div className="space-y-1.5">
                      {report.level === 'none' ? (
                        <p className="text-[11px] text-neutral-500">No package manifests: docs-only project.</p>
                      ) : topIssues.length === 0 ? (
                        <p className="text-[11px] text-emerald-300/90">
                          {report.level === 'unchecked' ? 'Checking versions against npm / PyPI…' : 'Stack is current: nothing to upgrade.'}
                        </p>
                      ) : (
                        topIssues.map((issue) => (
                          <button
                            key={issue.id}
                            type="button"
                            onClick={() => setDetailRoot(workspace.rootPath)}
                            className={`w-full text-left px-2.5 py-1.5 rounded-lg border text-[11px] flex items-center gap-2 transition hover:brightness-125 ${ISSUE_CHIP[issue.severity]}`}
                            title={issue.detail}
                          >
                            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${ISSUE_DOT[issue.severity]}`} />
                            <span className="truncate">{issue.title}</span>
                            {issue.tier === 'tooling' && <span className="ml-auto text-[9px] uppercase tracking-wider opacity-60 shrink-0">dev</span>}
                          </button>
                        ))
                      )}
                      {report.issues.length > topIssues.length && (
                        <button
                          type="button"
                          onClick={() => setDetailRoot(workspace.rootPath)}
                          className="text-[11px] text-neutral-500 hover:text-neutral-200 transition"
                        >
                          +{report.issues.length - topIssues.length} more →
                        </button>
                      )}
                    </div>

                    {/* Doc metrics */}
                    <div className="flex flex-wrap items-center gap-3 text-[11px] text-neutral-400 pt-3 border-t border-[#2a2a2a]">
                      <span className="flex items-center gap-1">
                        <FileText className="w-3 h-3 text-sky-400" />
                        {auditReport.inventory.length} docs · {auditReport.healthScore}/100
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
                    </div>

                    {expandedCards[workspace.rootPath] && (
                      <div className="space-y-1 max-h-56 overflow-y-auto -mt-1">
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

                    <div className="flex items-center gap-2 mt-auto">
                      <button
                        onClick={() => setExpandedCards((prev) => ({ ...prev, [workspace.rootPath]: !prev[workspace.rootPath] }))}
                        aria-expanded={Boolean(expandedCards[workspace.rootPath])}
                        className="py-2 px-3 rounded-xl bg-[#252525] hover:bg-[#2f2f2f] border border-[#353535] text-xs font-medium text-neutral-300 hover:text-white flex items-center gap-1.5 transition shrink-0"
                      >
                        {expandedCards[workspace.rootPath] ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        <span>Docs ({auditReport.inventory.length})</span>
                      </button>
                      <button
                        onClick={() => onRescanProject(workspace.rootPath)}
                        disabled={rescanning || busy}
                        className="p-2 rounded-xl bg-[#252525] hover:bg-[#2f2f2f] border border-[#353535] text-neutral-400 hover:text-white transition disabled:opacity-50 shrink-0"
                        aria-label={`Rescan ${workspace.name}`}
                        title="Rescan this project and recheck registries"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${rescanning ? 'animate-spin text-indigo-300' : ''}`} />
                      </button>
                      <button
                        onClick={() => onOpenProject(workspace)}
                        className="flex-1 py-2 px-3 rounded-xl bg-[#282830] hover:bg-indigo-500/20 border border-[#36364a] hover:border-indigo-500/40 text-xs font-medium text-neutral-200 hover:text-white flex items-center justify-center gap-1.5 transition"
                      >
                        <span>Open project</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          /* Stack versions matrix */
          <div className="space-y-4">
            {matrix.length === 0 && (
              <div className="p-8 rounded-2xl border border-dashed border-[#2d2d2d] text-center text-xs text-neutral-500">
                No tracked frameworks found in these projects.
              </div>
            )}
            {matrix.map((group) => (
              <div key={group.name} className="rounded-2xl border border-[#2d2d2d] bg-[#1e1e1e] overflow-hidden">
                <div className="px-5 py-3 bg-[#222] border-b border-[#2d2d2d] flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <span className="font-semibold text-sm text-white">{group.label}</span>
                    <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-[#2a2a2a] text-neutral-300">
                      {group.rows.length} app{group.rows.length === 1 ? '' : 's'}
                    </span>
                    {group.behind > 0 && (
                      <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-200 border border-amber-500/25">
                        {group.behind} behind
                      </span>
                    )}
                  </div>
                  <span className="text-[11px] text-neutral-400">
                    latest <span className="font-mono text-emerald-300">{group.latest || '…'}</span>
                  </span>
                </div>
                <div className="p-3 flex flex-wrap gap-2">
                  {group.rows.map(({ project, dep }) => {
                    // Packages pinned by an Expo SDK are only as current as that SDK.
                    const sdkDep = dep.notes.startsWith('Managed by Expo SDK')
                      ? project.auditReport.stackProfile.dependencies.find((d) => d.name === 'expo' && (d.appPath || '') === (dep.appPath || ''))
                      : undefined;
                    const sev = sdkDep && sdkDep.severity !== 'current' && sdkDep.severity !== 'unknown' ? sdkDep.severity : dep.severity;
                    const tone =
                      sev === 'critical'
                        ? 'border-rose-500/30 bg-rose-500/10 text-rose-200'
                        : sev === 'outdated'
                          ? 'border-amber-500/30 bg-amber-500/10 text-amber-200'
                          : sev === 'minor'
                            ? 'border-sky-500/25 bg-sky-500/10 text-sky-200'
                            : sev === 'current'
                              ? 'border-emerald-500/25 bg-emerald-500/5 text-emerald-200'
                              : 'border-[#333] bg-[#222] text-neutral-300';
                    return (
                      <button
                        key={`${project.workspace.rootPath}:${dep.appPath}:${dep.name}`}
                        type="button"
                        onClick={() => setDetailRoot(project.workspace.rootPath)}
                        className={`px-2.5 py-1.5 rounded-lg border text-[11px] flex items-center gap-2 transition hover:brightness-125 ${tone}`}
                        title={sdkDep ? `${dep.notes} The SDK itself: ${sdkDep.notes}` : dep.notes}
                      >
                        <span className="font-semibold">{project.workspace.name}</span>
                        {dep.appPath && <span className="opacity-60 font-mono">{dep.appPath}/</span>}
                        <span className="font-mono">{(dep.installedVersion || dep.currentVersion).replace(/^[~^]/, '')}</span>
                        {sdkDep && <span className="text-[9px] uppercase tracking-wider opacity-60">via SDK {sdkDep.currentMajor}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Stack detail drawer */}
      {detail && (
        <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true" aria-label={`${detail.workspace.name} stack freshness`}>
          <div className="absolute inset-0 bg-black/50" onClick={() => setDetailRoot(null)} />
          <div className="relative w-full max-w-xl h-full bg-[#1a1a1a] border-l border-[#2d2d2d] shadow-2xl flex flex-col">
            <div className="px-5 py-4 border-b border-[#2a2a2a] flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[11px] uppercase tracking-wider text-neutral-500 font-semibold">Stack freshness</div>
                <h2 className="text-base font-bold text-white truncate">{detail.workspace.name}</h2>
                <p className="text-[11px] font-mono text-neutral-500 truncate">{detail.workspace.rootPath}</p>
              </div>
              <button
                type="button"
                onClick={() => setDetailRoot(null)}
                className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-[#2a2a2a] transition"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              <StackFreshnessPanel
                report={fr(detail)}
                profile={detail.auditReport.stackProfile}
                checking={rescanningProjectRoot === detail.workspace.rootPath}
                onRecheck={() => onRescanProject(detail.workspace.rootPath)}
              />
            </div>
            <div className="px-5 py-3 border-t border-[#2a2a2a] flex items-center justify-between gap-2">
              <span className="text-[11px] text-neutral-500">Commands run in the project folder. Copy, review, then run.</span>
              <button
                type="button"
                onClick={() => {
                  setDetailRoot(null);
                  onOpenProject(detail.workspace);
                }}
                className="px-3 py-2 rounded-xl bg-indigo-500 hover:bg-indigo-600 text-white text-xs font-semibold flex items-center gap-1.5 transition"
              >
                Open project
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
