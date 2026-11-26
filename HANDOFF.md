# Handoff: Litho (Markdown studio) / DocAtlas

_Last updated 2026-11-26 (end of session). Everything is merged into `main` and pushed to https://github.com/MacMbizo/litho (head `952d9c7`): stack fixer, project basics, licence, queue, the .gitignore and secrets work, and the AI gateway (slice 1). There's no open feature branch. Feature branches are merged into `main`._

## Start here (next session)

- **Next task:** AI foundation **slice 2**, personas plus prompt caching. Then slice 3 (finder → condenser → thinker). Spec: `docs/superpowers/specs/2026-11-26-ai-foundation-design.md`. Load the `claude-api` skill before writing Claude code.
- **Waiting on the owner:**
  - Add a real Claude key in AI & Settings. A real Claude answer has never been tested (no key was used, to avoid spending credit).
  - Re-pick the Ollama model if they used Ollama before. The legacy `llama3` default isn't installed; `llama3.2` is.
  - Rotate the DrivingSchool Supabase `service_role` key if it was ever shared or pushed.
  - Decide whether DrivingSchool's `TEST_CREDENTIALS.md`, `fix-admin-password.js` and `reset-passwords.js` (test-account passwords) go into git.
  - Choose whether to gitignore `.agents/`.
  - Decide on packaging (electron-builder) and the "Open with Litho" association.
- **Changes made outside Litho this session:**
  - **DrivingSchool (not a git repo):**
    - 7 scripts (`create-test-users.js`, `delete-and-recreate-users.js`, `fix-admin-password.js`, `fix-auth-final.js`, `reset-passwords.js`, `test-auth.js`, `test-connection.js`) now read `SUPABASE_SERVICE_ROLE_KEY` from `.env` instead of a hardcoded key.
    - `.env.example` gained that variable's name, with no value.
    - The originals are backed up in the session scratchpad (`…/scratchpad/ds-backup`). They still contain the key, so delete them once the owner is happy.
    - `.env` also has `VITE_WHATSAPP_ACCESS_TOKEN` and `VITE_PAYNOW_INTEGRATION_KEY`. They're unused in `src` and absent from `dist`, but `VITE_` values get bundled into the site if they're ever used.
  - **Fix .gitignore, committed locally only (not pushed), each commit `.gitignore` only:**
    - agent-skills (`antigravity-skills/`): `0f8870c`
    - aves: `0b38bcc`
    - instruction-scanner: `23515e5`
    - paperRock: `935874c`
    - sightline: `b8d5d40`
  - **Skipped on purpose:**
    - **wellness:** 41 staged files, including a staged `.gitignore`, so someone's work is in progress.
    - **F4:** tracks `.vercel/project.json` on purpose. DocAtlas now leaves tracked folders alone.
- **E2E scripts:** they live only in the session scratchpad and aren't in the repo. They used playwright-core from the npx cache with `--user-data-dir`. The suites were `e2e-basics` (`C:\Prj`, read-only, hashes every `.git`), `e2e-fixes`, `e2e-queue`, `e2e-gitignore` and `e2e-ai`, all on throwaway fixtures. Worth adding to the repo as a `tests/e2e/` folder.
- **Gotcha:** in this environment Git Bash heredocs collapse `\\` to `\`. Write code containing backslashes with the Write/Edit tools, never `cat <<EOF`.

## Name and brand (2026-11-14)

- **Names:**
  - The app is **Litho**: one app. DocAtlas is its project-checking section.
  - "Notion" is gone from user-facing labels. Code identifiers like `NotionEditor` are unchanged.
- **Approved artwork (owner, direction "B2 overprint"):**
  - **Litho:** a Markdown `#` printed in cyan `#00AEEF` and magenta `#EC008C` (multiply) on paper `#FAF7F0`.
  - **DocAtlas:** a folded map with a magenta route.
  - Design: `docs/superpowers/specs/2026-11-13-litho-icons-design.md`.
- **Files:**
  - Sources: `assets/brand/litho.svg`, `litho-small.svg` (used for 16 to 32 px) and `docatlas.svg`.
  - In-app marks: `src/components/brand/BrandMarks.tsx` (`LithoMark`, `DocAtlasMark`, inline via Vite `?raw`).
