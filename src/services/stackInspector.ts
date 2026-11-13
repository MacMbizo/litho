import type { ProjectWorkspace } from '../types/document';
import type {
  DetectedStackProfile,
  ExpoAlignmentIssue,
  RuntimePin,
  StackAppUnit,
  StackDependencyStatus,
  StackSeverity,
} from '../types/docAudit';

const REGISTRY_CACHE_KEY = 'newdoc_registry_cache_v1';
const EXPO_BUNDLE_CACHE_KEY = 'newdoc_expo_bundle_cache_v1';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const EXPO_BUNDLE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // a published SDK's bundle rarely changes

interface RegistryCacheEntry {
  latestVersion: string;
  fetchedAt: number;
}

/** Framework-defining packages whose age actually blocks a project from running or deploying. */
export const TRACKED_NPM_PACKAGES = [
  'expo',
  'react-native',
  'expo-router',
  'next',
  'react',
  'vite',
  'electron',
  'typescript',
  '@supabase/supabase-js',
  'firebase',
  'tailwindcss',
  'nativewind',
  'prisma',
  'drizzle-orm',
  'astro',
  'svelte',
  '@sveltejs/kit',
  'vue',
  'nuxt',
  '@angular/core',
  'express',
  'hono',
  '@tanstack/react-query',
  'zod',
  'vitest',
  'jest',
  '@playwright/test',
  'eslint',
  'stripe',
  'openai',
  '@anthropic-ai/sdk',
  'ai',
];

const TRACKED_PYPI_PACKAGES = [
  'fastapi',
  'django',
  'flask',
  'streamlit',
  'pydantic',
  'sqlalchemy',
  'uvicorn',
  'openai',
  'anthropic',
  'langchain',
];

/** Files that make a folder a buildable app unit. */
const APP_MANIFESTS = ['package.json', 'app.json', 'app.config.json', 'app.config.ts', 'app.config.js', 'pyproject.toml', 'requirements.txt'];

export function parseSemverMajor(versionStr?: string): number | null {
  if (!versionStr) return null;
  const cleaned = versionStr.trim().replace(/^[~^>=<v\s]+/, '');
  const match = cleaned.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!match) return null;
  return parseInt(match[1], 10);
}

