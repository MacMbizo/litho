import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  openDirectory: () => ipcRenderer.invoke('dialog:openDirectory'),
  scanDirectory: (dirPath: string, opts?: { watch?: boolean }) => ipcRenderer.invoke('fs:scanDirectory', dirPath, opts),
  scanPortfolioRoot: (dirPath: string) => ipcRenderer.invoke('fs:scanPortfolioRoot', dirPath),
  readFile: (filePath: string) => ipcRenderer.invoke('fs:readFile', filePath),
  writeFile: (filePath: string, content: string) => ipcRenderer.invoke('fs:writeFile', filePath, content),
  createFolder: (folderPath: string) => ipcRenderer.invoke('fs:createFolder', folderPath),
  renamePath: (oldPath: string, newPath: string) => ipcRenderer.invoke('fs:renamePath', oldPath, newPath),
  movePathSafe: (oldPath: string, newPath: string) => ipcRenderer.invoke('fs:movePathSafe', oldPath, newPath),
  deletePath: (targetPath: string) => ipcRenderer.invoke('fs:deletePath', targetPath),
  revealInExplorer: (targetPath: string) => ipcRenderer.invoke('fs:revealInExplorer', targetPath),
  getNotesFolder: (preferred?: string) => ipcRenderer.invoke('notes:getFolder', preferred),
  getDefaultNotesFolder: () => ipcRenderer.invoke('notes:getDefaultFolder'),
  takeLaunchFiles: () => ipcRenderer.invoke('app:takeLaunchFiles'),
  onOpenFiles: (callback: (paths: string[]) => void) => {
    const listener = (_: unknown, paths: string[]) => callback(paths);
    ipcRenderer.on('app:openFiles', listener);
    return () => {
      ipcRenderer.removeListener('app:openFiles', listener);
    };
  },
  openMarkdownFiles: () => ipcRenderer.invoke('dialog:openMarkdownFiles'),
  saveMarkdownFileAs: (defaultPath?: string) => ipcRenderer.invoke('dialog:saveMarkdownFile', defaultPath),
  fileInfo: (filePath: string) => ipcRenderer.invoke('fs:fileInfo', filePath),
  fetchJson: (url: string) => ipcRenderer.invoke('net:fetchJson', url),
  storeRead: (name: string) => ipcRenderer.invoke('store:read', name),
  storeWrite: (name: string, data: unknown) => ipcRenderer.invoke('store:write', name, data),
  fixPlan: (projectRoot: string, recipe: unknown, title: string) => ipcRenderer.invoke('fix:plan', projectRoot, recipe, title),
  fixRun: (planId: string, opts: { checkpoint: boolean }) => ipcRenderer.invoke('fix:run', planId, opts),
  fixStop: (runId: string) => ipcRenderer.invoke('fix:stop', runId),
  fixApplyConfig: (runId: string, index: number) => ipcRenderer.invoke('fix:applyConfig', runId, index),
  fixCommit: (runId: string) => ipcRenderer.invoke('fix:commit', runId),
  fixUndo: (runId: string) => ipcRenderer.invoke('fix:undo', runId),
  fixOpenFile: (runId: string, index: number) => ipcRenderer.invoke('fix:openFile', runId, index),
  fixOpenLog: (runId: string) => ipcRenderer.invoke('fix:openLog', runId),
  onFixEvent: (callback: (e: any) => void) => {
    const listener = (_: unknown, e: any) => callback(e);
    ipcRenderer.on('fix:event', listener);
    return () => {
      ipcRenderer.removeListener('fix:event', listener);
    };
  },
  onFsChanged: (callback: (data: any) => void) => {
    const listener = (_: unknown, data: any) => callback(data);
    ipcRenderer.on('fs:changed', listener);
    return () => {
      ipcRenderer.removeListener('fs:changed', listener);
    };
  },
});
