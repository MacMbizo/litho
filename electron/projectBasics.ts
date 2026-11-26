/**
 * Gathers the facts behind "project basics" (README, description, git, remote, push state, .gitignore,
 * licence). Strictly read-only: git runs with --no-optional-locks so `status` never refreshes the index,
 * and fsmonitor is off so a repo's config can't start a program. Node only, so tests can run it.
 */
import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import {
  licenceKind,
  manifestDescription,
  parseRemotes,
  parseStatusV2,
  type ProjectBasicsFacts,
  type RepoFacts,
} from '../src/services/projectBasics';
import { IGNORED_DIRS } from './stackFiles';
import { ignoreGaps, riskyFileName } from '../src/services/basicsFixes';

const GIT_TIMEOUT_MS = 10_000;
const README_MAX = 8 * 1024;
const MAX_NESTED_REPOS = 6;
const NESTED_SKIP = new Set([...IGNORED_DIRS, 'venv', '.venv', '__pycache__', 'Pods', 'vendor', 'ios', 'android']);

/** Read-only git: no index refresh, no fsmonitor hook, no credential prompts, no pager. */
export function gitReadOnly(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      ['--no-optional-locks', '-c', 'core.fsmonitor=false', '-c', 'core.quotePath=false', ...args],
      {
        cwd,
        windowsHide: true,
        timeout: GIT_TIMEOUT_MS,
        maxBuffer: 8 * 1024 * 1024,
        env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat' },
      },
      (err, stdout, stderr) => {
        if (err) reject(new Error((stderr || err.message).toString().trim().split(/\r?\n/)[0] || 'git failed'));
        else resolve(stdout.toString());
      }
    );
  });
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.promises.access(p);
    return true;
  } catch {
    return false;
  }
}

async function readRepo(projectRoot: string, rel: string): Promise<RepoFacts> {
  const dir = path.join(projectRoot, rel);
  try {
    const [status, remotes, files] = await Promise.all([
      gitReadOnly(dir, ['status', '--porcelain=v2', '--branch']),
      gitReadOnly(dir, ['remote', '-v']),
      gitReadOnly(dir, ['ls-files', '-z']).catch(() => ''),
    ]);
    const trackedSecrets = files.split('\0').filter((p) => p && riskyFileName(p));
    return { path: rel, ...parseStatusV2(status), remotes: parseRemotes(remotes), trackedSecrets };
  } catch (err: any) {
    return { path: rel, hasCommits: false, remotes: [], ahead: 0, behind: 0, dirty: 0, error: err?.message || 'git failed' };
  }
}

/** Folders (relative, '/'-separated) below the root that hold their own .git, up to 3 levels down. */
export async function findNestedRepos(rootDir: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (dir: string, depth: number) => {
    if (depth > 3 || found.length >= MAX_NESTED_REPOS) return;
    let entries: fs.Dirent[] = [];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    if (depth > 0 && entries.some((e) => e.name === '.git')) {
      found.push(path.relative(rootDir, dir).split(path.sep).join('/'));
      return; // a repo's own subfolders belong to it
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.') || NESTED_SKIP.has(e.name)) continue;
      await walk(path.join(dir, e.name), depth + 1);
    }
  };
  await walk(rootDir, 0);
  return found.sort();
}

async function findReadme(dir: string): Promise<string | null> {
  let names: string[] = [];
  try {
    names = await fs.promises.readdir(dir);
  } catch {
    return null;
  }
  const candidates = names.filter((n) => /^readme(\.(md|markdown|mdx|txt|rst))?$/i.test(n));
  // Prefer README.md over README.txt etc.
  candidates.sort((a, b) => Number(!/\.md$/i.test(a)) - Number(!/\.md$/i.test(b)));
  for (const n of candidates) {
    try {
      if ((await fs.promises.stat(path.join(dir, n))).isFile()) return n;
    } catch {
      // vanished
    }
  }
  return null;
}

