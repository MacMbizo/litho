# Handoff: Notion Markdown Studio / DocAtlas

_Last updated 2026-11-13. Branch `master` (main branch is `main`; no git remote)._

## What this is

Local-first Electron + React + Vite app (`C:\Prj\newdoc`). **DocAtlas** is the feature being built: it audits every project under one or more root folders (normally `C:\Prj`) for:

- **Doc health:** per-doc states (canonical, healthy, module-doc, stale, duplicate, deprecated, orphan, agent-system), an A–D grade and fix-it actions.
- **Stack freshness:** whether each project still runs. It checks Expo SDK, frameworks, Node/Python end-of-life and Expo package alignment against live npm/PyPI.

The original spec (`docatlas_specification.md`) is **not in the repo**. It's at `~/.gemini/antigravity/brain/e44905d0-ecda-49d2-ad91-fe770126712e/`. A Gemini agent wrote the first pass; Claude took over on 2026-11-13.

**Quality bar (from the owner):** match the polish and zero friction of `C:\Prj\envatlas`. Use it as inspiration, not as a copy. Stack freshness is a key feature: coming back to a project after weeks and finding it no longer runs is the pain point it addresses.

## Commands

| Task | Command |
| --- | --- |
| Unit tests (41) | `npm test` |
| Typecheck | `npx tsc --noEmit -p .` |
| Full build (renderer + electron) | `npm run build` |
| Run desktop app | `npm run build && npm start` |
| Browser dev (sample vault only, no portfolio) | `npm run dev` |

## Recent commits

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
- **App state left by the test run:** portfolio root `C:\Prj`, snapshot saved, last opened project C1. No project files were modified.
- **Invalid frontmatter:** 15 real docs have invalid YAML frontmatter; this could be surfaced as an audit issue.
- **`.agents/`** is untracked: an editor-generated paperRock MCP config. The owner decides whether to gitignore it.

## Suggested next steps (offered to the owner, not started)

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
