/**
 * Safe stack fixer: plans and runs fixed recipes. Node only (no Electron import); main.ts wires it to IPC.
 *
 * The renderer sends a FixRecipe; this module re-validates it, checks the folders are inside a known
 * project, builds every argv itself (fixRecipes.buildSteps) and runs the stored plan exactly as shown.
 */
import { spawn, execFile } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import {
  buildSteps,
  changedSince,
  detectPackageManager,
  findSdkVersionLine,
  recipeAppPaths,
  removeSdkVersion,
  toCmdLine,
  touchedDirty,
  validateRecipe,
  type AppContext,
  type ChangedFile,
  type ConfigProposal,
  type FixRecipe,
  type FixStep,
} from '../src/services/fixRecipes';
import { checkpoint, commitFiles, gitState, projectScope, restoreFiles, statusMap } from './fixGit';

export type FixEvent =
  | { type: 'output'; runId: string; stream: 'stdout' | 'stderr' | 'info'; text: string }
  | { type: 'step'; runId: string; index: number; state: 'running' | 'done' | 'failed'; exitCode?: number; ms?: number }
  | { type: 'end'; runId: string; result: FixRunResult };

export interface FixPlan {
  planId: string;
  projectRoot: string;
  title: string;
  steps: (FixStep & { cwd: string })[];
  /** scope: the project folder relative to repoRoot when the repo sits above the project ('' otherwise). */
  git: { repoRoot: string; head: string; dirtyCount: number; scope: string } | null;
}

export interface FixRunResult {
  runId: string;
  ok: boolean;
  stopped: boolean;
  failedStep?: number;
  /** Why the run never started its steps (e.g. the checkpoint commit failed). */
  error?: string;
  steps: { label: string; exitCode: number | null; ms: number; isCheck: boolean }[];
  /** Paths relative to the git repo root (`repoRoot`). */
  changedFiles: ChangedFile[];
  /** Files that were already dirty before the fix and that it changed again: shown, never undone or committed. */
  alreadyDirty: string[];
  repoRoot?: string;
  configProposals: ConfigProposal[];
  logPath: string;
  undoable: boolean;
  checkpointed: boolean;
}

export interface RunSignal {
  stopped: boolean;
  pid?: number;
}

const CHILD_ENV = () => ({ ...process.env, CI: '1', FORCE_COLOR: '0' });

function spawnStep(argv: string[], cwd: string) {
  if (process.platform === 'win32') {
    // npx/npm/pnpm are .cmd shims, which Node only starts through a shell. The line is built solely from
    // validated tokens by toCmdLine; the folder goes in `cwd`, never on the command line.
    return spawn('cmd.exe', ['/d', '/s', '/c', toCmdLine(argv)], { cwd, env: CHILD_ENV(), windowsVerbatimArguments: true, windowsHide: true });
  }
  return spawn(argv[0], argv.slice(1), { cwd, env: CHILD_ENV() });
}

/** Run steps one after another. A failing non-check step stops the run; a failing check is only reported. */
export async function runSteps(
  steps: { argv: string[]; cwd: string; isCheck: boolean }[],
  onEvent: (e: FixEvent) => void,
  runId: string,
  signal: RunSignal
): Promise<{ exitCodes: (number | null)[]; ms: number[]; failedStep?: number }> {
  const exitCodes: (number | null)[] = steps.map(() => null);
  const ms: number[] = steps.map(() => 0);
  for (let i = 0; i < steps.length; i++) {
    if (signal.stopped) return { exitCodes, ms, failedStep: i };
    const step = steps[i];
    const started = Date.now();
    onEvent({ type: 'step', runId, index: i, state: 'running' });
    onEvent({ type: 'output', runId, stream: 'info', text: `\n> ${step.argv.join(' ')}\n` });
    const code = await new Promise<number>((resolve) => {
      let child;
      try {
        child = spawnStep(step.argv, step.cwd);
      } catch (err: any) {
        onEvent({ type: 'output', runId, stream: 'stderr', text: `${err?.message || err}\n` });
        resolve(-1);
        return;
      }
      signal.pid = child.pid;
      child.stdout?.on('data', (d: Buffer) => onEvent({ type: 'output', runId, stream: 'stdout', text: d.toString('utf8') }));
      child.stderr?.on('data', (d: Buffer) => onEvent({ type: 'output', runId, stream: 'stderr', text: d.toString('utf8') }));
      child.on('error', (err) => {
        onEvent({ type: 'output', runId, stream: 'stderr', text: `${err.message}\n` });
      });
      child.on('close', (c) => resolve(c ?? -1));
    });
    signal.pid = undefined;
    exitCodes[i] = code;
    ms[i] = Date.now() - started;
    const failed = code !== 0;
    onEvent({ type: 'step', runId, index: i, state: failed ? 'failed' : 'done', exitCode: code, ms: ms[i] });
    if (signal.stopped) return { exitCodes, ms, failedStep: i };
    if (failed && !step.isCheck) return { exitCodes, ms, failedStep: i };
  }
  return { exitCodes, ms };
}

