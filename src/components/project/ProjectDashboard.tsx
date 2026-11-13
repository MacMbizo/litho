import React, { useMemo, useState } from 'react';
import {
  Folder,
  FileText,
  Bot,
  Wrench,
  ExternalLink,
  Plus,
  RefreshCw,
  BookOpen,
  HardDrive,
  ShieldCheck,
  Cpu,
  FilePlus2,
  Wand2,
  Globe,
  FolderGit2,
  SlidersHorizontal,
  Search,
} from 'lucide-react';
import { ProjectWorkspace, ViewMode } from '../../types/document';
import { DocTaxonomyStatus, ProjectDocAuditReport } from '../../types/docAudit';
import { generateUpgradePlanMarkdown } from '../../services/stackInspector';
import { AIService } from '../../services/aiService';
import { DocActionModal, DocActionHandlers } from './DocActionModal';
import {
  DocPassportBadge,
  GRADE_CLASS,
  SEVERITY_BADGE,
  STATUS_META,
  STATUS_ORDER,
  primaryActionLabel,
} from './docPassport';

interface ProjectDashboardProps {
  project: ProjectWorkspace;
  auditReport: ProjectDocAuditReport;
  checkingLiveVersions: boolean;
  onRefreshLiveStack: () => void;
  onSelectFile: (id: string) => void;
  onSelectViewMode: (mode: ViewMode) => void;
  onNewFile: () => void;
  onRefreshProject: () => void;
  onCreateDocWithContent?: (relativePath: string, content: string) => Promise<void> | void;
  onAutoHealProject?: () => Promise<void>;
  docActions: DocActionHandlers;
  onOpenPortfolio?: () => void;
}

/** Problems first, then authority, so the matrix reads as a to-do list. */
const MATRIX_SORT: Record<DocTaxonomyStatus, number> = {
  duplicate: 0,
  stale: 1,
  orphan: 2,
  deprecated: 3,
  canonical: 4,
  'module-doc': 5,
  healthy: 6,
  'agent-system': 7,
};

