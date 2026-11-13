# Litho name and icons: design

_2026-11-13. Size: small change. Status: awaiting owner approval._

## Intent

The app becomes **Litho**: one app, with DocAtlas as its project-checking side. The owner's routine moves between both halves: check which docs are missing or unhealthy, write the missing ones, and routinely check stack freshness. It needs a real app icon and favicon (today it has none; it points at a missing `vite.svg`). DocAtlas needs its own mark from the same family, replacing the generic radar icon.

Lithography (printing from stone) is the theme: Markdown is plain text that prints into finished pages, and 19th-century atlases were printed by lithography, which ties in DocAtlas.

## Decided by the owner

- **One app named Litho.** DocAtlas keeps its name as a section inside it.
- **Direction B2, "two-colour overprint"**, chosen from three directions and three refinements in the visual companion.
  - **Litho:** a Markdown `#` printed twice, in process cyan `#00AEEF` and process magenta `#EC008C` (multiply), slightly out of register, on a warm paper tile `#FAF7F0` with rounded corners.
  - **DocAtlas:** a cyan folded three-panel map with a magenta route and an end point overprinted. The owner asked to keep this design as it is.
  - **Small sizes:** heavier strokes at 32 px and 16 px, as shown in the mockup.

## Goals

1. **Litho icon everywhere the OS shows the app:** the window and taskbar now (`BrowserWindow.icon`), and an `.ico` ready for the future installer.
2. **Browser favicon:** `index.html` uses the SVG favicon, plus a PNG fallback.
3. **DocAtlas mark in the app:** the DocAtlas page header (replacing `Radar`) and the "Projects Portfolio" sidebar item.
4. **Rename to Litho in user-facing text:**
   - Window title "Litho" and page `<title>` "Litho".
   - Sidebar fallback name "Litho".
   - The generated upgrade plan footer: "Litho Stack Inspector".
   - README heading.
5. **Remove "Notion" from user-facing labels,** since it's another company's trademark:
   - "Notion Database Hub" → "Database Hub" (sidebar, command palette, hub header).
   - "In-Place Notion Canvas" → "In-place canvas".
   - Code identifiers such as `NotionEditor` stay as they are, because users never see them.

## Non-goals

- Packaging, installer and the .md file association (separate decision, pending).
- Renaming the npm package, the repo folder or code identifiers.
- Light-theme polish of the app (it is still unverified).

## Anti-goals (failure even if it "works")

- **Losing the owner's saved state.** Electron derives the userData folder (`%APPDATA%\notion-markdown-studio`) from the package name. If a later `name` or `productName` change silently moved it, the app would forget the portfolio snapshot, `notes.json`, notes folder choice and last workspace. Pin it: `app.setPath('userData', <appData>/notion-markdown-studio)` before `ready`, so the rename and any later packaging can't move it.
- **A blurry or illegible icon at 16 px**, or a generic glyph.
- **Adding new dependencies** to make the icons.

## Approaches considered

| Approach | Trade-off | Verdict |
| --- | --- | --- |
| **Hand-written SVG sources, rasterised by the Electron already installed** (a small script in a hidden window: PNGs at 16 to 512 px, packed into an `.ico` with PNG entries in plain Node) | No new dependencies. The output matches what Chromium shows. The script is re-runnable. | **Chosen** |
| Build the icons in Figma and export them | Polished tooling, but costs tokens and adds a manual export step for a 64-unit SVG. | Not needed |
| Add an icon-generation package (sharp, electron-icon-builder) | Convenient, but it's a new install the owner would need to approve, for something about 60 lines of script can do. | Rejected |

## Design

- **Sources:**
  - `assets/brand/litho.svg` and `assets/brand/docatlas.svg`: the master artwork from the approved mockup.
  - `litho-small.svg`: the heavier-stroke version for 16 to 32 px.
- **Generated (committed):**
  - `public/favicon.svg` (the small variant) and `public/favicon-32.png`.
  - `assets/brand/build/litho-{16,24,32,48,64,128,256,512}.png` and `litho.ico`.
  - Sizes 16 to 32 px render from the small variant; 48 px and up from the master.
- **Script:** `scripts/render-icons.cjs`, run with `npx electron scripts/render-icons.cjs` and documented in HANDOFF. It is deterministic, so re-running it produces the same files.
- **In-app DocAtlas mark:** a tiny `DocAtlasMark` React component (inline SVG, the same paths), so it scales cleanly and needs no image request. The Litho mark is also available as `LithoMark` for the sidebar header badge, which currently shows a gradient square with the workspace's first letter. That badge stays as it is: it shows the workspace, not the app.
- **Electron:** `BrowserWindow({ icon: <path to litho.ico, or 256 PNG> })`, plus the userData pin.

## Left to the builder

- Exact pixel nudges at 16 px after looking at the real rendered PNGs.
- Whether the sidebar portfolio item shows the mark at 16 px or keeps an outline icon, if the full-colour mark looks too loud in the nav list.

## Verification

- `npm test`, typecheck and build.
- Look at each rendered PNG.
- Launch the real Electron app:
  - Taskbar and window icon present.
  - Title "Litho".
  - DocAtlas header shows the map mark.
  - Saved portfolio and notes are still there after the userData pin. This is the anti-goal check.
- Browser `npm run dev`: favicon visible in the tab.
