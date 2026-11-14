/**
 * Git helpers for the safe stack fixer: checkpoint before, list what changed, undo and commit after.
 * Node only (no Electron import) so tests can run it against real temp repos. Every call is
 * execFile('git', args) with no shell.
 */
import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { parsePorcelain, type ChangedFile } from '../src/services/fixRecipes';

export interface GitState {
  repoRoot: string;
  head: string;
  /** Files already changed before the fix (path → XY code). */
  dirty: Map<string, string>;
}

export const CHECKPOINT_MESSAGE = 'chore: checkpoint before DocAtlas fix';

/** A hook or credential prompt must never leave a fix "running" forever. */
const GIT_TIMEOUT_MS = 5 * 60 * 1000;

function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    // --literal-pathspecs: Expo Router files like app/[id].tsx must never glob-match app/i.tsx.
    execFile(
      'git',
      ['--literal-pathspecs', '-c', 'core.quotePath=false', ...args],
      { cwd, windowsHide: true, maxBuffer: 32 * 1024 * 1024, timeout: GIT_TIMEOUT_MS },
      (err, stdout, stderr) => {
        if (err) reject(new Error((stderr || err.message).toString().trim() || 'git failed'));
        else resolve(stdout.toString());
      }
    );
  });
}

/**
 * Pathspec that keeps git inside the project when the repo sits above it (e.g. C:\Prj as one repo,
 * or a dotfiles repo in the home folder). '' when the repo is the project or lives inside it.
 */
export function projectScope(repoRoot: string, projectRoot: string): string {
  const rel = path.relative(path.resolve(repoRoot), path.resolve(projectRoot));
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return '';
  return rel.split(path.sep).join('/');
}

const scoped = (scope: string) => (scope ? ['--', scope] : []);

export async function statusMap(repoRoot: string, scope = ''): Promise<Map<string, string>> {
  return parsePorcelain(await git(repoRoot, ['status', '--porcelain', '--untracked-files=all', ...scoped(scope)]));
}

/** The repo holding `cwd` (nested apps often have their own), or null when there's no repo or no git. */
export async function gitState(cwd: string, scope = ''): Promise<GitState | null> {
  try {
    const repoRoot = (await git(cwd, ['rev-parse', '--show-toplevel'])).trim();
    const head = (await git(repoRoot, ['rev-parse', 'HEAD'])).trim();
    return { repoRoot: path.resolve(repoRoot), head, dirty: await statusMap(repoRoot, scope) };
  } catch {
    return null;
  }
}

async function headOf(repoRoot: string): Promise<string> {
  return (await git(repoRoot, ['rev-parse', 'HEAD'])).trim();
}

/**
 * Commit every current change inside `scope` (untracked included) so the fix starts from a clean tree.
 * Rejects if git refuses (hook, identity, signing).
 */
export async function checkpoint(repoRoot: string, scope = ''): Promise<string> {
  await git(repoRoot, ['add', '-A', ...scoped(scope)]);
  await git(repoRoot, ['commit', '-q', '-m', CHECKPOINT_MESSAGE, ...scoped(scope)]);
  return headOf(repoRoot);
}

async function existsAt(repoRoot: string, head: string, file: string): Promise<boolean> {
  try {
    await git(repoRoot, ['cat-file', '-e', `${head}:${file}`]);
    return true;
  } catch {
    return false;
  }
}

const inNodeModules = (p: string) => p === 'node_modules' || p.startsWith('node_modules/') || p.includes('/node_modules/');

/**
 * Undo a fix: files that existed at `head` go back to that version; files the fix created are deleted.
 * Never touches node_modules. Returns the paths restored or removed.
 */
export async function restoreFiles(repoRoot: string, head: string, files: ChangedFile[]): Promise<string[]> {
  const root = path.resolve(repoRoot);
  const toRestore: string[] = [];
  const toDelete: string[] = [];
  for (const f of files) {
    if (inNodeModules(f.path)) continue;
    if (await existsAt(repoRoot, head, f.path)) toRestore.push(f.path);
    else toDelete.push(f.path);
  }
  if (toRestore.length > 0) await git(repoRoot, ['restore', `--source=${head}`, '--staged', '--worktree', '--', ...toRestore]);
  for (const rel of toDelete) {
    const abs = path.resolve(root, rel);
    if (!abs.toLowerCase().startsWith(root.toLowerCase() + path.sep)) continue;
    try {
      await git(repoRoot, ['rm', '-q', '--cached', '--ignore-unmatch', '--', rel]);
    } catch {
      /* not staged */
    }
    await fs.promises.rm(abs, { force: true });
  }
  return [...toRestore, ...toDelete];
}

/** Commit only the given files (the ones the fix changed). */
export async function commitFiles(repoRoot: string, files: string[], message: string): Promise<string> {
  const list = files.filter((f) => !inNodeModules(f));
  if (list.length === 0) throw new Error('Nothing to commit');
  await git(repoRoot, ['add', '-A', '--', ...list]);
  await git(repoRoot, ['commit', '-q', '-m', message, '--', ...list]);
  return headOf(repoRoot);
}
