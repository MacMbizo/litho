/**
 * Runs the project-basics fixes: create a README, add a description, start git, publish to GitHub, push.
 * Node only (tests run it against real temp folders). Every call is execFile with no shell. Nothing is
 * overwritten, and the first commit and every push are refused when the files look like they hold secrets.
 */
import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import {
  MAX_FILE_BYTES,
  MAX_FILES,
  LICENCES,
  gitignoreFor,
  insertDescription,
  licenceText,
  looksBinary,
  riskyFileName,
  secretInText,
  validateAction,
  type BasicsAction,
  type BasicsActionResult,
  type ScanFinding,
} from '../src/services/basicsFixes';
import { findNestedRepos } from './projectBasics';

const LONG_TIMEOUT_MS = 5 * 60 * 1000;

function run(cmd: string, cwd: string, args: string[], timeout = 60_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      {
        cwd,
        windowsHide: true,
        timeout,
        maxBuffer: 32 * 1024 * 1024,
        // No terminal prompts (there's no terminal); Git Credential Manager can still show its own window.
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GH_PROMPT_DISABLED: '1', GIT_PAGER: 'cat', GH_PAGER: 'cat', NO_COLOR: '1' },
      },
      (err, stdout, stderr) => {
        if (!err) return resolve(stdout.toString());
        if ((err as any).code === 'ENOENT') return reject(new Error(`${cmd} is not installed`));
        reject(new Error((stderr || '').toString().trim() || (stdout || '').toString().trim() || err.message));
      }
    );
  });
}

const git = (cwd: string, args: string[], timeout?: number) =>
  run('git', cwd, ['-c', 'core.quotePath=false', '-c', 'core.fsmonitor=false', ...args], timeout);

async function exists(p: string): Promise<boolean> {
  try {
    await fs.promises.access(p);
    return true;
  } catch {
    return false;
  }
}

/** Resolves a project-relative path and refuses anything that escapes the project (incl. via symlinks). */
async function inside(projectRoot: string, rel: string): Promise<string> {
  const root = await fs.promises.realpath(projectRoot);
  const full = path.resolve(root, rel);
  const relCheck = path.relative(root, full);
  if (relCheck.startsWith('..') || path.isAbsolute(relCheck)) throw new Error('Path is outside the project');
  try {
    const real = await fs.promises.realpath(full);
    const r2 = path.relative(root, real);
    if (r2.startsWith('..') || path.isAbsolute(r2)) throw new Error('Path is outside the project');
    return real;
  } catch (e: any) {
    if (e?.code === 'ENOENT') return full;
    throw e;
  }
}

// --- secret scan over real files ----------------------------------------------

export async function scanFiles(baseDir: string, relPaths: string[], opts: { limitCount?: boolean } = {}): Promise<ScanFinding[]> {
  const findings: ScanFinding[] = [];
  if (opts.limitCount && relPaths.length > MAX_FILES) {
    findings.push({ path: '', reason: `${relPaths.length} files would be committed (over ${MAX_FILES}): is a build or dependency folder missing from .gitignore?` });
    return findings;
  }
  for (const rel of relPaths) {
    const name = riskyFileName(rel);
    if (name) {
      findings.push({ path: rel, reason: name });
      continue;
    }
    const full = path.join(baseDir, rel);
    let st: fs.Stats;
    try {
      st = await fs.promises.stat(full);
    } catch {
      continue; // deleted since
    }
    if (!st.isFile()) continue;
    if (st.size > MAX_FILE_BYTES) {
      findings.push({ path: rel, reason: `${Math.round(st.size / 1024 / 1024)} MB: too big for GitHub; add it to .gitignore` });
      continue;
    }
    if (st.size > 2 * 1024 * 1024) continue; // big files are data, not config
    try {
      const buf = await fs.promises.readFile(full);
      if (looksBinary(buf)) continue;
      const hit = secretInText(buf.toString('utf-8'));
      if (hit) findings.push({ path: rel, reason: `looks like it contains a ${hit}` });
    } catch {
      // unreadable: skip
    }
  }
  return findings;
}

const splitZ = (out: string) => out.split('\0').filter(Boolean);

// --- the actions ------------------------------------------------------------------

async function createReadme(projectRoot: string, content: string): Promise<BasicsActionResult> {
  const names = await fs.promises.readdir(projectRoot);
  const existing = names.find((n) => /^readme(\.(md|markdown|mdx|txt|rst))?$/i.test(n));
  if (existing) return { ok: false, message: `${existing} already exists; DocAtlas never overwrites it.` };
  const target = await inside(projectRoot, 'README.md');
  await fs.promises.writeFile(target, content.endsWith('\n') ? content : content + '\n', { encoding: 'utf-8', flag: 'wx' });
  return { ok: true, message: 'README.md created.', wrote: ['README.md'] };
}

