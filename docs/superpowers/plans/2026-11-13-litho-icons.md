# Litho Name and Icons: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the approved B2 Litho icon (overprinted `#`) and the DocAtlas folded-map mark as real app, taskbar and favicon assets. Rename the app to "Litho" in user-facing text without moving the owner's saved data.

**Architecture:**
- **Sources:** hand-written SVGs in `assets/brand/` are the single source of truth.
- **React:** the app imports the SVGs as raw strings via Vite `?raw`, through small `LithoMark`/`DocAtlasMark` components.
- **Raster files:** a Node/Electron script renders PNGs in a hidden Electron window. It packs them into an `.ico` with a tested pure helper. No new dependencies.

**Tech Stack:** Electron 34, React 19, Vite 6, TypeScript, esbuild and node:test (existing).

**Spec:** `docs/superpowers/specs/2026-11-13-litho-icons-design.md`

## Global Constraints

- **Colours:**
  - Cyan `#00AEEF`, magenta `#EC008C` with `mix-blend-mode: multiply`.
  - Paper tile `#FAF7F0`, rounded rect `x=3 y=3 w=58 h=58 rx=14`, `viewBox="0 0 64 64"`.
- **Approved artwork:** the paths are exactly those of B2 in `.superpowers/brainstorm/1398-1794604589/content/overprint-refine.html`.
  - Litho master: the stroke-width 6.5 `#`.
  - Litho small: the stroke-width 9 `#` (the 16 px variant).
  - DocAtlas: the folded map.
- **No new npm dependencies.**
- **userData must stay at `%APPDATA%\notion-markdown-studio`.** Pin it with `app.setPath('userData', path.join(app.getPath('appData'), 'notion-markdown-studio'))` before `app.whenReady()`.
- **User-facing name is exactly "Litho".** Window title "Litho", page `<title>` "Litho".
- **Remove "Notion" from user-facing labels only:**
  - "Notion Database Hub" → "Database Hub".
  - "Go to Notion Database Hub" → "Go to Database Hub".
  - "In-Place Notion Canvas" → "In-place canvas".
  - Code identifiers (`NotionEditor` etc.) are unchanged.
- **Don't patch files through heredoc scripts.** Use Edit/Write (owner lesson: backslashes get eaten in Git Bash).

## Review Focus

1. **Saved state after the rename:** after relaunch the portfolio snapshot, `notes.json` and the last workspace must still load. Task 3 verifies this in the real app.
2. **Favicon under `file://`:** the built app loads `dist/index.html` from disk, so the favicon href must be relative (`./favicon.svg`, Vite `base: './'`). Task 4 checks the built HTML.
3. **ICO entry of 256 px:** the ICO header must write width/height byte `0` for 256. Task 2 tests this.
4. **16 px legibility:** sizes 16, 24 and 32 render from `litho-small.svg`, not the master. Task 2 asserts which source each size uses, and a human looks at the PNGs.
5. **Multiply blend in raster output:** PNGs must show the dark overlap where the inks cross (Chromium honours `mix-blend-mode` in SVG). Task 2 checks a pixel at an overlap point is darker than both inks.

---

### Task 1: Brand SVG sources and React marks

**Files:**
- Create:
  - `assets/brand/litho.svg`, `assets/brand/litho-small.svg`, `assets/brand/docatlas.svg`
  - `src/components/brand/BrandMarks.tsx`
  - `src/vite-env.d.ts`
- Test: `tests/brand.test.ts` (add it to the `npm test` script in `package.json`)

**Interfaces:**
- Produces:
  - `LithoMark({ className?: string, size?: 'master' | 'small' })` and `DocAtlasMark({ className?: string })`, React components that render the SVG inline.
  - The three SVG files, used by Task 2's script.

