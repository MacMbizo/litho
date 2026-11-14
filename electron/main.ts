import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import path from 'path';
import fs from 'fs';
import { IGNORED_DIRS, pathExists, readStackConfigFiles } from './stackFiles';
import { FixController } from './fixRunner';

// Suppress harmless Windows MediaFoundation video accelerator log without disabling GPU
app.commandLine.appendSwitch('disable-features', 'MediaFoundationVideoEncodeAccelerator');

// The app is now called Litho, but its saved data (portfolio snapshot, Notes settings, last workspace,
// localStorage) lives in the folder Electron derived from the original package name. Pin it so renaming
// the package or adding a productName for packaging can never silently start the app with empty state.
// Must run before anything reads userData, including the single-instance lock below.
// An explicit --user-data-dir (used by end-to-end tests to run with isolated state) still wins.
if (!app.commandLine.hasSwitch('user-data-dir')) {
  app.setPath('userData', path.join(app.getPath('appData'), 'notion-markdown-studio'));
}

// Windows taskbar identity. Run unpackaged, the process is electron.exe, so without this Windows groups
// the window as "Electron" and a pin relaunches bare electron.exe with the Electron icon.
const APP_USER_MODEL_ID = 'com.litho.app';
const APP_ICON_PATH = path.join(__dirname, '../assets/brand/build', process.platform === 'win32' ? 'litho.ico' : 'litho-256.png');
if (process.platform === 'win32') app.setAppUserModelId(APP_USER_MODEL_ID);

let mainWindow: BrowserWindow | null = null;
let activeWatcher: fs.FSWatcher | null = null;

const MD_EXTENSIONS = new Set(['.md', '.markdown', '.mdx']);

// Files the app itself wrote recently; the watcher ignores their change events so autosave
// does not trigger a self-inflicted rescan.
const recentWrites = new Map<string, number>();
const SELF_WRITE_WINDOW_MS = 2000;

function markSelfWrite(filePath: string) {
  recentWrites.set(path.resolve(filePath).toLowerCase(), Date.now());
}

function isRecentSelfWrite(filePath: string): boolean {
  const key = path.resolve(filePath).toLowerCase();
  const ts = recentWrites.get(key);
  if (!ts) return false;
  if (Date.now() - ts > SELF_WRITE_WINDOW_MS) {
    recentWrites.delete(key);
    return false;
  }
  return true;
}

/** Runs async work over items with a concurrency limit, preserving order. */
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const idx = next++;
      results[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return results;
}

// Small JSON store in the user-data folder (portfolio snapshots and roots).
function storePath(name: string): string {
  if (!/^[a-z0-9-]{1,64}$/.test(name)) throw new Error('Invalid store name');
  return path.join(app.getPath('userData'), 'docatlas', `${name}.json`);
}

// --- Safe stack fixer --------------------------------------------------------
// Fixes may only run in projects the app itself scanned (this session) or remembers in its portfolio.
const knownProjectRoots = new Set<string>();
const normRoot = (p: string) => path.resolve(p).replace(/[\\/]+$/, '').toLowerCase();

function rememberProjectRoot(p: string) {
  knownProjectRoots.add(normRoot(p));
}

async function isKnownProjectRoot(p: string): Promise<boolean> {
  const key = normRoot(p);
  if (knownProjectRoots.has(key)) return true;
  try {
    const snap = JSON.parse(await fs.promises.readFile(storePath('portfolio'), 'utf-8'));
    const roots: string[] = (snap?.projects || []).map((e: any) => e?.workspace?.rootPath).filter((r: unknown) => typeof r === 'string');
    return roots.some((r) => normRoot(r) === key);
  } catch {
    return false;
  }
}

const fixController = new FixController({
  logDir: path.join(app.getPath('userData'), 'docatlas', 'fix-logs'),
  isKnownRoot: isKnownProjectRoot,
  emit: (e) => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) mainWindow.webContents.send('fix:event', e);
  },
});

