import React, { useEffect, useMemo, useState } from 'react';
import { CircleCheck, CircleX, ExternalLink, Github, Loader2, Lock, Globe, ShieldCheck, X } from 'lucide-react';
import type { BasicsActionResult } from '../../services/basicsFixes';
import { draftReadme, suggestRepoName } from '../../services/basicsFixes';
import type { ProjectBasicsFacts, RepoFacts } from '../../services/projectBasics';

export type BasicsSheetKind = 'create-readme' | 'add-description' | 'start-git' | 'publish-github' | 'push';

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
};

const joinPath = (root: string, rel: string) => (rel ? `${root.replace(/[\\/]+$/, '')}\\${rel.replace(/\//g, '\\')}` : root);

/** Confirm → run → result, for one project-basics fix. Nothing runs until the person presses the button. */
export const BasicsActionSheet: React.FC<Props> = ({ kind, ctx, repo, suggestedDescription, onClose }) => {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<BasicsActionResult | null>(null);
  const [description, setDescription] = useState(suggestedDescription);
  const [draft, setDraft] = useState<string | null>(null); // null = follow the generated draft
  const [readmeText, setReadmeText] = useState<string | null>(null);
  const [readmeError, setReadmeError] = useState<string | null>(null);
  const [repoName, setRepoName] = useState(suggestRepoName(repo?.path ? repo.path.split('/').pop()! : ctx.projectName));
  const [visibility, setVisibility] = useState<'private' | 'public'>('private');
  const [gh, setGh] = useState<{ installed: boolean; account?: string } | null>(null);

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
    if (kind === 'publish-github') window.electronAPI?.basicsGhStatus?.().then(setGh).catch(() => setGh({ installed: false }));
  }, [kind]);

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
              ? { kind }
              : kind === 'publish-github'
                ? { kind, repoPath: repo?.path ?? '', name: repoName.trim(), visibility, description: description.trim() || undefined }
                : { kind, repoPath: repo?.path ?? '' };
      const res = await window.electronAPI.basicsRun(ctx.projectRoot, action as any);
      setResult(res);
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
            : 'Push';

  const input = 'w-full px-3 py-2 rounded-lg bg-[#161616] border border-[#333] text-xs text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:border-indigo-500';
  const where = repo?.path ? `${repo.path}/` : 'the project folder';

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
                {!ctx.facts.gitignore && <li>Adds a <span className="font-mono">.gitignore</span> for this stack (always keeps <span className="font-mono">.env</span> files out).</li>}
                <li>Runs <span className="font-mono">git init</span> on a <span className="font-mono">main</span> branch.</li>
                <li>Checks every file that would be committed for keys, tokens, env files and files over 50 MB. If any turn up, it stops, removes the new repository and lists them.</li>
                <li>Makes the first commit: <span className="font-mono">chore: initial commit</span>.</li>
              </ol>
              <p className="text-neutral-500 flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" /> Everything stays on this PC. Publishing to GitHub is a separate step.
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
                <ul className="mt-2 space-y-1 pl-6">
                  {result.findings.slice(0, 20).map((f) => (
                    <li key={f.path + f.reason} className="text-[11px]">
                      {f.path && <span className="font-mono text-rose-50">{f.path}</span>} <span className="text-rose-200/80">{f.reason}</span>
                    </li>
                  ))}
                  {result.findings.length > 20 && <li className="text-[11px] text-rose-200/70">…and {result.findings.length - 20} more</li>}
                </ul>
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