async function readHead(file: string, max: number): Promise<string> {
  const fh = await fs.promises.open(file, 'r');
  try {
    const buf = Buffer.alloc(max);
    const { bytesRead } = await fh.read(buf, 0, max, 0);
    return buf.subarray(0, bytesRead).toString('utf-8');
  } finally {
    await fh.close();
  }
}

const LICENCE_FILES = /^(licen[cs]e|copying|unlicense)(\.(md|txt))?$/i;

export async function readProjectBasics(projectRoot: string): Promise<ProjectBasicsFacts> {
  const rootHasGit = await exists(path.join(projectRoot, '.git'));
  const repoPaths = rootHasGit ? [''] : await findNestedRepos(projectRoot);
  const repos = await Promise.all(repoPaths.map((rel) => readRepo(projectRoot, rel)));

  // README: the root's, else the (first) nested repo's, since that's where the real app lives.
  let readme: ProjectBasicsFacts['readme'] = null;
  for (const rel of ['', ...repoPaths.filter(Boolean)]) {
    const name = await findReadme(path.join(projectRoot, rel));
    if (name) {
      try {
        readme = { path: rel ? `${rel}/${name}` : name, text: await readHead(path.join(projectRoot, rel, name), README_MAX) };
      } catch {
        readme = { path: rel ? `${rel}/${name}` : name, text: '' };
      }
      break;
    }
  }

  const manifestDescriptions: ProjectBasicsFacts['manifestDescriptions'] = [];
  let pkgLicence: string | undefined;
  for (const rel of ['', ...repoPaths.filter(Boolean)]) {
    for (const file of ['package.json', 'Cargo.toml', 'pyproject.toml']) {
      const full = path.join(projectRoot, rel, file);
      try {
        const content = await readHead(full, 128 * 1024);
        const source = rel ? `${rel}/${file}` : file;
        const d = manifestDescription(file, content);
        if (d) manifestDescriptions.push({ source, text: d });
        if (file === 'package.json' && !pkgLicence) {
          try {
            const l = JSON.parse(content)?.license;
            if (typeof l === 'string' && l.trim() && l.trim().toUpperCase() !== 'UNLICENSED') pkgLicence = l.trim();
          } catch {
            // invalid json
          }
        }
      } catch {
        // missing
      }
    }
  }

  const gitignoreDirs = ['', ...repoPaths.filter(Boolean)];
  let gitignore = false;
  let gitignoreDir: string | undefined;
  let gitignoreGaps: string[] | undefined;
  for (const rel of gitignoreDirs) {
    const file = path.join(projectRoot, rel, '.gitignore');
    if (!(await exists(file))) continue;
    gitignore = true;
    if (gitignoreDir === undefined) {
      gitignoreDir = rel;
      try {
        const entries = (await fs.promises.readdir(path.join(projectRoot, rel), { withFileTypes: true })).map((d) => ({ name: d.name, isDir: d.isDirectory() }));
        gitignoreGaps = ignoreGaps(await readHead(file, 64 * 1024), entries);
      } catch {
        // unreadable
      }
    }
  }

  let licence: ProjectBasicsFacts['licence'] = null;
  for (const rel of gitignoreDirs) {
    let names: string[] = [];
    try {
      names = await fs.promises.readdir(path.join(projectRoot, rel));
    } catch {
      continue;
    }
    const file = names.find((n) => LICENCE_FILES.test(n));
    if (file) {
      let kind: string | undefined;
      try {
        kind = licenceKind(await readHead(path.join(projectRoot, rel, file), 4096));
      } catch {
        // unreadable
      }
      licence = { file: rel ? `${rel}/${file}` : file, kind: kind || pkgLicence };
      break;
    }
  }
  if (!licence && pkgLicence) licence = { kind: pkgLicence };

  return { readme, manifestDescriptions, repos, gitignore, gitignoreDir, gitignoreGaps, licence, checkedAt: new Date().toISOString() };
}
