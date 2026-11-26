# Project basics: description, README, git and GitHub (design)

_2026-11-26. Owner request: DocAtlas should say in one line what each project is about, flag projects with no README, no git or no GitHub remote, and help bring every project up to that standard._

## Not duplicated elsewhere

- **EnvAtlas:** already pulls a description (package.json `description`, else the first README paragraph) and reads the git remote from `.git/config`. It doesn't flag a missing README, check push state or write anything.
- **Cairn Guardian:** records `has_readme` and `has_git` for its own scoring. It runs no git commands and, by design, never writes into the owner's folders.
- **Neither creates a README, a repo or a GitHub remote.** DocAtlas owns this. The description logic is reimplemented here, not shared, so the apps stay independent.

## Phase A: read-only (no project is changed)

### Facts, gathered in the main process during every scan
- **Where:** `electron/projectBasics.ts`, Node only and tested. Stored on `ProjectWorkspace.basics` and kept in the portfolio snapshot.
- **README:** the root `README*` (`.md`, `.txt` or no extension). If there is none and the project's repo lives in a subfolder, that folder's README is used. Capped at 8 KB.
- **Manifest descriptions:** `package.json` `description`, `Cargo.toml` `[package] description`, `pyproject.toml` `[project] description`.
- **Git:**
  - When the root has `.git`, it uses `git --no-optional-locks -c core.fsmonitor=false status --porcelain=v2 --branch` and `git remote -v`. This gives the branch, whether there are commits, the upstream, ahead/behind and the number of uncommitted changes.
  - It never fetches, so ahead/behind are as of the last fetch.
  - A 10 s timeout. `GIT_TERMINAL_PROMPT=0`.
  - A test hashes `.git` before and after a scan to prove nothing changes.
- **Nested repos:** when the root has no `.git`, it looks up to 3 levels down for `.git`, skipping ignored folders. It finds at most 6.
- **Other files:** whether `.gitignore` exists, and the licence file and its kind (AGPL, GPL, MIT, Apache, or package.json `license`).

### Assessment
This is pure code in `src/services/projectBasics.ts`.
- **`describeProject`** returns `{ text, source }`. The first README paragraph comes first, skipping the title, badges, HTML, images, code and tables, capped at 240 characters. If there is none, it uses a manifest description.
- **`assessProjectBasics`** produces a checklist:

| Check | Fails when | Notes |
| --- | --- | --- |
| README with a description | no README (**required**) | Warns when the README has no description paragraph |
| Git | no repo anywhere (**required**) | A repo in a subfolder passes, with a note |
| Remote | repo with no remote (**required**) | Another host passes, with a note that it isn't GitHub |
| Pushed | n/a | Warns on commits not pushed, a branch with no upstream, no commits, or uncommitted changes |
| .gitignore | n/a | Warns when missing |
| Licence | n/a | Warns when missing; shows the kind |

- **Levels:** `complete` (all pass), `partial` (only warnings) or `missing` (any required check fails).

### Not a project
Scratch folders can be marked **Not a project**. This is stored in `userData/docatlas/project-prefs.json` (`ignored: string[]`). They leave the cards and every count, and come back through a "Not projects (n)" filter.

### UI
- **Card:** the About line under the name, or "No description: add a README" in grey. Small chips for each failing check ("No README", "No git", "Not on GitHub", "2 unpushed", "Uncommitted"). Clicking one opens the drawer.
- **KPI tile:** "Project basics", showing `complete/total` and the top two gaps. Filter chip: "Missing basics".
- **Drawer:** it becomes "Project details", with the Basics checklist above the stack freshness panel, plus "Not a project".
- **Search** also matches the description.

## Phase B: fixes (each one confirmed, run one at a time, never overwriting)

All of these run in the main process for known project roots only. One operation runs at a time, and its button shows the running state at once.

- **Create README:**
  - A sheet shows an editable draft: the title, a one-line description (prefilled from the manifest), the stack, scripts and licence.
  - It is written with `wx`, so an existing README is never overwritten.
  - **Add description** inserts a paragraph under the first heading of an existing README. It's compare-and-write: the file is refused if it changed since it was read.
- **Start git** (only when there is no repo at the root or in a subfolder):
  - Writes a stack-aware `.gitignore` if there is none (always including `.env`, `.env.*`, `!.env.example`).
  - Runs `git init -b main` and lists what would be committed (`git ls-files --others --exclude-standard`).
  - **Blocks** on likely secrets (env files, keys, tokens found by pattern), files over 50 MB, or more than 5,000 files. When blocked, it removes the `.git` it just created and lists the reasons. Otherwise it runs `git add -A` and commits `chore: initial commit`.
- **Publish to GitHub:**
  - Needs `gh` signed in, at least one commit, and no remote.
  - Runs `gh repo create <name> --private --source <dir> --remote origin --push --description <About line>`.
  - **Private by default**; public is an explicit choice. The name is editable.
  - The same secret scan runs over tracked files first.
- **Push:**
  - `git push` with `-u origin <branch>` when there is no upstream.
  - First scans the files changed in the commits being pushed.

## Hidden traps handled

- **Secrets leaking on a first commit or push:** blocked by the scan above.
- **A repo in a subfolder:** gets no second, top-level repo.
- **Read-only git checks:** must not touch `.git` (`--no-optional-locks`, with `fsmonitor` off so the repo config can't start a program).
- **The description:** lives in the README, so GitHub and other tools see the same text. DocAtlas keeps no private copy.