ipcMain.handle('fix:plan', (_, projectRoot: string, recipe: unknown, title: string) => fixController.plan(projectRoot, recipe, title));
ipcMain.handle('fix:run', (_, planId: string, opts?: { checkpoint?: boolean }) => fixController.run(planId, { checkpoint: Boolean(opts?.checkpoint) }));
ipcMain.handle('fix:stop', (_, runId: string) => fixController.stop(runId));
ipcMain.handle('fix:applyConfig', (_, runId: string, index: number) => fixController.applyConfig(runId, Number(index)));
ipcMain.handle('fix:commit', (_, runId: string) => fixController.commit(runId));
ipcMain.handle('fix:undo', (_, runId: string) => fixController.undo(runId));
// Reveal, never open: shell.openPath would run app.config.js through Windows Script Host on a stock install.
ipcMain.handle('fix:openFile', (_, runId: string, index: number) => {
  shell.showItemInFolder(fixController.proposalFile(runId, Number(index)));
  return true;
});
ipcMain.handle('fix:openLog', async (_, runId: string) => {
  const err = await shell.openPath(fixController.logPath(runId));
  if (err) throw new Error(err);
  return true;
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    center: true,
    title: 'Litho',
    icon: APP_ICON_PATH,
    backgroundColor: '#191919',
    show: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // What a taskbar pin stores: Litho's icon, name and a relaunch of this app (not bare electron.exe).
  // Paths are computed at runtime, so renaming or moving the project folder only needs a re-pin.
  if (process.platform === 'win32') {
    mainWindow.setAppDetails({
      appId: APP_USER_MODEL_ID,
      appIconPath: APP_ICON_PATH,
      appIconIndex: 0,
      relaunchCommand: `"${process.execPath}" "${app.getAppPath()}"`,
      relaunchDisplayName: 'Litho',
    });
  }

  const indexPath = path.join(__dirname, '../dist/index.html');
  const devServerUrl = process.env.VITE_DEV_SERVER_URL;

  if (devServerUrl) {
    console.log('[Main]: Connecting to dev server at', devServerUrl);
    mainWindow.loadURL(devServerUrl);
  } else {
    console.log('[Main]: Loading bundled UI from', indexPath);
    mainWindow.loadFile(indexPath).catch((err) => {
      console.error('[Main Error]: Failed to load HTML file:', err);
    });
  }

  mainWindow.webContents.on('did-finish-load', () => {
    console.log('[Main]: UI loaded successfully! Bringing window to front.');
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  mainWindow.webContents.on('did-fail-load', (_, errorCode, errorDescription) => {
    console.error(`[Main Error]: UI failed to load (${errorCode}): ${errorDescription}`);
  });

  mainWindow.on('closed', () => {
    fixController.stopAll();
    mainWindow = null;
    if (activeWatcher) {
      activeWatcher.close();
      activeWatcher = null;
    }
  });
}

/** Markdown files named in a command line, resolved against the directory it was run from. */
function markdownArgs(argv: string[], cwd: string): string[] {
  const found: string[] = [];
  for (const arg of argv.slice(1)) {
    if (!arg || arg.startsWith('-')) continue;
    if (!MD_EXTENSIONS.has(path.extname(arg).toLowerCase())) continue;
    const full = path.resolve(cwd, arg);
    try {
      if (fs.statSync(full).isFile()) found.push(full);
    } catch {
      // not a file: ignore
    }
  }
  return found;
}

let pendingLaunchFiles: string[] = markdownArgs(process.argv, process.cwd());

// One window: opening a .md while DocAtlas runs hands it to the open window instead of a second copy.
const hasInstanceLock = app.requestSingleInstanceLock();
if (!hasInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv, workingDirectory) => {
    const files = markdownArgs(argv, workingDirectory);
    if (!mainWindow) {
      pendingLaunchFiles.push(...files);
      return;
    }
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    if (files.length > 0) mainWindow.webContents.send('app:openFiles', files);
  });
}

app.whenReady().then(() => {
  if (!hasInstanceLock) return;
  console.log('[Main]: Electron app is ready.');
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Helper: Scan directory recursively
async function scanDirectoryRecursive(
  currentDir: string,
  rootDir: string
): Promise<{
  files: Array<{ path: string; fullPath: string; name: string; content: string; lastModifiedMs?: number }>;
  tree: any;
}> {
  const dirName = path.basename(currentDir);
  const relativePath = path.relative(rootDir, currentDir).replace(/\\/g, '/');

  const folderNode: any = {
    id: relativePath || dirName,
    name: relativePath === '' ? path.basename(rootDir) : dirName,
    path: relativePath,
    fullPath: currentDir,
    isFolder: true,
    children: [],
  };

  const filesList: Array<{ path: string; fullPath: string; name: string; content: string; lastModifiedMs?: number }> = [];

  try {
    const entries = await fs.promises.readdir(currentDir, { withFileTypes: true });

    // Sort: directories first, then alphabetical
    entries.sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });

    for (const entry of entries) {
      const entryFullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name) || entry.name.startsWith('.')) {
          continue;
        }

        const sub = await scanDirectoryRecursive(entryFullPath, rootDir);
        // Only include subfolder in tree if it contains markdown files or subfolders with markdown
        if (sub.files.length > 0) {
          folderNode.children.push(sub.tree);
          filesList.push(...sub.files);
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (MD_EXTENSIONS.has(ext)) {
          const fileRelPath = path.relative(rootDir, entryFullPath).replace(/\\/g, '/');
          let content = '';
          let lastModifiedMs: number | undefined;
          try {
            content = await fs.promises.readFile(entryFullPath, 'utf-8');
            const st = await fs.promises.stat(entryFullPath);
            lastModifiedMs = st.mtimeMs;
          } catch (e) {
            console.warn(`Failed to read file ${entryFullPath}:`, e);
          }

          const fileNode = {
            id: fileRelPath,
            name: entry.name,
            path: fileRelPath,
            fullPath: entryFullPath,
            isFolder: false,
          };

          folderNode.children.push(fileNode);
          filesList.push({
            path: fileRelPath,
            fullPath: entryFullPath,
            name: entry.name,
            content,
            lastModifiedMs,
          });
        }
      }
    }
  } catch (err) {
    console.error(`Error scanning directory ${currentDir}:`, err);
  }

  return { files: filesList, tree: folderNode };
}

