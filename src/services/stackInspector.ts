import type { ProjectWorkspace } from '../types/document';
import type {
  DetectedStackProfile,
  StackDependencyStatus,
  StackSeverity,
} from '../types/docAudit';

const REGISTRY_CACHE_KEY = 'newdoc_registry_cache_v1';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface RegistryCacheEntry {
  latestVersion: string;
  fetchedAt: number;
}

const TRACKED_NPM_PACKAGES = [
  'expo',
  'react-native',
  'next',
  'react',
  'vite',
  'electron',
  'typescript',
  '@supabase/supabase-js',
  'tailwindcss',
  'prisma',
  'drizzle-orm',
];

const TRACKED_PYPI_PACKAGES = ['fastapi', 'django', 'streamlit', 'openai', 'anthropic'];

export function parseSemverMajor(versionStr?: string): number | null {
  if (!versionStr) return null;
  const cleaned = versionStr.trim().replace(/^[~^>=<v\s]+/, '');
  const match = cleaned.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!match) return null;
  return parseInt(match[1], 10);
}

export function cleanVersionString(versionStr?: string): string {
  if (!versionStr) return '';
  return versionStr.trim().replace(/^[~^>=<\s]+/, '');
}

function readCache(): Record<string, RegistryCacheEntry> {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(REGISTRY_CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeCache(cache: Record<string, RegistryCacheEntry>): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(REGISTRY_CACHE_KEY, JSON.stringify(cache));
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
  const cache = readCache();
  const cached = cache[cacheKey];
  if (!forceRefresh && cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.latestVersion;
  }

  let latestVersion: string | undefined;
  if (ecosystem === 'npm') {
    const data = await fetchJsonSafe(`https://registry.npmjs.org/${encodeURIComponent(name)}/latest`);
    if (data && typeof data.version === 'string') {
      latestVersion = data.version;
    }
  } else if (ecosystem === 'pypi') {
    const data = await fetchJsonSafe(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`);
    if (data?.info && typeof data.info.version === 'string') {
      latestVersion = data.info.version;
    }
  }

  if (latestVersion) {
    cache[cacheKey] = { latestVersion, fetchedAt: Date.now() };
    writeCache(cache);
  }

  return latestVersion;
}

function buildUpgradeGuidance(
  name: string,
  currentMajor: number | null,
  latestVersion: string | undefined,
  latestMajor: number | null
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
  } else if (majorBehind >= 1) {
    severity = 'outdated';
  } else if (cleanVersionString(latestVersion) !== String(currentMajor)) {
    severity = 'current';
  }

  const upgradeCommands: string[] = [];
  let notes = `Up to date (latest ${latestVersion}).`;

  if (name === 'expo') {
    if (majorBehind > 0) {
      upgradeCommands.push(`npx expo install expo@^${latestMajor}.0.0`);
      upgradeCommands.push('npx expo install --fix');
      upgradeCommands.push('npx expo-doctor');
      notes = `Expo SDK ${currentMajor} is ${majorBehind} major version${majorBehind > 1 ? 's' : ''} behind SDK ${latestMajor} (${latestVersion}). Expo Go & native EAS builds may reject SDK ${currentMajor}.`;
    } else {
      notes = `Expo SDK ${currentMajor} matches current major release (${latestVersion}).`;
    }
  } else if (name === 'react-native') {
    if (majorBehind > 0) {
      upgradeCommands.push('npx expo install --fix');
      notes = `React Native ${currentMajor}.x is behind latest ${latestVersion}.`;
    }
  } else if (name === 'next') {
    if (majorBehind > 0) {
      upgradeCommands.push(`npm install next@${latestMajor} react@latest react-dom@latest`);
      upgradeCommands.push(`npx @next/codemod@latest upgrade ${latestMajor}`);
      notes = `Next.js ${currentMajor} is ${majorBehind} major release${majorBehind > 1 ? 's' : ''} behind ${latestVersion}.`;
    }
  } else if (name === 'electron') {
    if (majorBehind >= 2) {
      upgradeCommands.push(`npm install -D electron@^${latestMajor}.0.0`);
      notes = `Electron ${currentMajor} is ${majorBehind} major versions behind ${latestVersion} (Chromium security & Node runtime updates).`;
    }
  } else if (majorBehind > 0) {
    upgradeCommands.push(`npm install ${name}@^${latestMajor}.0.0`);
    notes = `${name} v${currentMajor} is ${majorBehind} major version${majorBehind > 1 ? 's' : ''} behind ${latestVersion}.`;
  }

  return { severity, majorBehind, upgradeCommands, notes };
}

export function inspectProjectStack(project: ProjectWorkspace): DetectedStackProfile {
  const configs = project.configFiles || {};
  const configFilesFound = Object.keys(configs);
  const frameworks = new Set<string>();
  const dependencies: StackDependencyStatus[] = [];
  const seenDeps = new Set<string>();

  let expoSdkVersion: string | undefined;
  let nodeEngine: string | undefined;
  let packageManager: string | undefined;
  let localPort: number | undefined;
  let scripts: Record<string, string> = {};

  // 1. Inspect app.config.json / app.json (Expo / React Native)
  for (const cfgName of ['app.config.json', 'app.json']) {
    const raw = configs[cfgName];
    if (!raw) continue;
    try {
      const json = JSON.parse(raw);
      const expoNode = json.expo || json;
      if (expoNode && (json.expo || expoNode.sdkVersion || expoNode.slug || expoNode.ios || expoNode.android)) {
        frameworks.add('Expo');
        if (typeof expoNode.sdkVersion === 'string') {
          const sdkVer = expoNode.sdkVersion;
          expoSdkVersion = sdkVer;
          const major = parseSemverMajor(sdkVer);
          if (!seenDeps.has('expo')) {
            seenDeps.add('expo');
            dependencies.push({
              name: 'expo',
              ecosystem: 'npm',
              sourceFile: `${cfgName} (expo.sdkVersion)`,
              currentVersion: sdkVer,
              currentMajor: major,
              severity: 'unknown',
              upgradeCommands: [],
              notes: `Configured Expo SDK ${sdkVer} in ${cfgName}`,
            });
          }
        }
      }
    } catch {
      // ignore invalid JSON
    }
  }

  // 2. Inspect app.config.ts / app.config.js
  for (const cfgName of ['app.config.ts', 'app.config.js']) {
    const raw = configs[cfgName];
    if (!raw) continue;
    frameworks.add('Expo');
    const sdkMatch = raw.match(/sdkVersion\s*:\s*['"]([^'"]+)['"]/);
    if (sdkMatch && sdkMatch[1]) {
      expoSdkVersion = expoSdkVersion || sdkMatch[1];
      if (!seenDeps.has('expo')) {
        seenDeps.add('expo');
        dependencies.push({
          name: 'expo',
          ecosystem: 'npm',
          sourceFile: `${cfgName} (sdkVersion)`,
          currentVersion: sdkMatch[1],
          currentMajor: parseSemverMajor(sdkMatch[1]),
          severity: 'unknown',
          upgradeCommands: [],
          notes: `Configured Expo SDK ${sdkMatch[1]} in ${cfgName}`,
        });
      }
    }
  }

  // 3. Inspect package.json
  if (configs['package.json']) {
    try {
      const pkg = JSON.parse(configs['package.json']);
      if (pkg.scripts && typeof pkg.scripts === 'object') {
        scripts = pkg.scripts;
        const allScripts = Object.values(scripts).join(' ');
        const portMatch = allScripts.match(/(?:--port|-p|PORT=)\s*(\d{4,5})/);
        if (portMatch) localPort = Number(portMatch[1]);
        else if (allScripts.includes('vite')) localPort = 5173;
        else if (allScripts.includes('next')) localPort = 3000;
        else if (allScripts.includes('expo')) localPort = 8081;
      }

      if (pkg.engines?.node) nodeEngine = pkg.engines.node;
      if (pkg.packageManager) packageManager = pkg.packageManager;

      const allDeps: Record<string, string> = {
        ...(pkg.dependencies || {}),
        ...(pkg.devDependencies || {}),
      };

      if (allDeps['expo']) frameworks.add('Expo');
      if (allDeps['react-native']) frameworks.add('React Native');
      if (allDeps['next']) frameworks.add('Next.js');
      else if (allDeps['react']) frameworks.add('React');
      if (allDeps['electron']) frameworks.add('Electron');
      if (allDeps['vite']) frameworks.add('Vite');
      if (allDeps['typescript']) frameworks.add('TypeScript');
      if (allDeps['tailwindcss']) frameworks.add('Tailwind CSS');
      if (allDeps['@supabase/supabase-js'] || allDeps['@supabase/ssr']) frameworks.add('Supabase');
      if (allDeps['prisma'] || allDeps['@prisma/client']) frameworks.add('Prisma');
      if (allDeps['drizzle-orm']) frameworks.add('Drizzle');

      for (const pkgName of TRACKED_NPM_PACKAGES) {
        const ver = allDeps[pkgName];
        if (!ver) continue;
        if (pkgName === 'expo' && !expoSdkVersion) {
          expoSdkVersion = cleanVersionString(ver);
        }
        if (seenDeps.has(pkgName)) continue;
        seenDeps.add(pkgName);

        dependencies.push({
          name: pkgName,
          ecosystem: 'npm',
          sourceFile: 'package.json',
          currentVersion: ver,
          currentMajor: parseSemverMajor(ver),
          severity: 'unknown',
          upgradeCommands: [],
          notes: `Installed in package.json (${ver})`,
        });
      }
    } catch {
      // ignore invalid package.json
    }
  }

  // 4. Inspect Python manifests
  if (configs['pyproject.toml'] || configs['requirements.txt']) {
    frameworks.add('Python');
    const pyText = `${configs['pyproject.toml'] || ''}\n${configs['requirements.txt'] || ''}`;
    for (const pyPkg of TRACKED_PYPI_PACKAGES) {
      const m = pyText.match(new RegExp(`\\b${pyPkg}\\s*[=<>~!]+\\s*([0-9][0-9a-zA-Z.]*)`, 'i'));
      if (m && !seenDeps.has(pyPkg)) {
        seenDeps.add(pyPkg);
        frameworks.add(pyPkg.charAt(0).toUpperCase() + pyPkg.slice(1));
        dependencies.push({
          name: pyPkg,
          ecosystem: 'pypi',
          sourceFile: configs['pyproject.toml'] ? 'pyproject.toml' : 'requirements.txt',
          currentVersion: m[1],
          currentMajor: parseSemverMajor(m[1]),
          severity: 'unknown',
          upgradeCommands: [],
          notes: `Python dependency (${m[1]})`,
        });
      }
    }
  }

  if (configs['eas.json']) frameworks.add('EAS Build');
  if (configs['Dockerfile'] || configs['docker-compose.yml']) frameworks.add('Docker');
  if (configs['supabase/config.toml']) frameworks.add('Supabase');

  return {
    frameworks: Array.from(frameworks),
    configFilesFound,
    expoSdkVersion,
    nodeEngine,
    packageManager,
    localPort,
    scripts,
    dependencies,
  };
}

export async function checkLiveStackVersions(
  profile: DetectedStackProfile,
  forceRefresh = false
): Promise<DetectedStackProfile> {
  const updatedDeps = await Promise.all(
    profile.dependencies.map(async (dep) => {
      if (dep.ecosystem === 'runtime') return dep;
      const latestVersion = await fetchLatestPackageVersion(dep.name, dep.ecosystem, forceRefresh);
      if (!latestVersion) return dep;

      const latestMajor = parseSemverMajor(latestVersion);
      const guidance = buildUpgradeGuidance(dep.name, dep.currentMajor, latestVersion, latestMajor);
      return {
        ...dep,
        latestVersion,
        latestMajor,
        majorBehind: guidance.majorBehind,
        severity: guidance.severity,
        upgradeCommands: guidance.upgradeCommands,
        notes: guidance.notes,
      };
    })
  );

  // Sort critical/outdated items first
  const order: Record<StackSeverity, number> = {
    critical: 0,
    outdated: 1,
    minor: 2,
    current: 3,
    unknown: 4,
  };
  updatedDeps.sort((a, b) => order[a.severity] - order[b.severity]);

  return {
    ...profile,
    dependencies: updatedDeps,
    checkedLiveAt: new Date().toISOString(),
  };
}

export function generateUpgradePlanMarkdown(
  projectName: string,
  profile: DetectedStackProfile
): string {
  const outdated = profile.dependencies.filter(
    (d) => d.severity === 'critical' || d.severity === 'outdated'
  );
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
    `> Generated by **Markdown Studio Stack Inspector** on ${new Date().toISOString().slice(0, 10)}.`,
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
    lines.push(
      `| \`${dep.name}\` | \`${dep.sourceFile}\` | \`${dep.currentVersion}\` | \`${dep.latestVersion || 'unknown'}\` | **${dep.severity.toUpperCase()}** |`
    );
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
        for (const cmd of dep.upgradeCommands) {
          lines.push(`  ${cmd}`);
        }
        lines.push('  ```');
      }
    }
    lines.push('- [ ] Run test suite and verify local build / dev server startup');
    lines.push('- [ ] Update `README.md` & `ARCHITECTURE.md` with new SDK/runtime requirements');
  }

  return lines.join('\n') + '\n';
}