- [ ] **Step 1: Write the failing test** `brand assets: the three SVGs exist with the approved colours`. It reads each file with `fs` and asserts:
  - Every SVG has `viewBox="0 0 64 64"` and `#FAF7F0`.
  - Every SVG contains `#00AEEF`, `#EC008C` and `multiply`.
  - `litho.svg` contains `stroke-width="6.5"`.
  - `litho-small.svg` contains `stroke-width="9"`.
  - `docatlas.svg` contains `M11 18.5 24 14l16 5 13-4.5v31L40 50l-16-5-13 4.5z`.
  - No file contains `<script` or `id=` (no ids, so multiple inline copies can't clash).
- [ ] **Step 2: Run `npm test`.** Expected: FAIL (files missing).
- [ ] **Step 3: Write the three SVGs** with the exact B2 artwork. Each starts with `xmlns="http://www.w3.org/2000/svg"`. Use `style="mix-blend-mode:multiply"` on the magenta group, not a class.
- [ ] **Step 4: Add `src/vite-env.d.ts`** containing `/// <reference types="vite/client" />`.
- [ ] **Step 5: Implement `BrandMarks.tsx`.**
  - Import the SVGs with `?raw`.
  - Render them via `<span aria-hidden className={className} dangerouslySetInnerHTML={{ __html: svg }} />`. The CSS `[&>svg]:w-full [&>svg]:h-full` makes the SVG fill the span.
  - `size='small'` uses `litho-small.svg`.
- [ ] **Step 6: Run `npm test` and `npx tsc --noEmit -p .`.** Expected: PASS, no type errors.
- [ ] **Step 7: Commit** `feat(brand): Litho and DocAtlas SVG marks`.

### Task 2: Rendered PNGs and ICO

**Files:**
- Create:
  - `scripts/ico.cjs`: pure `packIco(images: Array<{ size: number, png: Buffer }>): Buffer`.
  - `scripts/render-icons.cjs`: an Electron main script.
  - Generated outputs: `assets/brand/build/litho-{16,24,32,48,64,128,256,512}.png`, `assets/brand/build/litho.ico` (16, 24, 32, 48, 64, 128, 256), `public/favicon.svg` (copy of `litho-small.svg`), `public/favicon-32.png`.
- Test: `tests/brand.test.ts`

**Interfaces:**
- Consumes: the Task 1 SVGs.
- Produces: `assets/brand/build/litho.ico` and `assets/brand/build/litho-256.png` (Task 3), and `public/favicon.svg` and `public/favicon-32.png` (Task 4).

- [ ] **Step 1: Write the failing test** `packIco: valid ICONDIR with PNG entries`. Pack two fake PNG buffers, sizes 16 and 256, and assert:
  - Bytes 0 to 5 are `00 00 01 00 02 00`.
  - Entry 1 width byte is `16`; entry 2 width and height bytes are `0`.
  - Each entry's size and offset fields point at the exact buffers. The first offset is `6 + 16*2`.
  - The PNG bytes appear at those offsets.
- [ ] **Step 2: Run `npm test`.** Expected: FAIL (`packIco` missing).
- [ ] **Step 3: Implement `packIco`.**
  - 6-byte ICONDIR, then 16-byte ICONDIRENTRY per image: planes 1, bpp 32, little-endian size and offset.
  - Then the PNG data, concatenated in input order.
- [ ] **Step 4: Run `npm test`.** Expected: PASS.
- [ ] **Step 5: Implement `render-icons.cjs`** (run via `npx electron scripts/render-icons.cjs`).
  - `app.whenReady`. For each size, open a hidden `BrowserWindow({ show: false, width: size, height: size, frame: false, transparent: true, webPreferences: { offscreen: true } })`.
  - Load `data:text/html` with a zero-margin body and the SVG at `width:100vw;height:100vh`. Sizes ≤ 32 use `litho-small.svg`; the rest use `litho.svg`.
  - `capturePage()`, `.resize({ width: size, height: size, quality: 'best' })`, `.toPNG()`.
  - Write the PNGs, the ICO and the favicons, then `app.quit()`.
- [ ] **Step 6: Run** `npx electron scripts/render-icons.cjs`. Expected: the files listed above exist.
- [ ] **Step 7: Check the overprint.** In `tests/brand.test.ts`, add a test that `litho.ico` exists, starts with `00 00 01 00 07 00`, and that `litho-256.png` starts with the PNG signature. Then look at `litho-16.png`, `litho-32.png` and `litho-256.png` yourself with the Read tool. The `#` must be legible at 16 px, and the overlap where cyan and magenta cross must be dark navy.
- [ ] **Step 8: Run `npm test`** (PASS) and **commit** `feat(brand): rendered Litho PNG/ICO assets and favicon`, including the script and the generated files. Document the script command in HANDOFF in Task 4.

### Task 3: Electron icon, title and pinned userData

**Files:**
- Modify: `electron/main.ts`: `createWindow()` (title, icon) and add the userData pin before the single-instance lock.

**Interfaces:**
- Consumes: `assets/brand/build/litho.ico` and `assets/brand/build/litho-256.png` from Task 2.

- [ ] **Step 1: Add the userData pin** near the top of the module, before `requestSingleInstanceLock`, with a comment explaining the anti-goal. The lock is keyed on userData, so the pin must come first.
- [ ] **Step 2: Set the window.**
  - Title: `'Litho'`.
  - Icon: `path.join(__dirname, '../assets/brand/build', process.platform === 'win32' ? 'litho.ico' : 'litho-256.png')`.
- [ ] **Step 3: Run `npm run build`.** Expected: clean.
- [ ] **Step 4: Verify in the real app** with Playwright `_electron`, using the existing scratchpad pattern. Assert:
  - `app.evaluate(({ app }) => app.getPath('userData'))` ends with `notion-markdown-studio`.
  - `await page.title()` is `Litho` (once Task 4 lands; for now, check the BrowserWindow title via `app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle())`).
  - The portfolio still shows 24 projects (the snapshot loaded).
  - No console errors.
- [ ] **Step 5: Commit** `feat(app): Litho window title and icon; pin userData folder`.

### Task 4: Favicon, renamed labels and DocAtlas mark in the UI

**Files:**
- Modify:
  - `index.html`: `<title>Litho</title>`; `<link rel="icon" type="image/svg+xml" href="./favicon.svg">` and `<link rel="icon" type="image/png" sizes="32x32" href="./favicon-32.png">` (replacing `/vite.svg`).
  - `src/components/project/PortfolioView.tsx`: header `<Radar className="w-6 h-6" />` (around line 439) → `<DocAtlasMark className="w-11 h-11" />` (the mark replaces the whole tinted square). In the empty state (around line 286), the non-busy desktop case uses `DocAtlasMark`; the busy spinner stays `Radar`.
  - `src/components/layout/Sidebar.tsx`:
    - Projects Portfolio nav icon (`FolderGit2`, around line 477) → `<DocAtlasMark className="w-4 h-4" />`.
    - Fallback name `'Markdown Studio'` → `'Litho'`.
    - `Notion Database Hub` → `Database Hub`.
  - `src/components/layout/CommandPalette.tsx`: the label `Go to Database Hub`.
  - `src/components/database/DatabaseHub.tsx`: header `Database Hub`.
  - `src/components/editor/NotionEditor.tsx`: `In-place canvas`.
  - `src/services/stackInspector.ts`: footer `Litho Stack Inspector`.
  - `README.md`: title `# Litho`, then one line saying DocAtlas is its project-checking side.
  - `HANDOFF.md`: brand section with the asset paths, the `npx electron scripts/render-icons.cjs` command and the userData pin.
- Test: existing suites. Check that `tests/markdown.test.ts` doesn't assert the old "Markdown Studio Stack Inspector" text (`grep -n "Stack Inspector" tests`) and update it if it does.

**Interfaces:**
- Consumes: `DocAtlasMark` and `LithoMark` (Task 1), `public/favicon.svg` and `public/favicon-32.png` (Task 2).

- [ ] **Step 1: Make the edits above.**
- [ ] **Step 2: Run** `grep -rn "Notion Database Hub\|In-Place Notion Canvas\|Markdown Studio Stack Inspector\|vite.svg" src index.html`. Expected: no output.
- [ ] **Step 3: Run `npm test`, `npx tsc --noEmit -p .` and `npm run build`.** Expected: PASS, clean. `dist/index.html` must contain `href="./favicon.svg"`, and `dist/favicon.svg` must exist.
- [ ] **Step 4: Verify in the real app** (Electron).
  - Title is `Litho`.
  - The DocAtlas header shows the map mark. Take a screenshot and look at it.
  - The sidebar nav shows the mark at 16 px.
  - The window or taskbar icon is set: `BrowserWindow.getAllWindows()[0]` was created with an icon. Check by screenshot of the window, or by asserting that the file path passed exists.
  - Saved state is intact (24 projects).
  - No console errors.
  - Restore the owner's last workspace if the test changes it.
- [ ] **Step 5: Verify in a browser.** Run `npm run dev`, then use Playwright (msedge): the favicon request returns 200 and the tab title is `Litho`.
- [ ] **Step 6: Commit** `feat(brand): Litho favicon, labels and DocAtlas mark in the UI`.