async function addDescription(projectRoot: string, a: Extract<BasicsAction, { kind: 'add-description' }>): Promise<BasicsActionResult> {
  const target = await inside(projectRoot, a.readmePath);
  const current = await fs.promises.readFile(target, 'utf-8');
  if (current !== a.expected) return { ok: false, message: `${a.readmePath} changed since it was read. Rescan, then try again.` };
  await fs.promises.writeFile(target, insertDescription(current, a.description), 'utf-8');
  return { ok: true, message: `Description added to ${a.readmePath}.`, wrote: [a.readmePath] };
}

async function detectStack(projectRoot: string) {
  const has = async (...names: string[]) => {
    for (const dir of ['', ...(await fs.promises.readdir(projectRoot, { withFileTypes: true }))
      .filter((d) => d.isDirectory() && !d.name.startsWith('.') && d.name !== 'node_modules')
      .map((d) => d.name)
      .slice(0, 40)]) {
      for (const n of names) if (await exists(path.join(projectRoot, dir, n))) return true;
    }
    return false;
  };
  let dotnet = false;
  try {
    dotnet = (await fs.promises.readdir(projectRoot)).some((n) => /\.(csproj|sln)$/i.test(n));
  } catch {
    // ignore
  }
  return {
    node: await has('package.json'),
    python: await has('pyproject.toml', 'requirements.txt', 'setup.py'),
    rust: await has('Cargo.toml'),
    dotnet,
  };
}

async function startGit(projectRoot: string): Promise<BasicsActionResult> {
  if (await exists(path.join(projectRoot, '.git'))) return { ok: false, message: 'This folder is already a git repository.' };
  const nested = await findNestedRepos(projectRoot);
  if (nested.length) return { ok: false, message: `Git already lives in ${nested.map((n) => `${n}/`).join(', ')}; a second repo at the top would contain it.` };
  // A repo above this folder (e.g. the whole projects folder) would swallow the new one's files.
  try {
    const top = (await git(projectRoot, ['rev-parse', '--show-toplevel'])).trim();
    if (top) return { ok: false, message: `This folder is already inside the git repository at ${top}.` };
  } catch {
    // not inside a repo: good
  }
  try {
    const email = (await git(projectRoot, ['config', '--get', 'user.email'])).trim();
    if (!email) throw new Error();
  } catch (e: any) {
    if (/not installed/.test(e?.message || '')) return { ok: false, message: 'Git is not installed.' };
    return { ok: false, message: 'Git doesn\'t know who you are yet. Run: git config --global user.name "Your Name" and git config --global user.email you@example.com' };
  }

  const wrote: string[] = [];
  if (!(await exists(path.join(projectRoot, '.gitignore')))) {
    await fs.promises.writeFile(path.join(projectRoot, '.gitignore'), gitignoreFor(await detectStack(projectRoot)), { encoding: 'utf-8', flag: 'wx' });
    wrote.push('.gitignore');
  }
  await git(projectRoot, ['init', '-q', '-b', 'main']);
  const removeRepo = () => fs.promises.rm(path.join(projectRoot, '.git'), { recursive: true, force: true });
  try {
    const files = splitZ(await git(projectRoot, ['ls-files', '-z', '--others', '--exclude-standard']));
    const findings = await scanFiles(projectRoot, files, { limitCount: true });
    if (findings.length) {
      await removeRepo();
      return {
        ok: false,
        message: `Stopped before the first commit: ${findings.length} file${findings.length === 1 ? '' : 's'} shouldn't go into git. Add ${findings.length === 1 ? 'it' : 'them'} to .gitignore and try again.${wrote.length ? ' The new .gitignore was kept.' : ''}`,
        findings,
        wrote,
      };
    }
    if (files.length === 0) {
      await removeRepo();
      return { ok: false, message: 'There are no files to commit.', wrote };
    }
    await git(projectRoot, ['add', '-A'], LONG_TIMEOUT_MS);
    await git(projectRoot, ['commit', '-q', '-m', 'chore: initial commit'], LONG_TIMEOUT_MS);
    return { ok: true, message: `Git started: ${files.length} file${files.length === 1 ? '' : 's'} in the first commit on main.`, wrote };
  } catch (e: any) {
    // Only ever remove a .git this call created, and only if it has no commit yet.
    try {
      await git(projectRoot, ['rev-parse', '--verify', '-q', 'HEAD']);
    } catch {
      await removeRepo();
    }
    return { ok: false, message: `Git could not start: ${e?.message || e}`, wrote };
  }
}

