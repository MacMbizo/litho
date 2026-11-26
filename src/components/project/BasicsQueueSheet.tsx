import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CircleCheck, CircleX, Github, ListChecks, Loader2, MinusCircle, X } from 'lucide-react';
import type { PortfolioProjectSummary } from '../../types/docAudit';
import type { BasicsActionResult, LicenceId } from '../../services/basicsFixes';
import { LICENCES, oneLine } from '../../services/basicsFixes';
import { describeProject } from '../../services/projectBasics';
import {
  QUEUE_ORDER,
  orderedSteps,
  planQueue,
  queueReadme,
  queueRepoName,
  stepKey,
  type QueueProjectInput,
  type QueueStepKind,
} from '../../services/basicsQueue';

interface Props {
  projects: PortfolioProjectSummary[];
  onRescanProject: (rootPath: string) => void | Promise<void>;
  onClose: () => void;
}

type StepState = { status: 'running' | 'done' | 'failed' | 'skipped'; result?: BasicsActionResult };

const KIND_LABEL: Record<QueueStepKind, string> = {
  'create-readme': 'README',
  'add-licence': 'Licence',
  'start-git': 'Start git',
  'publish-github': 'Publish',
  push: 'Push',
};

/** Tick basics fixes across many projects, then run them one at a time. */
export const BasicsQueueSheet: React.FC<Props> = ({ projects, onRescanProject, onClose }) => {
  const inputs = useMemo<QueueProjectInput[]>(
    () =>
      projects.map((p) => ({
        rootPath: p.workspace.rootPath,
        name: p.workspace.name,
        facts: p.workspace.basics,
        stack: {
          frameworks: p.auditReport.stackProfile.frameworks,
          scripts: p.auditReport.stackProfile.scripts,
          packageManager: p.auditReport.stackProfile.packageManager,
        },
      })),
    [projects]
  );
  // The plan is fixed when the sheet opens, so rescans during the run don't reshuffle the rows.
  const [plan] = useState(() => planQueue(inputs));
  const inputByRoot = useMemo(() => new Map(inputs.map((i) => [i.rootPath, i])), [inputs]);
  const [ticked, setTicked] = useState<Set<string>>(
    () => new Set(plan.flatMap((p) => p.steps.filter((s) => s.available && s.defaultOn).map((s) => stepKey(p.rootPath, s.kind))))
  );
  const [licenceId, setLicenceId] = useState<LicenceId>('AGPL-3.0');
  const [holder, setHolder] = useState('');
  const [gh, setGh] = useState<{ installed: boolean; account?: string } | null>(null);
  const [states, setStates] = useState<Record<string, StepState>>({});
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);
  const stopRef = useRef(false);

  useEffect(() => {
    window.electronAPI?.basicsGitUser?.().then((n) => setHolder((h) => h || n)).catch(() => {});
    window.electronAPI?.basicsGhStatus?.().then(setGh).catch(() => setGh({ installed: false }));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !running && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [running, onClose]);

  const isTicked = (root: string, kind: QueueStepKind) => ticked.has(stepKey(root, kind));
  const toggle = (root: string, kind: QueueStepKind) =>
    setTicked((prev) => {
      const next = new Set(prev);
      const k = stepKey(root, kind);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  const toggleColumn = (kind: QueueStepKind) => {
    const keys = plan.flatMap((p) => p.steps.filter((s) => s.kind === kind && s.available).map(() => stepKey(p.rootPath, kind)));
    const allOn = keys.every((k) => ticked.has(k));
    setTicked((prev) => {
      const next = new Set(prev);
      keys.forEach((k) => (allOn ? next.delete(k) : next.add(k)));
      return next;
    });
  };

  const tickedCount = plan.reduce((a, p) => a + orderedSteps(p, ticked).length, 0);
  const projectCount = plan.filter((p) => orderedSteps(p, ticked).length > 0).length;
  const needsGh = plan.some((p) => isTicked(p.rootPath, 'publish-github'));
  const needsHolder = plan.some((p) => isTicked(p.rootPath, 'add-licence'));
  const blocked = (needsGh && !gh?.account) || (needsHolder && !holder.trim());
  const columns = QUEUE_ORDER.filter((k) => plan.some((p) => p.steps.some((s) => s.kind === k)));

  const run = async () => {
    if (running || !window.electronAPI?.basicsRun) return;
    setRunning(true);
    stopRef.current = false;
    for (const project of plan) {
      const steps = orderedSteps(project, ticked);
      if (steps.length === 0) continue;
      if (stopRef.current) break;
      const input = inputByRoot.get(project.rootPath)!;
      const failed = new Set<QueueStepKind>();
      let changed = false;
      for (const step of steps) {
        const key = stepKey(project.rootPath, step.kind);
        if (stopRef.current) break;
        // Publish needs Start git; push needs publish when both were queued.
        const dep = step.dependsOn || (step.kind === 'push' && isTicked(project.rootPath, 'publish-github') ? 'publish-github' : undefined);
        if (dep && failed.has(dep)) {
          failed.add(step.kind);
          setStates((s) => ({ ...s, [key]: { status: 'skipped', result: { ok: false, message: `Skipped: ${KIND_LABEL[dep]} didn't succeed.` } } }));
          continue;
        }
        setStates((s) => ({ ...s, [key]: { status: 'running' } }));
        const description = describeProject(input.facts)?.text || input.facts?.manifestDescriptions[0]?.text;
        const action =
          step.kind === 'create-readme'
            ? { kind: step.kind, content: queueReadme(input) }
            : step.kind === 'add-licence'
              ? { kind: step.kind, repoPath: step.repoPath, licence: licenceId, holder: holder.trim(), year: new Date().getFullYear() }
              : step.kind === 'start-git'
                ? { kind: step.kind }
                : step.kind === 'publish-github'
                  ? { kind: step.kind, repoPath: step.repoPath, name: queueRepoName(input, step.repoPath), visibility: 'private' as const, description: description ? oneLine(description).slice(0, 350) : undefined }
                  : { kind: step.kind, repoPath: step.repoPath };
        let result: BasicsActionResult;
        try {
          result = await window.electronAPI.basicsRun(project.rootPath, action as any);
        } catch (e: any) {
          result = { ok: false, message: e?.message || String(e) };
        }
        if (result.ok || result.wrote?.length) changed = true;
        if (!result.ok) failed.add(step.kind);
        setStates((s) => ({ ...s, [key]: { status: result.ok ? 'done' : 'failed', result } }));
      }
      if (changed) {
        try {
          await onRescanProject(project.rootPath);
        } catch {
          // the card refreshes on the next rescan
        }
      }
    }
    setRunning(false);
    setFinished(true);
  };

  const done = Object.values(states).filter((s) => s.status === 'done').length;
  const failedCount = Object.values(states).filter((s) => s.status === 'failed').length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Fix several at once">
      <div className="absolute inset-0 bg-black/60" onClick={() => !running && onClose()} />
      <div className="relative w-full max-w-4xl max-h-[90vh] flex flex-col rounded-2xl bg-[#1c1c1c] border border-[#333] shadow-2xl">
        <div className="px-5 py-4 border-b border-[#2a2a2a] flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-neutral-500 font-semibold flex items-center gap-1.5">
              <ListChecks className="w-3.5 h-3.5 text-indigo-300" /> Project basics
            </div>
            <h2 className="text-base font-bold text-white">Fix several at once</h2>
            <p className="text-[11px] text-neutral-500 mt-0.5">
              Tick what to do. Fixes run one at a time, in order: README, licence, start git, publish, push. Each makes the same checks as on its own: nothing is overwritten and secrets stop git and GitHub.
            </p>
          </div>
          <button type="button" onClick={onClose} disabled={running} className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-[#2a2a2a] transition disabled:opacity-40" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-3 border-b border-[#2a2a2a] flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-neutral-300">
          <label className="flex items-center gap-2">
            Licence
            <select
              value={licenceId}
              onChange={(e) => setLicenceId(e.target.value as LicenceId)}
              disabled={running}
              className="px-2 py-1 rounded-lg bg-[#161616] border border-[#333] text-xs text-neutral-100 focus:outline-none focus:border-indigo-500"
            >
              {LICENCES.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2">
            Copyright holder
            <input
              value={holder}
              onChange={(e) => setHolder(e.target.value)}
              disabled={running}
              className="px-2 py-1 w-44 rounded-lg bg-[#161616] border border-[#333] text-xs text-neutral-100 focus:outline-none focus:border-indigo-500"
            />
          </label>
          <span className="flex items-center gap-1.5 text-[11px]">
            <Github className="w-3.5 h-3.5" />
            {gh === null ? 'Checking GitHub CLI…' : gh.account ? `Publishing as ${gh.account}, always private` : gh.installed ? 'GitHub CLI not signed in: run gh auth login' : 'GitHub CLI not installed'}
          </span>
        </div>

        <div className="flex-1 overflow-y-auto">
          {plan.length === 0 ? (
            <p className="p-8 text-center text-xs text-neutral-500">Every project already has its basics, or needs a decision only you can make on the project itself.</p>
          ) : (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-[#1f1f1f] z-10">
                <tr className="text-left text-[11px] text-neutral-400">
                  <th className="px-5 py-2 font-semibold">Project</th>
                  {columns.map((k) => (
                    <th key={k} className="px-2 py-2 font-semibold">
                      <button type="button" onClick={() => toggleColumn(k)} disabled={running} className="hover:text-white transition" title={`Tick or untick ${KIND_LABEL[k]} for every project`}>
                        {KIND_LABEL[k]}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#262626]">
                {plan.map((p) => (
                  <tr key={p.rootPath} className="align-top">
                    <td className="px-5 py-2.5 min-w-[180px] max-w-[260px]">
                      <div className="font-semibold text-neutral-100 truncate">{p.name}</div>
                      <div className="text-[11px] text-neutral-500 truncate" title={p.description}>
                        {p.description || 'No description'}
                      </div>
                      {p.steps.map((s) => {
                        const st = states[stepKey(p.rootPath, s.kind)];
                        return st?.result && st.status !== 'done' ? (
                          <div key={s.kind} className="mt-1 text-[11px] text-rose-200/90 whitespace-normal">
                            {KIND_LABEL[s.kind]}: {st.result.message}
                            {st.result.findings?.slice(0, 3).map((f) => (
                              <div key={f.path + f.reason} className="pl-2 text-rose-200/70">
                                <span className="font-mono">{f.path}</span> {f.reason}
                              </div>
                            ))}
                          </div>
                        ) : null;
                      })}
                    </td>
                    {columns.map((k) => {
                      const s = p.steps.find((x) => x.kind === k);
                      if (!s) return <td key={k} className="px-2 py-2.5 text-neutral-700">–</td>;
                      const st = states[stepKey(p.rootPath, k)];
                      const on = isTicked(p.rootPath, k);
                      return (
                        <td key={k} className="px-2 py-2.5">
                          {st ? (
                            <span
                              className={`inline-flex items-center gap-1 text-[11px] ${st.status === 'done' ? 'text-emerald-300' : st.status === 'running' ? 'text-indigo-300' : st.status === 'skipped' ? 'text-neutral-500' : 'text-rose-300'}`}
                              title={st.result?.message}
                            >
                              {st.status === 'running' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : st.status === 'done' ? <CircleCheck className="w-3.5 h-3.5" /> : st.status === 'skipped' ? <MinusCircle className="w-3.5 h-3.5" /> : <CircleX className="w-3.5 h-3.5" />}
                              {st.status === 'done' && st.result?.url ? (
                                <button type="button" className="underline" onClick={() => window.electronAPI?.basicsOpenUrl?.(st.result!.url!)}>
                                  open
                                </button>
                              ) : (
                                { running: 'running', done: 'done', failed: 'failed', skipped: 'skipped' }[st.status]
                              )}
                            </span>
                          ) : (
                            <label className={`inline-flex items-center gap-1.5 ${s.available ? 'cursor-pointer text-neutral-200' : 'text-neutral-600 cursor-not-allowed'}`} title={s.reason}>
                              <input
                                type="checkbox"
                                checked={on && s.available}
                                disabled={!s.available || running || finished}
                                onChange={() => toggle(p.rootPath, k)}
                                className="accent-indigo-500"
                                aria-label={`${s.label} for ${p.name}`}
                              />
                              <span className="text-[11px]">{s.kind === 'add-licence' ? licenceId : s.label}</span>
                            </label>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="px-5 py-3 border-t border-[#2a2a2a] flex flex-wrap items-center justify-between gap-2">
          <span className="text-[11px] text-neutral-500">
            {finished || running
              ? `${done} done${failedCount ? ` · ${failedCount} failed` : ''}${running ? ' · working…' : ''}`
              : needsGh && !gh?.account
                ? 'Publishing needs the GitHub CLI signed in.'
                : needsHolder && !holder.trim()
                  ? 'Licences need a copyright holder.'
                  : `${tickedCount} fix${tickedCount === 1 ? '' : 'es'} in ${projectCount} project${projectCount === 1 ? '' : 's'}`}
          </span>
          <div className="flex items-center gap-2">
            {running ? (
              <button type="button" onClick={() => (stopRef.current = true)} className="px-3 py-2 rounded-xl bg-[#262626] hover:bg-[#303030] border border-[#363636] text-xs font-medium text-neutral-200 transition">
                Stop after this one
              </button>
            ) : (
              <button type="button" onClick={onClose} className="px-3 py-2 rounded-xl bg-[#262626] hover:bg-[#303030] border border-[#363636] text-xs font-medium text-neutral-200 transition">
                {finished ? 'Done' : 'Cancel'}
              </button>
            )}
            {!finished && (
              <button
                type="button"
                onClick={run}
                disabled={running || tickedCount === 0 || blocked}
                className="px-3.5 py-2 rounded-xl bg-indigo-500 hover:bg-indigo-600 text-white text-xs font-semibold flex items-center gap-1.5 transition disabled:opacity-50"
              >
                {running && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {running ? 'Working…' : `Run ${tickedCount} fix${tickedCount === 1 ? '' : 'es'}`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
