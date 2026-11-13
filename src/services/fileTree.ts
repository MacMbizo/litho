import type { FileTreeNode, MarkdownFile } from '../types/document';

/** Builds a folder tree (folders first, alphabetical) from flat project-relative file paths. */
export function buildTreeFromFiles(files: MarkdownFile[], rootName: string): FileTreeNode {
  const root: FileTreeNode = { id: 'root', name: rootName, path: '', isFolder: true, children: [] };
  const folders = new Map<string, FileTreeNode>([['', root]]);

  const ensureFolder = (folderPath: string): FileTreeNode => {
    const existing = folders.get(folderPath);
    if (existing) return existing;
    const idx = folderPath.lastIndexOf('/');
    const parent = ensureFolder(idx === -1 ? '' : folderPath.slice(0, idx));
    const node: FileTreeNode = {
      id: folderPath,
      name: idx === -1 ? folderPath : folderPath.slice(idx + 1),
      path: folderPath,
      isFolder: true,
      children: [],
    };
    parent.children!.push(node);
    folders.set(folderPath, node);
    return node;
  };

  for (const file of files) {
    const idx = file.path.lastIndexOf('/');
    const parent = ensureFolder(idx === -1 ? '' : file.path.slice(0, idx));
    parent.children!.push({
      id: file.id,
      name: file.name,
      path: file.path,
      fullPath: file.fullPath,
      isFolder: false,
      docType: file.frontmatter.type || 'document',
      metadata: file.frontmatter,
    });
  }

  const finalize = (node: FileTreeNode): number => {
    if (!node.isFolder) return 1;
    node.children!.sort((a, b) =>
      a.isFolder === b.isFolder ? a.name.localeCompare(b.name) : a.isFolder ? -1 : 1
    );
    node.itemCount = node.children!.reduce((acc, c) => acc + finalize(c), 0);
    return node.itemCount;
  };
  finalize(root);
  return root;
}
