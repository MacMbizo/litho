import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Wrench } from 'lucide-react';
import type { FreshnessIssue, StackFreshnessReport } from '../../../types/docAudit';
import type { FixPlan, FixRunResult } from '../../../../electron/fixRunner';
import { FixSheet } from './FixSheet';

export type StepState = { state: 'running' | 'done' | 'failed'; exitCode?: number; ms?: number };
export type ProposalState = 'applied' | 'skipped' | 'stale';

export interface FixSession {
  phase: 'planning' | 'confirm' | 'running' | 'result';
  projectRoot: string;
  issue: FreshnessIssue;
  plan?: FixPlan;
  checkpoint: boolean;
  runId?: string;
  log: string;
  steps: Record<number, StepState>;
  result?: FixRunResult;
  before?: StackFreshnessReport;
  rescanned: boolean;
  error?: string;
  minimized: boolean;
  proposals: Record<number, ProposalState>;
  committed?: string;
  undone?: string[];
  busyAction?: 'commit' | 'undo' | 'apply';
}

interface FixContextValue {
  available: boolean;
  busy: boolean;
  start: (projectRoot: string, issue: FreshnessIssue) => void;
}

const FixContext = createContext<FixContextValue>({ available: false, busy: false, start: () => undefined });

export const useFix = () => useContext(FixContext);

const MAX_LOG_LINES = 5000;

function appendLog(prev: string, text: string): string {
  const next = prev + text;
  let count = 0;
  for (let i = next.length - 1; i >= 0; i--) {
    if (next.charCodeAt(i) === 10 && ++count > MAX_LOG_LINES) return next.slice(i + 1);
  }
  return next;
}

interface FixProviderProps {
  children: React.ReactNode;
  /** Rescan the project (and recheck registries) after a fix or an undo. */
  onFixed: (projectRoot: string) => Promise<void>;
  /** The project's current freshness report, if DocAtlas has one. */
  getReport: (projectRoot: string) => StackFreshnessReport | undefined;
}

