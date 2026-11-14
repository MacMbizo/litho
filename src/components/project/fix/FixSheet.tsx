import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  FileCode2,
  FolderOpen,
  GitCommitHorizontal,
  Loader2,
  Minimize2,
  ScrollText,
  Square,
  Undo2,
  Wrench,
  X,
} from 'lucide-react';
import type { FreshnessIssue, StackFreshnessReport } from '../../../types/docAudit';
import { FRESHNESS_META } from '../../../services/stackFreshness';
import type { FixSession } from './FixProvider';

interface FixSheetProps {
  session: FixSession;
  after?: StackFreshnessReport;
  nextIssue?: FreshnessIssue;
  onToggleCheckpoint: (v: boolean) => void;
  onRun: () => void;
  onStop: () => void;
  onMinimize: () => void;
  onClose: () => void;
  onContinue: () => void;
  onApplyProposal: (index: number) => void;
  onSkipProposal: (index: number) => void;
  onOpenFile: (file: string) => void;
  onOpenLog: () => void;
  onCommit: () => void;
  onUndo: () => void;
}

const fmtMs = (ms: number) => (ms < 1000 ? `${ms} ms` : ms < 60000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.floor(ms / 60000)} min ${Math.round((ms % 60000) / 1000)} s`);

const LevelPill: React.FC<{ report?: StackFreshnessReport; pending?: boolean }> = ({ report, pending }) => {
  if (pending) return <span className="text-[11px] text-neutral-500 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> rescanning…</span>;
  if (!report) return <span className="text-[11px] text-neutral-500">unknown</span>;
  const m = FRESHNESS_META[report.level];
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg border text-[11px] font-semibold ${m.bg} ${m.border} ${m.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${m.dot}`} />
      {m.label}
      {report.score !== null && <span className="font-mono opacity-80">{report.score}</span>}
    </span>
  );
};

