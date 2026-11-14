/**
 * Safe stack fixer: typed fix recipes.
 *
 * The renderer only ever sends a FixRecipe (data). The Electron main process re-validates it and builds
 * every argv itself from this module, so no command text from the UI is ever executed.
 * Pure: no Electron or DOM imports, so main, renderer and tests share it.
 */
import type { StackDependencyStatus } from '../types/docAudit';

export type FixRecipe =
  | { kind: 'expo-sdk-step'; appPath: string; fromMajor: number; toMajor: number }
  | { kind: 'expo-align'; appPath: string }
  | { kind: 'pkg-upgrade'; packages: { appPath: string; name: string; range: string }[] }
  | { kind: 'install'; appPath: string };

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

export interface FixStep {
  appPath: string;
  argv: string[];
  label: string;
  /** A check (expo-doctor): its failure is reported but doesn't fail the fix. */
  isCheck: boolean;
}

export interface AppContext {
  pm: PackageManager;
  devDeps: Set<string>;
}

const NPM_NAME = /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const RANGE = /^[\^~]?\d+(\.\d+){0,2}(-[0-9A-Za-z.]+)?$/;
/** Relative folder inside the project: no drive letter, no leading slash, no `..`, no odd characters. */
const APP_PATH = /^[A-Za-z0-9._@ ()\-]+(\/[A-Za-z0-9._@ ()\-]+)*$/;

function invalid(why: string): never {
  throw new Error(`Invalid fix: ${why}`);
}

function checkAppPath(p: unknown): string {
  if (typeof p !== 'string') invalid('appPath must be a string');
  if (p === '') return p;
  if (!APP_PATH.test(p) || p.split('/').some((seg) => seg === '..' || seg === '.')) invalid(`bad appPath ${JSON.stringify(p)}`);
  return p;
}

function checkMajor(n: unknown): number {
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > 999) invalid('bad SDK major');
  return n;
}

/** Re-check a recipe that crossed IPC. Returns a fresh object holding only known fields. */
export function validateRecipe(r: unknown): FixRecipe {
  if (!r || typeof r !== 'object') invalid('not an object');
  const o = r as Record<string, unknown>;
  switch (o.kind) {
    case 'expo-sdk-step': {
      const fromMajor = checkMajor(o.fromMajor);
      const toMajor = checkMajor(o.toMajor);
      if (toMajor !== fromMajor + 1) invalid('Expo upgrades move one SDK at a time');
      return { kind: 'expo-sdk-step', appPath: checkAppPath(o.appPath), fromMajor, toMajor };
    }
    case 'expo-align':
      return { kind: 'expo-align', appPath: checkAppPath(o.appPath) };
    case 'install':
      return { kind: 'install', appPath: checkAppPath(o.appPath) };
    case 'pkg-upgrade': {
      if (!Array.isArray(o.packages) || o.packages.length === 0 || o.packages.length > 50) invalid('packages must be a non-empty list');
      const packages = o.packages.map((p) => {
        const q = (p || {}) as Record<string, unknown>;
        if (typeof q.name !== 'string' || !NPM_NAME.test(q.name)) invalid(`bad package name ${JSON.stringify(q.name)}`);
        if (typeof q.range !== 'string' || !RANGE.test(q.range)) invalid(`bad version range ${JSON.stringify(q.range)}`);
        return { appPath: checkAppPath(q.appPath), name: q.name, range: q.range };
      });
      return { kind: 'pkg-upgrade', packages };
    }
    default:
      invalid(`unknown kind ${JSON.stringify(o.kind)}`);
  }
}

/**
 * The recipe DocAtlas can run for one dependency issue, or null when it stays copy-only:
 * Next.js (its codemod asks questions) and every PyPI package (pip vs uv is unknown).
 */
export function recipeForDependency(d: StackDependencyStatus): FixRecipe | null {
  if (d.ecosystem !== 'npm') return null;
  if (d.severity === 'current' || d.severity === 'unknown') return null;
  const appPath = d.appPath || '';
  if (d.name === 'expo') {
    if (d.currentMajor === null || d.latestMajor == null || d.latestMajor <= d.currentMajor) return null;
    return { kind: 'expo-sdk-step', appPath, fromMajor: d.currentMajor, toMajor: d.currentMajor + 1 };
  }
  if (d.name === 'react-native') return { kind: 'expo-align', appPath };
  if (d.name === 'next') return null;
  if (!NPM_NAME.test(d.name) || !d.latestVersion) return null;
  const behind = d.majorBehind ?? (d.currentMajor !== null && d.latestMajor != null ? d.latestMajor - d.currentMajor : 0);
  const range = behind > 0 && d.latestMajor != null ? `^${d.latestMajor}.0.0` : `^${d.latestVersion}`;
  if (!RANGE.test(range)) return null;
  return { kind: 'pkg-upgrade', packages: [{ appPath, name: d.name, range }] };
}

