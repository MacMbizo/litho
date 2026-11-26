import React, { useEffect, useMemo, useState } from 'react';
import { CircleCheck, CircleX, ExternalLink, Github, Loader2, Lock, Globe, ShieldCheck, X } from 'lucide-react';
import type { BasicsActionResult } from '../../services/basicsFixes';
import { LICENCES, draftReadme, suggestRepoName, type LicenceId } from '../../services/basicsFixes';
import type { ProjectBasicsFacts, RepoFacts } from '../../services/projectBasics';

export type BasicsSheetKind =
  | 'create-readme'
  | 'add-description'
  | 'start-git'
  | 'publish-github'
  | 'push'
  | 'add-licence'
  | 'update-gitignore'
  | 'untrack-secrets';

export interface BasicsActionContext {
  projectRoot: string;
  projectName: string;
  facts: ProjectBasicsFacts;
  stack: { frameworks: string[]; scripts: Record<string, string>; packageManager?: string };
  /** Rescan the project after a change so the checklist updates. */
  onChanged: () => void | Promise<void>;
}

interface Props {
  kind: BasicsSheetKind;
  ctx: BasicsActionContext;
  /** The repo the action targets (publish/push), '' = project root. */
  repo?: RepoFacts;
  /** Folder for actions without a repo object (Fix .gitignore); defaults to repo?.path. */
  repoPath?: string;
  /** Files for Stop tracking secrets. */
  paths?: string[];
  /** Prefill for the description fields (the manifest's, or the current About line). */
  suggestedDescription: string;
  onClose: () => void;
}

const TITLES: Record<BasicsSheetKind, string> = {
  'create-readme': 'Create README',
  'add-description': 'Add a description',
  'start-git': 'Start git',
  'publish-github': 'Publish to GitHub',
  push: 'Push',
  'add-licence': 'Add a licence',
  'update-gitignore': 'Fix .gitignore',
  'untrack-secrets': 'Stop tracking secrets',
};

const joinPath = (root: string, rel: string) => (rel ? `${root.replace(/[\\/]+$/, '')}\\${rel.replace(/\//g, '\\')}` : root);