export const ProjectDashboard: React.FC<ProjectDashboardProps> = ({
  project,
  auditReport,
  checkingLiveVersions,
  onRefreshLiveStack,
  onSelectFile,
  onSelectViewMode,
  onNewFile,
  onRefreshProject,
  onCreateDocWithContent,
  onAutoHealProject,
  docActions,
  onOpenPortfolio,
}) => {
  const files = project.files;
  const liveStackProfile = auditReport.stackProfile;
  const [inventoryFilter, setInventoryFilter] = useState<'all' | DocTaxonomyStatus>('all');
  const [matrixQuery, setMatrixQuery] = useState('');
  const [generatingAiPlan, setGeneratingAiPlan] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [actionItemId, setActionItemId] = useState<string | null>(null);
  const [confirmHeal, setConfirmHeal] = useState(false);
  const [healing, setHealing] = useState(false);

  // Look the item up by id on every render so the modal always shows the freshest audit.
  const actionItem = actionItemId ? auditReport.inventory.find((i) => i.fileId === actionItemId) || null : null;

  const totalAuditedDocs = auditReport.inventory.length;
  const brokenLinkCount = useMemo(
    () => auditReport.inventory.reduce((acc, item) => acc + item.brokenLinks.length, 0),
    [auditReport.inventory]
  );
  const driftingDocs = useMemo(
    () =>
      auditReport.inventory.filter((i) =>
        i.issues.some((iss) => iss.startsWith('Port drift') || iss.startsWith('SDK drift'))
      ),
    [auditReport.inventory]
  );

  const filteredInventory = useMemo(() => {
    const q = matrixQuery.trim().toLowerCase();
    return auditReport.inventory
      .filter((item) => inventoryFilter === 'all' || item.status === inventoryFilter)
      .filter((item) => !q || `${item.path} ${item.title} ${item.issues.join(' ')}`.toLowerCase().includes(q))
      .sort((a, b) => MATRIX_SORT[a.status] - MATRIX_SORT[b.status] || a.path.localeCompare(b.path));
  }, [auditReport.inventory, inventoryFilter, matrixQuery]);

  const handleAutoHeal = async () => {
    if (!onAutoHealProject) return;
    if (!confirmHeal) {
      setConfirmHeal(true);
      return;
    }
    setHealing(true);
    try {
      await onAutoHealProject();
    } finally {
      setHealing(false);
      setConfirmHeal(false);
    }
  };

  const handleSaveUpgradePlan = async (withAi: boolean) => {
    if (!onCreateDocWithContent) return;
    setAiError(null);
    let content = generateUpgradePlanMarkdown(project.name, liveStackProfile);

    if (withAi) {
      setGeneratingAiPlan(true);
      try {
        const drifted = liveStackProfile.dependencies
          .filter((d) => d.severity === 'critical' || d.severity === 'outdated' || d.severity === 'minor')
          .map((d) => `${d.name}: ${d.currentVersion} -> ${d.latestVersion || 'latest'} (${d.sourceFile})`)
          .join('\n');

        const aiNotes = await AIService.prompt(
          'You are a senior release engineer. Provide concise, actionable breaking-change migration steps and verification checks in Markdown.',
          `Project: ${project.name}\nFrameworks: ${liveStackProfile.frameworks.join(', ')}\nOutdated dependencies:\n${drifted || 'None detected'}\n\nWrite a "Breaking Changes & Migration Checklist" section with concrete commands and config updates.`
        );
        content = `${content.trim()}\n\n---\n\n## AI Migration Notes\n\n${aiNotes.trim()}\n`;
      } catch (err: any) {
        setAiError(err?.message || 'AI migration notes unavailable; generated standard upgrade plan.');
      } finally {
        setGeneratingAiPlan(false);
      }
    }

    await onCreateDocWithContent('STACK_UPGRADE_PLAN.md', content);
  };

  // Compute project metrics
  const totalDocs = files.length;
  const totalWords = files.reduce((acc, f) => acc + (f.wordCount || 0), 0);
  const totalTasks = files.reduce((acc, f) => acc + (f.tasks?.length || 0), 0);
  const completedTasks = files.reduce(
    (acc, f) => acc + (f.tasks?.filter((t) => t.completed).length || 0),
    0
  );
  const percentComplete = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  // Breakdown by entity type
  const agents = files.filter((f) => f.frontmatter.type === 'agent');
  const skills = files.filter((f) => f.frontmatter.type === 'skill');
  const projects = files.filter((f) => f.frontmatter.type === 'project');

  // Key documents: README, ARCHITECTURE, ADR, ROADMAP
  const keyDocs = files.filter((f) => {
    const lower = f.name.toLowerCase();
    return (
      lower.includes('readme') ||
      lower.includes('architecture') ||
      lower.includes('adr') ||
      lower.includes('roadmap') ||
      lower.includes('contributing')
    );
  });

  return (
    <div className="flex-1 h-full flex flex-col bg-[#181818] font-sans overflow-y-auto">
      {/* Top Project Banner */}
      <div className="p-8 border-b border-[#2b2b2b] bg-[#1d1d1d] shrink-0">
        <div className="max-w-5xl mx-auto space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400">
                <Folder className="w-6 h-6" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-neutral-100 tracking-tight flex items-center gap-2">
                  <span>{project.name}</span>
                </h1>
                <p className="text-xs text-neutral-400 font-mono flex items-center gap-1.5 mt-0.5">
                  <HardDrive className="w-3.5 h-3.5 text-neutral-500" />
                  <span className="truncate max-w-xl">{project.rootPath}</span>
                </p>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2">
              {onOpenPortfolio && (
                <button
                  onClick={onOpenPortfolio}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-500/20 hover:bg-indigo-500/30 border border-indigo-500/40 text-indigo-200 text-xs font-medium transition"
                  title="Scan a root folder containing multiple projects"
                >
                  <FolderGit2 className="w-3.5 h-3.5" />
                  <span>Projects Portfolio</span>
                </button>
              )}
              <button
                onClick={onRefreshProject}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#282828] hover:bg-[#333] border border-[#383838] text-neutral-300 text-xs transition"
                title="Rescan project folder"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Rescan</span>
              </button>
              <button
                onClick={onNewFile}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium text-xs transition shadow-sm"
              >
                <Plus className="w-4 h-4" />
                <span>New Doc</span>
              </button>
            </div>
          </div>

          {/* Key Metrics Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
            <div className="p-3.5 rounded-xl bg-[#222] border border-[#2e2e2e]">
              <div className="text-[11px] font-medium text-neutral-400 uppercase tracking-wider">
                Markdown Files
              </div>
              <div className="text-xl font-bold text-neutral-100 mt-1">{totalDocs}</div>
              <div className="text-[10px] text-neutral-500 mt-0.5">{totalWords.toLocaleString()} total words</div>
            </div>

            <div className="p-3.5 rounded-xl bg-[#222] border border-[#2e2e2e]">
              <div className="text-[11px] font-medium text-neutral-400 uppercase tracking-wider">
                Action Items
              </div>
              <div className="text-xl font-bold text-emerald-400 mt-1">
                {completedTasks}/{totalTasks}
              </div>
              <div className="text-[10px] text-neutral-500 mt-0.5">{percentComplete}% completed</div>
            </div>

            <div className="p-3.5 rounded-xl bg-[#222] border border-[#2e2e2e]">
              <div className="text-[11px] font-medium text-neutral-400 uppercase tracking-wider">
                Agents & Skills
              </div>
              <div className="text-xl font-bold text-purple-400 mt-1">
                {agents.length + skills.length}
              </div>
              <div className="text-[10px] text-neutral-500 mt-0.5">{agents.length} agents, {skills.length} skills</div>
            </div>

            <div className="p-3.5 rounded-xl bg-[#222] border border-[#2e2e2e]">
              <div className="text-[11px] font-medium text-neutral-400 uppercase tracking-wider">
                Project Lens
              </div>
              <div className="flex items-center gap-1.5 mt-2">
                <button
                  onClick={() => onSelectViewMode('database')}
                  className="px-2 py-1 rounded bg-[#2a2a2a] hover:bg-[#333] text-amber-300 text-[11px] font-medium transition"
                >
                  Database
                </button>
                <button
                  onClick={() => onSelectViewMode('graph')}
                  className="px-2 py-1 rounded bg-[#2a2a2a] hover:bg-[#333] text-violet-300 text-[11px] font-medium transition"
                >
                  Graph
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Body */}
      <div className="max-w-5xl mx-auto p-8 space-y-8 w-full">
        {/* Documentation Health Score & Taxonomy Summary */}
        <div className="rounded-xl bg-[#202020] border border-[#2d2d2d] p-5 space-y-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div
                className={`w-14 h-14 rounded-xl flex flex-col items-center justify-center border font-bold ${GRADE_CLASS[auditReport.grade]}`}
              >
                <span className="text-xl leading-none">{auditReport.grade}</span>
                <span className="text-[10px] font-medium opacity-80 mt-0.5">
                  {auditReport.healthScore}/100
                </span>
              </div>
              <div>
                <h2 className="text-sm font-semibold text-neutral-100 flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  <span>Documentation Health &amp; State Audit</span>
                </h2>
                <p className="text-xs text-neutral-400 mt-0.5">
                  {totalAuditedDocs} markdown files audited • {auditReport.missingDocs.length} recommended docs missing •{' '}
                  {brokenLinkCount} broken local links
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <button
                onClick={() => setInventoryFilter('all')}
                className={`px-2.5 py-1 rounded-md text-[11px] font-medium border transition ${
                  inventoryFilter === 'all'
                    ? 'bg-neutral-100 text-neutral-900 border-neutral-100'
                    : 'bg-[#262626] text-neutral-300 border-[#333] hover:border-neutral-500'
                }`}
              >
                All ({totalAuditedDocs})
              </button>
              {STATUS_ORDER.map((statusKey) => {
                const count = auditReport.counts[statusKey] || 0;
                if (count === 0) return null;
                const meta = STATUS_META[statusKey];
                const isSelected = inventoryFilter === statusKey;
                return (
                  <button
                    key={statusKey}
                    onClick={() => setInventoryFilter(isSelected ? 'all' : statusKey)}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-medium border flex items-center gap-1 transition ${
                      isSelected
                        ? 'ring-1 ring-white/50 ' + meta.badgeClass
                        : meta.badgeClass + ' opacity-85 hover:opacity-100'
                    }`}
                  >
                    <meta.Icon className="w-3 h-3" />
                    <span>
                      {meta.label} ({count})
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {driftingDocs.length > 0 && onAutoHealProject && (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
              <p className="text-xs text-neutral-300">
                <span className="font-semibold text-emerald-300">{driftingDocs.length} document{driftingDocs.length === 1 ? '' : 's'}</span>{' '}
                reference outdated dev ports or SDK versions
                {liveStackProfile.localPort ? ` (config uses :${liveStackProfile.localPort}` : ''}
                {liveStackProfile.expoSdkVersion ? `${liveStackProfile.localPort ? ', ' : ' ('}Expo SDK ${parseInt(liveStackProfile.expoSdkVersion, 10)}` : ''}
                {liveStackProfile.localPort || liveStackProfile.expoSdkVersion ? ')' : ''}.
              </p>
              <div className="flex items-center gap-2 shrink-0">
                {confirmHeal && !healing && (
                  <button
                    onClick={() => setConfirmHeal(false)}
                    className="px-2.5 py-1.5 rounded-lg text-xs text-neutral-400 hover:text-neutral-200 transition"
                  >
                    Cancel
                  </button>
                )}
                <button
                  onClick={handleAutoHeal}
                  disabled={healing}
                  className="px-3 py-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-200 text-xs font-medium flex items-center gap-1.5 transition disabled:opacity-50"
                  title="Rewrites drifted localhost ports and Expo SDK references in every affected doc, and stamps updated_at"
                >
                  <Wand2 className={`w-3.5 h-3.5 ${healing ? 'animate-spin' : ''}`} />
                  <span>
                    {healing
                      ? 'Healing...'
                      : confirmHeal
                        ? `Confirm: update ${driftingDocs.length} file${driftingDocs.length === 1 ? '' : 's'}`
                        : 'Auto-Heal Drift'}
                  </span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Tech Stack & Live SDK Drift Radar */}
        <div className="space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-neutral-200 uppercase tracking-wider flex items-center gap-2">
              <Cpu className="w-4 h-4 text-indigo-400" />
              <span>Tech Stack &amp; Live SDK Drift</span>
              {liveStackProfile.frameworks.length > 0 && (
                <span className="text-[11px] normal-case font-normal text-neutral-400">
                  ({liveStackProfile.frameworks.join(' • ')})
                </span>
              )}
            </h2>

            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={onRefreshLiveStack}
                disabled={checkingLiveVersions}
                className="px-2.5 py-1.5 rounded-lg bg-[#252525] hover:bg-[#303030] border border-[#333] text-neutral-200 text-xs font-medium flex items-center gap-1.5 transition disabled:opacity-50"
              >
                <Globe className={`w-3.5 h-3.5 text-sky-400 ${checkingLiveVersions ? 'animate-pulse' : ''}`} />
                <span>{checkingLiveVersions ? 'Checking Registries...' : 'Check Live Registry'}</span>
              </button>

              {onCreateDocWithContent && liveStackProfile.dependencies.length > 0 && (
                <>
                  <button
                    onClick={() => handleSaveUpgradePlan(false)}
                    disabled={generatingAiPlan}
                    className="px-2.5 py-1.5 rounded-lg bg-indigo-500/20 hover:bg-indigo-500/30 border border-indigo-500/40 text-indigo-200 text-xs font-medium flex items-center gap-1.5 transition disabled:opacity-50"
                  >
                    <FilePlus2 className="w-3.5 h-3.5" />
                    <span>Save Upgrade Plan (.md)</span>
                  </button>
                  <button
                    onClick={() => handleSaveUpgradePlan(true)}
                    disabled={generatingAiPlan}
                    className="px-2.5 py-1.5 rounded-lg bg-purple-500/20 hover:bg-purple-500/30 border border-purple-500/40 text-purple-200 text-xs font-medium flex items-center gap-1.5 transition disabled:opacity-50"
                  >
                    <Wand2 className={`w-3.5 h-3.5 ${generatingAiPlan ? 'animate-spin' : ''}`} />
                    <span>{generatingAiPlan ? 'Generating AI Plan...' : 'AI Migration Guide'}</span>
                  </button>
                </>
              )}
            </div>
          </div>

          {aiError && (
            <div className="px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-xs text-amber-300">
              {aiError}
            </div>
          )}

          {liveStackProfile.configFilesFound.length === 0 ? (
            <div className="p-5 rounded-xl border border-dashed border-[#2d2d2d] text-xs text-neutral-500">
              No stack config files (`app.config.json`, `app.json`, `package.json`, `pyproject.toml`) detected in this workspace.
            </div>
          ) : (
            <div className="rounded-xl bg-[#202020] border border-[#2d2d2d] overflow-hidden">
              <div className="px-4 py-2.5 border-b border-[#2a2a2a] flex flex-wrap items-center justify-between gap-2 text-[11px] text-neutral-400">
                <span>
                  Config files:{' '}
                  <span className="font-mono text-neutral-200">
                    {liveStackProfile.configFilesFound.join(', ')}
                  </span>
                </span>
                {liveStackProfile.checkedLiveAt && (
                  <span>
                    Registry checked: {new Date(liveStackProfile.checkedLiveAt).toLocaleTimeString()}
                  </span>
                )}
              </div>

              {liveStackProfile.dependencies.length === 0 ? (
                <div className="p-4 text-xs text-neutral-400">
                  Config files detected, but no trackable runtime SDKs were listed.
                </div>
              ) : (
                <div className="divide-y divide-[#2a2a2a]">
                  {liveStackProfile.dependencies.map((dep) => (
                    <div
                      key={`${dep.sourceFile}:${dep.name}`}
                      className="px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 hover:bg-[#242424] transition"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-semibold text-neutral-100">{dep.name}</span>
                          <span className="text-[10px] font-mono text-neutral-500 bg-[#1a1a1a] px-1.5 py-0.5 rounded">
                            {dep.sourceFile}
                          </span>
                          <span
                            className={`text-[10px] font-medium px-2 py-0.5 rounded border uppercase ${
                              SEVERITY_BADGE[dep.severity] || SEVERITY_BADGE.unknown
                            }`}
                          >
                            {dep.severity}
                          </span>
                        </div>
                        {dep.notes && (
                          <p className="text-[11px] text-neutral-400 mt-1">{dep.notes}</p>
                        )}
                      </div>

                      <div className="flex items-center gap-3 shrink-0">
                        <div className="text-right font-mono text-xs">
                          <span className="text-neutral-300">{dep.currentVersion}</span>
                          {dep.latestVersion && (
                            <>
                              <span className="text-neutral-500 mx-1.5">→</span>
                              <span
                                className={
                                  dep.severity === 'current' ? 'text-emerald-400' : 'text-amber-300 font-semibold'
                                }
                              >
                                {dep.latestVersion}
                              </span>
                            </>
                          )}
                        </div>
                        {dep.upgradeCommands.length > 0 && dep.severity !== 'current' && (
                          <code className="hidden lg:inline-block text-[10px] bg-[#161616] border border-[#2f2f2f] text-neutral-300 px-2 py-1 rounded">
                            {dep.upgradeCommands[0]}
                          </code>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Missing Professional-Grade Docs */}
        {auditReport.missingDocs.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-neutral-200 uppercase tracking-wider flex items-center gap-2">
              <FilePlus2 className="w-4 h-4 text-amber-400" />
              <span>Missing Professional-Grade Docs ({auditReport.missingDocs.length})</span>
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {auditReport.missingDocs.map((missing) => (
                <div
                  key={missing.id}
                  className="p-4 rounded-xl bg-[#202020] border border-[#2d2d2d] flex flex-col justify-between gap-3"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="text-xs font-semibold text-neutral-100">{missing.title}</span>
                      <span
                        className={`text-[10px] font-medium px-2 py-0.5 rounded border uppercase ${
                          missing.priority === 'critical'
                            ? 'bg-rose-500/15 text-rose-300 border-rose-500/30'
                            : missing.priority === 'recommended'
                              ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                              : 'bg-neutral-500/15 text-neutral-300 border-neutral-500/30'
                        }`}
                      >
                        {missing.priority}
                      </span>
                    </div>
                    <div className="text-[11px] font-mono text-neutral-500 mb-1.5">
                      {missing.fileName}
                    </div>
                    <p className="text-xs text-neutral-400 leading-relaxed">{missing.reason}</p>
                  </div>

                  {onCreateDocWithContent && (
                    <button
                      onClick={() =>
                        onCreateDocWithContent(missing.fileName, missing.templateContent)
                      }
                      className="self-start px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-200 text-xs font-medium flex items-center gap-1.5 transition"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Scaffold {missing.fileName}</span>
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Markdown File State Matrix */}
        <div className="space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-neutral-200 uppercase tracking-wider flex items-center gap-2">
              <FileText className="w-4 h-4 text-emerald-400" />
              <span>
                Markdown File State Matrix ({filteredInventory.length}
                {filteredInventory.length !== totalAuditedDocs ? ` / ${totalAuditedDocs}` : ''})
              </span>
            </h2>
            <div className="relative w-full sm:w-64">
              <Search className="w-3.5 h-3.5 text-neutral-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                value={matrixQuery}
                onChange={(e) => setMatrixQuery(e.target.value)}
                placeholder="Filter by path, title or issue..."
                aria-label="Filter documents"
                className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-[#222] border border-[#333] text-xs text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:border-emerald-500/60"
              />
            </div>
          </div>

          {filteredInventory.length === 0 ? (
            <div className="p-6 rounded-xl border border-dashed border-[#2d2d2d] text-center text-xs text-neutral-500">
              No markdown files match the selected filter.
            </div>
          ) : (
            <div className="rounded-xl bg-[#202020] border border-[#2d2d2d] divide-y divide-[#2a2a2a]">
              {filteredInventory.map((item) => {
                const meta = STATUS_META[item.status];
                return (
                  <div
                    key={item.fileId}
                    onClick={() => onSelectFile(item.fileId)}
                    className="px-4 py-3 hover:bg-[#252525] transition cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <DocPassportBadge item={item} detailed />
                        <span className="text-xs font-semibold text-neutral-100 truncate">{item.title}</span>
                        <span className="text-[11px] font-mono text-neutral-500 truncate">{item.path}</span>
                      </div>

                      {item.issues.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {item.issues.map((issue, idx) => (
                            <span
                              key={idx}
                              className="text-[11px] text-amber-300/90 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded"
                            >
                              {issue}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-2.5 text-[11px] text-neutral-500 shrink-0">
                      <span title={`${item.incomingLinksCount} incoming link(s)`}>
                        {item.wordCount} words · {item.incomingLinksCount} ↩
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setActionItemId(item.fileId);
                        }}
                        className={`px-2.5 py-1 rounded-md border text-[11px] font-medium flex items-center gap-1 transition ${meta.buttonClass}`}
                      >
                        <SlidersHorizontal className="w-3 h-3" />
                        <span>{primaryActionLabel(item.status)}</span>
                      </button>
                      <span className="text-neutral-400 flex items-center gap-1">
                        <span>Open</span>
                        <ExternalLink className="w-3 h-3" />
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Key Documentation Spotlight */}
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-neutral-200 uppercase tracking-wider flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-sky-400" />
            <span>Key Project Documentation ({keyDocs.length})</span>
          </h2>

          {keyDocs.length === 0 ? (
            <div className="p-6 rounded-xl border border-dashed border-[#2d2d2d] text-center text-xs text-neutral-500">
              No README or architecture specs found at the root.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {keyDocs.map((doc) => (
                <div
                  key={doc.id}
                  onClick={() => onSelectFile(doc.id)}
                  className="p-4 rounded-xl bg-[#202020] hover:bg-[#252525] border border-[#2d2d2d] hover:border-neutral-500 transition cursor-pointer group flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2 font-semibold text-xs text-neutral-100 group-hover:text-white">
                        <FileText className="w-3.5 h-3.5 text-blue-400" />
                        <span className="truncate">{doc.frontmatter.title || doc.name}</span>
                      </div>
                      <span className="text-[10px] text-neutral-500 font-mono">{doc.path}</span>
                    </div>
                    <p className="text-xs text-neutral-400 line-clamp-2 leading-relaxed">
                      {doc.body.replace(/^[#>\s\-*`]+/gm, '').trim().slice(0, 100) || 'Empty document'}
                    </p>
                  </div>
                  <div className="flex items-center justify-between pt-3 mt-2 border-t border-[#2a2a2a] text-[10px] text-neutral-500">
                    <span>{doc.wordCount} words</span>
                    <span className="group-hover:text-neutral-300 flex items-center gap-1">
                      <span>Open in editor</span>
                      <ExternalLink className="w-3 h-3" />
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* AI Agents & Skills in this Project */}
        {(agents.length > 0 || skills.length > 0) && (
          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-neutral-200 uppercase tracking-wider flex items-center gap-2">
              <Bot className="w-4 h-4 text-purple-400" />
              <span>Project AI Agents & Skills</span>
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {agents.map((agent) => (
                <div
                  key={agent.id}
                  onClick={() => onSelectFile(agent.id)}
                  className="p-3.5 rounded-xl bg-[#202020] hover:bg-[#252525] border border-purple-500/20 hover:border-purple-500/50 transition cursor-pointer"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <div className="p-1 rounded bg-purple-500/20 text-purple-300">
                      <Bot className="w-4 h-4" />
                    </div>
                    <span className="font-semibold text-xs text-neutral-200 truncate">
                      {agent.frontmatter.title || agent.name}
                    </span>
                  </div>
                  <div className="text-[10px] font-mono text-purple-400 bg-purple-950/40 px-2 py-0.5 rounded border border-purple-800/40 inline-block mb-2">
                    {agent.frontmatter.model || 'model unspecified'}
                  </div>
                  <div className="text-xs text-neutral-400 line-clamp-2">
                    {agent.body.replace(/^[#>\s\-*`]+/gm, '').trim().slice(0, 80)}
                  </div>
                </div>
              ))}

              {skills.map((skill) => (
                <div
                  key={skill.id}
                  onClick={() => onSelectFile(skill.id)}
                  className="p-3.5 rounded-xl bg-[#202020] hover:bg-[#252525] border border-emerald-500/20 hover:border-emerald-500/50 transition cursor-pointer"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <div className="p-1 rounded bg-emerald-500/20 text-emerald-300">
                      <Wrench className="w-4 h-4" />
                    </div>
                    <span className="font-semibold text-xs text-neutral-200 truncate">
                      {skill.frontmatter.title || skill.name}
                    </span>
                  </div>
                  <div className="text-[10px] text-emerald-400 bg-emerald-950/40 px-2 py-0.5 rounded border border-emerald-800/40 inline-block mb-2">
                    {skill.frontmatter.category || 'General Skill'}
                  </div>
                  <div className="text-xs text-neutral-400 line-clamp-2">
                    {skill.body.replace(/^[#>\s\-*`]+/gm, '').trim().slice(0, 80)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {actionItem && (
        <DocActionModal
          item={actionItem}
          canonicalItem={
            actionItem.duplicateOf
              ? auditReport.inventory.find((i) => i.path === actionItem.duplicateOf)
              : undefined
          }
          files={files}
          stackProfile={liveStackProfile}
          isLocalFolder={project.isLocalFolder}
          onClose={() => setActionItemId(null)}
          onOpenInEditor={onSelectFile}
          actions={docActions}
        />
      )}
    </div>
  );
};
