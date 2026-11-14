import assert from 'node:assert';
import test from 'node:test';
import {
  validateRecipe,
  recipeForDependency,
  detectPackageManager,
  buildSteps,
  quoteWinArg,
  toCmdLine,
  type AppContext,
} from '../src/services/fixRecipes.ts';
import { assessStackFreshness } from '../src/services/stackFreshness.ts';
import type { StackDependencyStatus, DetectedStackProfile } from '../src/types/docAudit.ts';

const NOW = Date.UTC(2026, 10, 14);

function dep(over: Partial<StackDependencyStatus>): StackDependencyStatus {
  return {
    name: 'x',
    ecosystem: 'npm',
    sourceFile: 'package.json',
    currentVersion: '^1.0.0',
    currentMajor: 1,
    appPath: '',
    severity: 'outdated',
    upgradeCommands: [],
    notes: '',
    ...over,
  };
}

const npmCtx = (dev: string[] = []): ((p: string) => AppContext) => () => ({ pm: 'npm', devDeps: new Set(dev) });

// --- validateRecipe -------------------------------------------------------

test('validateRecipe accepts a one-SDK Expo step', () => {
  const r = validateRecipe({ kind: 'expo-sdk-step', appPath: 'mobile', fromMajor: 50, toMajor: 51 });
  assert.strictEqual(r.kind, 'expo-sdk-step');
});

test('validateRecipe refuses paths outside the project, multi-SDK jumps and bad names/ranges', () => {
  const bad: unknown[] = [
    { kind: 'expo-align', appPath: '../x' },
    { kind: 'expo-align', appPath: 'C:\\x' },
    { kind: 'expo-align', appPath: '/x' },
    { kind: 'expo-sdk-step', appPath: '', fromMajor: 50, toMajor: 52 },
    { kind: 'pkg-upgrade', packages: [{ appPath: '', name: 'a b', range: '^1.0.0' }] },
    { kind: 'pkg-upgrade', packages: [{ appPath: '', name: 'react', range: 'latest' }] },
    { kind: 'pkg-upgrade', packages: [] },
    { kind: 'rm-rf', appPath: '' },
    null,
  ];
  for (const r of bad) assert.throws(() => validateRecipe(r), /Invalid fix/, JSON.stringify(r));
});

// --- recipeForDependency --------------------------------------------------

test('recipeForDependency: Expo moves one SDK, RN aligns, next/pypi/current are copy-only', () => {
  assert.deepStrictEqual(recipeForDependency(dep({ name: 'expo', currentMajor: 50, latestMajor: 54, latestVersion: '54.0.1', appPath: 'mobile', severity: 'critical' })), {
    kind: 'expo-sdk-step',
    appPath: 'mobile',
    fromMajor: 50,
    toMajor: 51,
  });
  assert.deepStrictEqual(recipeForDependency(dep({ name: 'react-native', appPath: 'mobile' })), { kind: 'expo-align', appPath: 'mobile' });
  assert.strictEqual(recipeForDependency(dep({ name: 'next', latestMajor: 16, latestVersion: '16.0.0' })), null);
  assert.strictEqual(recipeForDependency(dep({ name: 'django', ecosystem: 'pypi', latestMajor: 6, latestVersion: '6.0' })), null);
  assert.strictEqual(recipeForDependency(dep({ name: 'typescript', severity: 'current', latestMajor: 1, latestVersion: '1.0.0' })), null);
});

test('recipeForDependency: npm majors get ^N.0.0, minors get ^latest', () => {
  assert.deepStrictEqual(recipeForDependency(dep({ name: 'typescript', currentMajor: 5, majorBehind: 1, latestMajor: 6, latestVersion: '6.0.2' })), {
    kind: 'pkg-upgrade',
    packages: [{ appPath: '', name: 'typescript', range: '^6.0.0' }],
  });
  assert.deepStrictEqual(recipeForDependency(dep({ name: 'zod', severity: 'minor', currentMajor: 5, majorBehind: 0, latestMajor: 5, latestVersion: '5.4.2' })), {
    kind: 'pkg-upgrade',
    packages: [{ appPath: '', name: 'zod', range: '^5.4.2' }],
  });
});

// --- detectPackageManager -------------------------------------------------

test('detectPackageManager: packageManager field, then lockfile, else npm', () => {
  assert.strictEqual(detectPackageManager('pnpm@9.1.0', []), 'pnpm');
  assert.strictEqual(detectPackageManager(undefined, ['yarn.lock']), 'yarn');
  assert.strictEqual(detectPackageManager(undefined, ['bun.lock']), 'bun');
  assert.strictEqual(detectPackageManager(undefined, ['bun.lockb']), 'bun');
  assert.strictEqual(detectPackageManager(undefined, ['package.json']), 'npm');
});