/** The project's repo folder for an action: the root, or one of its nested repos. */
async function repoDir(projectRoot: string, repoPath: string): Promise<string> {
  if (repoPath) {
    const nested = await findNestedRepos(projectRoot);
    if (!nested.includes(repoPath)) throw new Error('Unknown repository folder');
  } else if (!(await exists(path.join(projectRoot, '.git')))) throw new Error('This folder is not a git repository');
  return inside(projectRoot, repoPath || '.');
}

/** The name in git's global config, used as the default copyright holder. */
export async function gitUserName(): Promise<string> {
  try {
    return (await git(process.cwd(), ['config', '--global', '--get', 'user.name'])).trim();
  } catch {
    return '';
  }
}

/** Whether the GitHub CLI is installed and signed in (gh prints this to stdout or stderr by version). */
export function ghStatus(): Promise<{ installed: boolean; account?: string }> {
  return new Promise((resolve) => {
    execFile('gh', ['auth', 'status', '--hostname', 'github.com'], { windowsHide: true, timeout: 20_000, env: { ...process.env, NO_COLOR: '1' } }, (err, stdout, stderr) => {
      if (err && (err as any).code === 'ENOENT') return resolve({ installed: false });
      const out = `${stdout || ''}\n${stderr || ''}`;
      const signedIn = !err && /Logged in to github\.com/i.test(out);
      const m = /Logged in to github\.com (?:account|as) (\S+)/i.exec(out);
      resolve({ installed: true, account: signedIn ? m?.[1] || 'signed in' : undefined });
    });
  });
}

async function publishGithub(projectRoot: string, a: Extract<BasicsAction, { kind: 'publish-github' }>): Promise<BasicsActionResult> {
  const dir = await repoDir(projectRoot, a.repoPath);
  try {
    await git(dir, ['rev-parse', '--verify', '-q', 'HEAD']);
  } catch {
    return { ok: false, message: 'Nothing is committed yet: commit first, then publish.' };
  }
  if ((await git(dir, ['remote'])).trim()) return { ok: false, message: 'This repository already has a remote.' };
  const gh = await ghStatus();
  if (!gh.installed) return { ok: false, message: 'The GitHub CLI (gh) is not installed. Get it from cli.github.com, then run: gh auth login' };
  if (!gh.account) return { ok: false, message: 'The GitHub CLI is not signed in. Run: gh auth login' };

  const findings = await scanFiles(dir, splitZ(await git(dir, ['ls-files', '-z'])));
  if (findings.length) return { ok: false, message: `Not published: ${findings.length} committed file${findings.length === 1 ? '' : 's'} look${findings.length === 1 ? 's' : ''} sensitive. Remove ${findings.length === 1 ? 'it' : 'them'} from git first (git rm --cached <file>, add to .gitignore, commit).`, findings };

  const args = ['repo', 'create', a.name, a.visibility === 'public' ? '--public' : '--private', '--source', '.', '--remote', 'origin', '--push'];
  if (a.description) args.push('--description', a.description);
  try {
    const out = await run('gh', dir, args, LONG_TIMEOUT_MS);
    const url = /https:\/\/github\.com\/\S+/.exec(out)?.[0];
    return { ok: true, message: `Published to GitHub as a ${a.visibility} repository${gh.account ? ` under ${gh.account}` : ''}.`, url };
  } catch (e: any) {
    return { ok: false, message: `GitHub refused: ${e?.message || e}` };
  }
}

