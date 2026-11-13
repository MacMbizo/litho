import { FileTreeNode, MarkdownFile, ProjectWorkspace } from '../types/document';
import { MarkdownService } from './markdown';

/**
 * Notes: the home for Markdown that doesn't belong to any project.
 *
 * It is a normal local workspace (a folder under Documents, scanned and watched like a project), plus
 * any .md files the user opened from elsewhere on disk. Those outside files are listed under a virtual
 * folder; they stay where they are on disk and are only remembered by path.
 */

/** Virtual folder (and id/path prefix) for files opened from outside the notes folder. */
export const ELSEWHERE_PREFIX = '~elsewhere';
export const ELSEWHERE_LABEL = 'Opened from elsewhere';

export function isElsewhereId(id: string): boolean {
  return id === ELSEWHERE_PREFIX || id.startsWith(`${ELSEWHERE_PREFIX}/`);
}

/** Forward slashes, no trailing slash. Windows paths compare case-insensitively via `samePath`. */
export function normalizeFsPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '');
}

export function samePath(a: string, b: string): boolean {
  return normalizeFsPath(a).toLowerCase() === normalizeFsPath(b).toLowerCase();
}

/** Path of `filePath` relative to `folder` (forward slashes), or null when it isn't inside it. */
export function relativeInside(filePath: string, folder: string): string | null {
  const file = normalizeFsPath(filePath);
  const dir = normalizeFsPath(folder);
  if (!dir || file.length <= dir.length + 1) return null;
  if (file.slice(0, dir.length + 1).toLowerCase() !== `${dir.toLowerCase()}/`) return null;
  return file.slice(dir.length + 1);
}

/** The deepest root that contains `filePath` (nested apps are their own projects), or null. */
export function findOwningRoot(filePath: string, roots: string[]): string | null {
  let best: string | null = null;
  for (const root of roots) {
    if (relativeInside(filePath, root) === null) continue;
    if (!best || normalizeFsPath(root).length > normalizeFsPath(best).length) best = root;
  }
  return best;
}

export function baseName(p: string): string {
  const norm = normalizeFsPath(p);
  return norm.slice(norm.lastIndexOf('/') + 1);
}

/** "Note 2026-11-13 1432.md", with " 2", " 3"… appended if that name is taken. */
export function newNoteFileName(now: Date, existingNames: string[]): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const stem = `Note ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}${pad(now.getMinutes())}`;
  const taken = new Set(existingNames.map((n) => n.toLowerCase()));
  if (!taken.has(`${stem}.md`.toLowerCase())) return `${stem}.md`;
  for (let i = 2; ; i++) {
    const candidate = `${stem} ${i}.md`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

/**
 * A blank note: no frontmatter, so it stays a plain .md file anywhere it ends up. The heading repeats
 * the dated file name so several fresh notes can be told apart in the sidebar until they're retitled.
 */
export function newNoteContent(fileName: string): string {
  return `# ${fileName.replace(/\.md$/i, '')}\n\n`;
}

export interface ExternalFile {
  fullPath: string;
  content: string;
  lastModifiedMs?: number;
}

/**
 * Turns a scanned notes folder into the Notes workspace, adding the outside files under the virtual
 * "Opened from elsewhere" folder. Ids are stable for a given list order, so open tabs survive reloads.
 */
export function buildNotesWorkspace(base: ProjectWorkspace, externals: ExternalFile[]): ProjectWorkspace {
  const usedPaths = new Set<string>();
  const externalFiles: MarkdownFile[] = externals.map((ext) => {
    const name = baseName(ext.fullPath);
    let relPath = `${ELSEWHERE_PREFIX}/${name}`;
    for (let i = 2; usedPaths.has(relPath.toLowerCase()); i++) {
      const dot = name.lastIndexOf('.');
      relPath = `${ELSEWHERE_PREFIX}/${dot > 0 ? `${name.slice(0, dot)} (${i})${name.slice(dot)}` : `${name} (${i})`}`;
    }
    usedPaths.add(relPath.toLowerCase());
    const parsed = MarkdownService.parse(ext.content, relPath);
    return {
      id: relPath,
      path: relPath,
      fullPath: normalizeFsPath(ext.fullPath),
      name,
      content: ext.content,
      frontmatter: parsed.frontmatter,
      body: parsed.body,
      wordCount: parsed.wordCount,
      tasks: parsed.tasks,
      lastModifiedMs: ext.lastModifiedMs,
      isDirty: false,
    };
  });

  const baseChildren = (base.tree.children || []).filter((c) => !isElsewhereId(c.id));
  const children: FileTreeNode[] = [...baseChildren];
  if (externalFiles.length > 0) {
    children.push({
      id: ELSEWHERE_PREFIX,
      name: ELSEWHERE_LABEL,
      path: ELSEWHERE_PREFIX,
      isFolder: true,
      itemCount: externalFiles.length,
      children: externalFiles.map((f) => ({
        id: f.id,
        name: f.name,
        path: f.path,
        fullPath: f.fullPath,
        isFolder: false,
        docType: f.frontmatter.type || 'document',
        metadata: f.frontmatter,
      })),
    });
  }

  const baseFiles = base.files.filter((f) => !isElsewhereId(f.id));
  return {
    ...base,
    kind: 'notes',
    name: 'Notes',
    files: [...baseFiles, ...externalFiles],
    tree: {
      ...base.tree,
      name: 'Notes',
      children,
      itemCount: (base.tree.itemCount ?? baseFiles.length) + externalFiles.length,
    },
  };
}
