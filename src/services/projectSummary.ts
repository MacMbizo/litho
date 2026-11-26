/**
 * Turns a raw folder scan into a portfolio summary (stack + doc audit) without keeping file contents.
 * Runs in the main process for portfolio scans, so the window never receives every file of every project
 * (28 MB for one large project) just to show a card. Opening a project still loads its files.
 */
import type { MarkdownFile, ProjectWorkspace } from '../types/document';
import type { PortfolioProjectSummary, ProjectDocAuditReport } from '../types/docAudit';
import type { ProjectBasicsFacts } from './projectBasics';
import { MarkdownService } from './markdown';
import { auditProjectDocumentation } from './docHealthAuditor';
import { inspectProjectStack } from './stackInspector';

export interface RawScannedFile {
  path: string;
  fullPath: string;
  name: string;
  content: string;
  lastModifiedMs?: number;
}

export interface RawProjectScan {
  rootPath: string;
  rootName: string;
  files: RawScannedFile[];
  configFiles?: Record<string, string>;
  installedPackages?: ProjectWorkspace['installedPackages'];
  basics?: ProjectBasicsFacts;
}

/** What crosses IPC for one portfolio project: everything a card needs, no file contents. */
export interface ProjectSummaryPayload {
  rootPath: string;
  rootName: string;
  configFiles: Record<string, string>;
  installedPackages?: ProjectWorkspace['installedPackages'];
  basics?: ProjectBasicsFacts;
  auditReport: ProjectDocAuditReport;
}

export function toMarkdownFiles(raw: RawScannedFile[]): MarkdownFile[] {
  return raw.map((r) => {
    const parsed = MarkdownService.parse(r.content, r.path);
    return {
      id: r.path,
      path: r.path,
      fullPath: r.fullPath,
      name: r.name,
      content: r.content,
      frontmatter: parsed.frontmatter,
      body: parsed.body,
      wordCount: parsed.wordCount,
      tasks: parsed.tasks,
      lastModifiedMs: r.lastModifiedMs,
      isDirty: false,
    };
  });
}

export function summarizeScan(scan: RawProjectScan): ProjectSummaryPayload {
  const workspace: ProjectWorkspace = {
    name: scan.rootName,
    rootPath: scan.rootPath,
    isLocalFolder: true,
    tree: { id: scan.rootName, name: scan.rootName, path: '', isFolder: true, children: [] },
    files: toMarkdownFiles(scan.files),
    configFiles: scan.configFiles || {},
    installedPackages: scan.installedPackages,
    basics: scan.basics,
  };
  return {
    rootPath: scan.rootPath,
    rootName: scan.rootName,
    configFiles: workspace.configFiles!,
    installedPackages: scan.installedPackages,
    basics: scan.basics,
    auditReport: auditProjectDocumentation(workspace, inspectProjectStack(workspace)),
  };
}

/**
 * The renderer's portfolio entry for a summary. It carries no file contents, so it is flagged like a
 * remembered entry and the project is read from disk again before anything is edited.
 */
export function summaryToEntry(s: ProjectSummaryPayload, scannedAt: string): PortfolioProjectSummary {
  return {
    fromSnapshot: true,
    scannedAt,
    auditReport: s.auditReport,
    workspace: {
      name: s.rootName,
      rootPath: s.rootPath,
      isLocalFolder: true,
      tree: { id: s.rootName, name: s.rootName, path: '', isFolder: true, children: [] },
      files: [],
      configFiles: s.configFiles,
      installedPackages: s.installedPackages,
      basics: s.basics,
    },
  };
}