- **Generated (committed):**
  - `assets/brand/build/litho-*.png` and `litho.ico`.
  - `public/favicon.svg` and `public/favicon-32.png`.
  - Re-render after editing the SVGs with `npx electron scripts/render-icons.cjs`. `tests/brand.test.ts` checks the ICO, the sizes, and that the overprint overlap renders dark.
- **userData is pinned** to `%APPDATA%\notion-markdown-studio` in `electron/main.ts`.
  - **Keep it.** Without it, a package rename or a `productName` change makes the app start empty: no portfolio, notes settings or last workspace.
  - If packaging later, keep the pin. Don't move the data.

## What this is

Local-first Electron + React + Vite app (`C:\Prj\litho`, renamed from `C:\Prj\newdoc` on 2026-11-14). **DocAtlas** is the feature being built: it audits every project under one or more root folders (normally `C:\Prj`) for:

- **Doc health:** per-doc states (canonical, healthy, module-doc, stale, duplicate, deprecated, orphan, agent-system), an A–D grade and fix-it actions.
- **Stack freshness:** whether each project still runs. It checks Expo SDK, frameworks, Node/Python end-of-life and Expo package alignment against live npm/PyPI.

The original spec (`docatlas_specification.md`) is **not in the repo**. It's at `~/.gemini/antigravity/brain/e44905d0-ecda-49d2-ad91-fe770126712e/`. A Gemini agent wrote the first pass; Claude took over on 2026-11-13.

**Quality bar (from the owner):** match the polish and zero friction of `C:\Prj\envatlas`. Use it as inspiration, not as a copy. Stack freshness is a key feature: coming back to a project after weeks and finding it no longer runs is the pain point it addresses.

## Commands

| Task | Command |
| --- | --- |
| Unit tests (124) | `npm test` |
| Typecheck | `npx tsc --noEmit -p .` |
| Full build (renderer + electron) | `npm run build` |
| Run desktop app | `npm run build && npm start` |
| Browser dev (sample vault only, no portfolio) | `npm run dev` |

## Recent commits

- `37370ed` Litho favicon, labels and DocAtlas mark in the UI (merged from `feat/litho-icons`)
- `f6052ad` Litho window title and icon; userData pinned
- `b240b57` Rendered Litho PNG/ICO assets and favicon
- `5f29323` Litho and DocAtlas SVG marks
- `5c53c6b` README with badges, MIT LICENSE, first push to GitHub
- `31466a5` Notes: rename from heading, notes folder setting, open files from the command line
- `ad40f69` Notes: standalone Markdown notes and opening any .md file
- `56cdbc8` Stack freshness, remembered portfolio, redesigned landing page
- `40bf59c` Stack penalty removed from the doc-health grade; freshness types added
- `a0e5de8` Audit calibrated on the real `C:\Prj` projects
- `2222dca` Audit/remediation bug fixes, module-doc state, auto-heal
- `5e2ecdd` Checkpoint of the previous agent's work

## Notes (Markdown outside any project), added 2026-11-13

- **What it does:** `Ctrl+N` creates a plain note from anywhere in the app. `Ctrl+O` opens any .md file. `Ctrl+Shift+S` is "Save as…". Notes also has a sidebar entry and a "New note" button on the portfolio header.
- **Where notes live:** `Documents\DocAtlas Notes`, scanned and watched like a project. The workspace has `kind: 'notes'`, so DocPassport and Project Overview are hidden there.
- **Files opened from elsewhere:**
  - They are listed under a virtual "Opened from elsewhere" folder. Ids look like `~elsewhere/<name>`, and `fullPath` is the real file, which is saved in place.
  - Their paths are stored in `userData/docatlas/notes.json`.
  - "Remove from Notes" only forgets a file; it never deletes it.
  - Missing files are dropped on load.