/** End a step's whole process tree (cmd → npx → node …). */
export function killTree(pid: number): void {
  if (process.platform === 'win32') execFile('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true }, () => undefined);
  else {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      /* already gone */
    }
  }
}

// ---------------------------------------------------------------------------
// Controller: plan → run → result actions
// ---------------------------------------------------------------------------

export interface FixControllerOptions {
  logDir: string;
  isKnownRoot: (projectRoot: string) => Promise<boolean>;
  emit: (e: FixEvent) => void;
  /** How many log files to keep. */
  keepLogs?: number;
}

interface StoredPlan {
  plan: FixPlan;
  recipe: FixRecipe;
  createdAt: number;
}

interface RunRecord {
  plan: FixPlan;
  recipe: FixRecipe;
  signal: RunSignal;
  startHead?: string;
  result?: FixRunResult;
}

const PLAN_TTL_MS = 10 * 60 * 1000;
const APP_CONFIG_JSON = ['app.json', 'app.config.json'];
const APP_CONFIG_CODE = ['app.config.ts', 'app.config.js'];

const sameOrInside = (child: string, parent: string) => {
  const c = child.toLowerCase();
  const p = parent.toLowerCase().replace(/[\\/]+$/, '');
  return c === p || c.startsWith(p + path.sep);
};