// Native IPC handlers for local files & project management
ipcMain.handle('dialog:openDirectory', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory', 'createDirectory'],
  });
  return result.filePaths[0] || null;
});

ipcMain.handle('fs:scanDirectory', async (_, dirPath: string, opts?: { watch?: boolean }) => {
  try {
    rememberProjectRoot(dirPath);
    const rootName = path.basename(dirPath);
    const [{ files, tree }, { configFiles, installedPackages }] = await Promise.all([
      scanDirectoryRecursive(dirPath, dirPath),
      readStackConfigFiles(dirPath),
    ]);

    // Setup live file watcher for external changes (with debounce). Background rescans skip this.
    if (opts?.watch === false) return { rootPath: dirPath, rootName, files, tree, configFiles, installedPackages };
    if (activeWatcher) {
      activeWatcher.close();
    }

    try {
      let debounceTimer: any = null;
      activeWatcher = fs.watch(dirPath, { recursive: true }, (_, filename) => {
        if (!filename) return;
        const ext = path.extname(filename).toLowerCase();
        if (MD_EXTENSIONS.has(ext) && !isRecentSelfWrite(path.join(dirPath, filename))) {
          clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            if (mainWindow) {
              mainWindow.webContents.send('fs:changed', { rootDir: dirPath, changedFile: filename });
            }
          }, 400);
        }
      });
    } catch (watchErr) {
      console.warn('File watcher setup skipped or unsupported:', watchErr);
    }

    return { rootPath: dirPath, rootName, files, tree, configFiles, installedPackages };
  } catch (err: any) {
    throw new Error(`Failed to scan directory: ${err.message}`);
  }
});

ipcMain.handle('fs:scanPortfolioRoot', async (_, rootDir: string) => {
  try {
    const entries = await fs.promises.readdir(rootDir, { withFileTypes: true });
    const projects: Array<{
      rootPath: string;
      rootName: string;
      files: any[];
      tree: any;
      configFiles: Record<string, string>;
      installedPackages: Record<string, { present: boolean; versions: Record<string, string> }>;
    }> = [];

    const candidateDirs = entries.filter(
      (entry) => entry.isDirectory() && !IGNORED_DIRS.has(entry.name) && !entry.name.startsWith('.')
    );

    const scanned = await mapWithConcurrency(candidateDirs, 4, async (entry) => {
      const projDir = path.join(rootDir, entry.name);
      const [{ files, tree }, { configFiles, installedPackages }, hasGit] = await Promise.all([
        scanDirectoryRecursive(projDir, projDir),
        readStackConfigFiles(projDir),
        pathExists(path.join(projDir, '.git')),
      ]);
      if (files.length === 0 && Object.keys(configFiles).length === 0 && !hasGit) return null;
      return { rootPath: projDir, rootName: entry.name, files, tree, configFiles, installedPackages };
    });

    for (const p of scanned) if (p) {
      projects.push(p);
      rememberProjectRoot(p.rootPath);
    }

    projects.sort((a, b) => a.rootName.localeCompare(b.rootName));
    return { rootPath: rootDir, projects };
  } catch (err: any) {
    throw new Error(`Failed to scan portfolio root: ${err.message}`);
  }
});

