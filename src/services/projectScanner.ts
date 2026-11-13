import { MarkdownFile, FileTreeNode, ProjectWorkspace } from '../types/document';
import { MarkdownService } from './markdown';
import { archivePathFor, rewriteRelativeLinksForMove } from './docRemediation';

declare global {
  interface Window {
    electronAPI?: {
      openDirectory: () => Promise<string | null>;
      scanDirectory: (dirPath: string, opts?: { watch?: boolean }) => Promise<{
        rootPath: string;
        rootName: string;
        files: Array<{ path: string; fullPath: string; name: string; content: string; lastModifiedMs?: number }>;
        tree: any;
        configFiles?: Record<string, string>;
        installedPackages?: ProjectWorkspace['installedPackages'];
      }>;
      scanPortfolioRoot: (dirPath: string) => Promise<{
        rootPath: string;
        projects: Array<{
          rootPath: string;
          rootName: string;
          files: Array<{ path: string; fullPath: string; name: string; content: string; lastModifiedMs?: number }>;
          tree: any;
          configFiles?: Record<string, string>;
          installedPackages?: ProjectWorkspace['installedPackages'];
        }>;
      }>;
      readFile: (filePath: string) => Promise<string>;
      writeFile: (filePath: string, content: string) => Promise<boolean>;
      createFolder: (folderPath: string) => Promise<boolean>;
      renamePath: (oldPath: string, newPath: string) => Promise<boolean>;
      movePathSafe?: (oldPath: string, newPath: string) => Promise<string>;
      deletePath: (targetPath: string) => Promise<boolean>;
      revealInExplorer: (targetPath: string) => Promise<boolean>;
      getNotesFolder?: (preferred?: string) => Promise<string>;
      getDefaultNotesFolder?: () => Promise<string>;
      takeLaunchFiles?: () => Promise<string[]>;
      onOpenFiles?: (callback: (paths: string[]) => void) => (() => void) | void;
      openMarkdownFiles?: () => Promise<string[]>;
      saveMarkdownFileAs?: (defaultPath?: string) => Promise<string | null>;
      fileInfo?: (filePath: string) => Promise<{ exists: boolean; lastModifiedMs?: number }>;
      fetchJson: (url: string) => Promise<any>;
      storeRead?: (name: string) => Promise<any>;
      storeWrite?: (name: string, data: unknown) => Promise<boolean>;
      onFsChanged: (callback: (data: any) => void) => (() => void) | void;
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
  static async scanPath(dirPath: string, opts?: { watch?: boolean }): Promise<ProjectWorkspace | null> {
    if (!this.isElectron()) return null;

    const result = await window.electronAPI!.scanDirectory(dirPath, opts);
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
        lastModifiedMs: raw.lastModifiedMs,
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
      configFiles: result.configFiles || {},
      installedPackages: result.installedPackages,
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
      const configFiles: Record<string, string> = {};
      const TRACKED_CONFIGS = new Set([
        'package.json',
        'app.config.json',
        'app.json',
        'app.config.ts',
        'app.config.js',
        'eas.json',
        'tsconfig.json',
        'pyproject.toml',
        'requirements.txt',
        'Dockerfile',
        'docker-compose.yml',
        'vercel.json',
        'wrangler.toml',
        '.firebaserc',
        'supabase/config.toml',
        'vite.config.ts',
        'vite.config.js',
        '.nvmrc',
        '.node-version',
        '.python-version',
        'runtime.txt',
      ]);
      const NESTED_CONFIG_NAMES = new Set([
        'package.json',
        'app.json',
        'app.config.json',
        'app.config.ts',
        'app.config.js',
        'eas.json',
        'pyproject.toml',
        'requirements.txt',
        'Dockerfile',
        '.nvmrc',
        '.python-version',
      ]);
      const NESTED_SKIP = new Set(['ios', 'android', 'examples', 'example', 'fixtures', 'tests', 'test', '__tests__', 'templates', '_archive', 'archive', 'docs', 'tmp', 'vendor']);

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
            if (
              IGNORED_FOLDERS.has(entry.name) ||
              (entry.name.startsWith('.') && entry.name !== '.github')
            ) {
              continue;
            }
            if (entry.name === 'supabase' && !currentPath) {
              // check supabase/config.toml
              try {
                const subCfg = await entry.getFileHandle('config.toml');
                const f = await subCfg.getFile();
                configFiles['supabase/config.toml'] = (await f.text()).slice(0, 64 * 1024);
              } catch {
                // ignore
              }
            }
            const subTree = await walkHandle(entry, entryRelPath);
            if (subTree.children && subTree.children.length > 0) {
              folderNode.children!.push(subTree);
            }
          } else if (entry.kind === 'file') {
            const depth = entryRelPath.split('/').length - 1;
            const isNestedManifest =
              depth > 0 &&
              depth <= 3 &&
              NESTED_CONFIG_NAMES.has(entry.name) &&
              !entryRelPath.split('/').some((seg: string) => NESTED_SKIP.has(seg));
            if (TRACKED_CONFIGS.has(entryRelPath) || isNestedManifest) {
              try {
                const cfgObj = await entry.getFile();
                configFiles[entryRelPath] = (await cfgObj.text()).slice(0, 128 * 1024);
              } catch {
                // ignore
              }
            }
            const ext = entry.name.includes('.')
              ? entry.name.slice(entry.name.lastIndexOf('.')).toLowerCase()
              : '';
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
                lastModifiedMs: fileObj.lastModified,
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
        configFiles,
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

  /**
   * Move a markdown file to another project-relative path, rewriting its relative links so they
   * still resolve from the new location. Never overwrites an existing file. Returns the final
   * relative path and the rewritten content.
   */
  static async moveFile(
    workspace: ProjectWorkspace,
    file: MarkdownFile,
    targetRelPath: string
  ): Promise<{ path: string; content: string }> {
    const body = rewriteRelativeLinksForMove(file.body, file.path, targetRelPath);
    const content = MarkdownService.hasFrontmatter(file.content)
      ? MarkdownService.stringify(file.frontmatter, body)
      : body;

    if (this.isElectron() && file.fullPath) {
      const root = workspace.rootPath.replace(/\\/g, '/').replace(/\/+$/, '');
      const targetFullPath = `${root}/${targetRelPath}`;
      if (content !== file.content) {
        await window.electronAPI!.writeFile(file.fullPath, content);
      }
      let finalFullPath = targetFullPath;
      if (window.electronAPI!.movePathSafe) {
        finalFullPath = (await window.electronAPI!.movePathSafe(file.fullPath, targetFullPath)).replace(/\\/g, '/');
      } else {
        await window.electronAPI!.renamePath(file.fullPath, targetFullPath);
      }
      const finalRel = finalFullPath.toLowerCase().startsWith(`${root.toLowerCase()}/`)
        ? finalFullPath.slice(root.length + 1)
        : targetRelPath;
      return { path: finalRel, content };
    }
    return { path: targetRelPath, content };
  }

  /** Archive a markdown file safely into _archive/<relativePath> (reversible). */
  static async archiveFile(workspace: ProjectWorkspace, file: MarkdownFile): Promise<{ path: string; content: string }> {
    return this.moveFile(workspace, file, archivePathFor(file.path));
  }

  /**
   * Pick a root directory containing multiple projects and scan all of them
   */
  static async openAndScanPortfolioRoot(): Promise<{ rootPath: string; projects: ProjectWorkspace[] } | null> {
    if (this.isElectron()) {
      const dirPath = await window.electronAPI!.openDirectory();
      if (!dirPath) return null;
      return this.scanPortfolioRoot(dirPath);
    }
    return null;
  }

  static async scanPortfolioRoot(rootDirPath: string): Promise<{ rootPath: string; projects: ProjectWorkspace[] }> {
    if (!this.isElectron()) {
      throw new Error('Multi-project root scanning requires the desktop Electron app.');
    }
    if (typeof window.electronAPI?.scanPortfolioRoot !== 'function') {
      throw new Error('Please restart the Electron app (close window and run npm start) to enable Portfolio Scanning.');
    }
    const raw = await window.electronAPI.scanPortfolioRoot(rootDirPath);
    const projects: ProjectWorkspace[] = raw.projects.map((p) => {
      const parsedFiles: MarkdownFile[] = p.files.map((f) => {
        const parsed = MarkdownService.parse(f.content, f.path);
        return {
          id: f.path,
          path: f.path,
          fullPath: f.fullPath,
          name: f.name,
          content: f.content,
          frontmatter: parsed.frontmatter,
          body: parsed.body,
          wordCount: parsed.wordCount,
          tasks: parsed.tasks,
          lastModifiedMs: f.lastModifiedMs,
          isDirty: false,
        };
      });
      const enrichedTree = this.enrichTreeWithMetadata(p.tree, parsedFiles);
      return {
        name: p.rootName,
        rootPath: p.rootPath,
        isLocalFolder: true,
        tree: enrichedTree,
        files: parsedFiles,
        configFiles: p.configFiles || {},
        installedPackages: p.installedPackages,
      };
    });
    return { rootPath: raw.rootPath, projects };
  }
}
