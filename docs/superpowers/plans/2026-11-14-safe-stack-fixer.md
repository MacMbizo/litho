# Safe Stack Fixer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A **Fix** button on DocAtlas freshness issues that runs a fixed, validated upgrade recipe in Electron, streams its output live, and then shows expo-doctor, the files that changed, an `sdkVersion` proposal, freshness before and after, Continue to the next SDK, Commit, and Undo.

**Architecture:** Recipes are typed data, built in the pure module `src/services/fixRecipes.ts`. They are attached to each `FreshnessIssue` by `assessStackFreshness`. The renderer sends only a recipe. The main process re-validates it and builds the argv itself (`electron/fixRunner.ts`), takes git checkpoints and does undo (`electron/fixGit.ts`), and streams events over IPC. The renderer has one `FixProvider` in `App.tsx` that owns the sheet (confirm → running → result) and lets only one fix run at a time.

**Tech Stack:** Electron (main process `child_process`), React 19, TypeScript, Tailwind, lucide-react, `node:test` via esbuild. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-14-safe-stack-fixer-design.md`

## Global Constraints

- No new npm dependencies.
- The renderer never sends a command string. Main builds every argv from a validated `FixRecipe`.
- `appPath` is relative, with no `..`, no drive letter and no leading slash. npm names match `^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$`. Ranges match `^[\^~]?\d+(\.\d+){0,2}(-[0-9A-Za-z.]+)?$`.
- Windows: run through `cmd.exe /d /s /c "<line>"` with `windowsVerbatimArguments: true`. The line is built only by `toCmdLine(argv)`.
- Env for child processes: `process.env` plus `CI=1`, `FORCE_COLOR=0`.
- Copy-only (no recipe): Node/Python runtime issues, `next` (codemod), every `pypi` dependency.
- Expo upgrades go one SDK per run: `toMajor = fromMajor + 1`.
- Checkpoint commit message: `chore: checkpoint before DocAtlas fix`. Fix commit message: `chore(deps): <issue title>`.
- Logs: `userData/docatlas/fix-logs/<YYYYMMDD-HHmmss>-<project>.log`; keep the newest 50.
- One fix at a time, across the whole app.
- Undo never touches `node_modules`.
- The Fix button is hidden when `window.electronAPI?.fixPlan` is missing (the browser build).
- Icons: lucide `Wrench` for Fix. No generic icons (owner preference).
- End-to-end runs use throwaway projects in the scratchpad only, never the owner's real `C:\Prj` projects.
- Use Edit/Write, not heredoc scripts, for any code with regexes or backslashes.

## Review Focus

1. **A project path with spaces or brackets** (`C:\Prj\My App (old)`): the command must still run in that folder. It's handled by `cwd` in spawn, never by putting the path into the cmd line; Task 3 tests that `toCmdLine` never contains the cwd.
2. **The user closes the sheet or the window during a run:** the process tree must not be orphaned. Task 4 kills the active run on `mainWindow` `closed`; the provider keeps the run alive when the sheet is minimized.
3. **Git hooks or a missing git identity make the checkpoint commit fail:** the fix must not run. Task 3 test: commit fails, so `checkpoint` rejects; Task 4 ends the run with `ok:false` and runs no steps.
4. **A fix fails halfway (step 1 exits non-zero):** later non-check steps don't run, the result says "Failed at step 1", and Undo is still offered. Task 4 test with a failing step.
5. **`app.json` with CRLF line endings and 4-space indent:** removing `sdkVersion` keeps both. Task 2 test.

---

### Task 1: Recipes, validation and argv building (pure)

**Files:**
- Create: `src/services/fixRecipes.ts`
- Modify: `src/types/docAudit.ts` (`FreshnessIssue` gains `fix?: FixRecipe`; re-export the type)
- Modify: `src/services/stackFreshness.ts` (attach `fix` in each issue branch)
- Test: `tests/fixer.test.ts` (new); add it to the `test` script in `package.json` next to the others.

**Interfaces:**
- Produces:
  ```ts
  export type FixRecipe =
    | { kind: 'expo-sdk-step'; appPath: string; fromMajor: number; toMajor: number }
    | { kind: 'expo-align'; appPath: string }
    | { kind: 'pkg-upgrade'; packages: { appPath: string; name: string; range: string }[] }
    | { kind: 'install'; appPath: string };
  export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';
  export interface FixStep { appPath: string; argv: string[]; label: string; isCheck: boolean }
  export interface AppContext { pm: PackageManager; devDeps: Set<string> }
  export function validateRecipe(r: unknown): FixRecipe            // throws Error('Invalid fix: …')
  export function recipeForDependency(d: StackDependencyStatus): FixRecipe | null
  export function detectPackageManager(packageManagerField: string | undefined, rootFiles: string[]): PackageManager
  export function buildSteps(r: FixRecipe, ctx: (appPath: string) => AppContext): FixStep[]
  export function quoteWinArg(arg: string): string                  // throws on " % ! \r \n
  export function toCmdLine(argv: string[]): string                // '"' + argv.map(quoteWinArg).join(' ') + '"'
  export function recipeAppPaths(r: FixRecipe): string[]
  ```

- [ ] **Step 1: Write the failing tests** in `tests/fixer.test.ts`:
  - `validateRecipe`:
    - accepts `{kind:'expo-sdk-step',appPath:'mobile',fromMajor:50,toMajor:51}`
    - throws for `appPath:'../x'`, `'C:\\x'`, `'/x'`, `toMajor:52` with `fromMajor:50`, name `'a b'`, range `'latest'`, an unknown `kind`, and an empty `packages`
  - `recipeForDependency`:
    - `{name:'expo',ecosystem:'npm',currentMajor:50,latestMajor:54,…}` → `expo-sdk-step` 50→51
    - `react-native` → `expo-align`
    - `next` → `null`
    - a `pypi` dep → `null`
    - `{name:'typescript',majorBehind:1,latestMajor:6}` → `pkg-upgrade` with `range:'^6.0.0'`
    - a `minor` dep with `latestVersion:'5.4.2'` → `range:'^5.4.2'`
    - `severity:'current'` → `null`
  - `detectPackageManager`:
    - `('pnpm@9.1.0',[])` → `pnpm`
    - `(undefined,['yarn.lock'])` → `yarn`
    - `(undefined,['bun.lock'])` → `bun`
    - `(undefined,['bun.lockb'])` → `bun`
    - `(undefined,[])` → `npm`
  - `buildSteps`:
    - `expo-sdk-step` → `[['npx','expo','install','expo@^51.0.0','--fix'] (isCheck false), ['npx','expo-doctor'] (isCheck true)]`
    - `pkg-upgrade` with electron and react in the same app, `devDeps` containing `electron`, pm npm → two steps: `['npm','install','-D','electron@^39.0.0']` and `['npm','install','react@^19.2.0']`
    - with pnpm → `['pnpm','add','-D',…]`; bun dev → `['bun','add','-d',…]`
    - `install` with yarn → `['yarn','install']`
  - `quoteWinArg`:
    - `'npx'` → `'npx'`
    - `'expo@^51.0.0'` → `'"expo@^51.0.0"'`
    - throws for `'a"b'`, `'%PATH%'` and `'a!b'`
  - `toCmdLine(['npx','expo','install','expo@^51.0.0','--fix'])` → `'"npx expo install "expo@^51.0.0" --fix"'`
  - `assessStackFreshness` on a profile with expo 50 vs 54 → the `expo-sdk:` issue has `fix.kind === 'expo-sdk-step'`; the Node runtime issue has no `fix`.

- [ ] **Step 2: Run the tests and check they fail.** `npm test` should fail with an import error for `fixRecipes`.

- [ ] **Step 3: Implement `src/services/fixRecipes.ts`** with the signatures above, using the regexes from Global Constraints.
  - Quote an argument when it contains any of `^&|<>()` or a space.
  - `buildSteps` groups `pkg-upgrade` packages by `appPath`, then splits them by dev and prod. Each group is one step. Labels look like `Upgrade electron (dev) in mobile/`.
  - `expo-align` → `npx expo install --fix`, then the check `npx expo-doctor`.

- [ ] **Step 4: Attach the recipes** in `stackFreshness.ts`:

  | Issue | `fix` |
  | --- | --- |
  | Expo SDK | `recipeForDependency(d)` |
  | Expo alignment | `{kind:'expo-align', appPath}` |
  | Dependency drift | `recipeForDependency(d)` |
  | Minor bundle | merge the `pkg-upgrade` packages of every npm minor dep; `undefined` if there are none |
  | Install | `{kind:'install', appPath: app.path}` |
  | Runtime | none |

- [ ] **Step 5: Run `npm test`.** It should pass: 44 existing tests plus the new ones.

- [ ] **Step 6: Commit** with the message `feat(fixer): typed fix recipes, validation and argv building`.

### Task 2: After-run helpers (pure)

**Files:**
- Modify: `src/services/fixRecipes.ts`
- Test: `tests/fixer.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface ChangedFile { path: string; status: 'modified' | 'added' | 'deleted' | 'untracked' }
  export function parsePorcelain(out: string): Map<string, string>   // path → 2-char XY code
  export function changedSince(before: Map<string,string>, after: Map<string,string>): ChangedFile[]
  export type ConfigProposal =
    | { kind: 'json-remove-sdk'; file: string; before: string; after: string; current: string; expected: number }
    | { kind: 'code-line'; file: string; line: number; current: string; expected: number };
  export function removeSdkVersion(jsonText: string, expectedMajor: number): string | null
  export function findSdkVersionLine(code: string): { line: number; value: string } | null
  ```

- [ ] **Step 1: Write the failing tests.**
  - `parsePorcelain(' M package.json\n?? new.txt\nR  a -> b\n')` maps `package.json`, `new.txt` and `b`.
  - `changedSince`:
    - A file that was already ` M` with the same code isn't listed.
    - A new `??` entry → `untracked`.
    - A path that went from ` M` to missing → not listed (it was reverted).
    - A ` M` that appeared → `modified`.
    - Paths starting with `node_modules/` are excluded.
  - `removeSdkVersion`:
    - `{"expo":{"name":"a","sdkVersion":"50.0.0"}}` with expected 51 removes the key.
    - It returns `null` when the key is missing or its major is 51.
    - **Review Focus 5:** input with `\r\n` and 4-space indent keeps both in the output.
  - `findSdkVersionLine("export default {\n  sdkVersion: '50.0.0',\n}")` → `{line:2, value:'50.0.0'}`.

- [ ] **Step 2: Run `npm test`.** It should fail.

- [ ] **Step 3: Implement.**
  - `removeSdkVersion`: `JSON.parse`, delete `expo.sdkVersion` (or the top-level `sdkVersion` when there's no `expo` key), then `JSON.stringify(obj, null, indent)`.
  - Detect the indent from the first indented line and the line ending from the first `\r\n`. Keep a trailing newline if the original had one.

- [ ] **Step 4: Run `npm test`.** It should pass.

- [ ] **Step 5: Commit** with the message `feat(fixer): changed-file diff and sdkVersion proposal helpers`.

### Task 3: Git helpers (`electron/fixGit.ts`, Node only)

**Files:**
- Create: `electron/fixGit.ts` (imports only `child_process`, `fs`, `path`, and `parsePorcelain` from `../src/services/fixRecipes`)
- Test: `tests/fixer.test.ts`. It runs real git in `fs.mkdtempSync(os.tmpdir())` repos, with `user.name`/`user.email` set per repo.

**Interfaces:**
- Produces:
  ```ts
  export interface GitState { repoRoot: string; head: string; dirty: Map<string, string> }
  export async function gitState(cwd: string): Promise<GitState | null>     // null: not a repo or no git
  export async function checkpoint(repoRoot: string): Promise<string>       // git add -A; commit; returns new head
  export async function statusMap(repoRoot: string): Promise<Map<string, string>>
  export async function restoreFiles(repoRoot: string, head: string, files: ChangedFile[]): Promise<string[]>
  export async function commitFiles(repoRoot: string, files: string[], message: string): Promise<string>
  ```
- All git calls go through `execFile('git', args, { cwd, windowsHide: true })`. No shell.

- [ ] **Step 1: Write the failing tests.**
  - `gitState` on a non-repo temp dir → `null`.
  - On a clean repo → `dirty.size === 0` and `head` is 40 hex characters.
  - `checkpoint` on a repo with an untracked file → a new head, and the tree is clean afterwards.
  - **Review Focus 3:** `checkpoint` when `.git/hooks/pre-commit` exits 1 → rejects.
  - `restoreFiles` after modifying `a.txt` and adding `b.txt` → `a.txt` is back to its old content, `b.txt` is deleted, and the restored paths are returned.
  - `commitFiles(['a.txt'])` commits only `a.txt`.

- [ ] **Step 2: Run `npm test`.** It should fail.

- [ ] **Step 3: Implement.**
  - `restoreFiles`:
    - Tracked files: `git restore --source=<head> --staged --worktree -- <paths>`.
    - Files with status `untracked`/`added` that didn't exist at `head`: delete them with `fs.promises.rm`.
    - Skip every `node_modules/` path.

- [ ] **Step 4: Run `npm test`.** It should pass.

- [ ] **Step 5: Commit** with the message `feat(fixer): git state, checkpoint, restore and commit helpers`.

### Task 4: Runner and IPC (main + preload)

**Files:**
- Create: `electron/fixRunner.ts`
- Modify: `electron/main.ts` (known roots, IPC handlers, kill on window close), `electron/preload.ts`, `src/services/projectScanner.ts` (the `Window.electronAPI` type)
- Test: `tests/fixer.test.ts` (`runSteps` only)

**Interfaces:**
- Consumes: Task 1 (`validateRecipe`, `buildSteps`, `detectPackageManager`, `toCmdLine`, `recipeAppPaths`), Task 2 (`changedSince`, `removeSdkVersion`, `findSdkVersionLine`), Task 3 (all).
- Produces (`electron/fixRunner.ts`):
  ```ts
  export type FixEvent =
    | { type: 'output'; runId: string; stream: 'stdout' | 'stderr' | 'info'; text: string }
    | { type: 'step'; runId: string; index: number; state: 'running' | 'done' | 'failed'; exitCode?: number; ms?: number }
    | { type: 'end'; runId: string; result: FixRunResult };
  export interface FixPlan { planId: string; projectRoot: string; title: string; steps: (FixStep & { cwd: string })[]; git: { repoRoot: string; head: string; dirtyCount: number } | null }
  export interface FixRunResult { runId: string; ok: boolean; stopped: boolean; failedStep?: number; steps: { label: string; exitCode: number | null; ms: number; isCheck: boolean }[]; changedFiles: ChangedFile[]; configProposals: ConfigProposal[]; logPath: string; undoable: boolean; checkpointed: boolean }
  export async function runSteps(steps: { argv: string[]; cwd: string; isCheck: boolean }[], onEvent: (e: FixEvent) => void, runId: string, signal: { stopped: boolean; pid?: number }): Promise<{ exitCodes: (number | null)[]; failedStep?: number }>
  ```
- IPC handlers and their preload names:

  | IPC channel | Preload name | Returns |
  | --- | --- | --- |
  | `fix:plan` | `fixPlan(projectRoot, recipe, title)` | `FixPlan` |
  | `fix:run` | `fixRun(planId, {checkpoint})` | `{runId}`; rejects with `Error('A fix is already running')` |
  | `fix:stop` | `fixStop(runId)` | |
  | `fix:applyConfig` | `fixApplyConfig(runId, index)` | `boolean` |
  | `fix:commit` | `fixCommit(runId)` | `head` |
  | `fix:undo` | `fixUndo(runId)` | `string[]` |
  | `fix:openFile` | `fixOpenFile(runId, file)` | |
  | `fix:openLog` | `fixOpenLog(runId)` | |
  | event `fix:event` | `onFixEvent(cb)` | unsubscribe function |

- [ ] **Step 1: Write failing tests for `runSteps`** (Windows only; skip elsewhere), with argv built by hand:
  - Two steps: `['node','-e','process.exit(0)']` and `['node','-e','console.log(1)']` → both exit 0, and an `output` event contains `1`.
  - **Review Focus 4:** a first step `['node','-e','process.exit(3)']` with `isCheck:false` → `failedStep:0`, and the second step never starts.
  - A failing step with `isCheck:true` → no `failedStep`.
  - **Review Focus 1:** a cwd with a space and brackets (`mkdtemp` + `'My App (old)'`) → `node -e "console.log(process.cwd())"` prints that folder.

  Use argv tokens that `quoteWinArg` accepts, e.g. `-e` with `process.exit(3)`; the parentheses get quoted.
- [ ] **Step 2: Run `npm test`.** It should fail.
- [ ] **Step 3: Implement `runSteps`.**
  - Spawn `cmd.exe` with `['/d','/s','/c', toCmdLine(argv)]` and `{ cwd, env, windowsVerbatimArguments: true, windowsHide: true }`. On other systems spawn `argv[0]` directly.
  - Stream stdout and stderr chunks as `output` events.
  - Stop: set `signal.stopped`, then `execFile('taskkill',['/pid',pid,'/T','/F'])`.
- [ ] **Step 4: Run `npm test`.** It should pass.
- [ ] **Step 5: Implement plan and run in `fixRunner.ts` and wire up the IPC in `main.ts`.**
  - **Known roots:** a `Set` of normalized (lower-case, no trailing slash) project roots.
    - Add every `fs:scanDirectory` path and every `fs:scanPortfolioRoot` project.
    - When the set misses, `fix:plan` also accepts roots listed in `store:read('portfolio')`'s `projects[].workspace.rootPath`.
    - Anything else throws `Error('Unknown project')`.
  - **Plan:**
    - `validateRecipe`.
    - For each app path: `realpath(join(root, appPath))` must start with `realpath(root)`.
    - Read that app's `package.json` (for `packageManager` and `devDependencies`) and its root file names, then build the steps.
    - Run `gitState(cwd of the first app)`.
    - Store the plan in a `Map` for 10 minutes.
  - **Run:**
    - Refuse if a fix is already running.
    - If `checkpoint` is set and the tree is dirty, run `checkpoint()`. If it rejects, the run ends `ok:false` and no steps run.
    - Snapshot `statusMap`, call `runSteps`, then snapshot it again and compute `changedSince`.
    - **Config proposals (Expo recipes only):**
      - Expected major: `toMajor`, or `parseSemverMajor` of `package.json`'s `expo` after the run.
      - For `app.json` and `app.config.json`: `removeSdkVersion`.
      - For `app.config.ts` and `app.config.js`: `findSdkVersionLine`, when its major ≠ expected.
    - Write the log to `fix-logs` and prune it to 50 files.
    - Emit `end`.
    - `undoable` is true when git is present.
  - **`applyConfig`:** write `after` only if the file still equals `before`; otherwise return `false`.
  - **`openFile`:** only a path inside the project, via `shell.openPath`.
  - **Window closed:** if `mainWindow` closes during a run, stop it.
- [ ] **Step 6: Verify.** `npx tsc --noEmit -p .` and `npm run build` should both be clean.
- [ ] **Step 7: Commit** with the message `feat(fixer): main-process runner, IPC and preload API`.

### Task 5: Fix UI (provider, sheet, button) and App wiring

**Files:**
- Create: `src/components/project/fix/FixProvider.tsx` (context, the run state machine, and the minimized chip)
- Create: `src/components/project/fix/FixSheet.tsx` (confirm, running and result views)
- Modify: `src/components/project/StackFreshnessPanel.tsx`:
  - `FreshnessIssueRow` gets a Fix button.
  - `StackFreshnessPanel` gains a `projectRoot?: string` prop, passed down to the row.
  - Copy-only rows show "Run this yourself" plus the reason.
- Modify: `src/components/project/PortfolioView.tsx:911` (pass `projectRoot={detail.workspace.rootPath}`) and `:919` (footer copy: "Fix runs the upgrade after you confirm. Other commands: copy, review, then run.")
- Modify: `src/components/project/ProjectDashboard.tsx:438` (pass `projectRoot`)
- Modify: `src/App.tsx`:
  - Wrap the app in `<FixProvider onFixed={…} getReport={…}>`.
  - Make `handleRescanPortfolioProject` await `handleRefreshProject(true)` for the active project.

**Interfaces:**
- Consumes: the preload API from Task 4; `FreshnessIssue.fix` from Task 1.
- Produces:
  ```ts
  export function useFix(): { available: boolean; busy: boolean; start(projectRoot: string, issue: FreshnessIssue): void } // available=false in the browser
  <FixProvider onFixed={(projectRoot: string) => Promise<void>} getReport={(projectRoot: string) => StackFreshnessReport | undefined}>
  ```
  `getReport` in App: find the `portfolioProjects` entry by root, then `assessStackFreshness(entry.auditReport.stackProfile)`; otherwise `undefined`.

- [ ] **Step 1: Build the sheet's states.**
  - **confirm:** the title; "Runs in <cwd>"; numbered argv lines joined with spaces, with check steps marked "(check)".
    - **Git line:** clean → "Undo available (commit abc1234)"; dirty → "N uncommitted files" with the checkbox **Commit them first**, ticked by default; no git → an amber "No git repo: this fix can't be undone".
    - **Buttons:** Cancel and Run fix.
  - **running:** a monospace log, capped at 5,000 lines. It follows the end unless the user has scrolled up. The current step is highlighted, with Stop and Minimize buttons.
  - **result:**
    - Each step with ✓/✗ and its time; the expo-doctor result; "Failed at step N" when a step failed.
    - The changed files.
    - Config proposals: a diff with **Apply**/**Skip**, or for code files the file:line with **Open file**.
    - Freshness `before → after`, read from `getReport` before the run and after `onFixed`.
    - Buttons:
      - **Continue to SDK N+1**: shown when the fresh report still has an issue with the same `id` and `fix.kind === 'expo-sdk-step'`. It goes straight to a new confirm view for that recipe.
      - **Commit this fix**, **Undo** (with its own confirm listing the files and the note "Run install again afterwards"), and **Open log**.
- [ ] **Step 2: Add the Fix button** to `FreshnessIssueRow`: lucide `Wrench`, `title="Fix: runs after you confirm"`. Disabled with the tooltip "Another fix is running" when `busy`. Hidden when `!available || !issue.fix || !projectRoot`.
- [ ] **Step 3: Verify.** `npx tsc --noEmit -p .`, `npm test` and `npm run build` should all be clean.
- [ ] **Step 4: Commit** with the message `feat(fixer): Fix sheet with live output, result, continue, commit and undo`.

### Task 6: End-to-end verification and handoff

**Files:**
- Scratch only: fixtures and the driver script under the session scratchpad.
- Modify: `HANDOFF.md`

- [ ] **Step 1: Make the fixtures** in the scratchpad.
  - Folder `fixroot/tiny-app`: a `package.json` with `"is-number": "^6.0.0"` in dependencies, installed with `npm install`, then `git init` and an initial commit.
  - `fixroot/expo-config`: an `app.json` containing `expo.sdkVersion "50.0.0"` and a `package.json` with `expo ^51.0.0`. It's only used to check the proposal UI, with a stubbed run. Don't install Expo.
- [ ] **Step 2: Drive the real app** with playwright-core `_electron`, as described in the paperRock lesson `electron-e2e-without-new-installs`.
  - First confirm no Litho instance is running.
  - Add `fixroot` as a portfolio root through the stubbed dialog, then restore the owner's roots at the end.
  - Check each of these:
    1. The is-number issue shows Fix. The sheet lists `npm install is-number@^7.x`.
    2. Run streams output, then the result lists `package.json` and `package-lock.json`. The freshness goes up.
    3. Undo puts `package.json` back.
    4. With a dirty file, the checkpoint commit is created (`git log -1` message).
    5. Stop during a run ends it, and no `npm` process is left (`tasklist`).
    6. A second Fix is disabled while one is running.
    7. No console errors.
- [ ] **Step 3: Update `HANDOFF.md`.**
  - Fixer section: files, IPC, what's copy-only, what was verified.
  - "Expo SDK step run not verified on a real Expo app; try on a copy of C1/mobile with the owner's OK".
  - Move the stack fixer out of "In progress", and set the next step to the AI foundation.
- [ ] **Step 4: Commit** with the message `docs: handoff for the safe stack fixer`.
