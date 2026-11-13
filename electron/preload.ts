import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  openDirectory: () => ipcRenderer.invoke('dialog:openDirectory'),
  scanDirectory: (dirPath: string) => ipcRenderer.invoke('fs:scanDirectory', dirPath),
  scanPortfolioRoot: (dirPath: string) => ipcRenderer.invoke('fs:scanPortfolioRoot', dirPath),
  readFile: (filePath: string) => ipcRenderer.invoke('fs:readFile', filePath),
  writeFile: (filePath: string, content: string) => ipcRenderer.invoke('fs:writeFile', filePath, content),
  createFolder: (folderPath: string) => ipcRenderer.invoke('fs:createFolder', folderPath),
  renamePath: (oldPath: string, newPath: string) => ipcRenderer.invoke('fs:renamePath', oldPath, newPath),
  movePathSafe: (oldPath: string, newPath: string) => ipcRenderer.invoke('fs:movePathSafe', oldPath, newPath),
  deletePath: (targetPath: string) => ipcRenderer.invoke('fs:deletePath', targetPath),
  revealInExplorer: (targetPath: string) => ipcRenderer.invoke('fs:revealInExplorer', targetPath),
  fetchJson: (url: string) => ipcRenderer.invoke('net:fetchJson', url),
  onFsChanged: (callback: (data: any) => void) => {
    const listener = (_: unknown, data: any) => callback(data);
    ipcRenderer.on('fs:changed', listener);
    return () => {
      ipcRenderer.removeListener('fs:changed', listener);
    };
  },
});