// --- buildSteps -----------------------------------------------------------

test('buildSteps: Expo step installs the next SDK then checks with expo-doctor', () => {
  const steps = buildSteps({ kind: 'expo-sdk-step', appPath: 'mobile', fromMajor: 50, toMajor: 51 }, npmCtx());
  assert.deepStrictEqual(steps.map((s) => [s.argv, s.isCheck, s.appPath]), [
    [['npx', 'expo', 'install', 'expo@^51.0.0', '--fix'], false, 'mobile'],
    [['npx', 'expo-doctor'], true, 'mobile'],
  ]);
});

test('buildSteps: package upgrades split dev and prod, per package manager', () => {
  const r = { kind: 'pkg-upgrade' as const, packages: [{ appPath: '', name: 'electron', range: '^39.0.0' }, { appPath: '', name: 'react', range: '^19.2.0' }] };
  assert.deepStrictEqual(buildSteps(r, npmCtx(['electron'])).map((s) => s.argv), [
    ['npm', 'install', '-D', 'electron@^39.0.0'],
    ['npm', 'install', 'react@^19.2.0'],
  ]);
  assert.deepStrictEqual(buildSteps(r, () => ({ pm: 'pnpm', devDeps: new Set(['electron']) }))[0].argv, ['pnpm', 'add', '-D', 'electron@^39.0.0']);
  assert.deepStrictEqual(buildSteps(r, () => ({ pm: 'bun', devDeps: new Set(['electron']) }))[0].argv, ['bun', 'add', '-d', 'electron@^39.0.0']);
  assert.deepStrictEqual(buildSteps({ kind: 'install', appPath: '' }, () => ({ pm: 'yarn', devDeps: new Set() }))[0].argv, ['yarn', 'install']);
});

// --- Windows command line -------------------------------------------------

test('quoteWinArg quotes cmd metacharacters and refuses expansion characters', () => {
  assert.strictEqual(quoteWinArg('npx'), 'npx');
  assert.strictEqual(quoteWinArg('expo@^51.0.0'), '"expo@^51.0.0"');
  for (const bad of ['a"b', '%PATH%', 'a!b', 'a\nb']) assert.throws(() => quoteWinArg(bad), bad);
});

test('toCmdLine wraps the whole line for cmd /s /c', () => {
  assert.strictEqual(toCmdLine(['npx', 'expo', 'install', 'expo@^51.0.0', '--fix']), '"npx expo install "expo@^51.0.0" --fix"');
});

// --- recipes attached to freshness issues ---------------------------------

test('assessStackFreshness attaches a fix to the Expo issue but not to the runtime issue', () => {
  const profile = {
    frameworks: ['Expo'],
    scripts: {},
    dependencies: [dep({ name: 'expo', currentMajor: 50, currentVersion: '^50.0.0', latestMajor: 54, latestVersion: '54.0.1', majorBehind: 4, appPath: 'mobile', severity: 'critical' })],
    runtimes: [{ runtime: 'node', version: '18', major: 18, source: '.nvmrc', appPath: '', isMinimum: false, eolDate: '2025-04-30' }],
    apps: [],
    checkedLiveAt: new Date(NOW).toISOString(),
  } as unknown as DetectedStackProfile;
  const report = assessStackFreshness(profile, NOW);
  const expo = report.issues.find((i) => i.id.startsWith('expo-sdk:'))!;
  assert.strictEqual(expo.fix?.kind, 'expo-sdk-step');
  const node = report.issues.find((i) => i.id.startsWith('runtime:'))!;
  assert.strictEqual(node.fix, undefined);
});

// --- Task 2: after-run helpers --------------------------------------------
import { parsePorcelain, changedSince, removeSdkVersion, findSdkVersionLine } from '../src/services/fixRecipes.ts';

test('parsePorcelain reads XY codes, untracked files and renames', () => {
  const m = parsePorcelain(' M package.json\n?? new.txt\nR  a -> b\n');
  assert.deepStrictEqual([...m.entries()], [['package.json', ' M'], ['new.txt', '??'], ['b', 'R ']]);
});

