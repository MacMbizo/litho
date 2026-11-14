import type {
  DetectedStackProfile,
  FreshnessIssue,
  FreshnessLevel,
  StackFreshnessReport,
} from '../types/docAudit';
import { currentNodeLts, inApp, newestPythonMinor } from './stackInspector';
import { recipeForDependency, type FixRecipe } from './fixRecipes';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Points lost per issue. Platform problems stop an app from running; tooling only slows development. */
const PENALTY: Record<FreshnessIssue['tier'], Record<FreshnessIssue['severity'], number>> = {
  platform: { critical: 25, outdated: 10, minor: 3 },
  library: { critical: 10, outdated: 5, minor: 3 },
  tooling: { critical: 4, outdated: 2, minor: 1 },
};

const PLATFORM_PACKAGES = new Set(['expo', 'react-native', 'next', 'electron', 'nuxt', '@angular/core', '@sveltejs/kit', 'astro']);
const TOOLING_PACKAGES = new Set(['typescript', 'eslint', 'jest', 'vitest', '@playwright/test']);

export function tierOf(name: string): FreshnessIssue['tier'] {
  if (PLATFORM_PACKAGES.has(name)) return 'platform';
  if (TOOLING_PACKAGES.has(name)) return 'tooling';
  return 'library';
}

/** One runnable upgrade for a batch of minor releases; undefined when none of them can be run. */
function mergeUpgrades(deps: Parameters<typeof recipeForDependency>[0][]): FixRecipe | undefined {
  const packages = deps.flatMap((d) => {
    const r = recipeForDependency(d);
    return r && r.kind === 'pkg-upgrade' ? r.packages : [];
  });
  return packages.length > 0 ? { kind: 'pkg-upgrade', packages } : undefined;
}

export function issueWeight(i: Pick<FreshnessIssue, 'tier' | 'severity'>): number {
  return PENALTY[i.tier][i.severity];
}

function fmtDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function where(appPath: string): string {
  return appPath ? ` (${appPath}/)` : '';
}

/**
 * Turns a stack profile into "will this still run?" findings: SDK and framework majors behind,
 * Expo packages that no longer match their SDK, end-of-life Node/Python pins and missing installs.
 * Kept separate from documentation health so each grade means one thing.
 */