async function readJson(file: string): Promise<any> {
  try {
    return JSON.parse(await fs.promises.readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

async function listNames(dir: string): Promise<string[]> {
  try {
    return await fs.promises.readdir(dir);
  } catch {
    return [];
  }
}

function majorOfRange(v: unknown): number | null {
  const m = typeof v === 'string' ? v.match(/(\d+)/) : null;
  return m ? Number(m[1]) : null;
}

function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export class FixController {
  private plans = new Map<string, StoredPlan>();
  private runs = new Map<string, RunRecord>();
  private active: string | null = null;

  constructor(private opts: FixControllerOptions) {}

  get busy(): boolean {
    return this.active !== null;
  }

  async plan(projectRootIn: string, recipeIn: unknown, title: string): Promise<FixPlan> {
    const recipe = validateRecipe(recipeIn);
    const projectRoot = path.resolve(String(projectRootIn || ''));
    if (!(await this.opts.isKnownRoot(projectRoot))) throw new Error('Unknown project');
    const realRoot = await fs.promises.realpath(projectRoot);

    const contexts = new Map<string, AppContext>();
    const cwds = new Map<string, string>();
    const rootPkg = await readJson(path.join(projectRoot, 'package.json'));
    const rootNames = await listNames(projectRoot);
    for (const appPath of recipeAppPaths(recipe)) {
      const dir = path.resolve(projectRoot, ...appPath.split('/').filter(Boolean));
      let real: string;
      try {
        real = await fs.promises.realpath(dir);
      } catch {
        throw new Error(`Folder not found: ${appPath || '(project root)'}`);
      }
      if (!sameOrInside(real, realRoot)) throw new Error('Folder is outside the project');
      const pkg = (await readJson(path.join(dir, 'package.json'))) || {};
      const names = [...(await listNames(dir)), ...rootNames];
      contexts.set(appPath, {
        pm: detectPackageManager(pkg.packageManager || rootPkg?.packageManager, names),
        devDeps: new Set(Object.keys(pkg.devDependencies || {})),
      });
      cwds.set(appPath, dir);
    }
    const steps = buildSteps(recipe, (p) => contexts.get(p)!).map((s) => ({ ...s, cwd: cwds.get(s.appPath)! }));
    const firstCwd = steps[0]?.cwd || projectRoot;
    const found = await gitState(firstCwd);
    const scope = found ? projectScope(found.repoRoot, projectRoot) : '';
    const g = found && scope ? await gitState(firstCwd, scope) : found;
    const plan: FixPlan = {
      planId: crypto.randomUUID(),
      projectRoot,
      title: String(title || 'Fix').slice(0, 200),
      steps,
      git: g ? { repoRoot: g.repoRoot, head: g.head, dirtyCount: g.dirty.size, scope } : null,
    };
    const now = Date.now();
    for (const [id, p] of this.plans) if (now - p.createdAt > PLAN_TTL_MS) this.plans.delete(id);
    this.plans.set(plan.planId, { plan, recipe, createdAt: now });
    return plan;
  }

  /** Start a stored plan. Resolves once started; progress and the result arrive as events. */
  async run(planId: string, options: { checkpoint?: boolean } = {}): Promise<{ runId: string }> {
    if (this.active) throw new Error('A fix is already running');
    const stored = this.plans.get(planId);
    if (!stored || Date.now() - stored.createdAt > PLAN_TTL_MS) throw new Error('This fix plan has expired; open it again');
    this.plans.delete(planId);
    const runId = crypto.randomUUID();
    const rec: RunRecord = { plan: stored.plan, recipe: stored.recipe, signal: { stopped: false } };
    this.runs.set(runId, rec);
    this.active = runId;
    void this.execute(runId, rec, Boolean(options.checkpoint)).finally(() => {
      if (this.active === runId) this.active = null;
    });
    return { runId };
  }

  private async openLog(plan: FixPlan): Promise<{ file: string; write: (s: string) => void; close: () => Promise<void> }> {
    await fs.promises.mkdir(this.opts.logDir, { recursive: true });
    const safe = path.basename(plan.projectRoot).replace(/[^A-Za-z0-9._-]+/g, '_') || 'project';
    const file = path.join(this.opts.logDir, `${stamp()}-${safe}.log`);
    const stream = fs.createWriteStream(file, { encoding: 'utf8' });
    let broken = false;
    // A disk or antivirus error on the log must not crash the main process; the run carries on unlogged.
    stream.on('error', () => {
      broken = true;
    });
    return {
      file,
      write: (s) => {
        if (!broken) stream.write(s);
      },
      close: () =>
        new Promise((r) => {
          if (broken) return r();
          stream.end(() => r());
        }),
    };
  }

  private async pruneLogs(): Promise<void> {
    const keep = this.opts.keepLogs ?? 50;
    const names = (await listNames(this.opts.logDir)).filter((n) => n.endsWith('.log')).sort();
    for (const n of names.slice(0, Math.max(0, names.length - keep))) {
      await fs.promises.rm(path.join(this.opts.logDir, n), { force: true }).catch(() => undefined);
    }
  }

  /** Always ends with an `end` event, even when something unexpected throws: the UI must never stay "running". */
  private async execute(runId: string, rec: RunRecord, wantCheckpoint: boolean): Promise<void> {
    const { plan } = rec;
    let logFile = '';
    try {
      await this.executeSteps(runId, rec, wantCheckpoint, (f) => (logFile = f));
    } catch (err: any) {
      const result: FixRunResult = {
        runId,
        ok: false,
        stopped: rec.signal.stopped,
        error: `The fix could not run: ${err?.message || err}`,
        steps: plan.steps.map((s) => ({ label: s.label, exitCode: null, ms: 0, isCheck: s.isCheck })),
        changedFiles: [],
        alreadyDirty: [],
        repoRoot: plan.git?.repoRoot,
        configProposals: [],
        logPath: logFile,
        undoable: false,
        checkpointed: false,
      };
      rec.result = result;
      this.safeEmit({ type: 'end', runId, result });
    }
  }

  private safeEmit(e: FixEvent): void {
    try {
      this.opts.emit(e);
    } catch {
      /* window gone */
    }
  }

  private async executeSteps(runId: string, rec: RunRecord, wantCheckpoint: boolean, setLog: (f: string) => void): Promise<void> {
    const { plan, recipe } = rec;
    const log = await this.openLog(plan);
    setLog(log.file);
    const emit = (e: FixEvent) => {
      if (e.type === 'output') log.write(e.text);
      this.safeEmit(e);
    };
    const info = (text: string) => emit({ type: 'output', runId, stream: 'info', text });
    log.write(`# ${plan.title}\n# ${plan.projectRoot}\n# ${new Date().toISOString()}\n`);

    const repoRoot = plan.git?.repoRoot;
    const scope = plan.git?.scope || '';
    let checkpointed = false;
    let error: string | undefined;
    rec.startHead = plan.git?.head;

    if (repoRoot && wantCheckpoint) {
      const fresh = await gitState(repoRoot, scope);
      if (!fresh) {
        error = 'Couldn’t read the git state for the checkpoint, so nothing was run.';
      } else if (fresh.dirty.size > 0) {
        try {
          info(`Committing ${fresh.dirty.size} uncommitted file(s) as a checkpoint…\n`);
          rec.startHead = await checkpoint(repoRoot, scope);
          checkpointed = true;
        } catch (err: any) {
          error = `The checkpoint commit failed, so nothing was run: ${err?.message || err}`;
        }
      }
    }

    let exitCodes: (number | null)[] = plan.steps.map(() => null);
    let ms: number[] = plan.steps.map(() => 0);
    let failedStep: number | undefined;
    let changedFiles: ChangedFile[] = [];
    let alreadyDirty: string[] = [];
    let configProposals: ConfigProposal[] = [];
    // Undo is only offered when git told us exactly what was dirty before and after (fail closed).
    let gitTrusted = Boolean(repoRoot);

    if (error) {
      info(`${error}\n`);
    } else {
      let before: Map<string, string> | null = null;
      if (repoRoot) before = await statusMap(repoRoot, scope).catch(() => null);
      if (repoRoot && !before) {
        gitTrusted = false;
        info('Couldn’t read git status before the fix; undo will be unavailable.\n');
      }
      const res = await runSteps(plan.steps, emit, runId, rec.signal);
      exitCodes = res.exitCodes;
      ms = res.ms;
      failedStep = res.failedStep;
      if (repoRoot && before) {
        const after = await statusMap(repoRoot, scope).catch(() => null);
        if (after) {
          changedFiles = changedSince(before, after);
          alreadyDirty = touchedDirty(before, after);
        } else gitTrusted = false;
      }
      if (failedStep === undefined && (recipe.kind === 'expo-sdk-step' || recipe.kind === 'expo-align')) {
        configProposals = await this.expoConfigProposals(plan, recipe);
      }
    }

    const stopped = rec.signal.stopped;
    const result: FixRunResult = {
      runId,
      ok: !error && failedStep === undefined && !stopped,
      stopped,
      failedStep,
      error,
      steps: plan.steps.map((s, i) => ({ label: s.label, exitCode: exitCodes[i], ms: ms[i], isCheck: s.isCheck })),
      changedFiles,
      alreadyDirty,
      repoRoot: gitTrusted ? repoRoot : undefined,
      configProposals,
      logPath: log.file,
      undoable: gitTrusted && Boolean(rec.startHead) && !error,
      checkpointed,
    };
    info(`\n${result.ok ? 'Fix finished.' : stopped ? 'Fix stopped.' : 'Fix did not finish.'}\n`);
    await log.close();
    await this.pruneLogs();
    rec.result = result;
    this.safeEmit({ type: 'end', runId, result });
  }

  private async expoConfigProposals(plan: FixPlan, recipe: FixRecipe): Promise<ConfigProposal[]> {
    const appPath = recipe.kind === 'expo-sdk-step' || recipe.kind === 'expo-align' ? recipe.appPath : '';
    const dir = path.resolve(plan.projectRoot, ...appPath.split('/').filter(Boolean));
    const pkg = await readJson(path.join(dir, 'package.json'));
    const expected = recipe.kind === 'expo-sdk-step' ? recipe.toMajor : majorOfRange(pkg?.dependencies?.expo);
    if (expected === null) return [];
    const rel = (name: string) => (appPath ? `${appPath}/${name}` : name);
    const out: ConfigProposal[] = [];
    for (const name of APP_CONFIG_JSON) {
      const text = await fs.promises.readFile(path.join(dir, name), 'utf8').catch(() => null);
      if (text === null) continue;
      const after = removeSdkVersion(text, expected);
      if (after === null) continue;
      const parsed = JSON.parse(text);
      const current = String((parsed.expo && parsed.expo.sdkVersion) ?? parsed.sdkVersion);
      out.push({ kind: 'json-remove-sdk', file: rel(name), before: text, after, current, expected });
    }
    for (const name of APP_CONFIG_CODE) {
      const code = await fs.promises.readFile(path.join(dir, name), 'utf8').catch(() => null);
      if (code === null) continue;
      const hit = findSdkVersionLine(code);
      if (hit && majorOfRange(hit.value) !== expected) out.push({ kind: 'code-line', file: rel(name), line: hit.line, current: hit.value, expected });
    }
    return out;
  }

  private record(runId: string): RunRecord & { result: FixRunResult } {
    const rec = this.runs.get(runId);
    if (!rec || !rec.result) throw new Error('Unknown or unfinished fix');
    return rec as RunRecord & { result: FixRunResult };
  }

  stop(runId: string): void {
    const rec = this.runs.get(runId);
    if (!rec || rec.result) return;
    rec.signal.stopped = true;
    if (rec.signal.pid) killTree(rec.signal.pid);
  }

  stopAll(): void {
    if (this.active) this.stop(this.active);
  }

  /** The app.config.ts/js a "code-line" proposal points at (only those; never an arbitrary path from the UI). */
  proposalFile(runId: string, index: number): string {
    const p = this.record(runId).result.configProposals[index];
    if (!p || p.kind !== 'code-line') throw new Error('No such config file');
    return this.resolveFile(runId, p.file);
  }

  /** Absolute path of a project file, refusing anything outside the project. */
  private resolveFile(runId: string, file: string): string {
    const rec = this.runs.get(runId);
    if (!rec) throw new Error('Unknown fix');
    const abs = path.resolve(rec.plan.projectRoot, ...String(file).split('/').filter(Boolean));
    if (!sameOrInside(abs, rec.plan.projectRoot)) throw new Error('File is outside the project');
    return abs;
  }

  logPath(runId: string): string {
    return this.record(runId).result.logPath;
  }

  /** Write a proposed config change, but only if the file is still exactly what was proposed against. */
  async applyConfig(runId: string, index: number): Promise<boolean> {
    const rec = this.record(runId);
    const p = rec.result.configProposals[index];
    if (!p || p.kind !== 'json-remove-sdk') return false;
    const abs = this.resolveFile(runId, p.file);
    const now = await fs.promises.readFile(abs, 'utf8').catch(() => null);
    if (now !== p.before) return false;
    await fs.promises.writeFile(abs, p.after, 'utf8');
    const repoRoot = rec.result.repoRoot;
    if (repoRoot) {
      const relToRepo = path.relative(repoRoot, abs).split(path.sep).join('/');
      if (!rec.result.changedFiles.some((f) => f.path === relToRepo)) rec.result.changedFiles.push({ path: relToRepo, status: 'modified' });
    }
    return true;
  }

  async commit(runId: string): Promise<string> {
    const rec = this.record(runId);
    if (!rec.result.repoRoot) throw new Error('No git repo');
    return commitFiles(rec.result.repoRoot, rec.result.changedFiles.map((f) => f.path), `chore(deps): ${rec.plan.title}`);
  }

  async undo(runId: string): Promise<string[]> {
    const rec = this.record(runId);
    if (!rec.result.undoable || !rec.result.repoRoot || !rec.startHead) throw new Error('This fix cannot be undone');
    if (this.active) throw new Error('A fix is already running');
    return restoreFiles(rec.result.repoRoot, rec.startHead, rec.result.changedFiles);
  }
}