test('changedSince lists only what the fix changed, never node_modules', () => {
  const before = parsePorcelain(' M already.ts\n M reverted.ts\n');
  const after = parsePorcelain(' M already.ts\n M package.json\n?? fresh.txt\n?? node_modules/x/y.js\n D gone.ts\n');
  assert.deepStrictEqual(changedSince(before, after), [
    { path: 'package.json', status: 'modified' },
    { path: 'fresh.txt', status: 'untracked' },
    { path: 'gone.ts', status: 'deleted' },
  ]);
});

test('removeSdkVersion drops a stale expo.sdkVersion and keeps formatting', () => {
  assert.strictEqual(removeSdkVersion('{"expo":{"name":"a","sdkVersion":"50.0.0"}}', 51), '{"expo":{"name":"a"}}');
  assert.strictEqual(removeSdkVersion('{"expo":{"name":"a"}}', 51), null);
  assert.strictEqual(removeSdkVersion('{"expo":{"sdkVersion":"51.0.0"}}', 51), null);
  const crlf = '{\r\n    "expo": {\r\n        "name": "a",\r\n        "sdkVersion": "50.0.0"\r\n    }\r\n}\r\n';
  assert.strictEqual(removeSdkVersion(crlf, 51), '{\r\n    "expo": {\r\n        "name": "a"\r\n    }\r\n}\r\n');
});

test('findSdkVersionLine points at sdkVersion in app.config code', () => {
  assert.deepStrictEqual(findSdkVersionLine("export default {\n  sdkVersion: '50.0.0',\n}"), { line: 2, value: '50.0.0' });
  assert.strictEqual(findSdkVersionLine('export default {}'), null);
});

// --- Task 3: git helpers (real git in temp repos) --------------------------
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { gitState, checkpoint, restoreFiles, commitFiles, statusMap } from '../electron/fixGit.ts';

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'litho-fix-'));
}

function tempRepo(): string {
  const dir = tempDir();
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
  git('init', '-q');
  git('config', 'user.name', 'Fixer Test');
  git('config', 'user.email', 'fixer@example.invalid');
  git('config', 'core.autocrlf', 'false');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'init');
  return dir;
}

const lastMessage = (dir: string) => execFileSync('git', ['log', '-1', '--format=%s'], { cwd: dir }).toString().trim();

test('gitState: null outside a repo, clean state with a head inside one', async () => {
  assert.strictEqual(await gitState(tempDir()), null);
  const repo = tempRepo();
  const s = (await gitState(repo))!;
  assert.strictEqual(s.dirty.size, 0);
  assert.match(s.head, /^[0-9a-f]{40}$/);
  assert.strictEqual(path.resolve(s.repoRoot).toLowerCase(), fs.realpathSync(repo).toLowerCase());
});

test('checkpoint commits every change, untracked included', async () => {
  const repo = tempRepo();
  fs.writeFileSync(path.join(repo, 'new.txt'), 'x');
  const before = (await gitState(repo))!.head;
  const head = await checkpoint(repo);
  assert.notStrictEqual(head, before);
  assert.strictEqual(lastMessage(repo), 'chore: checkpoint before DocAtlas fix');
  assert.strictEqual((await statusMap(repo)).size, 0);
});

