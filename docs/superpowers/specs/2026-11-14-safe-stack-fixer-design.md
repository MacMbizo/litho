# Safe stack fixer: design

_2026-11-14. Status: draft for owner approval. The first of three projects, in the order the owner chose (1 stack fixer, 2 AI foundation, 3 design suite)._

## Why

DocAtlas already tells you a project has fallen behind: an old Expo SDK, packages that no longer match their SDK, missing `node_modules`, an outdated framework. Today it only shows the fix as text you copy into a terminal. The pain point is coming back to a project after weeks and finding it no longer runs. The fixer closes that loop inside DocAtlas: click **Fix**, confirm, watch it run, see what changed, and see the freshness grade move.

Owner direction: use best practice, as long as it doesn't become cumbersome.

## Goals

- A **Fix** button on every freshness issue that DocAtlas can safely fix on its own, in both the portfolio drawer and the Project Overview (`StackFreshnessPanel` / `FreshnessIssueRow`).
- A confirmation sheet showing the exact commands, the folder they run in, and the git state, before anything runs.
- Live output while it runs, with a **Stop** button that ends the whole process tree.
- Afterwards: run `npx expo-doctor` for Expo apps, rescan the project and recheck registries, list the files that changed, and show the freshness before and after.
- Propose Expo config changes (`expo.sdkVersion`) as a diff you approve. Never apply them silently.
- Expo upgrades go one SDK at a time (Expo's own advice). When a step succeeds, a **Continue to SDK N+1** button starts the next step in one click.
- Undo: put back the files the fix changed, using git.

## Non-goals (this project)

- A free shell, or running any text the renderer sends.
- Changes to the whole machine: `nvm install`, `uv python install`. These stay copy-only, because they affect every project, not just one.
- Interactive tools: `npx @next/codemod upgrade` stops to ask questions, so it stays copy-only.
- Python package upgrades (`pip`/`uv`): DocAtlas offers both side by side and can't yet tell which one the project uses. They stay copy-only for now.
- Editing app code to fix breaking changes. The fixer changes package files, lockfiles and (with approval) Expo config only.
- Packaging and the installer (still waiting on the owner's decision).

## Anti-goals (a failure even if it "works")

- Something runs that you didn't see on the confirmation sheet.
- A project is left half-upgraded with no clear message saying so and no way back.
- Uncommitted work is mixed into the fix with no warning.
- Two installs run at once in the same project.
- An extra click on every step of a multi-SDK upgrade.

## Approaches considered

1. **Fixed recipes run by Electron (chosen).** The renderer asks for "fix issue X in app Y". The main process rebuilds the exact command list itself from a short fixed set of recipes, validates every part, runs it and streams the output. The renderer can never make it run text it made up. Costs a bit more code: one recipe per kind of fix.
2. **Run the displayed command strings through a shell after confirmation.** The quickest to build, but any string that reaches IPC gets executed, and lines such as `cd mobile && …` and `# then repeat…` need special-case handling. Rejected as unsafe for an app that is meant to be safe.
3. **Open Windows Terminal with the command already typed in.** The safest, but DocAtlas can't see the result, so there's no expo-doctor, rescan, diff or next step. Rejected: it drops most of what the feature is for.

Chosen by Claude after the owner handed over the how ("use best practice, as long as it doesn't become cumbersome").

## Design

### Recipes (pure, shared, tested)

New `src/services/fixRecipes.ts`, with no Electron or DOM imports, so both the renderer and `electron/main.ts` (esbuild bundles it) can import it.

A recipe is a typed request, not a string:

| Kind | Fields | Steps (argv) | Comes from |
| --- | --- | --- | --- |
| `expo-sdk-step` | `appPath`, `fromMajor`, `toMajor` (= fromMajor + 1) | `npx expo install expo@^{to}.0.0 --fix`, then the check `npx expo-doctor` | Expo SDK issue |
| `expo-align` | `appPath` | `npx expo install --fix`, then the check `npx expo-doctor` | "packages don't match SDK" issue |
| `pkg-upgrade` | `appPath`, `packages: {name, range, dev}[]` | the package manager's add command, one per package | npm framework/library issue, minor-releases bundle |
| `install` | `appPath` | `<pm> install` | "dependencies not installed" issue |

- `issueToRecipe(issue, profile)` maps a `FreshnessIssue` to a recipe or to `null` (copy-only). It needs structured data, so `FreshnessIssue` gains an optional `fix?: FixRecipe`, filled in by `assessStackFreshness` next to `commands`. The command text shown today stays as it is.
- Validation (`validateRecipe`): `appPath` is relative, with no `..` and no drive letter. Package names match the npm name rule. Ranges match `^\d+(\.\d+){0,2}` with an optional `^`/`~`. Anything else is refused.
- Package manager: from `packageManager` in `package.json`; otherwise from the lockfile (`pnpm-lock.yaml`, `yarn.lock`, `bun.lockb`/`bun.lock`, else npm). Detected in main at plan time, not trusted from the renderer. The add command for each: npm `install [-D]`, pnpm `add [-D]`, yarn `add [-D]`, bun `add [-d]`.
- Expo stays on `npx expo install`, so versions match the SDK, whatever the package manager.

### Main process: plan, then run

- **`fix:plan(projectRoot, recipe)`**:
  - Checks that `projectRoot` is a project DocAtlas knows (it's in the portfolio or is the open workspace), and that `realpath(projectRoot/appPath)` is inside it.
  - Resolves the steps to `{ argv, cwd, label, isCheck }`.
  - Reads the git state (below).
  - Stores the plan under a random `planId` and returns it for the sheet.
- **`fix:run(planId, { checkpoint })`**: runs the stored plan exactly as shown. The renderer can't change the steps. Steps run one after another; a non-zero exit stops the run, except for check steps (expo-doctor), whose failure is reported but doesn't count as the fix failing.
- **Streaming**: `fix:output` events carry `{ runId, stream, text }`, and `fix:status` carries step start, exit code and duration. The renderer keeps up to the last 5,000 lines.
- **`fix:stop(runId)`**: `taskkill /pid <pid> /T /F` on Windows (`kill -pid` on other systems).
- **One fix at a time**, across the whole app. A second `fix:run` while one is running is refused, and the UI says so.
- **Spawning on Windows**: `npx`/`npm`/`pnpm` are `.cmd` shims, which Node won't spawn without a shell. Run them through `cmd.exe /d /s /c` with arguments built only from validated tokens and quoted by one helper (`quoteWinArg`). It has tests. No user text ever reaches the command line.
- **Environment**: the user's normal `PATH`. Set `CI=1` so tools don't wait for input, and `FORCE_COLOR=0` so the output is plain text.
- **Log**: each run's full output is saved to `userData/docatlas/fix-logs/<timestamp>-<project>.log`, and the result screen links to it.

### Git: checkpoint and undo

- Find the repo that holds the app folder with `git -C <cwd> rev-parse --show-toplevel`. Nested apps often have their own repo.
- **Clean tree**: the sheet says "Undo is available (current commit abc1234)". Nothing to do.
- **Uncommitted changes**: the sheet shows how many files and offers **Commit them first** (on by default). That makes a checkpoint commit `chore: checkpoint before DocAtlas fix` with every change, untracked files included, like `git add -A`. The other choice is **Run anyway**, which turns undo off for files that already had changes.
- **No git repo**: a warning that the fix can't be undone, and Run stays available.
- **Undo** (after a run, with its own confirmation): `git restore --source=<start commit> --staged --worktree -- <files>` for the tracked files the fix changed, and delete untracked files the fix created. It lists the files first. `node_modules` is never touched by undo. The sheet says to run install again after undoing.
- Git is run with `execFile('git', …)` with no shell. If git isn't installed, the repo is treated as having no git.

### After a run

1. For Expo recipes, `npx expo-doctor` has already run as the check step; its result is shown as passed or with problems, and the output can be expanded.
2. **Changed files**: `git status --porcelain` before and after, compared, so the list shows only what the fix changed.
3. **Expo config proposal** (after `expo-sdk-step` or `expo-align`):
   - `app.json` / `app.config.json` with `expo.sdkVersion` that doesn't match the new SDK: propose removing the key (Expo's docs say to remove it or keep it matching `package.json`). Show it as a small diff with **Apply** / **Skip**. Apply keeps the file's indentation and line endings.
   - `app.config.ts` / `.js` with `sdkVersion`: show the file and line number and an **Open file** button (`shell.openPath`). Never rewrite code.
4. **Rescan**: `handleRescanPortfolioProject(projectRoot)`, which already rescans and rechecks registries. The result screen shows the freshness level before and after.
5. **Next step**: if the project is still behind on Expo, **Continue to SDK N+1** opens the next plan already resolved. The git state shown is from now, which is normally clean after the previous step's commit. One click to confirm.

The fixer doesn't commit the result. The result screen offers **Commit this fix** (message `chore(deps): <issue title>`) as a button, since the owner commits after checking the app.

### UI

- `FreshnessIssueRow` gains a **Fix** button (lucide `Wrench`) when `issue.fix` exists and the app is running in Electron. It's hidden in the browser build. Copy-only issues keep their copy buttons and show "Run this yourself" with the reason (machine-wide / asks questions).
- **Fix sheet** (modal, matches the existing dark panels):

```
Fix: Expo SDK 50 → 51 (mobile/)
Runs in  C:\Prj\C1\mobile
  1  npx expo install expo@^51.0.0 --fix
  2  npx expo-doctor            (check)
Git      3 uncommitted files   [x] Commit them first
                                 [Cancel]  [Run fix]
```

- **Running**: the same sheet becomes a log view (monospace, follows the end unless you scroll up), with the current step highlighted and a **Stop** button. It can be minimized to a small "Fixing C1…" chip so you can keep browsing. Only one runs at a time.
- **Result**: passed/failed per step, expo-doctor result, changed files, the config proposal, freshness before → after, and the buttons **Continue to SDK N+1**, **Commit this fix**, **Undo**, **Open log**.

## Testing

- Unit tests (`tests/docatlas.test.ts` or a new `tests/fixer.test.ts`):
  - `issueToRecipe` for each issue kind, including the copy-only ones.
  - `validateRecipe`: refuses `..`, absolute paths and bad names or ranges.
  - Package manager detection and the add argv.
  - `quoteWinArg`.
  - The `sdkVersion` removal keeps formatting and is skipped when the key is missing or matches.
  - Comparing the before and after changed-file lists.
- End-to-end in the real Electron app (Playwright `_electron`, as before), **only on throwaway copies** in the scratchpad, never on the owner's real `C:\Prj` projects without asking:
  - A small Expo project one SDK behind: plan, run, live output, expo-doctor, config proposal, rescan, undo.
  - A dirty tree: the checkpoint commit.
  - Stop in the middle of an install.
  - A second Fix refused while one runs.

## Left to the builder

- Exact component split and file names under `src/components/project/`.
- The minimize-to-chip behaviour if it turns out fiddly. A modal that stays open is acceptable for the first version.
- Log retention: keep the last 50 logs.

## Open for later

- Python upgrades once DocAtlas can tell `uv` from `pip` (via `uv.lock` / `requirements.txt`).
- Node version via `.nvmrc` / `engines` (already on the ideas list).
- "Fix everything in this project" as one queued run.
