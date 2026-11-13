import React, { useState } from 'react';
import { Check, Copy, PackageCheck, RefreshCw, ShieldAlert, Smartphone, Terminal, Wrench, Boxes } from 'lucide-react';
import type { DetectedStackProfile, FreshnessIssue, StackFreshnessReport } from '../../types/docAudit';
import { FRESHNESS_META } from '../../services/stackFreshness';

export function timeAgo(iso?: string | null, nowMs: number = Date.now()): string {
  if (!iso) return 'never';
  const diff = Math.max(0, nowMs - Date.parse(iso));
  const min = Math.round(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

export const FreshnessBadge: React.FC<{ report: StackFreshnessReport; size?: 'sm' | 'md'; checking?: boolean }> = ({
  report,
  size = 'sm',
  checking,
}) => {
  const meta = FRESHNESS_META[report.level];
  const label = report.level === 'unchecked' && !checking ? 'Not checked' : meta.label;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-lg border font-semibold shrink-0 ${meta.bg} ${meta.border} ${meta.text} ${
        size === 'md' ? 'px-2.5 py-1 text-xs' : 'px-2 py-0.5 text-[10px]'
      }`}
      title={report.headline}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${meta.dot} ${checking || report.level === 'unchecked' ? 'animate-pulse' : ''}`} />
      <span>{label}</span>
      {report.score !== null && <span className="font-mono opacity-80">{report.score}</span>}
    </span>
  );
};

const SEVERITY_STYLE: Record<FreshnessIssue['severity'], string> = {
  critical: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  outdated: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  minor: 'bg-sky-500/10 text-sky-300 border-sky-500/25',
};

const TIER_META: Record<FreshnessIssue['tier'], { label: string; hint: string; Icon: React.FC<{ className?: string }> }> = {
  platform: { label: 'Can it still run?', hint: 'SDKs, frameworks and runtimes that decide whether the app starts, builds or ships', Icon: Smartphone },
  library: { label: 'App libraries', hint: 'Packages your code imports', Icon: Boxes },
  tooling: { label: 'Dev tooling', hint: 'Compilers, linters and test runners: dev-time only', Icon: Wrench },
};

const CommandLine: React.FC<{ cmd: string }> = ({ cmd }) => {
  const [copied, setCopied] = useState(false);
  const isComment = cmd.trim().startsWith('#');
  return (
    <div className="group flex items-center gap-2 rounded-md bg-[#141414] border border-[#2a2a2a] px-2 py-1">
      <Terminal className="w-3 h-3 text-neutral-600 shrink-0" />
      <code className={`flex-1 min-w-0 truncate font-mono text-[11px] ${isComment ? 'text-neutral-500 italic' : 'text-emerald-200'}`}>{cmd}</code>
      {!isComment && (
        <button
          type="button"
          onClick={() => {
            navigator.clipboard?.writeText(cmd).catch(() => undefined);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="p-1 rounded text-neutral-500 hover:text-white hover:bg-[#2a2a2a] transition shrink-0"
          aria-label={`Copy command: ${cmd}`}
          title="Copy"
        >
          {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
        </button>
      )}
    </div>
  );
};

export const FreshnessIssueRow: React.FC<{ issue: FreshnessIssue }> = ({ issue }) => (
  <div className="p-3 rounded-xl bg-[#1b1b1b] border border-[#2a2a2a] space-y-2">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="text-[13px] font-semibold text-neutral-100">{issue.title}</div>
        <p className="text-[11px] text-neutral-400 leading-relaxed mt-0.5">{issue.detail}</p>
      </div>
      <span className={`text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded border shrink-0 ${SEVERITY_STYLE[issue.severity]}`}>
        {issue.severity}
      </span>
    </div>
    {issue.commands.length > 0 && (
      <div className="space-y-1">
        {issue.commands.map((c, i) => (
          <CommandLine key={i} cmd={c} />
        ))}
      </div>
    )}
  </div>
);

interface StackFreshnessPanelProps {
  report: StackFreshnessReport;
  profile: DetectedStackProfile;
  checking?: boolean;
  onRecheck?: () => void;
}

/** "Will this project still run?": issues grouped by how much they block, with copyable fixes. */
export const StackFreshnessPanel: React.FC<StackFreshnessPanelProps> = ({ report, profile, checking, onRecheck }) => {
  const tiers: FreshnessIssue['tier'][] = ['platform', 'library', 'tooling'];
  const apps = profile.apps || [];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <FreshnessBadge report={report} size="md" checking={checking} />
          <span className="text-xs text-neutral-300 truncate">{report.headline}</span>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-neutral-500">
          <span>{checking ? 'Checking npm / PyPI…' : report.checkedLiveAt ? `Registries checked ${timeAgo(report.checkedLiveAt)}` : 'Registries not checked yet'}</span>
          {onRecheck && (
            <button
              type="button"
              onClick={onRecheck}
              disabled={checking}
              className="px-2 py-1 rounded-md bg-[#262626] hover:bg-[#303030] border border-[#363636] text-neutral-200 flex items-center gap-1 transition disabled:opacity-50"
            >
              <RefreshCw className={`w-3 h-3 ${checking ? 'animate-spin' : ''}`} />
              <span>Recheck</span>
            </button>
          )}
        </div>
      </div>

      {apps.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {apps.map((app) => (
            <span
              key={app.path || '.'}
              className="text-[10px] px-2 py-1 rounded-md bg-[#222] border border-[#323232] text-neutral-300 font-mono"
              title={app.manifests.join(', ')}
            >
              {app.path ? `${app.path}/` : './'}
              {app.expoSdkVersion && <span className="ml-1.5 text-indigo-300">SDK {parseInt(app.expoSdkVersion, 10)}</span>}
              {app.frameworks.filter((f) => f !== 'TypeScript').slice(0, 3).length > 0 && (
                <span className="ml-1.5 text-neutral-500">{app.frameworks.filter((f) => f !== 'TypeScript').slice(0, 3).join(' · ')}</span>
              )}
            </span>
          ))}
        </div>
      )}

      {report.level === 'none' ? (
        <p className="text-xs text-neutral-500">
          No <code className="font-mono">package.json</code>, <code className="font-mono">app.json</code> or{' '}
          <code className="font-mono">pyproject.toml</code> found in this project or its app folders.
        </p>
      ) : report.issues.length === 0 ? (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/20 text-xs text-emerald-200">
          <PackageCheck className="w-4 h-4" />
          {report.level === 'unchecked'
            ? 'Versions found; comparing against the registries…'
            : `All ${report.counts.current} tracked packages and runtimes are current.`}
        </div>
      ) : (
        tiers.map((tier) => {
          const list = report.issues.filter((i) => i.tier === tier);
          if (list.length === 0) return null;
          const { label, hint, Icon } = TIER_META[tier];
          return (
            <div key={tier} className="space-y-2">
              <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider font-semibold text-neutral-400" title={hint}>
                <Icon className="w-3.5 h-3.5" />
                <span>{label}</span>
                <span className="font-mono text-neutral-600">{list.length}</span>
                {tier === 'platform' && list.some((i) => i.severity === 'critical') && (
                  <ShieldAlert className="w-3.5 h-3.5 text-rose-400" aria-label="Blocking" />
                )}
              </div>
              {list.map((issue) => (
                <FreshnessIssueRow key={issue.id} issue={issue} />
              ))}
            </div>
          );
        })
      )}
    </div>
  );
};