- **Opening a file that belongs to a known project:** it opens in that project, so DocPassport applies.
- **Code:**
  - `src/services/notesWorkspace.ts` holds the pure helpers and has tests.
  - `src/services/notesStore.ts` loads the folder and the remembered list.
  - In `App.tsx`: `showNotes`, `handleNewNote`, `openMarkdownPaths`, `handleSaveAs`.
  - IPC: `notes:getFolder`, `dialog:openMarkdownFiles`, `dialog:saveMarkdownFile`, `fs:fileInfo`.
- **Fixed in the same pass:**
  - Editing a file without frontmatter used to inject `type`/`title`/`tags` YAML. This affected every README in every project. `MarkdownService.rebuild` now keeps a plain file plain unless its properties actually change.
  - "New File in Folder" joined an absolute folder path onto the project root.
- **Rename from heading:**
  - When you move on from an auto-named note (`Note YYYY-MM-DD HHMM.md`, by another tab, closing it, or switching workspace), the file takes its first H1 as its name. This is `noteNameFromHeading` plus `renameNoteFromHeading` in `App.tsx`.
  - It uses `movePathSafe`, so nothing is ever overwritten.
  - Names the user chose, and files opened from elsewhere, are never renamed.
  - **Gotcha:** scanned `fullPath`s use backslashes, so run `normalizeFsPath` before splitting on `/`. Before that fix, a test run renamed a note into a folder called `Note ….m`.
- **Notes folder setting:**
  - It's in Settings (the modal is now titled "Settings") and stored as `folder` in `notes.json`.
  - `notes:getFolder(preferred)` falls back to the default when the chosen folder can't be used.
  - Changing the folder doesn't move existing notes.
- **Opening files from outside the app:**
  - `npm start -- "C:\path\file.md"` opens that file. Launch files take priority over restoring the last workspace.
  - Single-instance lock: a second launch hands its .md files to the running window (`app:openFiles`) and exits. **This means two copies of DocAtlas can't run at once.**
- **Verified:**
  - 41 unit tests.
  - Two Electron runs with the native dialogs stubbed, 18 + 19 steps, all passing:
    - Run 1: new note, autosave, open an outside file, Save as, Remove, relaunch, a project file opening in its project.
    - Run 2: a launch file, second-instance handoff, rename from heading, folder change and reset.
  - No console errors. The test scripts are not in the repo.
- **Not built:** registering DocAtlas with Explorer ("Open with" / double-click .md). This needs packaging, e.g. electron-builder with `fileAssociations`. That's a new dev dependency, so it waits for the owner's go-ahead. The app side (argv plus single instance) is already done.

## Where things live

- **`electron/stackFiles.ts`:** finds nested apps up to 3 levels deep, skipping folders the project's `.gitignore` excludes. Reads config files and installed `node_modules` versions. Node-only, so it can be imported by scripts.
- **`electron/main.ts`:**
  - IPC for scans: `fs:scanDirectory(path, { watch })` and `fs:scanPortfolioRoot`.
  - The `store:read` / `store:write` JSON store at `userData/docatlas/<name>.json`.
  - `net:fetchJson`, which only allows npm, PyPI and the jsDelivr `expo@N/bundledNativeModules.json`.
- **`src/services/stackInspector.ts`:**
  - Inspects each app (`apps`, `runtimes`, `installedVersion`).
  - Registry check and Expo alignment in `checkLiveStackVersions`.
  - Node/Python end-of-life dates calculated offline.
- **`src/services/stackFreshness.ts`:** `assessStackFreshness` scores issues by tier (platform > library > tooling).
  - Any critical platform issue means "At risk"; any outdated platform issue caps the project at "Aging".
- **`src/services/docHealthAuditor.ts`:** doc states and the doc grade, which no longer includes stack age.
- **`src/services/portfolioStore.ts`:** the portfolio snapshot.
  - Restored entries are `fromSnapshot` with `files: []`, and `App.tsx` re-reads them from disk before editing. **Keep this**, or autosave could blank real files.
  - Refreshes quietly when older than 6h.
- **`src/components/project/PortfolioView.tsx`:** the landing page.
  - KPI tiles, upgrade radar, project cards, Stack versions matrix, detail drawer.
  - Saves tab/filter/sort per viewer in localStorage.