export function detectPackageManager(packageManagerField: string | undefined, rootFiles: string[]): PackageManager {
  const named = (packageManagerField || '').split('@')[0];
  if (named === 'npm' || named === 'pnpm' || named === 'yarn' || named === 'bun') return named;
  const files = new Set(rootFiles);
  if (files.has('pnpm-lock.yaml')) return 'pnpm';
  if (files.has('yarn.lock')) return 'yarn';
  if (files.has('bun.lock') || files.has('bun.lockb')) return 'bun';
  return 'npm';
}

/** Folders a recipe touches, in order, without duplicates. */
export function recipeAppPaths(r: FixRecipe): string[] {
  if (r.kind === 'pkg-upgrade') return [...new Set(r.packages.map((p) => p.appPath))];
  return [r.appPath];
}

const where = (appPath: string) => (appPath ? ` in ${appPath}/` : '');

function addArgv(pm: PackageManager, dev: boolean, specs: string[]): string[] {
  const verb = pm === 'npm' ? 'install' : 'add';
  const devFlag = pm === 'bun' ? '-d' : '-D';
  return [pm, verb, ...(dev ? [devFlag] : []), ...specs];
}

export function buildSteps(r: FixRecipe, ctx: (appPath: string) => AppContext): FixStep[] {
  switch (r.kind) {
    case 'expo-sdk-step':
      return [
        { appPath: r.appPath, argv: ['npx', 'expo', 'install', `expo@^${r.toMajor}.0.0`, '--fix'], label: `Move to Expo SDK ${r.toMajor}${where(r.appPath)}`, isCheck: false },
        { appPath: r.appPath, argv: ['npx', 'expo-doctor'], label: 'Check with expo-doctor', isCheck: true },
      ];
    case 'expo-align':
      return [
        { appPath: r.appPath, argv: ['npx', 'expo', 'install', '--fix'], label: `Align packages with the Expo SDK${where(r.appPath)}`, isCheck: false },
        { appPath: r.appPath, argv: ['npx', 'expo-doctor'], label: 'Check with expo-doctor', isCheck: true },
      ];
    case 'install': {
      const { pm } = ctx(r.appPath);
      return [{ appPath: r.appPath, argv: [pm, 'install'], label: `Install dependencies${where(r.appPath)}`, isCheck: false }];
    }
    case 'pkg-upgrade': {
      const steps: FixStep[] = [];
      for (const appPath of recipeAppPaths(r)) {
        const { pm, devDeps } = ctx(appPath);
        const pkgs = r.packages.filter((p) => p.appPath === appPath);
        for (const dev of [true, false]) {
          const group = pkgs.filter((p) => devDeps.has(p.name) === dev);
          if (group.length === 0) continue;
          steps.push({
            appPath,
            argv: addArgv(pm, dev, group.map((p) => `${p.name}@${p.range}`)),
            label: `Upgrade ${group.map((p) => p.name).join(', ')}${dev ? ' (dev)' : ''}${where(appPath)}`,
            isCheck: false,
          });
        }
      }
      return steps;
    }
  }
}

/**
 * Quote one argument for a `cmd.exe /d /s /c "<line>"` command line. Arguments only ever come from
 * validated recipes; characters cmd would expand (", %, !) or line breaks are refused outright.
 */
