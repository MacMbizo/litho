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