- **`src/components/project/StackFreshnessPanel.tsx`:** shared freshness panel and badge, also used in `ProjectDashboard.tsx`.
- **`src/App.tsx`:**
  - Portfolio state: `portfolioRoots`, `enrichWithRegistry`, `applyPortfolioScan`, `refreshAllPortfolioRoots`, `handleRescanPortfolioProject`, `handleOpenPortfolioProject`.
  - Remembers the last view (`notion_last_view`).
  - Hides the editor top bar and tabs on the portfolio page.

## Verified

- Tests, typecheck and build are clean.
- The real Electron app was driven with Playwright `_electron`, scanning `C:\Prj`:
  - 24 projects and 36 apps found.
  - Relaunch shows the portfolio in about 0.2s from the snapshot.
  - Tested: the drawer, the Stack versions tab, a single-project rescan, and opening C1 from the snapshot.
  - No console errors.
- **Browser build:** the sample vault's Project Overview works, and the portfolio shows its "desktop only" card.
- **How to drive it:** playwright-core from the npx cache with `executablePath: require('electron')`. For a browser, use `channel: 'msedge'`.

## Not verified / known gaps

- **Untested:** the "Choose folder" dialog (the root was set by script) and light theme.
- **Phone width:** the existing fixed sidebar fills the screen. Not a target, since the Electron window's minimum width is 960px.
- **Unchecked claim:** "store Expo Go only runs the newest SDK" comes from memory, not from Expo's docs.
- **App state:** portfolio root `C:\Prj`, snapshot saved, last workspace `C:\Prj\F4` (e2e runs restore it). No project files were modified by tests.
- **Taskbar identity (fixed 2026-11-14):** pinning used to show the Electron icon because the unpackaged app runs as `electron.exe`. `electron/main.ts` now sets `app.setAppUserModelId('com.litho.app')` and `win.setAppDetails` (Litho icon, name, relaunch `"<electron.exe>" "<app path>"`). These were read back from the live window's property store. Paths are computed at runtime, so after moving or renaming the folder, unpin and re-pin from the running window.
- **A note nobody can account for:** `Documents\DocAtlas Notes\Note 2026-11-13 2231.md` (empty default) wasn't made by a test. It may be the owner's, so it was left alone.
- **Invalid frontmatter:** 15 real docs have invalid YAML frontmatter; this could be surfaced as an audit issue.
- **`.agents/`** is untracked: an editor-generated paperRock MCP config, with local paths only and no secrets. The owner decides whether to gitignore it.
- **Deferred minors from the final review of the Litho brand work:**
  - The sidebar tile falls back to "N" when there's no workspace (never shown in practice).
  - Packaging must include `assets/brand/build` and set the builder `icon`.
  - No test pins "sizes up to 32 px come from litho-small.svg".
  - `tests/brand.test.ts` resolves paths from the working directory.
  - The DocAtlas mark at 16 px has no small variant.
  - Stale comment "Notion aesthetic" in `index.html`.
- **Pending owner decision:** packaging and installer (electron-builder) plus the "Open with Litho" `.md` association. The app side (argv plus single-instance) is done.

## Safe stack fixer (built 2026-11-14, branch `feat/stack-fixer`)

The owner chose the order **1 stack fixer → 2 AI foundation → 3 design suite**. Project 1 is built. Design: `docs/superpowers/specs/2026-11-14-safe-stack-fixer-design.md`. Plan: `docs/superpowers/plans/2026-11-14-safe-stack-fixer.md`.

- **What it does:**
  - Freshness issues get a **Fix** button (portfolio drawer and Project Overview, desktop only).
  - A confirm sheet shows the exact commands, the folder and the git state.
  - Output streams live, with Stop and a minimize chip.
  - The result screen shows: steps, expo-doctor, changed files, an Expo `sdkVersion` proposal (Apply/Skip for JSON, Open file for `app.config.ts/js`), freshness before → after, **Continue to SDK N+1**, **Commit this fix**, **Undo** and **Open log**.