export function minorOf(versionStr?: string): number {
  const m = (versionStr || '').trim().replace(/^[~^>=<v\s]+/, '').match(/^\d+\.(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

export function cleanVersionString(versionStr?: string): string {
  if (!versionStr) return '';
  return versionStr.trim().replace(/^[~^>=<\s]+/, '');
}

function readJsonCache<T>(key: string): Record<string, T> {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeJsonCache<T>(key: string, cache: Record<string, T>): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(cache));
  } catch {
    // ignore quota errors
  }
}

async function fetchJsonSafe(url: string): Promise<any> {
  try {
    if (typeof window !== 'undefined' && window.electronAPI?.fetchJson) {
      return await window.electronAPI.fetchJson(url);
    }
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function fetchLatestPackageVersion(
  name: string,
  ecosystem: 'npm' | 'pypi',
  forceRefresh = false
): Promise<string | undefined> {
  const cacheKey = `${ecosystem}:${name}`;
  const cache = readJsonCache<RegistryCacheEntry>(REGISTRY_CACHE_KEY);
  const cached = cache[cacheKey];
  if (!forceRefresh && cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.latestVersion;
  }

  let latestVersion: string | undefined;
  if (ecosystem === 'npm') {
    const data = await fetchJsonSafe(`https://registry.npmjs.org/${encodeURIComponent(name).replace('%40', '@')}/latest`);
    if (data && typeof data.version === 'string') latestVersion = data.version;
  } else if (ecosystem === 'pypi') {
    const data = await fetchJsonSafe(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`);
    if (data?.info && typeof data.info.version === 'string') latestVersion = data.info.version;
  }

  if (latestVersion) {
    const fresh = readJsonCache<RegistryCacheEntry>(REGISTRY_CACHE_KEY);
    fresh[cacheKey] = { latestVersion, fetchedAt: Date.now() };
    writeJsonCache(REGISTRY_CACHE_KEY, fresh);
  }
  return latestVersion ?? cached?.latestVersion;
}

/** The package versions a given Expo SDK expects (`bundledNativeModules.json` from the expo package). */
export async function fetchExpoBundledModules(sdkMajor: number, forceRefresh = false): Promise<Record<string, string> | null> {
  const key = String(sdkMajor);
  const cache = readJsonCache<{ modules: Record<string, string>; fetchedAt: number }>(EXPO_BUNDLE_CACHE_KEY);
  const cached = cache[key];
  if (!forceRefresh && cached && Date.now() - cached.fetchedAt < EXPO_BUNDLE_TTL_MS) return cached.modules;
  const data = await fetchJsonSafe(`https://cdn.jsdelivr.net/npm/expo@${sdkMajor}/bundledNativeModules.json`);
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const fresh = readJsonCache<{ modules: Record<string, string>; fetchedAt: number }>(EXPO_BUNDLE_CACHE_KEY);
    fresh[key] = { modules: data, fetchedAt: Date.now() };
    writeJsonCache(EXPO_BUNDLE_CACHE_KEY, fresh);
    return data;
  }
  return cached?.modules ?? null;
}

/** Prefix a shell command so it runs inside a nested app folder. */
export function inApp(appPath: string | undefined, cmd: string): string {
  return appPath ? `cd ${appPath} && ${cmd}` : cmd;
}

export function buildUpgradeGuidance(
  name: string,
  ecosystem: 'npm' | 'pypi' | 'runtime',
  currentMajor: number | null,
  latestVersion: string | undefined,
  latestMajor: number | null,
  currentVersion?: string,
  appPath?: string
): { severity: StackSeverity; majorBehind: number; upgradeCommands: string[]; notes: string } {
  if (currentMajor === null || latestMajor === null || !latestVersion) {
    return {
      severity: 'unknown',
      majorBehind: 0,
      upgradeCommands: [],
      notes: latestVersion ? `Latest registry version: ${latestVersion}` : 'Run live check to compare against registry.',
    };
  }

  const majorBehind = Math.max(0, latestMajor - currentMajor);
  let severity: StackSeverity = 'current';
  if (majorBehind >= 3 || (name === 'expo' && majorBehind >= 2) || (name === 'next' && majorBehind >= 2)) {
    severity = 'critical';
  } else if (majorBehind >= 1 || (currentMajor === 0 && latestMajor === 0 && minorOf(currentVersion) < minorOf(latestVersion) - 5)) {
    severity = 'outdated';
  } else if (currentVersion && minorOf(currentVersion) < minorOf(latestVersion)) {
    severity = 'minor';
  }

  const upgradeCommands: string[] = [];
  let notes = `Up to date (latest ${latestVersion}).`;
  const run = (cmd: string) => upgradeCommands.push(inApp(appPath, cmd));

  if (name === 'expo') {
    if (majorBehind > 0) {
      // Expo recommends moving one SDK at a time; each step has its own breaking-change notes.
      const next = currentMajor + 1;
      run(`npx expo install expo@^${next}.0.0 --fix`);
      run('npx expo-doctor');
      if (majorBehind > 1) upgradeCommands.push(`# then repeat for each SDK up to ${latestMajor}, running the app between steps`);
      notes =
        `Expo SDK ${currentMajor} is ${majorBehind} SDK${majorBehind > 1 ? 's' : ''} behind SDK ${latestMajor} (${latestVersion}). ` +
        `Expo Go from the app stores only runs the newest SDK, so this app likely won't open in it; EAS builds and store submissions may also reject old SDKs. ` +
        (majorBehind > 1 ? `Upgrade one SDK at a time (${currentMajor} → ${next} → … → ${latestMajor}).` : 'Upgrade to the next SDK.');
    } else {
      notes = `Expo SDK ${currentMajor} is the current SDK (${latestVersion}).`;
    }
  } else if (name === 'react-native') {
    if (majorBehind > 0 || severity !== 'current') {
      run('npx expo install --fix');
      notes = `React Native ${cleanVersionString(currentVersion)} is behind latest ${latestVersion}.`;
    }
  } else if (name === 'next') {
    if (majorBehind > 0) {
      run(`npx @next/codemod@latest upgrade ${latestMajor}`);
      notes = `Next.js ${currentMajor} is ${majorBehind} major release${majorBehind > 1 ? 's' : ''} behind ${latestVersion}.`;
    }
  } else if (name === 'electron') {
    if (majorBehind > 0) {
      run(`npm install -D electron@^${latestMajor}.0.0`);
      notes = `Electron ${currentMajor} is ${majorBehind} major version${majorBehind > 1 ? 's' : ''} behind ${latestVersion} (Chromium security & Node runtime updates).`;
    }
  } else if (ecosystem === 'pypi') {
    if (severity !== 'current') {
      run(`pip install -U "${name}>=${latestVersion}"`);
      run(`uv add "${name}>=${latestVersion}"`);
      notes = `${name} ${currentVersion || currentMajor} is behind latest ${latestVersion} on PyPI.`;
    }
  } else if (majorBehind > 0) {
    run(`npm install ${name}@^${latestMajor}.0.0`);
    notes = `${name} v${currentMajor} is ${majorBehind} major version${majorBehind > 1 ? 's' : ''} behind ${latestVersion}.`;
  } else if (severity === 'minor') {
    run(`npm install ${name}@^${latestVersion}`);
    notes = `${name} ${cleanVersionString(currentVersion)} has newer minor/patch releases (latest ${latestVersion}).`;
  }

  return { severity, majorBehind, upgradeCommands, notes };
}

// ---------------------------------------------------------------------------
// Runtime end-of-life (offline: the Node and Python release schedules are regular)
// ---------------------------------------------------------------------------

const NODE_CODENAMES: Record<string, number> = {
  argon: 4, boron: 6, carbon: 8, dubnium: 10, erbium: 12, fermium: 14, gallium: 16, hydrogen: 18, iron: 20, jod: 22, krypton: 24,
};

/** End-of-life date for a Node major (even = LTS, 3 years; odd = ~8 months). */
export function nodeEolDate(major: number): string | undefined {
  if (!Number.isFinite(major) || major <= 0) return undefined;
  if (major < 18) {
    const known: Record<number, string> = { 16: '2023-09-11', 14: '2023-04-30', 12: '2022-04-30', 10: '2021-04-30' };
    return known[major] || '2020-01-01';
  }
  if (major % 2 === 0) return `${2025 + (major - 18) / 2}-04-30`;
  return `${2023 + (major - 19) / 2}-06-01`;
}

/** Newest Node major that has entered LTS at `nowMs` (each even major goes LTS in October). */
export function currentNodeLts(nowMs: number): number {
  const d = new Date(nowMs);
  const year = d.getUTCFullYear() - (d.getUTCMonth() < 9 ? 1 : 0); // LTS starts late October
  return 18 + (year - 2022) * 2;
}

/** Python 3.m reaches end-of-life in October of 2016 + m (3.9 → 2025-10). */
export function pythonEolDate(minor: number): string | undefined {
  if (!Number.isFinite(minor) || minor < 0) return undefined;
  return `${2016 + minor}-10-31`;
}

export function newestPythonMinor(nowMs: number): number {
  const d = new Date(nowMs);
  const year = d.getUTCFullYear() - (d.getUTCMonth() < 9 ? 1 : 0); // 3.m ships each October
  return year - 2011;
}

function parseNodePin(raw: string): { major: number; isMinimum: boolean } | null {
  const v = raw.trim().toLowerCase();
  if (!v || v === 'node' || v === 'lts/*' || v === 'latest' || v === 'current') return null;
  const codename = v.match(/^lts\/(\w+)/);
  if (codename) return NODE_CODENAMES[codename[1]] ? { major: NODE_CODENAMES[codename[1]], isMinimum: false } : null;
  const isMinimum = /^\s*>/.test(v) || /\|\|/.test(v);
  const m = v.match(/(\d+)/);
  if (!m) return null;
  return { major: parseInt(m[1], 10), isMinimum };
}

function parsePythonPin(raw: string): { minor: number; isMinimum: boolean } | null {
  const v = raw.trim();
  const m = v.match(/3\.(\d+)/);
  if (!m) return null;
  return { minor: parseInt(m[1], 10), isMinimum: /^[>^~]/.test(v) };
}

function collectRuntimePins(appPath: string, cfg: (name: string) => string | undefined, prefix: string): RuntimePin[] {
  const pins: RuntimePin[] = [];
  const addNode = (raw: string | undefined, source: string, forceMinimum?: boolean) => {
    if (!raw) return;
    const p = parseNodePin(raw);
    if (!p) return;
    pins.push({ runtime: 'node', version: raw.trim(), major: p.major, source: prefix + source, appPath, isMinimum: forceMinimum ?? p.isMinimum, eolDate: nodeEolDate(p.major) });
  };
  const addPython = (raw: string | undefined, source: string, forceMinimum?: boolean) => {
    if (!raw) return;
    const p = parsePythonPin(raw);
    if (!p) return;
    pins.push({ runtime: 'python', version: raw.trim(), major: 3, minor: p.minor, source: prefix + source, appPath, isMinimum: forceMinimum ?? p.isMinimum, eolDate: pythonEolDate(p.minor) });
  };

  const pkgRaw = cfg('package.json');
  if (pkgRaw) {
    try {
      const pkg = JSON.parse(pkgRaw);
      if (typeof pkg.engines?.node === 'string') addNode(pkg.engines.node, 'package.json (engines.node)');
      if (typeof pkg.volta?.node === 'string') addNode(pkg.volta.node, 'package.json (volta.node)', false);
    } catch {
      // ignore
    }
  }
  addNode(cfg('.nvmrc')?.split(/\r?\n/)[0], '.nvmrc', false);
  addNode(cfg('.node-version')?.split(/\r?\n/)[0], '.node-version', false);
  addPython(cfg('.python-version')?.split(/\r?\n/)[0], '.python-version', false);
  const runtimeTxt = cfg('runtime.txt')?.match(/python-(3\.\d+[\d.]*)/);
  if (runtimeTxt) addPython(runtimeTxt[1], 'runtime.txt', false);

  const toolVersions = cfg('.tool-versions');
  if (toolVersions) {
    addNode(toolVersions.match(/^nodejs\s+(\S+)/m)?.[1], '.tool-versions', false);
    addPython(toolVersions.match(/^python\s+(\S+)/m)?.[1], '.tool-versions', false);
  }

  const pyproject = cfg('pyproject.toml');
  if (pyproject) {
    const req = pyproject.match(/requires-python\s*=\s*["']([^"']+)["']/);
    if (req) addPython(req[1], 'pyproject.toml (requires-python)');
    else {
      const poetry = pyproject.match(/^\s*python\s*=\s*["']([^"']+)["']/m);
      if (poetry) addPython(poetry[1], 'pyproject.toml (python)', true);
    }
  }

  const dockerfile = cfg('Dockerfile');
  if (dockerfile) {
    for (const m of dockerfile.matchAll(/^\s*FROM\s+(?:--platform=\S+\s+)?(?:\S+\/)?(node|python):(\d+(?:\.\d+)?)/gim)) {
      if (m[1].toLowerCase() === 'node') addNode(m[2], 'Dockerfile (FROM node)', false);
      else addPython(m[2], 'Dockerfile (FROM python)', false);
    }
  }
  return pins;
}

// ---------------------------------------------------------------------------
// Project inspection
// ---------------------------------------------------------------------------

function splitConfigKey(key: string): { dir: string; base: string } {
  const i = key.lastIndexOf('/');
  return i < 0 ? { dir: '', base: key } : { dir: key.slice(0, i), base: key.slice(i + 1) };
}

/** Folders (relative to the project root) that hold an app manifest, root first. */
export function discoverAppUnits(configs: Record<string, string>): string[] {
  const dirs = new Set<string>();
  for (const key of Object.keys(configs)) {
    const { dir, base } = splitConfigKey(key);
    if (APP_MANIFESTS.includes(base)) dirs.add(dir);
  }
  return Array.from(dirs).sort((a, b) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)));
}

function detectPort(cfg: (name: string) => string | undefined, scripts: Record<string, string>): number | undefined {
  const devScripts = [scripts.dev, scripts.start, scripts.serve].filter(Boolean).join(' ');
  const allScripts = Object.values(scripts).join(' ');
  const portRe = /(?:--port[= ]|\s-p\s|PORT=)\s*(\d{4,5})/;
  const portMatch = devScripts.match(portRe) || allScripts.match(portRe);
  const viteCfg = ['vite.config.ts', 'vite.config.js', 'vite.config.mts', 'vite.config.mjs'].map((n) => cfg(n)).find(Boolean);
  const viteCfgPort = viteCfg?.match(/server\s*:\s*\{[^}]*?\bport\s*:\s*(\d{4,5})/s);
  if (portMatch) return Number(portMatch[1]);
  if (viteCfgPort) return Number(viteCfgPort[1]);
  if (allScripts.includes('vite')) return 5173;
  if (allScripts.includes('next')) return 3000;
  if (allScripts.includes('expo')) return 8081;
  return undefined;
}

export function inspectProjectStack(project: ProjectWorkspace): DetectedStackProfile {
  const configs = project.configFiles || {};
  const configFilesFound = Object.keys(configs);
  const frameworks = new Set<string>();
  const dependencies: StackDependencyStatus[] = [];
  const apps: StackAppUnit[] = [];
  const runtimes: RuntimePin[] = [];

  let expoSdkVersion: string | undefined;
  let nodeEngine: string | undefined;
  let packageManager: string | undefined;
  let localPort: number | undefined;
  let scripts: Record<string, string> = {};

  const unitDirs = discoverAppUnits(configs);
  // Projects with only Docker/vercel config still get root-level framework detection.
  if (!unitDirs.includes('')) unitDirs.unshift('');

  for (const dir of unitDirs) {
    const prefix = dir ? `${dir}/` : '';
    const cfg = (name: string) => configs[prefix + name];
    const unitFrameworks = new Set<string>();
    const seenDeps = new Set<string>();
    const installed = project.installedPackages?.[dir];
    let unitExpoSdk: string | undefined;
    let unitPm: string | undefined;
    let unitScripts: Record<string, string> = {};
    let npmDependencies: Record<string, string> | undefined;

    const pushDep = (dep: Omit<StackDependencyStatus, 'appPath' | 'installedVersion'>) => {
      if (seenDeps.has(dep.name)) return;
      seenDeps.add(dep.name);
      dependencies.push({ ...dep, appPath: dir, installedVersion: installed?.versions[dep.name] });
    };

    // 1. app.config.json / app.json (Expo)
    for (const cfgName of ['app.config.json', 'app.json']) {
      const raw = cfg(cfgName);
      if (!raw) continue;
      try {
        const json = JSON.parse(raw);
        const expoNode = json.expo || json;
        if (expoNode && (json.expo || expoNode.sdkVersion || expoNode.slug || expoNode.ios || expoNode.android)) {
          unitFrameworks.add('Expo');
          if (typeof expoNode.sdkVersion === 'string') {
            unitExpoSdk = expoNode.sdkVersion;
            pushDep({
              name: 'expo',
              ecosystem: 'npm',
              sourceFile: `${prefix}${cfgName} (expo.sdkVersion)`,
              currentVersion: expoNode.sdkVersion,
              currentMajor: parseSemverMajor(expoNode.sdkVersion),
              severity: 'unknown',
              upgradeCommands: [],
              notes: `Configured Expo SDK ${expoNode.sdkVersion} in ${prefix}${cfgName}`,
            });
          }
        }
      } catch {
        // ignore invalid JSON
      }
    }

    // 2. app.config.ts / app.config.js
    for (const cfgName of ['app.config.ts', 'app.config.js']) {
      const raw = cfg(cfgName);
      if (!raw) continue;
      unitFrameworks.add('Expo');
      const sdkMatch = raw.match(/sdkVersion\s*:\s*['"]([^'"]+)['"]/);
      if (sdkMatch && sdkMatch[1]) {
        unitExpoSdk = unitExpoSdk || sdkMatch[1];
        pushDep({
          name: 'expo',
          ecosystem: 'npm',
          sourceFile: `${prefix}${cfgName} (sdkVersion)`,
          currentVersion: sdkMatch[1],
          currentMajor: parseSemverMajor(sdkMatch[1]),
          severity: 'unknown',
          upgradeCommands: [],
          notes: `Configured Expo SDK ${sdkMatch[1]} in ${prefix}${cfgName}`,
        });
      }
    }

    // 3. package.json
    const pkgRaw = cfg('package.json');
    if (pkgRaw) {
      try {
        const pkg = JSON.parse(pkgRaw);
        if (pkg.scripts && typeof pkg.scripts === 'object') unitScripts = pkg.scripts;
        if (typeof pkg.engines?.node === 'string') nodeEngine = nodeEngine || pkg.engines.node;
        if (typeof pkg.packageManager === 'string') unitPm = pkg.packageManager;

        const allDeps: Record<string, string> = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
        npmDependencies = allDeps;

        if (allDeps['expo']) unitFrameworks.add('Expo');
        if (allDeps['react-native']) unitFrameworks.add('React Native');
        if (allDeps['next']) unitFrameworks.add('Next.js');
        else if (allDeps['react'] && !allDeps['react-native']) unitFrameworks.add('React');
        if (allDeps['electron']) unitFrameworks.add('Electron');
        if (allDeps['vite']) unitFrameworks.add('Vite');
        if (allDeps['typescript']) unitFrameworks.add('TypeScript');
        if (allDeps['tailwindcss'] || allDeps['nativewind']) unitFrameworks.add('Tailwind CSS');
        if (allDeps['@supabase/supabase-js'] || allDeps['@supabase/ssr']) unitFrameworks.add('Supabase');
        if (allDeps['firebase'] || allDeps['firebase-admin']) unitFrameworks.add('Firebase');
        if (allDeps['prisma'] || allDeps['@prisma/client']) unitFrameworks.add('Prisma');
        if (allDeps['drizzle-orm']) unitFrameworks.add('Drizzle');
        if (allDeps['astro']) unitFrameworks.add('Astro');
        if (allDeps['svelte']) unitFrameworks.add('Svelte');
        if (allDeps['vue']) unitFrameworks.add('Vue');
        if (allDeps['@angular/core']) unitFrameworks.add('Angular');
        if (allDeps['express'] || allDeps['hono']) unitFrameworks.add('Node API');

        for (const pkgName of TRACKED_NPM_PACKAGES) {
          const ver = allDeps[pkgName];
          if (!ver) continue;
          if (pkgName === 'expo' && !unitExpoSdk) unitExpoSdk = cleanVersionString(ver);
          pushDep({
            name: pkgName,
            ecosystem: 'npm',
            sourceFile: `${prefix}package.json`,
            currentVersion: ver,
            currentMajor: parseSemverMajor(installed?.versions[pkgName] || ver),
            severity: 'unknown',
            upgradeCommands: [],
            notes: `Declared in ${prefix}package.json (${ver})`,
          });
        }
      } catch {
        // ignore invalid package.json
      }
    }

    // 4. Python manifests
    const pyproject = cfg('pyproject.toml');
    const requirements = cfg('requirements.txt');
    if (pyproject || requirements) {
      unitFrameworks.add('Python');
      const pyText = `${pyproject || ''}\n${requirements || ''}`;
      for (const pyPkg of TRACKED_PYPI_PACKAGES) {
        // Handles requirements (`fastapi==0.110`), PEP 621 (`"fastapi>=0.110"`) and Poetry (`fastapi = "^0.110.0"`)
        const m = pyText.match(
          new RegExp(
            `(?<![\\w-])${pyPkg}(?![\\w-])\\s*(?:\\[[^\\]]*\\])?\\s*(?:=\\s*)?["']?\\s*(?:[\\^~>=<!]=?\\s*)*([0-9][0-9a-zA-Z.]*)`,
            'i'
          )
        );
        if (!m) continue;
        if (['fastapi', 'django', 'flask', 'streamlit'].includes(pyPkg)) {
          unitFrameworks.add(pyPkg.charAt(0).toUpperCase() + pyPkg.slice(1));
        }
        pushDep({
          name: pyPkg,
          ecosystem: 'pypi',
          sourceFile: `${prefix}${pyproject ? 'pyproject.toml' : 'requirements.txt'}`,
          currentVersion: m[1],
          currentMajor: parseSemverMajor(m[1]),
          severity: 'unknown',
          upgradeCommands: [],
          notes: `Python dependency (${m[1]})`,
        });
      }
    }

    let unitPort = detectPort(cfg, unitScripts);
    if (!unitPort && (unitFrameworks.has('Fastapi') || unitFrameworks.has('Django') || unitFrameworks.has('Streamlit') || unitFrameworks.has('Flask'))) {
      const runtimeText = ['pyproject.toml', 'Dockerfile', 'docker-compose.yml', 'docker-compose.yaml', 'Procfile']
        .map((n) => cfg(n) || '')
        .join('\n');
      const pyPort = runtimeText.match(/(?:--port[= ]|--server\.port[= ])\s*(\d{4,5})/);
      unitPort = pyPort ? Number(pyPort[1]) : unitFrameworks.has('Streamlit') ? 8501 : unitFrameworks.has('Flask') ? 5000 : 8000;
    }

    if (cfg('eas.json')) unitFrameworks.add('EAS Build');
    if (cfg('Dockerfile') || cfg('docker-compose.yml') || cfg('docker-compose.yaml')) unitFrameworks.add('Docker');
    if (cfg('supabase/config.toml')) unitFrameworks.add('Supabase');

    runtimes.push(...collectRuntimePins(dir, cfg, prefix));

    unitFrameworks.forEach((f) => frameworks.add(f));
    if (!expoSdkVersion && unitExpoSdk) expoSdkVersion = installed?.versions['expo'] || unitExpoSdk;
    if (!packageManager && unitPm) packageManager = unitPm;
    if (!localPort && unitPort) localPort = unitPort;
    if (Object.keys(scripts).length === 0 && Object.keys(unitScripts).length > 0) scripts = unitScripts;

    const manifests = APP_MANIFESTS.filter((m) => cfg(m) !== undefined);
    if (manifests.length > 0) {
      apps.push({
        path: dir,
        label: dir || project.name,
        manifests: manifests.map((m) => prefix + m),
        frameworks: Array.from(unitFrameworks),
        expoSdkVersion: installed?.versions['expo'] || unitExpoSdk,
        packageManager: unitPm,
        npmDependencies,
        depsInstalled: pkgRaw && npmDependencies && Object.keys(npmDependencies).length > 0 ? installed?.present ?? undefined : undefined,
      });
    }
  }

  return {
    frameworks: Array.from(frameworks),
    configFilesFound,
    expoSdkVersion,
    nodeEngine,
    packageManager,
    localPort,
    scripts,
    dependencies,
    apps,
    runtimes,
  };
}

// ---------------------------------------------------------------------------
// Live registry check + Expo SDK alignment
// ---------------------------------------------------------------------------

function versionTriple(v?: string): [number, number, number] | null {
  const m = (v || '').match(/(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!m) {
    const major = (v || '').match(/^\D*(\d+)\s*$/);
    return major ? [parseInt(major[1], 10), 0, 0] : null;
  }
  return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3] || '0', 10)];
}