async function push(projectRoot: string, a: Extract<BasicsAction, { kind: 'push' }>): Promise<BasicsActionResult> {
  const dir = await repoDir(projectRoot, a.repoPath);
  const remotes = (await git(dir, ['remote'])).split(/\r?\n/).filter(Boolean);
  if (!remotes.length) return { ok: false, message: 'This repository has no remote to push to.' };
  const branch = (await git(dir, ['symbolic-ref', '--short', '-q', 'HEAD']).catch(() => '')).trim();
  if (!branch) return { ok: false, message: 'Not on a branch (detached HEAD); check out a branch first.' };
  let upstream = '';
  try {
    upstream = (await git(dir, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])).trim();
  } catch {
    // never pushed
  }
  // Every file added or changed in the commits about to leave this PC (names catch files deleted since).
  const range = upstream ? [`${upstream}..HEAD`] : ['HEAD'];
  const changed = [...new Set(splitZ(await git(dir, ['log', '-z', '--format=', '--name-only', '--diff-filter=AMR', ...range])).map((s) => s.trim()).filter(Boolean))];
  if (changed.length === 0 && upstream) return { ok: true, message: 'Already up to date: nothing to push.' };
  const findings = await scanFiles(dir, changed);
  if (findings.length) return { ok: false, message: `Not pushed: ${findings.length} file${findings.length === 1 ? '' : 's'} in the unpushed commits look${findings.length === 1 ? 's' : ''} sensitive.`, findings };
  const remote = remotes.includes('origin') ? 'origin' : remotes[0];
  try {
    await git(dir, upstream ? ['push'] : ['push', '-u', remote, branch], LONG_TIMEOUT_MS);
    return { ok: true, message: upstream ? `Pushed to ${upstream}.` : `Pushed ${branch} to ${remote} and set it as the upstream.` };
  } catch (e: any) {
    const msg = e?.message || String(e);
    if (/rejected|non-fast-forward|fetch first/i.test(msg)) return { ok: false, message: `The remote has commits this PC doesn't: pull first (git pull --rebase), then push. (${msg.split('\n')[0]})` };
    return { ok: false, message: `Push failed: ${msg.split('\n')[0]}` };
  }
}

/** Official licence text from GitHub's licence API (no auth, nothing about the project is sent). */
export async function fetchGithubLicence(key: string): Promise<string> {
  const res = await fetch(`https://api.github.com/licenses/${encodeURIComponent(key)}`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Litho' },
  });
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
  const body = (await res.json())?.body;
  if (typeof body !== 'string' || body.length < 200) throw new Error('Unexpected licence text');
  return body;
}

const LICENCE_FILE_RE = /^(licen[cs]e|copying|unlicense)(\.(md|txt))?$/i;

async function addLicence(
  projectRoot: string,
  a: Extract<BasicsAction, { kind: 'add-licence' }>,
  getTemplate: (key: string) => Promise<string>
): Promise<BasicsActionResult> {
  const dir = a.repoPath ? await repoDir(projectRoot, a.repoPath) : await fs.promises.realpath(projectRoot);
  const existing = (await fs.promises.readdir(dir)).find((n) => LICENCE_FILE_RE.test(n));
  if (existing) return { ok: false, message: `${existing} already exists; DocAtlas never overwrites it.` };
  const meta = LICENCES.find((l) => l.id === a.licence)!;
  let template: string | null = null;
  if (meta.github) {
    try {
      template = await getTemplate(meta.github);
    } catch (e: any) {
      return { ok: false, message: `Couldn't download the ${meta.label} text from GitHub (${e?.message || 'offline?'}). Nothing was written.` };
    }
  }
  const rel = a.repoPath ? `${a.repoPath}/LICENSE` : 'LICENSE';
  await fs.promises.writeFile(path.join(dir, 'LICENSE'), licenceText(a.licence, template, a.holder, a.year), { encoding: 'utf-8', flag: 'wx' });
  return { ok: true, message: `${meta.label} licence added (${rel}).`, wrote: [rel] };
}

/** One basics action at a time across the app; the renderer shows the running state from its own call. */
export class BasicsController {
  private busy = false;
  constructor(
    private isKnownRoot: (p: string) => Promise<boolean>,
    private getLicenceTemplate: (key: string) => Promise<string> = fetchGithubLicence
  ) {}

  async run(projectRoot: string, rawAction: unknown): Promise<BasicsActionResult> {
    if (typeof projectRoot !== 'string' || !path.isAbsolute(projectRoot)) throw new Error('Invalid project');
    const action = validateAction(rawAction);
    if (!(await this.isKnownRoot(projectRoot))) throw new Error('DocAtlas only changes projects it has scanned');
    if (this.busy) return { ok: false, message: 'Another project fix is still running.' };
    this.busy = true;
    try {
      switch (action.kind) {
        case 'create-readme':
          return await createReadme(projectRoot, action.content);
        case 'add-description':
          return await addDescription(projectRoot, action);
        case 'start-git':
          return await startGit(projectRoot);
        case 'publish-github':
          return await publishGithub(projectRoot, action);
        case 'push':
          return await push(projectRoot, action);
        case 'add-licence':
          return await addLicence(projectRoot, action, this.getLicenceTemplate);
      }
    } catch (e: any) {
      return { ok: false, message: e?.message || String(e) };
    } finally {
      this.busy = false;
    }
  }
}
