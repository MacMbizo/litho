import { MarkdownFile, FileTreeNode, ProjectWorkspace } from '../types/document';
import { MarkdownService } from './markdown';

declare global {
  interface Window {
    electronAPI?: {
      openDirectory: () => Promise<string | null>;
      scanDirectory: (dirPath: string) => Promise<{
        rootPath: string;
        rootName: string;
        files: Array<{ path: string; fullPath: string; name: string; content: string }>;
        tree: any;
      }>;
      readFile: (filePath: string) => Promise<string>;
      writeFile: (filePath: string, content: string) => Promise<boolean>;
      createFolder: (folderPath: string) => Promise<boolean>;
      renamePath: (oldPath: string, newPath: string) => Promise<boolean>;
      deletePath: (targetPath: string) => Promise<boolean>;
      revealInExplorer: (targetPath: string) => Promise<boolean>;
      onFsChanged: (callback: (data: any) => void) => void;
    };
  }
}

const IGNORED_FOLDERS = new Set([
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

export class ProjectScannerService {
  /**
   * Check if running in Electron environment
   */
  static isElectron(): boolean {
    return typeof window !== 'undefined' && Boolean(window.electronAPI);
  }

  /**
   * Open directory picker and scan project
   */
  static async openAndScanProject(): Promise<ProjectWorkspace | null> {
    if (this.isElectron()) {
      return this.scanElectronDirectory();
    } else {
      return this.scanBrowserDirectory();
    }
  }

  /**
   * Scan specific path via Electron
   */
  static async scanPath(dirPath: string): Promise<ProjectWorkspace | null> {
    if (!this.isElectron()) return null;

    const result = await window.electronAPI!.scanDirectory(dirPath);
    if (!result) return null;

    const files: MarkdownFile[] = result.files.map((raw) => {
      const parsed = MarkdownService.parse(raw.content, raw.path);
      return {
        id: raw.path,
        path: raw.path,
        fullPath: raw.fullPath,
        name: raw.name,
        content: raw.content,
        frontmatter: parsed.frontmatter,
        body: parsed.body,
        wordCount: parsed.wordCount,
        tasks: parsed.tasks,
        isDirty: false,
      };
    });

    const enrichedTree = this.enrichTreeWithMetadata(result.tree, files);

    return {
      name: result.rootName,
      rootPath: result.rootPath,
      isLocalFolder: true,
      tree: enrichedTree,
      files,
    };
  }

  /**
   * Electron implementation of directory opening & scan
   */
  private static async scanElectronDirectory(): Promise<ProjectWorkspace | null> {
    const selectedPath = await window.electronAPI!.openDirectory();
    if (!selectedPath) return null;
    return this.scanPath(selectedPath);
  }

  /**
   * Browser implementation via HTML5 File System Access API
   */
  private static async scanBrowserDirectory(): Promise<ProjectWorkspace | null> {
    if (!('showDirectoryPicker' in window)) {
      alert('Your browser does not support the File System Access API. Please use Google Chrome, Edge, or the desktop Electron app.');
      return null;
    }

    try {
      const dirHandle = await (window as any).showDirectoryPicker({ mode: 'readwrite' });
      const rootName = dirHandle.name;
      const files: MarkdownFile[] = [];

      const walkHandle = async (handle: any, currentPath: string): Promise<FileTreeNode> => {
        const isFolder = handle.kind === 'directory';
        const folderNode: FileTreeNode = {
          id: currentPath || handle.name,
          name: handle.name,
          path: currentPath,
          isFolder: true,
          children: [],
        };

        for await (const entry of handle.values()) {
          const entryRelPath = currentPath ? `${currentPath}/${entry.name}` : entry.name;

          if (entry.kind === 'directory') {
            if (IGNORED_FOLDERS.has(entry.name) || entry.name.startsWith('.')) {
              continue;
            }
            const subTree = await walkHandle(entry, entryRelPath);
            if (subTree.children && subTree.children.length > 0) {
              folderNode.children!.push(subTree);
            }
          } else if (entry.kind === 'file') {
            const ext = entry.name.slice(entry.name.lastIndexOf('.')).toLowerCase();
            if (MD_EXTENSIONS.has(ext)) {
              const fileObj = await entry.getFile();
              const text = await fileObj.text();
              const parsed = MarkdownService.parse(text, entryRelPath);

              const mdFile: MarkdownFile = {
                id: entryRelPath,
                path: entryRelPath,
                name: entry.name,
                content: text,
                frontmatter: parsed.frontmatter,
                body: parsed.body,
                wordCount: parsed.wordCount,
                tasks: parsed.tasks,
                isDirty: false,
              };

              files.push(mdFile);

              folderNode.children!.push({
                id: entryRelPath,
                name: entry.name,
                path: entryRelPath,
                isFolder: false,
                docType: parsed.frontmatter.type,
                metadata: parsed.frontmatter,
              });
            }
          }
        }

        return folderNode;
      };

      const tree = await walkHandle(dirHandle, '');
      const enrichedTree = this.enrichTreeWithMetadata(tree, files);

      return {
        name: rootName,
        rootPath: rootName,
        isLocalFolder: true,
        tree: enrichedTree,
        files,
      };
    } catch (err: any) {
      if (err.name === 'AbortError') return null;
      console.error('Failed to scan browser directory:', err);
      return null;
    }
  }

  /**
   * Recursively add metadata and child count to tree nodes
   */
  private static enrichTreeWithMetadata(node: any, files: MarkdownFile[]): FileTreeNode {
    if (!node) {
      return { id: 'root', name: 'Root', path: '', isFolder: true, children: [] };
    }

    if (!node.isFolder) {
      const match = files.find((f) => f.path === node.path);
      return {
        ...node,
        docType: match?.frontmatter?.type || 'document',
        metadata: match?.frontmatter,
      };
    }

    const children: FileTreeNode[] = (node.children || []).map((child: any) =>
      this.enrichTreeWithMetadata(child, files)
    );

    let count = 0;
    children.forEach((c) => {
      count += c.isFolder ? (c.itemCount || 0) : 1;
    });

    return {
      ...node,
      children,
      itemCount: count,
    };
  }

  /**
   * Save file contents to local disk
   */
  static async saveFileToDisk(file: MarkdownFile): Promise<boolean> {
    if (this.isElectron() && file.fullPath) {
      try {
        await window.electronAPI!.writeFile(file.fullPath, file.content);
        return true;
      } catch (err) {
        console.error('Failed to save file to disk:', err);
        return false;
      }
    }
    return false;
  }

  /**
   * Create new file in folder
   */
  static async createFile(
    parentFolderPath: string,
    fileName: string,
    content: string
  ): Promise<boolean> {
    if (this.isElectron()) {
      const targetFullPath = `${parentFolderPath}/${fileName}`.replace(/\\/g, '/');
      return window.electronAPI!.writeFile(targetFullPath, content);
    }
    return false;
  }

  /**
   * Create new subfolder
   */
  static async createFolder(folderFullPath: string): Promise<boolean> {
    if (this.isElectron()) {
      return window.electronAPI!.createFolder(folderFullPath);
    }
    return false;
  }

  /**
   * Rename file or folder
   */
  static async renamePath(oldFullPath: string, newFullPath: string): Promise<boolean> {
    if (this.isElectron()) {
      return window.electronAPI!.renamePath(oldFullPath, newFullPath);
    }
    return false;
  }

  /**
   * Delete file or folder
   */
  static async deletePath(fullPath: string): Promise<boolean> {
    if (this.isElectron()) {
      return window.electronAPI!.deletePath(fullPath);
    }
    return false;
  }

  /**
   * Reveal in OS File Explorer
   */
  static revealInExplorer(fullPath: string): void {
    if (this.isElectron()) {
      window.electronAPI!.revealInExplorer(fullPath);
    }
  }
}