export function assessStackFreshness(profile: DetectedStackProfile, nowMs: number = Date.now()): StackFreshnessReport {
  const issues: FreshnessIssue[] = [];
  const deps = profile.dependencies;
  const counts = { critical: 0, outdated: 0, minor: 0, current: 0, unknown: 0 };
  for (const d of deps) counts[d.severity]++;

  // 1. Expo SDK first: it gates everything else in a React Native app.
  for (const d of deps.filter((x) => x.name === 'expo' && (x.severity === 'critical' || x.severity === 'outdated'))) {
    const bundle = profile.latestExpoBundle;
    const ships =
      bundle && bundle.sdkMajor === d.latestMajor && (bundle.reactNative || bundle.react)
        ? ` SDK ${bundle.sdkMajor} ships React Native ${bundle.reactNative || '?'} and React ${bundle.react || '?'}.`
        : '';
    issues.push({
      id: `expo-sdk:${d.appPath || ''}`,
      appPath: d.appPath || '',
      severity: d.severity as 'critical' | 'outdated',
      tier: 'platform',
      title: `Expo SDK ${d.currentMajor} → ${d.latestMajor}${where(d.appPath || '')}`,
      detail: d.notes + ships,
      commands: d.upgradeCommands,
      fix: recipeForDependency(d) ?? undefined,
    });
  }

  // 2. Expo packages that don't match the SDK the app is on (what `npx expo-doctor` would flag).
  const byApp = new Map<string, typeof profile.expoAlignment>();
  for (const a of profile.expoAlignment || []) {
    const list = byApp.get(a.appPath) || [];
    list.push(a);
    byApp.set(a.appPath, list);
  }
  for (const [appPath, list] of byApp) {
    if (!list || list.length === 0) continue;
    const shown = list.slice(0, 6).map((a) => `${a.packageName} ${a.declared} → ${a.expected}`).join(', ');
    issues.push({
      id: `expo-align:${appPath}`,
      appPath,
      severity: list.length >= 5 ? 'outdated' : 'minor',
      tier: 'platform',
      title: `${list.length} package${list.length === 1 ? ' doesn’t' : 's don’t'} match Expo SDK ${list[0].sdkMajor}${where(appPath)}`,
      detail: `Versions differ from what the SDK was tested with, a common cause of build or runtime crashes: ${shown}${list.length > 6 ? `, +${list.length - 6} more` : ''}.`,
      commands: [inApp(appPath, 'npx expo install --fix'), inApp(appPath, 'npx expo-doctor')],
      fix: { kind: 'expo-align', appPath },
    });
  }

  // 3. End-of-life runtimes.
  const nodeLts = currentNodeLts(nowMs);
  const pyNewest = newestPythonMinor(nowMs);
  const seenRuntime = new Set<string>();
  for (const pin of profile.runtimes || []) {
    if (!pin.eolDate) continue;
    const key = `${pin.runtime}:${pin.appPath}:${pin.major}:${pin.minor ?? ''}:${pin.isMinimum}`;
    if (seenRuntime.has(key)) continue;
    seenRuntime.add(key);
    const eolMs = Date.parse(`${pin.eolDate}T00:00:00Z`);
    const label = pin.runtime === 'node' ? `Node ${pin.major}` : `Python 3.${pin.minor}`;
    const target = pin.runtime === 'node' ? `Node ${nodeLts} (current LTS)` : `Python 3.${Math.max(pyNewest - 1, 12)}+`;
    const commands =
      pin.runtime === 'node'
        ? [`nvm install ${nodeLts} && nvm use ${nodeLts}`, `# then update ${pin.source.replace(/ \(.*\)$/, '')} to ${nodeLts}`]
        : [`uv python install 3.${Math.max(pyNewest - 1, 12)}`, `# then update ${pin.source.replace(/ \(.*\)$/, '')}`];
    if (eolMs < nowMs) {
      const daysPast = Math.floor((nowMs - eolMs) / DAY_MS);
      issues.push({
        id: `runtime:${key}`,
        appPath: pin.appPath,
        severity: pin.isMinimum ? 'minor' : daysPast > 365 ? 'critical' : 'outdated',
        tier: 'platform',
        title: pin.isMinimum
          ? `Minimum ${label} is end-of-life${where(pin.appPath)}`
          : `${label} reached end-of-life${where(pin.appPath)}`,
        detail: `${pin.source} ${pin.isMinimum ? 'allows' : 'pins'} ${pin.version}; ${label} stopped getting security fixes on ${fmtDate(pin.eolDate)}. Move to ${target}.`,
        commands,
      });
    } else if (!pin.isMinimum && eolMs - nowMs < 120 * DAY_MS) {
      issues.push({
        id: `runtime:${key}`,
        appPath: pin.appPath,
        severity: 'minor',
        tier: 'platform',
        title: `${label} reaches end-of-life soon${where(pin.appPath)}`,
        detail: `${pin.source} pins ${pin.version}; support ends ${fmtDate(pin.eolDate)}. Plan a move to ${target}.`,
        commands,
      });
    }
  }

  // 4. Framework and library drift (Expo-managed packages were already re-judged against their SDK).
  for (const d of deps) {
    if (d.name === 'expo') continue;
    if (d.severity !== 'critical' && d.severity !== 'outdated') continue;
    const current = d.installedVersion || d.currentVersion;
    issues.push({
      id: `dep:${d.appPath || ''}:${d.name}`,
      appPath: d.appPath || '',
      severity: d.severity,
      tier: tierOf(d.name),
      title: `${d.name} ${current.replace(/^[~^]/, '')} → ${d.latestVersion}${where(d.appPath || '')}`,
      detail: d.notes,
      commands: d.upgradeCommands,
      fix: recipeForDependency(d) ?? undefined,
    });
  }
  const minorDeps = deps.filter((d) => d.severity === 'minor' && !(profile.expoAlignment || []).some((a) => a.packageName === d.name && a.appPath === (d.appPath || '')));
  if (minorDeps.length > 0) {
    issues.push({
      id: 'deps:minor',
      appPath: '',
      severity: 'minor',
      tier: 'library',
      title: `${minorDeps.length} package${minorDeps.length === 1 ? ' has' : 's have'} newer minor releases`,
      detail: minorDeps.map((d) => `${d.name}${d.appPath ? ` (${d.appPath}/)` : ''} → ${d.latestVersion}`).join(', '),
      commands: minorDeps.flatMap((d) => d.upgradeCommands).slice(0, 6),
      fix: mergeUpgrades(minorDeps),
    });
  }

  // 5. Apps whose dependencies aren't installed: the first thing that fails when you come back to a project.
  for (const app of profile.apps || []) {
    if (app.depsInstalled !== false) continue;
    const pm = (app.packageManager || '').split('@')[0] || 'npm';
    issues.push({
      id: `install:${app.path}`,
      appPath: app.path,
      severity: 'minor',
      tier: 'platform',
      title: `Dependencies not installed${where(app.path)}`,
      detail: `${app.path || 'The project root'} has a package.json but no node_modules folder, so it won't start until you install.`,
      commands: [inApp(app.path, `${pm} install`)],
      fix: { kind: 'install', appPath: app.path },
    });
  }

  // Most damaging first: an Expo SDK two behind outranks TypeScript three behind.
  issues.sort((a, b) => issueWeight(b) - issueWeight(a));

  const hasStack = deps.length > 0 || (profile.runtimes || []).length > 0 || (profile.apps || []).length > 0;
  const checked = Boolean(profile.checkedLiveAt);
  let level: FreshnessLevel;
  let score: number | null;
  if (!hasStack) {
    level = 'none';
    score = null;
  } else if (!checked && issues.length === 0) {
    level = 'unchecked';
    score = null;
  } else {
    let minorPenalty = 0;
    let toolingPenalty = 0;
    let penalty = 0;
    for (const i of issues) {
      if (i.severity === 'minor') minorPenalty += issueWeight(i);
      else if (i.tier === 'tooling') toolingPenalty += issueWeight(i);
      else penalty += issueWeight(i);
    }
    score = Math.max(0, 100 - penalty - Math.min(minorPenalty, 12) - Math.min(toolingPenalty, 8));
    // One blocking platform problem (e.g. an SDK several majors behind) is enough to call the project at risk.
    if (issues.some((i) => i.severity === 'critical' && i.tier === 'platform')) score = Math.min(score, 39);
    // A platform that's behind at all (e.g. one Expo SDK behind: Expo Go won't open it) can't be "fresh".
    else if (issues.some((i) => i.severity === 'outdated' && i.tier === 'platform')) score = Math.min(score, 84);
    level = score >= 85 ? 'fresh' : score >= 65 ? 'aging' : score >= 40 ? 'stale' : 'critical';
  }

  const headline =
    level === 'none'
      ? 'No package manifests found'
      : issues[0]
        ? issues[0].title
        : level === 'unchecked'
          ? 'Not yet checked against npm / PyPI'
          : 'All tracked packages are current';

  return { score, level, headline, issues, counts, checkedLiveAt: profile.checkedLiveAt };
}

export const FRESHNESS_META: Record<FreshnessLevel, { label: string; text: string; bg: string; border: string; dot: string }> = {
  fresh: { label: 'Fresh', text: 'text-emerald-300', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', dot: 'bg-emerald-400' },
  aging: { label: 'Aging', text: 'text-sky-300', bg: 'bg-sky-500/10', border: 'border-sky-500/30', dot: 'bg-sky-400' },
  stale: { label: 'Stale', text: 'text-amber-300', bg: 'bg-amber-500/10', border: 'border-amber-500/30', dot: 'bg-amber-400' },
  critical: { label: 'At risk', text: 'text-rose-300', bg: 'bg-rose-500/10', border: 'border-rose-500/30', dot: 'bg-rose-400' },
  unchecked: { label: 'Checking…', text: 'text-neutral-300', bg: 'bg-neutral-500/10', border: 'border-neutral-600/40', dot: 'bg-neutral-500' },
  none: { label: 'No stack', text: 'text-neutral-500', bg: 'bg-neutral-500/5', border: 'border-neutral-700/40', dot: 'bg-neutral-600' },
};