- **Safety:** the renderer sends only a typed `FixRecipe`. Main re-validates it (`validateRecipe`), checks the project is known (scanned this session or in the portfolio snapshot) and that the folder's realpath is inside it, then builds the argv itself. On Windows it runs `cmd.exe /d /s /c` with tokens quoted by `quoteWinArg`; `"`, `%`, `!` and newlines are refused. Only one fix runs at a time, and closing the window stops it.
- **Can run:**
  - Expo SDK one step at a time (`npx expo install expo@^N+1.0.0 --fix`, then the check `npx expo-doctor`)
  - Expo alignment / react-native (`npx expo install --fix`)
  - npm package upgrades via the project's package manager: npm, pnpm, yarn or bun, detected from `packageManager` or the lockfile; dev dependencies get `-D`
  - missing installs
- **Copy-only, with a reason shown:** Node/Python runtimes (machine-wide), `next` (the codemod asks questions), PyPI packages (pip vs uv unknown).
- **Git:**
  - A dirty tree offers **Commit them first** (ticked by default), with the message `chore: checkpoint before DocAtlas fix`.
  - Undo restores only the files the fix changed, from the start commit, and deletes files it created. It never touches `node_modules`, so after undo DocAtlas still sees the newer installed version until you reinstall.
  - Commit message: `chore(deps): <issue title>`.
- **Logs:** `userData/docatlas/fix-logs/`, the newest 50 kept.
- **Code:**
  - `src/services/fixRecipes.ts`: pure, tested.
  - `electron/fixGit.ts` and `electron/fixRunner.ts`: Node only, tested; `FixController`.
  - IPC `fix:*` in `electron/main.ts`.
  - `src/components/project/fix/FixProvider.tsx` and `FixSheet.tsx`.
  - Recipes are attached to issues in `assessStackFreshness` (`FreshnessIssue.fix`).
- **Also changed:** `--user-data-dir` now overrides the userData pin (this was a deferred minor). E2E tests use it to run with isolated state; setting `APPDATA` does **not** work for this.
- **Verified:**
  - 74 unit tests, including real git temp repos and real `cmd.exe` runs. A fresh reviewer checked the whole branch; its Important findings were fixed (undo never touches files you had already edited, git stays inside the project folder, literal paths for `[id].tsx`, runs always end, Open file only reveals the file).
  - Typecheck and build clean.
  - Electron e2e with isolated userData on a throwaway `hono@3` fixture, 18/18 passing: Fix shown, exact command, live log, changed files, freshness 95 → 100, undo, checkpoint commit, minimize chip, second Fix disabled, Stop, no stray npm process, no console errors.
- **Not verified:**
  - A real Expo SDK step, and the `sdkVersion` proposal UI end-to-end (Expo is a large download; covered only by unit tests). Next: try on a copy of `C1/mobile` with the owner's OK.
  - Light theme.
  - Continue to SDK N+1 (needs a real Expo run).
- **Deferred minors from the review:** the checkpoint defaults on even if files became dirty after the sheet opened; a failed checkpoint leaves `git add -A` staged and Stop cannot cancel a running checkpoint; runId filtering relies on IPC ordering; `parsePorcelain` should use `-z`; child env could set `NoDefaultCurrentDirectoryInExePath` and ignore stdin; Stop on macOS/Linux leaves grandchildren; commit/apply are not locked during a run.
- **Note:** DocAtlas tracks only the main framework packages (`TRACKED_NPM_PACKAGES`), so a tiny package like `is-number` never gets an issue or a Fix.

## Project basics (built 2026-11-26, branch `feat/project-basics`)

The owner's standard: every project has a README that says what it is, a git repo and a GitHub remote. Design: `docs/superpowers/specs/2026-11-26-project-basics-design.md`.

- **Not duplicated:**
  - EnvAtlas has its own description extraction and reads the remote from `.git/config`, but has no checks or writes.
  - Cairn Guardian only records `has_readme`/`has_git` and never writes into project folders.
- **Facts (read-only):**
  - `electron/projectBasics.ts` runs on every scan and is stored as `workspace.basics` in the portfolio snapshot.
  - Git is read with `--no-optional-locks -c core.fsmonitor=false`. Tests and the e2e run hash `.git` before and after.
  - When the root has no `.git`, it looks for nested repos up to 3 levels down (e.g. `AIPrompt/Vercel/pigeonprompt`). That repo's README and licence count.