/** Confirm → run → result, for one project-basics fix. Nothing runs until the person presses the button. */
export const BasicsActionSheet: React.FC<Props> = ({ kind, ctx, repo, repoPath: repoPathProp, paths, suggestedDescription, onClose }) => {
  const repoPath = repoPathProp ?? repo?.path ?? '';
  // Start git / Fix .gitignore: what would be added to .gitignore, shown before anything runs.
  const [ignorePlan, setIgnorePlan] = useState<{ exists: boolean; additions: string[] } | null>(null);
  // Decisions on flagged files: leave out of git (adds to .gitignore) or, for name-only flags, include.
  const [leaveOut, setLeaveOut] = useState<Set<string>>(new Set());
  const [confirmed, setConfirmed] = useState<Set<string>>(new Set());
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<BasicsActionResult | null>(null);
  const [description, setDescription] = useState(suggestedDescription);
  const [draft, setDraft] = useState<string | null>(null); // null = follow the generated draft
  const [readmeText, setReadmeText] = useState<string | null>(null);
  const [readmeError, setReadmeError] = useState<string | null>(null);
  const [repoName, setRepoName] = useState(suggestRepoName(repo?.path ? repo.path.split('/').pop()! : ctx.projectName));
  const [visibility, setVisibility] = useState<'private' | 'public'>('private');
  const [gh, setGh] = useState<{ installed: boolean; account?: string } | null>(null);
  const [licenceId, setLicenceId] = useState<LicenceId>('AGPL-3.0');
  const [holder, setHolder] = useState('');
  const [year, setYear] = useState(String(new Date().getFullYear()));

  const licence = ctx.facts.licence?.kind;
  const generated = useMemo(
    () =>
      draftReadme({
        name: ctx.projectName,
        description,
        frameworks: ctx.stack.frameworks,
        scripts: ctx.stack.scripts,
        packageManager: ctx.stack.packageManager,
        licence,
      }),
    [ctx.projectName, ctx.stack, description, licence]
  );

  // Add description compares against the whole file as it is on disk now (the scan keeps only its start).
  useEffect(() => {
    if (kind !== 'add-description' || !ctx.facts.readme) return;
    window.electronAPI
      ?.readFile(joinPath(ctx.projectRoot, ctx.facts.readme.path))
      .then(setReadmeText)
      .catch((e) => setReadmeError(e?.message || 'Could not read the README'));
  }, [kind, ctx.projectRoot, ctx.facts.readme]);

  useEffect(() => {
    if (kind === 'add-licence') window.electronAPI?.basicsGitUser?.().then((n) => setHolder((h) => h || n)).catch(() => {});
  }, [kind]);

  useEffect(() => {
    if (kind === 'publish-github') window.electronAPI?.basicsGhStatus?.().then(setGh).catch(() => setGh({ installed: false }));
  }, [kind]);

  useEffect(() => {
    if (kind !== 'start-git' && kind !== 'update-gitignore') return;
    window.electronAPI?.basicsPlanGitignore?.(ctx.projectRoot, repoPath).then(setIgnorePlan).catch(() => setIgnorePlan(null));
  }, [kind, ctx.projectRoot, repoPath]);

  const toggleIn = (set: Set<string>, setter: (s: Set<string>) => void, p: string, other?: [Set<string>, (s: Set<string>) => void]) => {
    const next = new Set(set);
    if (next.has(p)) next.delete(p);
    else {
      next.add(p);
      if (other) {
        const o = new Set(other[0]);
        o.delete(p);
        other[1](o);
      }
    }
    setter(next);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !running && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [running, onClose]);

  const go = async () => {
    if (running || !window.electronAPI?.basicsRun) return;
    setRunning(true);
    setResult(null);
    try {
      // Re-read just before writing: the main process refuses if the file changes in between.
      const current =
        kind === 'add-description' ? await window.electronAPI.readFile(joinPath(ctx.projectRoot, ctx.facts.readme!.path)) : null;
      if (current !== null) setReadmeText(current);
      const action =
        kind === 'create-readme'
          ? { kind, content: draft ?? generated }
          : kind === 'add-description'
            ? { kind, readmePath: ctx.facts.readme!.path, expected: current ?? '', description }
            : kind === 'start-git'
              ? { kind, ignore: [...leaveOut], confirmed: [...confirmed] }
              : kind === 'publish-github'
                ? { kind, repoPath, name: repoName.trim(), visibility, description: description.trim() || undefined, confirmed: [...confirmed] }
                : kind === 'add-licence'
                  ? { kind, repoPath, licence: licenceId, holder: holder.trim(), year: Number(year) }
                  : kind === 'untrack-secrets'
                    ? { kind, repoPath, paths: paths || [] }
                    : kind === 'push'
                      ? { kind, repoPath, confirmed: [...confirmed] }
                      : { kind, repoPath };
      const res = await window.electronAPI.basicsRun(ctx.projectRoot, action as any);
      setResult(res);
      // A first attempt may already have fixed .gitignore: show what's left to add, not the old plan.
      if (kind === 'start-git' || kind === 'update-gitignore') {
        window.electronAPI.basicsPlanGitignore?.(ctx.projectRoot, repoPath).then(setIgnorePlan).catch(() => {});
      }
      // The checklist refreshes in the background; the sheet is done as soon as the result is in.
      if (res.ok || (res.wrote && res.wrote.length)) void Promise.resolve(ctx.onChanged()).catch(() => {});
    } catch (e: any) {
      setResult({ ok: false, message: e?.message || String(e) });
    } finally {
      setRunning(false);
    }
  };

  const canRun =
    !running &&
    !result?.ok &&
    (kind === 'create-readme'
      ? (draft ?? generated).trim().length > 0
      : kind === 'add-description'
        ? description.trim().length > 0 && readmeText !== null
        : kind === 'publish-github'
          ? /^[A-Za-z0-9._-]{1,100}$/.test(repoName.trim()) && Boolean(gh?.account)
          : kind === 'add-licence'
            ? holder.trim().length > 0 && /^\d{4}$/.test(year)
            : kind === 'update-gitignore'
              ? Boolean(ignorePlan && (ignorePlan.additions.length > 0 || !ignorePlan.exists))
              : true);

  const buttonLabel =
    kind === 'create-readme'
      ? 'Create README.md'
      : kind === 'add-description'
        ? 'Add to README'
        : kind === 'start-git'
          ? 'Start git'
          : kind === 'publish-github'
            ? `Publish ${visibility}`
            : kind === 'add-licence'
              ? `Add ${licenceId} licence`
              : kind === 'update-gitignore'
                ? `Add ${ignorePlan?.additions.length ?? ''} lines`
                : kind === 'untrack-secrets'
                  ? 'Stop tracking'
                  : 'Push';

  const input = 'w-full px-3 py-2 rounded-lg bg-[#161616] border border-[#333] text-xs text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:border-indigo-500';
  const where = repoPath ? `${repoPath}/` : 'the project folder';
  const gitignoreName = repoPath ? `${repoPath}/.gitignore` : '.gitignore';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={TITLES[kind]}>
      <div className="absolute inset-0 bg-black/60" onClick={() => !running && onClose()} />
      <div className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl bg-[#1c1c1c] border border-[#333] shadow-2xl">
        <div className="px-5 py-4 border-b border-[#2a2a2a] flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-wider text-neutral-500 font-semibold">{ctx.projectName}</div>
            <h2 className="text-base font-bold text-white">{TITLES[kind]}</h2>
          </div>
          <button type="button" onClick={onClose} disabled={running} className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-[#2a2a2a] transition disabled:opacity-40" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 text-xs text-neutral-300">
          {kind === 'create-readme' && (
            <>
              <label className="block space-y-1.5">
                <span className="font-semibold text-neutral-200">What is this project? (one or two sentences)</span>
                <input className={input} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Books driving lessons and tracks learners' progress." autoFocus />
              </label>
              <label className="block space-y-1.5">
                <span className="font-semibold text-neutral-200 flex items-center justify-between">
                  README.md
                  {draft !== null && (
                    <button type="button" className="text-[11px] text-indigo-300 hover:text-indigo-200 font-normal" onClick={() => setDraft(null)}>
                      Reset to the draft
                    </button>
                  )}
                </span>
                <textarea className={`${input} font-mono h-56 resize-y leading-relaxed`} value={draft ?? generated} onChange={(e) => setDraft(e.target.value)} spellCheck={false} />
              </label>
              <p className="text-neutral-500">Written to {ctx.projectRoot}\README.md. If a README appears there first, nothing is overwritten.</p>
            </>
          )}

          {kind === 'add-description' && (
            <>
              <p>
                The first paragraph of <span className="font-mono text-neutral-200">{ctx.facts.readme?.path}</span> becomes the project's description, in DocAtlas and on GitHub. This adds one under the title; nothing else in the file changes.
              </p>
              <label className="block space-y-1.5">
                <span className="font-semibold text-neutral-200">Description</span>
                <textarea className={`${input} h-20 resize-y`} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What it does and who it's for." autoFocus />
              </label>
              {readmeError && <p className="text-rose-300">{readmeError}</p>}
            </>
          )}

          {kind === 'start-git' && (
            <>
              <ol className="space-y-1.5 list-decimal pl-4 marker:text-neutral-500">
                <li>
                  <GitignorePlanLine plan={ignorePlan} name=".gitignore" />
                </li>
                <li>Runs <span className="font-mono">git init</span> on a <span className="font-mono">main</span> branch. Only files your .gitignore allows are considered.</li>
                <li>Checks each of those files for keys, tokens, env files and files over 50 MB. If any turn up, it stops, removes the new repository and asks you what to do with each.</li>
                <li>Makes the first commit: <span className="font-mono">chore: initial commit</span>.</li>
              </ol>
              <p className="text-neutral-500 flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" /> Everything stays on this PC. Publishing to GitHub is a separate step.
              </p>
            </>
          )}

          {kind === 'update-gitignore' && (
            <>
              <GitignorePlanLine plan={ignorePlan} name={gitignoreName} />
              <p className="text-neutral-500">
                Lines are only added, never changed or removed. Files git already tracks stay tracked: if a secret file is committed, use Stop tracking secrets.
              </p>
            </>
          )}

          {kind === 'untrack-secrets' && (
            <>
              <p>These files are committed, so anyone with the repository can read them:</p>
              <ul className="space-y-1 pl-4 list-disc marker:text-rose-400">
                {(paths || []).map((p) => (
                  <li key={p} className="font-mono text-neutral-100">
                    {p}
                  </li>
                ))}
              </ul>
              <ol className="space-y-1.5 list-decimal pl-4 marker:text-neutral-500">
                <li>Adds them to {gitignoreName}.</li>
                <li>
                  Removes them from git with <span className="font-mono">git rm --cached</span>. <span className="text-neutral-100">The files stay on this PC.</span>
                </li>
                <li>
                  Commits just that: <span className="font-mono">chore: stop tracking secret files</span>.
                </li>
              </ol>
              <p className="text-amber-300/90">
                Older commits still contain them. If this repository was ever pushed, treat those keys as exposed and replace them (for Supabase, rotate them in the dashboard).
              </p>
            </>
          )}

          {kind === 'publish-github' && (
            <>
              <div className="px-3 py-2 rounded-lg bg-[#171717] border border-[#2a2a2a] flex items-center gap-2">
                <Github className="w-4 h-4 text-neutral-300" />
                {gh === null ? (
                  <span className="text-neutral-500">Checking the GitHub CLI…</span>
                ) : !gh.installed ? (
                  <span className="text-amber-300">The GitHub CLI (gh) isn't installed. Install it from cli.github.com, then run <span className="font-mono">gh auth login</span>.</span>
                ) : !gh.account ? (
                  <span className="text-amber-300">The GitHub CLI isn't signed in. Run <span className="font-mono">gh auth login</span>, then reopen this.</span>
                ) : (
                  <span>
                    Signed in as <span className="font-semibold text-neutral-100">{gh.account}</span>
                  </span>
                )}
              </div>
              <label className="block space-y-1.5">
                <span className="font-semibold text-neutral-200">Repository name</span>
                <input className={`${input} font-mono`} value={repoName} onChange={(e) => setRepoName(e.target.value)} />
              </label>
              <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Visibility">
                {(
                  [
                    ['private', 'Private', Lock, 'Only you (and people you invite)'],
                    ['public', 'Public', Globe, 'Anyone on the internet can see the code'],
                  ] as const
                ).map(([v, label, Icon, sub]) => (
                  <button
                    key={v}
                    type="button"
                    role="radio"
                    aria-checked={visibility === v}
                    onClick={() => setVisibility(v)}
                    className={`text-left p-3 rounded-lg border transition ${visibility === v ? 'border-indigo-500/60 bg-indigo-500/10' : 'border-[#333] bg-[#171717] hover:border-[#444]'}`}
                  >
                    <div className="flex items-center gap-1.5 font-semibold text-neutral-100">
                      <Icon className="w-3.5 h-3.5" /> {label}
                    </div>
                    <div className="text-[11px] text-neutral-500 mt-0.5">{sub}</div>
                  </button>
                ))}
              </div>
              <label className="block space-y-1.5">
                <span className="font-semibold text-neutral-200">GitHub "About" description</span>
                <input className={input} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" />
              </label>
              <p className="text-neutral-500">
                Creates the repository, adds it as <span className="font-mono">origin</span> for {where} and pushes the committed code. Committed files are checked for keys and env files first.
              </p>
            </>
          )}

          {kind === 'add-licence' && (
            <>
              <div className="space-y-1.5" role="radiogroup" aria-label="Licence">
                {LICENCES.map((l) => (
                  <button
                    key={l.id}
                    type="button"
                    role="radio"
                    aria-checked={licenceId === l.id}
                    onClick={() => setLicenceId(l.id)}
                    className={`w-full text-left px-3 py-2 rounded-lg border transition flex items-baseline gap-2 ${licenceId === l.id ? 'border-indigo-500/60 bg-indigo-500/10' : 'border-[#333] bg-[#171717] hover:border-[#444]'}`}
                  >
                    <span className="font-semibold text-neutral-100 w-24 shrink-0">{l.label}</span>
                    <span className="text-[11px] text-neutral-400">{l.note}</span>
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-[1fr_90px] gap-2">
                <label className="block space-y-1.5">
                  <span className="font-semibold text-neutral-200">Copyright holder</span>
                  <input className={input} value={holder} onChange={(e) => setHolder(e.target.value)} placeholder="Your name or organisation" />
                </label>
                <label className="block space-y-1.5">
                  <span className="font-semibold text-neutral-200">Year</span>
                  <input className={`${input} font-mono`} value={year} onChange={(e) => setYear(e.target.value)} inputMode="numeric" />
                </label>
              </div>
              <p className="text-neutral-500">
                Writes LICENSE in {where}{licenceId !== 'Proprietary' ? ", using GitHub's official licence text" : ''}. An existing licence file is never overwritten.
              </p>
            </>
          )}

          {kind === 'push' && repo && (
            <>
              <p>
                {repo.upstream
                  ? `Sends ${repo.ahead} commit${repo.ahead === 1 ? '' : 's'} on ${repo.branch} to ${repo.upstream}.`
                  : `Branch ${repo.branch || ''} has never been pushed. It goes to ${repo.remotes.find((r) => r.name === 'origin')?.name || repo.remotes[0]?.name} and becomes its upstream.`}
                {repo.path && <span className="text-neutral-500"> (repository in {repo.path}/)</span>}
              </p>
              {repo.dirty > 0 && (
                <p className="text-amber-300/90">
                  {repo.dirty} file{repo.dirty === 1 ? ' has' : 's have'} uncommitted changes. Only commits are pushed; commit those first if they should go too.
                </p>
              )}
              <p className="text-neutral-500">Files in the commits being pushed are checked for keys and env files first.</p>
            </>
          )}

          {result && (
            <div className={`p-3 rounded-lg border ${result.ok ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-100' : 'bg-rose-500/10 border-rose-500/30 text-rose-100'}`} role="status">
              <div className="flex items-start gap-2">
                {result.ok ? <CircleCheck className="w-4 h-4 shrink-0 text-emerald-400" /> : <CircleX className="w-4 h-4 shrink-0 text-rose-400" />}
                <span className="leading-relaxed">{result.message}</span>
              </div>
              {result.findings && result.findings.length > 0 && (
                <>
                <ul className="mt-2 space-y-1.5 pl-6">
                  {result.findings.slice(0, 30).map((f) => (
                    <li key={f.path + f.reason} className="text-[11px] flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span>
                        {f.path && <span className="font-mono text-rose-50">{f.path}</span>} <span className="text-rose-200/80">{f.reason}</span>
                      </span>
                      {/* Start git can leave any file out; a name-only flag can also be waved through once checked. */}
                      {f.path && kind === 'start-git' && (
                        <label className="inline-flex items-center gap-1 text-rose-50 cursor-pointer">
                          <input
                            type="checkbox"
                            className="accent-indigo-500"
                            checked={leaveOut.has(f.path)}
                            onChange={() => toggleIn(leaveOut, setLeaveOut, f.path, [confirmed, setConfirmed])}
                          />
                          Leave out of git
                        </label>
                      )}
                      {f.path && f.level === 'review' && (
                        <label className="inline-flex items-center gap-1 text-rose-50 cursor-pointer">
                          <input
                            type="checkbox"
                            className="accent-indigo-500"
                            checked={confirmed.has(f.path)}
                            onChange={() => toggleIn(confirmed, setConfirmed, f.path, [leaveOut, setLeaveOut])}
                          />
                          I checked it: include it
                        </label>
                      )}
                    </li>
                  ))}
                  {result.findings.length > 30 && <li className="text-[11px] text-rose-200/70">…and {result.findings.length - 30} more</li>}
                </ul>
                {kind === 'start-git' && result.findings.some((f) => f.level === 'block' && !/^\.env/.test(f.path.split('/').pop() || '')) && (
                  <p className="mt-2 pl-6 text-[11px] text-rose-100/80">
                    A key written into code is safest moved into <span className="font-mono">.env</span> (read it with process.env), then replaced if it was ever shared. Leaving the file out of git also works, but then the file isn't backed up either.
                  </p>
                )}
                </>
              )}
              {result.url && (
                <button type="button" onClick={() => window.electronAPI?.basicsOpenUrl?.(result.url!)} className="mt-2 ml-6 inline-flex items-center gap-1 text-[11px] text-emerald-200 hover:text-white underline">
                  {result.url} <ExternalLink className="w-3 h-3" />
                </button>
              )}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-[#2a2a2a] flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} disabled={running} className="px-3 py-2 rounded-xl bg-[#262626] hover:bg-[#303030] border border-[#363636] text-xs font-medium text-neutral-200 transition disabled:opacity-40">
            {result?.ok ? 'Done' : 'Cancel'}
          </button>
          {!result?.ok && (
            <button
              type="button"
              onClick={go}
              disabled={!canRun}
              className={`px-3.5 py-2 rounded-xl text-white text-xs font-semibold flex items-center gap-1.5 transition disabled:opacity-50 ${
                kind === 'publish-github' && visibility === 'public' ? 'bg-amber-600 hover:bg-amber-500' : 'bg-indigo-500 hover:bg-indigo-600'
              }`}
            >
              {running && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {running ? 'Working…' : result ? 'Try again' : buttonLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

/** "Adds these lines to .gitignore: …", or that it already covers everything. */
function GitignorePlanLine({ plan, name }: { plan: { exists: boolean; additions: string[] } | null; name: string }) {
  if (!plan) return <span className="text-neutral-500">Reading {name}…</span>;
  if (!plan.exists)
    return (
      <span>
        Creates <span className="font-mono">{name}</span> for this stack. It keeps <span className="font-mono">.env</span> files, keys and build folders out.
      </span>
    );
  if (plan.additions.length === 0)
    return (
      <span>
        Your <span className="font-mono">{name}</span> already keeps <span className="font-mono">.env</span> files, keys and build folders out.
      </span>
    );
  return (
    <span>
      Adds to your <span className="font-mono">{name}</span> (existing lines are kept):{' '}
      {plan.additions.map((l) => (
        <code key={l} className="mx-0.5 px-1.5 py-0.5 rounded bg-[#262626] border border-[#333] text-[11px] text-neutral-100">
          {l}
        </code>
      ))}
    </span>
  );
}
