export type DocType = 'project' | 'agent' | 'skill' | 'document' | 'note';

export type TaskItem = {
  id: string;
  text: string;
  completed: boolean;
  filePath: string;
  fileName: string;
  line: number;
};

export interface DocumentMetadata {
  title?: string;
  type?: DocType;
  tags?: string[];
  status?: 'Backlog' | 'In Progress' | 'Review' | 'Done' | 'Active' | 'Draft' | 'Archived';
  priority?: 'Low' | 'Medium' | 'High' | 'Critical';
  model?: string;
  tools?: string[];
  category?: string;
  version?: string;
  author?: string;
  created_at?: string;
  updated_at?: string;
  [key: string]: any;
}

export interface MarkdownFile {
  id: string;
  path: string;        // relative path e.g. "docs/architecture.md"
  fullPath?: string;   // absolute disk path e.g. "C:/Prj/my-repo/docs/architecture.md"
  name: string;        // e.g. "architecture.md"
  content: string;     // raw file contents
  frontmatter: DocumentMetadata;
  body: string;        // body without frontmatter
  isDirty?: boolean;
  wordCount: number;
  tasks: TaskItem[];
}

export interface FileTreeNode {
  id: string;
  name: string;
  path: string;        // relative path
  fullPath?: string;   // absolute path
  isFolder: boolean;
  docType?: DocType;
  children?: FileTreeNode[];
  metadata?: DocumentMetadata;
  itemCount?: number;
}

export interface ProjectWorkspace {
  name: string;
  rootPath: string;
  isLocalFolder: boolean;
  tree: FileTreeNode;
  files: MarkdownFile[];
}

export type ViewMode = 'editor' | 'database' | 'tasks' | 'agent-hub' | 'graph' | 'project-overview';
export type DatabaseViewType = 'table' | 'kanban' | 'gallery';