- **Assessment (pure):** `src/services/projectBasics.ts`.
  - **Description:** the first README paragraph, else a `package.json`/`Cargo.toml`/`pyproject.toml` description.
  - **What isn't a description:** a starter README (Lovable, Vite, Next, Expo, CRA) is flagged "Template README"; paperRock and `pr` are real cases. Also skipped: metadata lines (`**Key:** value`), a bare path, nav lines of links, short bold pseudo-headings, and anything after the third `##` section.
  - **Checks:** README, Git and Remote are the standard (required). Pushed, .gitignore and Licence only warn.
- **UI:**
  - **Cards:** the About line plus gap chips.
  - **KPI tile:** "Project basics".
  - **Filters:** "Missing basics", and "Not projects (n)" for scratch folders, stored in `userData/docatlas/project-prefs.json`.
  - **Checklist:** in the drawer (now "Project details") and on Project Overview.
- **Fixes:**
  - **Code:** `electron/basicsFixer.ts` (`BasicsController`, IPC `basics:run`, `basics:ghStatus`, `basics:openUrl`), `src/services/basicsFixes.ts` and `BasicsActionSheet.tsx`.
  - **Rules:** known roots only; one action at a time; nothing runs until the sheet's button is pressed.
  - **Create README:** `wx`, never overwrites.
  - **Add description:** compare-and-write against the file read just before.
  - **Start git:** writes a `.gitignore` if missing, runs `git init -b main`, scans the files, then commits `chore: initial commit`. If the scan finds anything, it stops and deletes its own `.git`. It refuses nested repos, a folder inside another repo, and a missing `user.email`.
  - **Publish to GitHub:** `gh repo create --private` by default; the About line becomes the GitHub description.
  - **Push:** sets `-u` the first time and scans files in the unpushed commits.
  - **Secret scan:** env files, keys and certs, GitHub/OpenAI/Anthropic/AWS/Stripe/Slack/npm tokens, files over 50 MB, more than 5,000 files on a first commit. Firebase `AIza` web keys are deliberately **not** flagged, because they're public by design.
- **Verified:**
  - 106 unit tests, with real temp repos and a local bare remote.
  - E2E on `C:\Prj`, 19/19: 30 projects, KPI 5/30 complete, descriptions, chips, nested repo, filters, Not a project and restore, search on description, snapshot relaunch, no console errors, **no `.git` under `C:\Prj` changed**.
  - E2E on throwaway fixtures, 17/17: create README; Start git blocked by a token file, then committed; the Publish sheet (gh signed in, private default; cancelled); push to a bare remote; add description to a Lovable README.
- **Not verified:**
  - A real `gh repo create`. It wasn't run, so no GitHub repo was created; it's covered by refusal tests only.
  - Light theme.
- **Calibration on `C:\Prj` (2026-11-26):**
  - **Complete:** aegis, agent-skills, aves, envatlas, nutrition.
  - **No README and no git:** anemerge, Back Cement, DevSet, forexTrader, guardian, mail, mdfiles, merge, nomos, SmoothLite, trial. Some are scratch folders: use "Not a project".
  - **Local only:** C1, F4, instruction-scanner, paperRock.
  - **Template README:** paperRock, pr.
  - **Unpushed:** mccShepherd (25), pigeon (49).
- **Add licence (built later the same day):**
  - Choices: AGPL-3.0 (the default), GPL-3.0, MIT, Apache-2.0, MPL-2.0, or Proprietary for client work.
  - The text is GitHub's official template from `api.github.com/licenses/<key>`. The request is anonymous and sends only the licence key. `[year]` and `[fullname]` are filled in.
  - Written into the repo's folder, including nested repos, with `wx`. Offline means nothing is written.
  - The holder defaults to git's global `user.name` (IPC `basics:gitUser`).
- **Fix several at once:**
  - **Code:** `src/services/basicsQueue.ts` (pure, tested) and `BasicsQueueSheet.tsx`. Opened from the "Missing basics" filter.
  - **Order:** README, licence, start git, publish, push, so a new README and LICENSE go into the first commit.
  - **Defaults:** README and Start git start ticked; licence, publish and push are opt-in.
  - **Rules:** publishing is always private here and is skipped if Start git failed. README is offered only when a manifest description exists.
  - **Existing repos:** new files in a repo that already exists are left for the owner to commit.