export function quoteWinArg(arg: string): string {
  if (/["%!\r\n]/.test(arg)) throw new Error(`Refusing unsafe argument: ${arg}`);
  return /[\s^&|<>()]/.test(arg) ? `"${arg}"` : arg;
}

export function toCmdLine(argv: string[]): string {
  return `"${argv.map(quoteWinArg).join(' ')}"`;
}

// ---------------------------------------------------------------------------
// After a run: what changed, and Expo config proposals
// ---------------------------------------------------------------------------

export interface ChangedFile {
  path: string;
  status: 'modified' | 'added' | 'deleted' | 'untracked';
}

/** `git status --porcelain` output → path → two-character XY code (renames keep the new path). */
export function parsePorcelain(out: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const line of out.split(/\r?\n/)) {
    if (line.length < 4) continue;
    const code = line.slice(0, 2);
    let p = line.slice(3);
    const arrow = p.indexOf(' -> ');
    if (arrow >= 0) p = p.slice(arrow + 4);
    if (p.startsWith('"') && p.endsWith('"')) p = p.slice(1, -1);
    m.set(p, code);
  }
  return m;
}

function statusOf(code: string): ChangedFile['status'] {
  if (code === '??') return 'untracked';
  if (code.includes('D')) return 'deleted';
  if (code.includes('A')) return 'added';
  return 'modified';
}

/** Files whose status the fix changed. Files dirty before with the same code, and node_modules, are left out. */
const isNodeModules = (p: string) => p === 'node_modules' || p.startsWith('node_modules/') || p.includes('/node_modules/');

/**
 * Files the fix changed that were clean before it ran: the only ones undo and "Commit this fix" may touch.
 * A file that was already dirty (staged or not) is never listed, even if the fix changed it again,
 * because restoring it would also throw away the user's own edits. See touchedDirty for those.
 */
export function changedSince(before: Map<string, string>, after: Map<string, string>): ChangedFile[] {
  const out: ChangedFile[] = [];
  for (const [p, code] of after) {
    if (isNodeModules(p) || before.has(p)) continue;
    out.push({ path: p, status: statusOf(code) });
  }
  return out;
}

/** Files that were already dirty before the fix and whose status the fix changed (shown, never undone). */
export function touchedDirty(before: Map<string, string>, after: Map<string, string>): string[] {
  const out: string[] = [];
  for (const [p, code] of before) {
    if (isNodeModules(p)) continue;
    if (after.get(p) !== code) out.push(p);
  }
  return out;
}

export type ConfigProposal =
  | { kind: 'json-remove-sdk'; file: string; before: string; after: string; current: string; expected: number }
  | { kind: 'code-line'; file: string; line: number; current: string; expected: number };

function majorOf(v: string): number | null {
  const m = v.match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

/**
 * Remove a stale `expo.sdkVersion` from app.json (Expo: remove it, or keep it matching package.json).
 * Returns the new text, keeping indent and line endings, or null when nothing should change.
 */
export function removeSdkVersion(jsonText: string, expectedMajor: number): string | null {
  let obj: any;
  try {
    obj = JSON.parse(jsonText);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object') return null;
  const holder = obj.expo && typeof obj.expo === 'object' ? obj.expo : obj;
  const current = holder.sdkVersion;
  if (typeof current !== 'string' || majorOf(current) === expectedMajor) return null;
  delete holder.sdkVersion;
  const expected = JSON.stringify(obj);

  // Preferred: delete just the "sdkVersion" line (and a now-dangling comma above it), so the rest of the
  // file stays byte-for-byte as it was. Accepted only if the result parses to exactly the expected object.
  const lines = jsonText.split('\n');
  const hits = lines.map((l, i) => (/^\s*"sdkVersion"\s*:\s*"[^"]*"\s*,?\s*\r?$/.test(l) ? i : -1)).filter((i) => i >= 0);
  if (hits.length === 1) {
    const i = hits[0];
    const hadComma = /,\s*\r?$/.test(lines[i]);
    const next = lines.slice(0, i).concat(lines.slice(i + 1));
    if (!hadComma) {
      for (let j = i - 1; j >= 0; j--) {
        if (next[j].trim() === '' || next[j].trim() === '\r') continue;
        next[j] = next[j].replace(/,(\s*\r?)$/, '$1');
        break;
      }
    }
    const candidate = next.join('\n');
    try {
      if (JSON.stringify(JSON.parse(candidate)) === expected) return candidate;
    } catch {
      /* fall through to re-serialising */
    }
  }

  const indentMatch = jsonText.match(/\n([ \t]+)\S/);
  const indent = indentMatch ? indentMatch[1] : 0;
  const eol = jsonText.includes('\r\n') ? '\r\n' : '\n';
  let out = JSON.stringify(obj, null, indent || undefined);
  if (eol === '\r\n') out = out.replace(/\n/g, '\r\n');
  if (/\r?\n$/.test(jsonText)) out += eol;
  return out;
}

/** Line (1-based) and value of `sdkVersion` in app.config.ts/js code, for pointing at it rather than rewriting. */
export function findSdkVersionLine(code: string): { line: number; value: string } | null {
  const lines = code.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/sdkVersion\s*:\s*['"`]([^'"`]+)['"`]/);
    if (m) return { line: i + 1, value: m[1] };
  }
  return null;
}