test('checkpoint rejects when a pre-commit hook fails', async () => {
  const repo = tempRepo();
  fs.writeFileSync(path.join(repo, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\nexit 1\n');
  fs.chmodSync(path.join(repo, '.git', 'hooks', 'pre-commit'), 0o755);
  fs.writeFileSync(path.join(repo, 'new.txt'), 'x');
  await assert.rejects(() => checkpoint(repo));
});

test('restoreFiles puts back modified files and deletes files the fix created', async () => {
  const repo = tempRepo();
  const head = (await gitState(repo))!.head;
  fs.writeFileSync(path.join(repo, 'a.txt'), 'changed\n');
  fs.writeFileSync(path.join(repo, 'b.txt'), 'new\n');
  const restored = await restoreFiles(repo, head, [
    { path: 'a.txt', status: 'modified' },
    { path: 'b.txt', status: 'untracked' },
  ]);
  assert.deepStrictEqual(restored.sort(), ['a.txt', 'b.txt']);
  assert.strictEqual(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8'), 'one\n');
  assert.strictEqual(fs.existsSync(path.join(repo, 'b.txt')), false);
});

test('commitFiles commits only the files given', async () => {
  const repo = tempRepo();
  fs.writeFileSync(path.join(repo, 'a.txt'), 'changed\n');
  fs.writeFileSync(path.join(repo, 'other.txt'), 'leave me\n');
  await commitFiles(repo, ['a.txt'], 'chore(deps): test fix');
  assert.strictEqual(lastMessage(repo), 'chore(deps): test fix');
  assert.deepStrictEqual([...(await statusMap(repo)).keys()], ['other.txt']);
});

// --- Task 4: runner ---------------------------------------------------------
import { runSteps, type FixEvent } from '../electron/fixRunner.ts';

const win = { skip: process.platform !== 'win32' };

async function collect(steps: { argv: string[]; cwd: string; isCheck: boolean }[]) {
  const events: FixEvent[] = [];
  const res = await runSteps(steps, (e) => events.push(e), 'run-test', { stopped: false });
  const out = events.filter((e) => e.type === 'output').map((e) => (e as any).text).join('');
  return { res, events, out };
}

test('runSteps runs steps in order and streams output', win, async () => {
  const cwd = tempDir();
  const { res, out } = await collect([
    { argv: ['node', '-e', 'process.exit(0)'], cwd, isCheck: false },
    { argv: ['node', '-e', 'console.log(4242)'], cwd, isCheck: false },
  ]);
  assert.deepStrictEqual(res.exitCodes, [0, 0]);
  assert.strictEqual(res.failedStep, undefined);
  assert.match(out, /4242/);
});

test('runSteps stops at a failing step and never starts the next', win, async () => {
  const cwd = tempDir();
  const { res, events } = await collect([
    { argv: ['node', '-e', 'process.exit(3)'], cwd, isCheck: false },
    { argv: ['node', '-e', 'console.log(1)'], cwd, isCheck: false },
  ]);
  assert.strictEqual(res.failedStep, 0);
  assert.deepStrictEqual(res.exitCodes, [3, null]);
  assert.ok(!events.some((e) => e.type === 'step' && e.index === 1));
});

test('runSteps: a failing check is reported but does not fail the fix', win, async () => {
  const { res } = await collect([{ argv: ['node', '-e', 'process.exit(1)'], cwd: tempDir(), isCheck: true }]);
  assert.deepStrictEqual(res.exitCodes, [1]);
  assert.strictEqual(res.failedStep, undefined);
});

test('runSteps runs in a folder with spaces and brackets', win, async () => {
  const cwd = path.join(tempDir(), 'My App (old)');
  fs.mkdirSync(cwd);
  const { res, out } = await collect([{ argv: ['node', '-e', 'console.log(process.cwd())'], cwd, isCheck: false }]);
  assert.deepStrictEqual(res.exitCodes, [0]);
  assert.ok(out.includes('My App (old)'), out);
});

import { FixController } from '../electron/fixRunner.ts';

function controller(known: string[], events: FixEvent[]) {
  const set = new Set(known.map((k) => path.resolve(k).toLowerCase()));
  return new FixController({
    logDir: path.join(tempDir(), 'logs'),
    isKnownRoot: async (r) => set.has(path.resolve(r).toLowerCase()),
    emit: (e) => events.push(e),
  });
}

async function waitForEnd(events: FixEvent[]) {
  for (let i = 0; i < 200; i++) {
    const end = events.find((e) => e.type === 'end');
    if (end) return (end as Extract<FixEvent, { type: 'end' }>).result;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('fix never ended');
}

test('FixController refuses projects it does not know and folders outside the project', async () => {
  const repo = tempRepo();
  const c = controller([repo], []);
  await assert.rejects(() => c.plan(tempDir(), { kind: 'install', appPath: '' }, 'x'), /Unknown project/);
  await assert.rejects(() => c.plan(repo, { kind: 'install', appPath: '../elsewhere' }, 'x'), /Invalid fix/);
  await assert.rejects(() => c.plan(repo, { kind: 'install', appPath: 'missing' }, 'x'), /Folder not found/);
});

test('FixController: a failed checkpoint commit runs nothing', async () => {
  const repo = tempRepo();
  fs.writeFileSync(path.join(repo, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\nexit 1\n');
  fs.writeFileSync(path.join(repo, 'dirty.txt'), 'x');
  const events: FixEvent[] = [];
  const c = controller([repo], events);
  const plan = await c.plan(repo, { kind: 'install', appPath: '' }, 'Install');
  assert.strictEqual(plan.git?.dirtyCount, 1);
  await c.run(plan.planId, { checkpoint: true });
  const result = await waitForEnd(events);
  assert.strictEqual(result.ok, false);
  assert.match(result.error || '', /checkpoint commit failed/);
  assert.ok(!events.some((e) => e.type === 'step'));
  assert.ok(fs.existsSync(result.logPath));
});
