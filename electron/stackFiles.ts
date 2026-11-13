import path from 'path';
import fs from 'fs';
import { TRACKED_NPM_PACKAGES } from '../src/services/stackInspector';

/** Folders skipped everywhere (scans and nested-app discovery). */
export const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'dist-electron',
  'build',
  '.next',
  '.cache',
  '.vscode',
  '.idea',
  'coverage',
  'target',
  'bin',
  'obj',
  '.turbo',
  '.gradle',
]);

export const STACK_CONFIG_FILES = [
  'package.json',
  'app.config.json',
  'app.json',
  'app.config.ts',
  'app.config.js',
  'eas.json',
  'tsconfig.json',
  'pyproject.toml',
  'requirements.txt',
  'Dockerfile',
  'docker-compose.yml',
  'docker-compose.yaml',
  'vercel.json',
  'wrangler.toml',
  '.firebaserc',
  'supabase/config.toml',
  'vite.config.ts',
  'vite.config.js',
  'vite.config.mts',
  'vite.config.mjs',
  'next.config.js',
  'next.config.mjs',
  'next.config.ts',
  'Procfile',
  '.nvmrc',
  '.node-version',
  '.python-version',
  'runtime.txt',
  '.tool-versions',
];

const APP_MANIFESTS = ['package.json', 'app.json', 'app.config.json', 'app.config.ts', 'app.config.js', 'pyproject.toml', 'requirements.txt'];

// Folders never treated as nested apps (native build output, envs, fixtures, archived code).
const NESTED_APP_SKIP = new Set([
  ...IGNORED_DIRS,
  'ios',
  'android',
  'venv',
  '__pycache__',
  'Pods',
  'vendor',
  'tmp',
  'temp',
  'examples',
  'example',
  'fixtures',
  '__tests__',
  'tests',
  'test',
  'templates',
  '_archive',
  'archive',
  'docs',
]);
const MAX_NESTED_APPS = 12;

export async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.promises.access(p);
    return true;
  } catch {
    return false;
  }
}

/** Nested folders (up to 3 levels) that contain their own app manifest, e.g. `mobile/` or `apps/web/`. */
async function findNestedAppDirs(rootDir: string): Promise<string[]> {
  const found: string[] = [];
  // Folders the project's .gitignore excludes (vendored clones, generated apps) aren't part of it.
  // Only simple folder patterns are honoured: "name", "name/", "/path/to/name/".
  let ignored: string[] = [];
  try {
    ignored = (await fs.promises.readFile(path.join(rootDir, '.gitignore'), 'utf-8'))
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#') && !l.startsWith('!') && !/[*?[]/.test(l))
      .map((l) => l.replace(/^\/+|\/+$/g, ''));
  } catch {
    // no .gitignore
  }
  const isGitIgnored = (rel: string) =>
    ignored.some((pat) => (pat.includes('/') ? rel === pat : rel.split('/').includes(pat)));
  const walk = async (dir: string, depth: number) => {
    if (depth > 3 || found.length >= MAX_NESTED_APPS) return;
    let entries: fs.Dirent[] = [];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    if (depth > 0 && isGitIgnored(path.relative(rootDir, dir).replace(/\\/g, '/'))) return;
    if (depth > 0 && entries.some((e) => e.isFile() && APP_MANIFESTS.includes(e.name))) {
      found.push(path.relative(rootDir, dir).replace(/\\/g, '/'));
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.') || NESTED_APP_SKIP.has(e.name)) continue;
      await walk(path.join(dir, e.name), depth + 1);
    }
  };
  await walk(rootDir, 0);
  return found;
}

async function readInstalledVersions(
  rootDir: string,
  appRel: string,
  pkgJson: string
): Promise<{ present: boolean; versions: Record<string, string> } | null> {
  let deps: Record<string, string> = {};
  try {
    const pkg = JSON.parse(pkgJson);
    deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  } catch {
    return null;
  }
  if (Object.keys(deps).length === 0) return null;
  const appDir = path.join(rootDir, appRel);
  const present = await pathExists(path.join(appDir, 'node_modules'));
  const versions: Record<string, string> = {};
  for (const name of TRACKED_NPM_PACKAGES) {
    if (!deps[name]) continue;
    // Workspaces hoist packages to the repo root, so fall back to it.
    for (const base of [appDir, rootDir]) {
      try {
        const raw = await fs.promises.readFile(path.join(base, 'node_modules', ...name.split('/'), 'package.json'), 'utf-8');
        const v = JSON.parse(raw).version;
        if (typeof v === 'string') {
          versions[name] = v;
          break;
        }
      } catch {
        // not installed here
      }
    }
  }
  return { present, versions };
}

export async function readStackConfigFiles(rootDir: string): Promise<{
  configFiles: Record<string, string>;
  installedPackages: Record<string, { present: boolean; versions: Record<string, string> }>;
}> {
  const configFiles: Record<string, string> = {};
  const installedPackages: Record<string, { present: boolean; versions: Record<string, string> }> = {};
  const appDirs = ['', ...(await findNestedAppDirs(rootDir))];
  for (const appRel of appDirs) {
    const prefix = appRel ? `${appRel}/` : '';
    for (const rel of STACK_CONFIG_FILES) {
      const full = path.join(rootDir, prefix + rel);
      try {
        const st = await fs.promises.stat(full);
        if (st.isFile()) configFiles[prefix + rel] = (await fs.promises.readFile(full, 'utf-8')).slice(0, 128 * 1024);
      } catch {
        // missing or unreadable
      }
    }
    const pkg = configFiles[`${prefix}package.json`];
    if (pkg) {
      const installed = await readInstalledVersions(rootDir, appRel, pkg);
      if (installed) installedPackages[appRel] = installed;
    }
  }
  return { configFiles, installedPackages };
}