- **Portfolio audit moved to the main process:**
  - `src/services/projectSummary.ts`: `fs:scanPortfolioRoot` and `fs:scanProjectSummary` return summaries with no file contents. Entries are `fromSnapshot: true`, so opening a project reads it from disk.
  - A full rescan no longer freezes the window; it was 1.1 s. It takes about 8 s, with the work in the main process.
  - The sidebar's Portfolio tab lists docs from the audit inventory, capped at 60 per project.
- **Large projects:**
  - Trees with more than 200 files start collapsed.
  - The doc matrix pages 100 rows at a time; key docs show 12.
  - The audit is debounced 500 ms while typing and no longer reruns on registry results.
  - agent-skills (3,288 docs) went from about 195k DOM nodes to 4.3k.
- **Verified:**
  - 110 unit tests.
  - E2E suites: basics 19/19, fixes 17/17, queue 15/15. The queue suite covers a real MIT text download, a run with a refusal, push, and the README and LICENSE in the first commit.
  - A copy of the owner's real userData: backfill, rescan and opening agent-skills, all with no long tasks.
- **Not verified:**
  - A real `gh repo create`, single or queued.
  - Light theme.
- **.gitignore and secrets (built 2026-11-26, branch `feat/basics-gitignore`):**
  - **Start git reads `.gitignore` first:**
    - **Prompted by:** DrivingSchool, whose Vite-starter `.gitignore` had no `.env` rule.
    - **What it adds:** only what's missing (`.env`, `.env.*`, `!.env.example`, `*.pem`, `*.key`, and build folders that are present), using `missingIgnoreLines` and `appendIgnoreLines`. Existing lines are never changed.
    - **Before running:** the sheet shows the lines via IPC `basics:planGitignore`.
    - **The matcher (`isIgnored`):** last rule wins, `!` negation, `dir/`, anchoring, `**`, escapes, and ignored parents.
  - **Per-file decisions on findings:** `ScanFinding.level` is `block` or `review`.
    - "Leave out of git" works for any file. It adds an anchored `/path` line and retries.
    - "I checked it: include it" only works for `review` findings, i.e. names like `TEST_CREDENTIALS.md`. `stillBlocking` never lets a `block` through.
  - **New secret patterns:**
    - Supabase `service_role` JWTs, found by decoding the payload (`anon` keys pass).
    - `sb_secret_` keys.
    - Database URLs with passwords. Local hosts and placeholders pass.
    - Every match is checked, so an earlier placeholder can't hide a later real key.
  - **Existing repos:**
    - **"Secrets in git":** `RepoFacts.trackedSecrets` from `git ls-files`. The Stop tracking action updates `.gitignore`, runs `git rm --cached` and makes one commit, and refuses when other changes are staged. History keeps the files, so the UI says to rotate keys.
    - **".env not ignored":** `ignoreGaps`, real risks only, with a Fix .gitignore action. Android `debug.keystore` is exempt.
  - **Owner's data, read-only:**
    - **DrivingSchool:** 7 scripts hardcode a Supabase **service_role** key, for example `create-test-users.js` and `fix-admin-password.js`. Start git now stops on them. The owner should move the key into `.env` and rotate it if it was ever shared.
    - **Other projects:** none has secrets committed. 9 don't ignore `.env`: agent-skills, aves, DrivingSchool, instruction-scanner, litho, paperRock, sightline, wellness. F4 doesn't ignore `.vercel/`.
  - **Verified:**
    - 118 unit tests.
    - E2E suites: gitignore 13/13, basics 19/19, fixes 17/17, queue 15/15.
    - A run on a copy of DrivingSchool: `.gitignore` fixed, the 7 key scripts and the credentials doc flagged, nothing committed.
- **Idea not built:** an AI-written description, once project 2 exists.

## Next: AI foundation (project 2), then design suite (project 3)