/** Packages in an Expo app whose declared version differs (major/minor) from what the SDK expects. */
export function findExpoMisalignments(
  appPath: string,
  sdkMajor: number,
  declared: Record<string, string>,
  expected: Record<string, string>
): ExpoAlignmentIssue[] {
  const issues: ExpoAlignmentIssue[] = [];
  for (const [name, exp] of Object.entries(expected)) {
    const dec = declared[name];
    if (!dec || name === 'expo') continue;
    if (/^(?:file:|link:|workspace:|git|github:|https?:|npm:)/.test(dec) || dec === '*' || dec === 'latest') continue;
    const a = versionTriple(dec);
    const b = versionTriple(exp);
    if (!a || !b) continue;
    if (a[0] !== b[0] || a[1] !== b[1]) {
      issues.push({ appPath, sdkMajor, packageName: name, declared: dec, expected: exp });
    }
  }
  return issues.sort((x, y) => x.packageName.localeCompare(y.packageName));
}

const SEVERITY_ORDER: Record<StackSeverity, number> = { critical: 0, outdated: 1, minor: 2, current: 3, unknown: 4 };

export async function checkLiveStackVersions(
  profile: DetectedStackProfile,
  forceRefresh = false
): Promise<DetectedStackProfile> {
  const updatedDeps: StackDependencyStatus[] = await Promise.all(
    profile.dependencies.map(async (dep) => {
      if (dep.ecosystem === 'runtime') return dep;
      const latestVersion = await fetchLatestPackageVersion(dep.name, dep.ecosystem, forceRefresh);
      if (!latestVersion) return dep;
      const latestMajor = parseSemverMajor(latestVersion);
      const compareVersion = dep.installedVersion || dep.currentVersion;
      const guidance = buildUpgradeGuidance(
        dep.name,
        dep.ecosystem,
        parseSemverMajor(compareVersion),
        latestVersion,
        latestMajor,
        compareVersion,
        dep.appPath
      );
      return {
        ...dep,
        currentMajor: parseSemverMajor(compareVersion),
        latestVersion,
        latestMajor,
        majorBehind: guidance.majorBehind,
        severity: guidance.severity,
        upgradeCommands: guidance.upgradeCommands,
        notes: guidance.notes,
      };
    })
  );

  // Expo apps: packages pinned by the SDK are judged against the SDK, not against npm "latest".
  const expoAlignment: ExpoAlignmentIssue[] = [];
  let latestExpoBundle: DetectedStackProfile['latestExpoBundle'];
  const expoApps = (profile.apps || []).filter((a) => a.expoSdkVersion && a.npmDependencies);
  for (const app of expoApps) {
    const sdkMajor = parseSemverMajor(app.expoSdkVersion);
    if (sdkMajor === null) continue;
    const bundle = await fetchExpoBundledModules(sdkMajor, forceRefresh);
    if (!bundle) continue;
    const issues = findExpoMisalignments(app.path, sdkMajor, app.npmDependencies!, bundle);
    expoAlignment.push(...issues);
    for (let i = 0; i < updatedDeps.length; i++) {
      const dep = updatedDeps[i];
      if ((dep.appPath || '') !== app.path || dep.name === 'expo' || !(dep.name in bundle)) continue;
      const mismatch = issues.find((x) => x.packageName === dep.name);
      updatedDeps[i] = {
        ...dep,
        severity: mismatch ? 'minor' : 'current',
        majorBehind: 0,
        upgradeCommands: mismatch ? [inApp(app.path, 'npx expo install --fix')] : [],
        notes: mismatch
          ? `Expo SDK ${sdkMajor} expects ${dep.name} ${mismatch.expected}; project declares ${mismatch.declared}.`
          : `Managed by Expo SDK ${sdkMajor} (expects ${bundle[dep.name]}). Upgrade it together with the SDK.`,
      };
    }
  }

  const expoDep = updatedDeps.find((d) => d.name === 'expo' && d.latestVersion);
  const latestSdk = parseSemverMajor(expoDep?.latestVersion);
  if (latestSdk !== null && expoApps.length > 0) {
    const latestBundle = await fetchExpoBundledModules(latestSdk, forceRefresh);
    if (latestBundle) {
      latestExpoBundle = {
        sdkMajor: latestSdk,
        reactNative: cleanVersionString(latestBundle['react-native']),
        react: cleanVersionString(latestBundle['react']),
      };
    }
  }

  updatedDeps.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

  return {
    ...profile,
    dependencies: updatedDeps,
    expoAlignment,
    latestExpoBundle,
    checkedLiveAt: new Date().toISOString(),
  };
}