ipcMain.handle('net:fetchJson', async (_, url: string) => {
  try {
    const allowed =
      url.startsWith('https://registry.npmjs.org/') ||
      url.startsWith('https://pypi.org/pypi/') ||
      /^https:\/\/cdn\.jsdelivr\.net\/npm\/expo@\d+\/bundledNativeModules\.json$/.test(url);
    if (!allowed) {
      throw new Error('Blocked URL');
    }
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
});

ipcMain.handle('store:read', async (_, name: string) => {
  try {
    return JSON.parse(await fs.promises.readFile(storePath(name), 'utf-8'));
  } catch {
    return null;
  }
});

ipcMain.handle('store:write', async (_, name: string, data: unknown) => {
  const target = storePath(name);
  await fs.promises.mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp`;
  await fs.promises.writeFile(tmp, JSON.stringify(data), 'utf-8');
  await fs.promises.rename(tmp, target);
  return true;
});

ipcMain.handle('fs:readFile', async (_, filePath: string) => {
  try {
    return await fs.promises.readFile(filePath, 'utf-8');
  } catch (err: any) {
    throw new Error(`Failed to read file: ${err.message}`);
  }
});

ipcMain.handle('fs:writeFile', async (_, filePath: string, content: string) => {
  try {
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    markSelfWrite(filePath);
    await fs.promises.writeFile(filePath, content, 'utf-8');
    return true;
  } catch (err: any) {
    throw new Error(`Failed to write file: ${err.message}`);
  }
});

ipcMain.handle('fs:createFolder', async (_, folderPath: string) => {
  try {
    await fs.promises.mkdir(folderPath, { recursive: true });
    return true;
  } catch (err: any) {
    throw new Error(`Failed to create folder: ${err.message}`);
  }
});

ipcMain.handle('fs:renamePath', async (_, oldPath: string, newPath: string) => {
  try {
    await fs.promises.mkdir(path.dirname(newPath), { recursive: true });
    await fs.promises.rename(oldPath, newPath);
    return true;
  } catch (err: any) {
    throw new Error(`Failed to rename: ${err.message}`);
  }
});

// Moves a file without ever overwriting: if the target exists, appends " (2)", " (3)"... Returns the final path.
ipcMain.handle('fs:movePathSafe', async (_, oldPath: string, newPath: string) => {
  try {
    const dir = path.dirname(newPath);
    const ext = path.extname(newPath);
    const base = path.basename(newPath, ext);
    let finalPath = newPath;
    for (let i = 2; (await pathExists(finalPath)) && path.resolve(finalPath) !== path.resolve(oldPath); i++) {
      finalPath = path.join(dir, `${base} (${i})${ext}`);
    }
    await fs.promises.mkdir(dir, { recursive: true });
    markSelfWrite(oldPath);
    markSelfWrite(finalPath);
    await fs.promises.rename(oldPath, finalPath);
    return finalPath;
  } catch (err: any) {
    throw new Error(`Failed to move: ${err.message}`);
  }
});

ipcMain.handle('fs:deletePath', async (_, targetPath: string) => {
  try {
    await fs.promises.rm(targetPath, { recursive: true, force: true });
    return true;
  } catch (err: any) {
    throw new Error(`Failed to delete: ${err.message}`);
  }
});

ipcMain.handle('fs:revealInExplorer', async (_, targetPath: string) => {
  shell.showItemInFolder(targetPath);
  return true;
});

// Notes: the home for Markdown that isn't part of any project. Created on first use.
const defaultNotesFolder = () => path.join(app.getPath('documents'), 'DocAtlas Notes');

ipcMain.handle('notes:getDefaultFolder', async () => defaultNotesFolder());

// Returns the chosen folder when it can be used (created if missing), otherwise the default.
ipcMain.handle('notes:getFolder', async (_, preferred?: string) => {
  if (preferred && path.isAbsolute(preferred)) {
    try {
      await fs.promises.mkdir(preferred, { recursive: true });
      if ((await fs.promises.stat(preferred)).isDirectory()) return preferred;
    } catch {
      // unusable (removed drive, no permission): fall back to the default
    }
  }
  const dir = defaultNotesFolder();
  await fs.promises.mkdir(dir, { recursive: true });
  return dir;
});

// Files handed to the app on its command line (or by "Open with"), queued until the UI asks for them.
ipcMain.handle('app:takeLaunchFiles', async () => {
  const files = pendingLaunchFiles;
  pendingLaunchFiles = [];
  return files;
});

const MARKDOWN_FILTERS = [
  { name: 'Markdown', extensions: ['md', 'markdown', 'mdx'] },
  { name: 'All files', extensions: ['*'] },
];

ipcMain.handle('dialog:openMarkdownFiles', async () => {
  const options: Electron.OpenDialogOptions = {
    title: 'Open Markdown file',
    properties: ['openFile', 'multiSelections'],
    filters: MARKDOWN_FILTERS,
  };
  const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
  return result.canceled ? [] : result.filePaths;
});

ipcMain.handle('dialog:saveMarkdownFile', async (_, defaultPath?: string) => {
  const options: Electron.SaveDialogOptions = {
    title: 'Save Markdown file as',
    defaultPath,
    filters: MARKDOWN_FILTERS,
  };
  const result = mainWindow ? await dialog.showSaveDialog(mainWindow, options) : await dialog.showSaveDialog(options);
  return result.canceled || !result.filePath ? null : result.filePath;
});

ipcMain.handle('fs:fileInfo', async (_, filePath: string) => {
  try {
    const stat = await fs.promises.stat(filePath);
    return { exists: stat.isFile(), lastModifiedMs: stat.mtimeMs };
  } catch {
    return { exists: false };
  }
});
