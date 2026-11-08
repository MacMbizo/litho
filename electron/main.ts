import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import path from 'path';
import fs from 'fs';

// Suppress harmless Windows MediaFoundation video accelerator log without disabling GPU
app.commandLine.appendSwitch('disable-features', 'MediaFoundationVideoEncodeAccelerator');

let mainWindow: BrowserWindow | null = null;
let activeWatcher: fs.FSWatcher | null = null;

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'dist-electron',
  'build',
  '.next',
  '.cache',
  '.vscode',
  '.idea',
  'coverage',
  'target',
  'bin',
  'obj',
  '.turbo',
  '.gradle',
]);

const MD_EXTENSIONS = new Set(['.md', '.markdown', '.mdx']);

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    center: true,
    title: 'Notion Markdown Studio & Agent OS',
    backgroundColor: '#191919',
    show: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

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
    mainWindow = null;
    if (activeWatcher) {
      activeWatcher.close();
      activeWatcher = null;
    }
  });
}

app.whenReady().then(() => {
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
): Promise<{ files: Array<{ path: string; fullPath: string; name: string; content: string }>; tree: any }> {
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

  const filesList: Array<{ path: string; fullPath: string; name: string; content: string }> = [];

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
          try {
            content = await fs.promises.readFile(entryFullPath, 'utf-8');
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

ipcMain.handle('fs:scanDirectory', async (_, dirPath: string) => {
  try {
    const rootName = path.basename(dirPath);
    const { files, tree } = await scanDirectoryRecursive(dirPath, dirPath);

    // Setup live file watcher for external changes (with debounce)
    if (activeWatcher) {
      activeWatcher.close();
    }

    try {
      let debounceTimer: any = null;
      activeWatcher = fs.watch(dirPath, { recursive: true }, (_, filename) => {
        if (!filename) return;
        const ext = path.extname(filename).toLowerCase();
        if (MD_EXTENSIONS.has(ext)) {
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

    return { rootPath: dirPath, rootName, files, tree };
  } catch (err: any) {
    throw new Error(`Failed to scan directory: ${err.message}`);
  }
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
    await fs.promises.rename(oldPath, newPath);
    return true;
  } catch (err: any) {
    throw new Error(`Failed to rename: ${err.message}`);
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