/** Confirm → live output → result, for one fix. */
export const FixSheet: React.FC<FixSheetProps> = (props) => {
  const { session: s, after, nextIssue } = props;
  const [confirmUndo, setConfirmUndo] = useState(false);
  const logRef = useRef<HTMLPreElement>(null);
  const stick = useRef(true);
  const running = s.phase === 'running';
  const result = s.result;

  useLayoutEffect(() => {
    const el = logRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [s.log]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props]);

  useEffect(() => setConfirmUndo(false), [s.runId]);

  const plan = s.plan;
  const failedAt = result?.failedStep;
  const changed = result?.changedFiles || [];

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={`Fix: ${s.issue.title}`}
    >
      <div className="w-full max-w-3xl max-h-[90vh] bg-[#1c1c1c] border border-[#323232] rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-[#2b2b2b] flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-neutral-100 flex items-center gap-2 min-w-0">
            <Wrench className="w-4 h-4 text-emerald-300 shrink-0" />
            <span className="truncate">Fix: {s.issue.title}</span>
          </h3>
          <div className="flex items-center gap-1 shrink-0">
            {running && (
              <button type="button" onClick={props.onMinimize} className="p-1.5 rounded-md text-neutral-400 hover:text-white hover:bg-[#2a2a2a]" title="Keep running in the background">
                <Minimize2 className="w-4 h-4" />
              </button>
            )}
            <button type="button" onClick={props.onClose} className="p-1.5 rounded-md text-neutral-400 hover:text-white hover:bg-[#2a2a2a]" title={running ? 'Keep running in the background' : 'Close'}>
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4 text-xs">
          {s.error && (
            <div className="flex items-start gap-2 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-200">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{s.error}</span>
            </div>
          )}

          {s.phase === 'planning' && (
            <div className="flex items-center gap-2 text-neutral-400">
              <Loader2 className="w-4 h-4 animate-spin" /> Preparing the fix…
            </div>
          )}

          {plan && (
            <>
              <div className="space-y-1.5">
                <div className="text-neutral-400">
                  Runs in <code className="font-mono text-neutral-200">{plan.steps[0]?.cwd || plan.projectRoot}</code>
                </div>
                <ol className="space-y-1">
                  {plan.steps.map((st, i) => {
                    const state = s.steps[i]?.state;
                    const exit = result?.steps[i]?.exitCode;
                    return (
                      <li
                        key={i}
                        className={`flex items-center gap-2 rounded-md px-2 py-1.5 border font-mono text-[11px] ${
                          state === 'running' ? 'bg-sky-500/10 border-sky-500/30' : 'bg-[#141414] border-[#2a2a2a]'
                        }`}
                      >
                        <span className="w-4 text-center text-neutral-500">
                          {state === 'running' ? <Loader2 className="w-3 h-3 animate-spin inline" /> : state === 'done' ? <Check className="w-3 h-3 inline text-emerald-400" /> : state === 'failed' ? <X className="w-3 h-3 inline text-rose-400" /> : i + 1}
                        </span>
                        <span className="flex-1 min-w-0 truncate text-emerald-200">{st.argv.join(' ')}</span>
                        {st.isCheck && <span className="text-[10px] text-neutral-500 font-sans">(check)</span>}
                        {s.steps[i]?.ms !== undefined && <span className="text-[10px] text-neutral-500 font-sans">{fmtMs(s.steps[i].ms!)}</span>}
                        {result && exit !== null && exit !== undefined && exit !== 0 && <span className="text-[10px] text-rose-300 font-sans">exit {exit}</span>}
                      </li>
                    );
                  })}
                </ol>
              </div>

              {s.phase === 'confirm' && (
                <div className="p-3 rounded-xl bg-[#202020] border border-[#2d2d2d]">
                  {!plan.git ? (
                    <div className="flex items-start gap-2 text-amber-200">
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      <span>No git repo: this fix can't be undone. Run it only if you have another copy.</span>
                    </div>
                  ) : plan.git.dirtyCount === 0 ? (
                    <div className="flex items-center gap-2 text-neutral-300">
                      <GitCommitHorizontal className="w-4 h-4 text-neutral-500" />
                      Undo available (commit <code className="font-mono">{plan.git.head.slice(0, 7)}</code>)
                    </div>
                  ) : (
                    <label className="flex items-center gap-2 text-neutral-300 cursor-pointer">
                      <input type="checkbox" checked={s.checkpoint} onChange={(e) => props.onToggleCheckpoint(e.target.checked)} className="accent-emerald-500" />
                      <span>
                        {plan.git.dirtyCount} uncommitted file{plan.git.dirtyCount === 1 ? '' : 's'}: <strong className="text-neutral-100">Commit them first</strong>
                        <span className="text-neutral-500"> {s.checkpoint ? '(recommended, keeps undo clean)' : '(those files are left out of undo)'}</span>
                      </span>
                    </label>
                  )}
                </div>
              )}
            </>
          )}

          {(running || result) && (
            <pre
              ref={logRef}
              onScroll={(e) => {
                const el = e.currentTarget;
                stick.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 24;
              }}
              className="h-64 overflow-auto rounded-xl bg-[#0f0f0f] border border-[#2a2a2a] p-3 font-mono text-[11px] leading-relaxed text-neutral-300 whitespace-pre-wrap break-all"
            >
              {s.log || 'Starting…'}
            </pre>
          )}

          {result && (
            <div className="space-y-3">
              <div
                className={`flex items-start gap-2 p-3 rounded-xl border ${
                  result.ok ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200' : 'bg-rose-500/10 border-rose-500/30 text-rose-200'
                }`}
              >
                {result.ok ? <Check className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
                <span>
                  {result.ok
                    ? 'Fix finished.'
                    : result.stopped
                      ? 'Stopped. Files may be half-changed: review them below, or undo.'
                      : result.error
                        ? result.error
                        : `Failed at step ${(failedAt ?? 0) + 1}. Later steps didn't run. See the output above, or undo.`}
                  {result.ok &&
                    result.steps.some((st) => st.isCheck && st.exitCode !== 0) &&
                    ' expo-doctor still reports problems: see the output above.'}
                  {result.checkpointed && ' Your earlier changes were committed as a checkpoint first.'}
                </span>
              </div>

              <div className="flex items-center gap-2 text-neutral-400">
                <span>Freshness</span>
                <LevelPill report={s.before} />
                <ArrowRight className="w-3.5 h-3.5" />
                <LevelPill report={after} pending={!s.rescanned} />
              </div>

              {result.configProposals.length > 0 && (
                <div className="space-y-2">
                  <div className="text-[11px] uppercase tracking-wider font-semibold text-neutral-400">Expo config</div>
                  {result.configProposals.map((p, i) => {
                    const st = s.proposals[i];
                    return (
                      <div key={i} className="p-3 rounded-xl bg-[#202020] border border-[#2d2d2d] space-y-2">
                        <div className="flex items-center gap-2 text-neutral-200">
                          <FileCode2 className="w-3.5 h-3.5 text-neutral-500" />
                          <code className="font-mono">{p.file}</code>
                          {p.kind === 'code-line' && <span className="text-neutral-500">line {p.line}</span>}
                        </div>
                        <p className="text-neutral-400">
                          <code className="font-mono">sdkVersion</code> is still <code className="font-mono">{p.current}</code> but the app is now on SDK {p.expected}.{' '}
                          {p.kind === 'json-remove-sdk' ? 'Expo recommends removing it so package.json decides.' : 'Remove it, or update it to match. DocAtlas won’t rewrite code files.'}
                        </p>
                        {p.kind === 'json-remove-sdk' && (
                          <pre className="rounded-md bg-[#141414] border border-[#2a2a2a] px-2 py-1 font-mono text-[11px] text-rose-300 whitespace-pre-wrap">
                            {p.before.split(/\r?\n/).filter((l) => /"sdkVersion"/.test(l)).map((l) => `- ${l.trim()}`).join('\n')}
                          </pre>
                        )}
                        <div className="flex items-center gap-2">
                          {p.kind === 'json-remove-sdk' ? (
                            st ? (
                              <span className={st === 'applied' ? 'text-emerald-300' : st === 'stale' ? 'text-amber-300' : 'text-neutral-500'}>
                                {st === 'applied' ? 'Applied.' : st === 'stale' ? 'The file changed since; nothing was written.' : 'Skipped.'}
                              </span>
                            ) : (
                              <>
                                <button type="button" disabled={s.busyAction === 'apply'} onClick={() => props.onApplyProposal(i)} className="px-2.5 py-1 rounded-md bg-emerald-600/80 hover:bg-emerald-600 text-white disabled:opacity-50">
                                  Apply
                                </button>
                                <button type="button" onClick={() => props.onSkipProposal(i)} className="px-2.5 py-1 rounded-md bg-[#2a2a2a] hover:bg-[#333] text-neutral-200">
                                  Skip
                                </button>
                              </>
                            )
                          ) : (
                            <button type="button" onClick={() => props.onOpenFile(p.file)} className="px-2.5 py-1 rounded-md bg-[#2a2a2a] hover:bg-[#333] text-neutral-200 flex items-center gap-1.5">
                              <FolderOpen className="w-3.5 h-3.5" /> Open file
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="space-y-1">
                <div className="text-[11px] uppercase tracking-wider font-semibold text-neutral-400">
                  Changed files <span className="font-mono text-neutral-600">{changed.length}</span>
                </div>
                {changed.length === 0 ? (
                  <p className="text-neutral-500">{result.repoRoot ? 'No tracked files changed.' : 'No git repo, so changes can’t be listed.'}</p>
                ) : (
                  <ul className="max-h-32 overflow-y-auto rounded-md bg-[#141414] border border-[#2a2a2a] p-2 font-mono text-[11px] space-y-0.5">
                    {changed.map((f) => (
                      <li key={f.path} className="flex gap-2">
                        <span className={`w-16 shrink-0 ${f.status === 'deleted' ? 'text-rose-300' : f.status === 'modified' ? 'text-amber-200' : 'text-emerald-300'}`}>{f.status}</span>
                        <span className="text-neutral-300 truncate">{f.path}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {confirmUndo && !s.undone && (
                <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-100 space-y-2">
                  <p>
                    Undo puts back {changed.length} file{changed.length === 1 ? '' : 's'} as they were before this fix and deletes files it created. node_modules isn’t touched, so run
                    install again afterwards.
                  </p>
                  <div className="flex gap-2">
                    <button type="button" disabled={s.busyAction === 'undo'} onClick={props.onUndo} className="px-2.5 py-1 rounded-md bg-amber-600/80 hover:bg-amber-600 text-white flex items-center gap-1.5 disabled:opacity-50">
                      {s.busyAction === 'undo' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Undo2 className="w-3.5 h-3.5" />} Undo {changed.length} file{changed.length === 1 ? '' : 's'}
                    </button>
                    <button type="button" onClick={() => setConfirmUndo(false)} className="px-2.5 py-1 rounded-md bg-[#2a2a2a] hover:bg-[#333] text-neutral-200">
                      Keep the fix
                    </button>
                  </div>
                </div>
              )}
              {s.undone && <p className="text-amber-200">Undone: {s.undone.length} file{s.undone.length === 1 ? '' : 's'} put back. Run install again to match node_modules.</p>}
              {s.committed && <p className="text-emerald-300">Committed as {s.committed}.</p>}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-[#2a2a2a] flex flex-wrap items-center justify-end gap-2">
          {s.phase === 'confirm' && (
            <>
              <button type="button" onClick={props.onClose} className="px-3 py-1.5 rounded-lg text-xs bg-[#262626] hover:bg-[#303030] border border-[#363636] text-neutral-200">
                Cancel
              </button>
              <button type="button" disabled={!plan} onClick={props.onRun} className="px-3 py-1.5 rounded-lg text-xs bg-emerald-600 hover:bg-emerald-500 text-white font-semibold flex items-center gap-1.5 disabled:opacity-50">
                <Wrench className="w-3.5 h-3.5" /> Run fix
              </button>
            </>
          )}
          {running && (
            <button type="button" onClick={props.onStop} className="px-3 py-1.5 rounded-lg text-xs bg-rose-600/80 hover:bg-rose-600 text-white font-semibold flex items-center gap-1.5">
              <Square className="w-3 h-3" /> Stop
            </button>
          )}
          {result && (
            <>
              <button type="button" onClick={props.onOpenLog} className="px-3 py-1.5 rounded-lg text-xs bg-[#262626] hover:bg-[#303030] border border-[#363636] text-neutral-200 flex items-center gap-1.5">
                <ScrollText className="w-3.5 h-3.5" /> Open log
              </button>
              {result.undoable && changed.length > 0 && !s.undone && !s.committed && (
                <button type="button" onClick={() => setConfirmUndo(true)} className="px-3 py-1.5 rounded-lg text-xs bg-[#262626] hover:bg-[#303030] border border-[#363636] text-neutral-200 flex items-center gap-1.5">
                  <Undo2 className="w-3.5 h-3.5" /> Undo
                </button>
              )}
              {result.ok && result.repoRoot && changed.length > 0 && !s.committed && !s.undone && (
                <button type="button" disabled={s.busyAction === 'commit'} onClick={props.onCommit} className="px-3 py-1.5 rounded-lg text-xs bg-[#262626] hover:bg-[#303030] border border-[#363636] text-neutral-200 flex items-center gap-1.5 disabled:opacity-50">
                  {s.busyAction === 'commit' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <GitCommitHorizontal className="w-3.5 h-3.5" />} Commit this fix
                </button>
              )}
              {nextIssue?.fix?.kind === 'expo-sdk-step' && !s.undone && (
                <button type="button" onClick={props.onContinue} className="px-3 py-1.5 rounded-lg text-xs bg-emerald-600 hover:bg-emerald-500 text-white font-semibold flex items-center gap-1.5">
                  Continue to SDK {nextIssue.fix.toMajor} <ArrowRight className="w-3.5 h-3.5" />
                </button>
              )}
              <button type="button" onClick={props.onClose} className="px-3 py-1.5 rounded-lg text-xs bg-[#262626] hover:bg-[#303030] border border-[#363636] text-neutral-200">
                Done
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
