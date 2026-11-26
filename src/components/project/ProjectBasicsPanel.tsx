import React from 'react';
import { BookOpenText, CircleAlert, CircleCheck, CircleX, CloudUpload, EyeOff, FolderX, GitBranch, Github, ListChecks, Scale, Undo2 } from 'lucide-react';
import type { BasicsCheck, BasicsCheckId, BasicsReport } from '../../services/projectBasics';
import { timeAgo } from './StackFreshnessPanel';

const CHECK_ICON: Record<BasicsCheckId, React.FC<{ className?: string }>> = {
  readme: BookOpenText,
  git: GitBranch,
  remote: Github,
  pushed: CloudUpload,
  gitignore: EyeOff,
  licence: Scale,
};

const STATUS_ICON: Record<BasicsCheck['status'], { Icon: React.FC<{ className?: string }>; tone: string }> = {
  pass: { Icon: CircleCheck, tone: 'text-emerald-400' },
  warn: { Icon: CircleAlert, tone: 'text-amber-400' },
  fail: { Icon: CircleX, tone: 'text-rose-400' },
};

export const BASICS_LEVEL_STYLE: Record<BasicsReport['level'], { label: string; cls: string }> = {
  complete: { label: 'Basics complete', cls: 'bg-emerald-500/10 text-emerald-200 border-emerald-500/30' },
  partial: { label: 'Basics: some gaps', cls: 'bg-amber-500/10 text-amber-200 border-amber-500/30' },
  missing: { label: 'Basics missing', cls: 'bg-rose-500/10 text-rose-200 border-rose-500/30' },
  unknown: { label: 'Basics not checked', cls: 'bg-[#262626] text-neutral-400 border-[#333]' },
};

/** Chip colour for a failing or warning check on a project card. */
export const BASICS_CHIP: Record<'warn' | 'fail', string> = {
  fail: 'bg-rose-500/10 text-rose-200 border-rose-500/25',
  warn: 'bg-amber-500/10 text-amber-200 border-amber-500/20',
};

export function BasicsChipIcon({ id, className }: { id: BasicsCheckId; className?: string }) {
  const Icon = CHECK_ICON[id];
  return <Icon className={className} />;
}

interface Props {
  report: BasicsReport;
  checkedAt?: string;
  /** Present when the project can be marked as "not a project" (portfolio only). */
  ignored?: boolean;
  onToggleIgnored?: () => void;
}

/** Description + the README / git / remote / pushed / .gitignore / licence checklist. */
export const ProjectBasicsPanel: React.FC<Props> = ({ report, checkedAt, ignored, onToggleIgnored }) => {
  const level = BASICS_LEVEL_STYLE[report.level];
  return (
    <section className="space-y-3" aria-label="Project basics">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ListChecks className="w-4 h-4 text-indigo-300" />
          <span className="text-xs font-bold uppercase tracking-wider text-neutral-200">Project basics</span>
          <span className={`text-[11px] font-mono px-2 py-0.5 rounded-full border ${level.cls}`}>
            {report.level === 'unknown' ? 'rescan to check' : `${report.passed}/${report.checks.length}`}
          </span>
        </div>
        {checkedAt && <span className="text-[11px] text-neutral-500">checked {timeAgo(checkedAt)}</span>}
      </div>

      <div className="rounded-xl border border-[#2a2a2a] bg-[#171717] p-3">
        <div className="text-[10px] uppercase tracking-wider text-neutral-500 font-semibold mb-1">About</div>
        {report.description ? (
          <>
            <p className="text-[13px] text-neutral-100 leading-relaxed">{report.description.text}</p>
            <p className="text-[10px] text-neutral-500 mt-1 font-mono">from {report.description.source}</p>
          </>
        ) : (
          <p className="text-[12px] text-neutral-500">
            {report.level === 'unknown'
              ? 'Rescan this project to read its README and git state.'
              : 'Nothing says what this project is yet. A README whose first paragraph describes it fixes that.'}
          </p>
        )}
      </div>

      {report.checks.length > 0 && (
        <ul className="space-y-1.5">
          {report.checks.map((c) => {
            const Icon = CHECK_ICON[c.id];
            const st = STATUS_ICON[c.status];
            return (
              <li key={c.id} className="flex items-start gap-2.5 px-3 py-2 rounded-lg bg-[#1d1d1d] border border-[#2a2a2a]">
                <st.Icon className={`w-4 h-4 mt-0.5 shrink-0 ${st.tone}`} aria-label={c.status} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-neutral-100">
                    <Icon className="w-3.5 h-3.5 text-neutral-400" />
                    {c.label}
                    {c.required && c.status !== 'pass' && (
                      <span className="text-[9px] uppercase tracking-wider text-neutral-500 font-medium">standard</span>
                    )}
                  </div>
                  <p className="text-[11px] text-neutral-400 leading-relaxed mt-0.5 break-words">{c.detail}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {onToggleIgnored && (
        <button
          type="button"
          onClick={onToggleIgnored}
          className="text-[11px] text-neutral-500 hover:text-neutral-200 flex items-center gap-1.5 transition"
          title={ignored ? 'Show this folder as a project again' : 'Hide a scratch folder from the cards and counts'}
        >
          {ignored ? <Undo2 className="w-3.5 h-3.5" /> : <FolderX className="w-3.5 h-3.5" />}
          {ignored ? 'Count this as a project again' : 'Not a project? Hide it from the portfolio'}
        </button>
      )}
    </section>
  );
};