/** One fix at a time for the whole app: owns the sheet, the live log and the minimized chip. */
export const FixProvider: React.FC<FixProviderProps> = ({ children, onFixed, getReport }) => {
  const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
  const available = Boolean(api?.fixPlan && api?.onFixEvent);
  const [session, setSession] = useState<FixSession | null>(null);
  const runIdRef = useRef<string | undefined>(undefined);
  const onFixedRef = useRef(onFixed);
  onFixedRef.current = onFixed;

  const busy = session?.phase === 'running' || session?.phase === 'planning';

  const patch = useCallback((p: Partial<FixSession> | ((s: FixSession) => Partial<FixSession>)) => {
    setSession((s) => (s ? { ...s, ...(typeof p === 'function' ? p(s) : p) } : s));
  }, []);

  const rescan = useCallback(
    async (projectRoot: string) => {
      try {
        await onFixedRef.current(projectRoot);
      } finally {
        patch({ rescanned: true });
      }
    },
    [patch]
  );

  useEffect(() => {
    if (!available) return;
    const off = api!.onFixEvent!((e) => {
      if (!runIdRef.current || e.runId !== runIdRef.current) return;
      if (e.type === 'output') patch((s) => ({ log: appendLog(s.log, e.text) }));
      else if (e.type === 'step') patch((s) => ({ steps: { ...s.steps, [e.index]: { state: e.state, exitCode: e.exitCode, ms: e.ms } } }));
      else if (e.type === 'end') patch({ phase: 'result', result: e.result, rescanned: false });
    });
    return () => off?.();
  }, [available, api, patch]);

  // Rescan once per finished run (outside the state updater, which React may call twice).
  const rescannedRunRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    const r = session?.result;
    if (session?.phase !== 'result' || !r || rescannedRunRef.current === r.runId) return;
    rescannedRunRef.current = r.runId;
    void rescan(session.projectRoot);
  }, [session?.phase, session?.result, session?.projectRoot, rescan]);

  const plan = useCallback(
    async (projectRoot: string, issue: FreshnessIssue) => {
      if (!issue.fix || !api?.fixPlan) return;
      runIdRef.current = undefined;
      setSession({
        phase: 'planning',
        projectRoot,
        issue,
        checkpoint: true,
        log: '',
        steps: {},
        before: getReport(projectRoot),
        rescanned: false,
        minimized: false,
        proposals: {},
      });
      try {
        const p = await api.fixPlan(projectRoot, issue.fix, issue.title);
        patch({ phase: 'confirm', plan: p });
      } catch (err: any) {
        patch({ phase: 'confirm', error: err?.message || String(err) });
      }
    },
    [api, getReport, patch]
  );

  const start = useCallback(
    (projectRoot: string, issue: FreshnessIssue) => {
      if (busy) return;
      void plan(projectRoot, issue);
    },
    [busy, plan]
  );

  const run = async () => {
    if (!session?.plan || !api?.fixRun) return;
    try {
      patch({ phase: 'running', error: undefined, log: '', steps: {} });
      const { runId } = await api.fixRun(session.plan.planId, { checkpoint: session.checkpoint });
      runIdRef.current = runId;
      patch({ runId });
    } catch (err: any) {
      patch({ phase: 'confirm', error: err?.message || String(err) });
    }
  };

  const action = async (kind: 'commit' | 'undo', fn: () => Promise<Partial<FixSession>>) => {
    patch({ busyAction: kind, error: undefined });
    try {
      patch({ ...(await fn()), busyAction: undefined });
    } catch (err: any) {
      patch({ busyAction: undefined, error: err?.message || String(err) });
    }
  };

  const close = () => {
    if (busy) {
      patch({ minimized: true });
      return;
    }
    runIdRef.current = undefined;
    setSession(null);
  };

  const after = session?.rescanned ? getReport(session.projectRoot) : undefined;
  const nextIssue =
    session?.phase === 'result' && session.result?.ok && after
      ? after.issues.find((i) => i.id === session.issue.id && i.fix?.kind === 'expo-sdk-step')
      : undefined;

  const value = useMemo(() => ({ available, busy, start }), [available, busy, start]);

  return (
    <FixContext.Provider value={value}>
      {children}
      {session && !session.minimized && (
        <FixSheet
          session={session}
          after={after}
          nextIssue={nextIssue}
          onToggleCheckpoint={(v) => patch({ checkpoint: v })}
          onRun={run}
          onStop={() => session.runId && api?.fixStop?.(session.runId)}
          onMinimize={() => patch({ minimized: true })}
          onClose={close}
          onContinue={() => nextIssue && void plan(session.projectRoot, nextIssue)}
          onApplyProposal={async (i) => {
            if (!session.runId) return;
            patch({ busyAction: 'apply' });
            const ok = await api!.fixApplyConfig!(session.runId, i).catch(() => false);
            patch((s) => ({ busyAction: undefined, proposals: { ...s.proposals, [i]: ok ? 'applied' : 'stale' } }));
          }}
          onSkipProposal={(i) => patch((s) => ({ proposals: { ...s.proposals, [i]: 'skipped' } }))}
          onOpenFile={(index) => session.runId && api?.fixOpenFile?.(session.runId, index).catch((err: any) => patch({ error: err?.message }))}
          onOpenLog={() => session.runId && api?.fixOpenLog?.(session.runId).catch((err: any) => patch({ error: err?.message }))}
          onCommit={() => action('commit', async () => ({ committed: (await api!.fixCommit!(session.runId!)).slice(0, 7) }))}
          onUndo={() =>
            action('undo', async () => {
              const undone = await api!.fixUndo!(session.runId!);
              patch({ rescanned: false });
              void rescan(session.projectRoot);
              return { undone };
            })
          }
        />
      )}
      {session?.minimized && (
        <button
          type="button"
          onClick={() => patch({ minimized: false })}
          className="fixed bottom-4 right-4 z-50 flex items-center gap-2 px-3 py-2 rounded-xl bg-[#1f1f1f] border border-[#363636] shadow-2xl text-xs text-neutral-200 hover:bg-[#262626] transition"
        >
          {session.phase === 'running' ? <Loader2 className="w-3.5 h-3.5 animate-spin text-sky-300" /> : <Wrench className="w-3.5 h-3.5 text-emerald-300" />}
          <span>
            {session.phase === 'running' ? 'Fixing' : 'Fix finished:'} {session.projectRoot.split(/[\\/]/).pop()}
            {session.phase === 'running' ? '…' : ''}
          </span>
        </button>
      )}
    </FixContext.Provider>
  );
};