export function generateUpgradePlanMarkdown(projectName: string, profile: DetectedStackProfile): string {
  const outdated = profile.dependencies.filter((d) => d.severity === 'critical' || d.severity === 'outdated');
  const lines: string[] = [
    '---',
    `title: "${projectName} Stack Upgrade Plan"`,
    'type: "document"',
    'status: "In Progress"',
    'tags: ["upgrade", "tech-stack", "maintenance"]',
    '---',
    '',
    `# 🚀 Tech Stack Upgrade Plan — ${projectName}`,
    '',
    `> Generated by **Litho Stack Inspector** on ${new Date().toISOString().slice(0, 10)}.`,
    '',
    `## Detected Stack`,
    profile.frameworks.length > 0 ? profile.frameworks.map((f) => `- **${f}**`).join('\n') : '- Custom / General Project',
    '',
    '## Version Drift Summary',
    '',
    '| Package | Source | Current | Latest | Status |',
    '| :--- | :--- | :--- | :--- | :--- |',
  ];

  for (const dep of profile.dependencies) {
    const current = dep.installedVersion ? `${dep.currentVersion} (installed ${dep.installedVersion})` : dep.currentVersion;
    lines.push(
      `| \`${dep.name}\` | \`${dep.sourceFile}\` | \`${current}\` | \`${dep.latestVersion || 'unknown'}\` | **${dep.severity.toUpperCase()}** |`
    );
  }

  if (profile.expoAlignment && profile.expoAlignment.length > 0) {
    lines.push('', '## Expo SDK Alignment', '', '| App | Package | Declared | SDK expects |', '| :--- | :--- | :--- | :--- |');
    for (const a of profile.expoAlignment) {
      lines.push(`| \`${a.appPath || '.'}\` | \`${a.packageName}\` | \`${a.declared}\` | \`${a.expected}\` (SDK ${a.sdkMajor}) |`);
    }
  }

  lines.push('');
  lines.push('## Actionable Upgrade Checklist');
  lines.push('');

  if (outdated.length === 0) {
    lines.push('- [x] All tracked framework dependencies are up to date!');
  } else {
    lines.push('- [ ] Create a clean git branch (`git checkout -b chore/upgrade-stack`)');
    for (const dep of outdated) {
      lines.push(`- [ ] Upgrade **${dep.name}** (${dep.currentVersion} → ${dep.latestVersion || 'latest'}): ${dep.notes}`);
      if (dep.upgradeCommands.length > 0) {
        lines.push('  ```bash');
        for (const cmd of dep.upgradeCommands) lines.push(`  ${cmd}`);
        lines.push('  ```');
      }
    }
    lines.push('- [ ] Run test suite and verify local build / dev server startup');
    lines.push('- [ ] Update `README.md` & `ARCHITECTURE.md` with new SDK/runtime requirements');
  }

  return lines.join('\n') + '\n';
}