1. ~~Safe stack fixer~~: done, see above.
2. **AI foundation.** Design: `docs/superpowers/specs/2026-11-26-ai-foundation-design.md`.
   - **Slice 1, done 2026-11-26 (gateway):**
     - **Code:** `electron/ai/`: `keyStore.ts`, `gateway.ts`, `claude.ts`, `otherProviders.ts` and `types.ts`.
     - **Calls:** all model calls run in the main process (IPC `ai:*`).
     - **Keys:** encrypted with `safeStorage` in `ai-keys.bin`. The renderer only sees `set` and `last4`. Legacy localStorage keys migrate on launch.
     - **Claude:** through `@anthropic-ai/sdk` 1.14: adaptive thinking, effort per task, `fallbacks: "default"`, and `stop_reason` checked.
     - **Other providers:** the Gemini key is in a header. Model lists are live. Ollama uses `num_ctx` 16k. Settings were rebuilt.
     - **Verified:** 124 unit tests. E2E 13/13: legacy migration, an encrypted file on disk, a real local `llama3.2` answer through the gateway, a fake Claude key rejected with a plain message, key removal.
     - **Not verified:** a real Claude, Gemini or OpenAI answer, since no real key was used.
   - **Next: slice 2 (personas + prompt caching), then slice 3 (finder → condenser → thinker).**
   - Add a Claude provider. Current IDs (Nov 2026): default `claude-opus-5-5` ($4/$20 per MTok, cache reads $0.20); also `claude-sonnet-5-5` and `claude-haiku-5-5`. Use `@anthropic-ai/sdk` and load the claude-api skill before coding.
   - Personas as Markdown files in a `Personas` folder, picked per task, 10–20k words. Use prompt caching so a cached persona costs about $0.005 per request on Opus 5.5.
   - Move API keys out of localStorage into Electron `safeStorage`, and make calls from the main process. Today the Gemini key is in the URL and calls come from the renderer.
   - Update the outdated model lists (Gemini 1.5, gpt-4o).
   - Pipeline:
     - **Finder:** Ollama embeddings (e.g. `nomic-embed-text`) pick the relevant docs.
     - **Condenser:** a local Ollama model writes a "doc card" per file, cached by content hash.
     - **Thinker:** Claude or Gemini gets the persona, DocAtlas's audit facts and the cards, and asks for full text on demand.
   - **Watch out:** Ollama's default context window is small and silently truncates big personas, so raise `num_ctx`.
   - Current limits:
     - Project chat (`ProjectChatDrawer.tsx`) sends the top 4 docs × 2,000 chars.
     - `AIService.summarize` sends 15k chars; `categorize` 8k.
3. **Design suite from a PRD** (depends on 2).
   - Detect an idea-stage project (a PRD but no architecture doc).
   - Generate drafts: architecture, data model, API, ADRs, test plan.
   - Write them as `status: Draft` files with `generated_by`, never overwriting, for review before adoption.
   - The thinker reads the PRD in full, not just its card.

## Suggested next steps (older ideas, not started)

1. "Save upgrade plan to all at-risk projects" (writes `UPGRADE_PLAN.md` to each).
2. An opt-in setting to track all dependencies, not only the main frameworks.
3. Compare the installed Node version against `.nvmrc`/`engines`.
4. A weekly background check with a desktop notification when a new Expo SDK ships or a runtime reaches end-of-life.
5. Earlier roadmap: git-blame telemetry, a CI lint CLI, an MCP registry.

## Gotchas

- **Don't patch regex or backslash-heavy code through heredoc scripts (Python or Node) in Git Bash:** backslashes get stripped. Use Edit/Write and grep afterwards.
- **Calibrate heuristics on the real `C:\Prj` projects, not just the test fixtures.**
- **Nested apps are real projects:** many `C:\Prj` projects keep the real app in a subfolder with its own `.git`. Don't skip nested repos; exclude only what `.gitignore` excludes.
- **Owner preferences:**
  - A checkpoint commit before major changes.
  - Save learnings to paperRock as you go.
  - No generic icons (e.g. a star).
  - Verify interface work in a real browser or the app.
  - Short, plain summaries that say what was and wasn't tested.
