import type { PortfolioProjectSummary } from '../types/docAudit';
import type { ProjectWorkspace } from '../types/document';

/**
 * Remembers the last portfolio scan between launches so DocAtlas opens instantly.
 * Only audit results and stack manifests are stored, never markdown contents: entries
 * restored from a snapshot are flagged `fromSnapshot` and re-read from disk before editing.
 */
export interface PortfolioSnapshot {
  version: 1;
  roots: string[];
  savedAt: string;
  projects: Array<{
    scannedAt: string;
    workspace: Pick<ProjectWorkspace, 'name' | 'rootPath' | 'configFiles' | 'installedPackages'>;
    auditReport: PortfolioProjectSummary['auditReport'];
  }>;
}

const STORE_NAME = 'portfolio';
const LEGACY_ROOT_KEY = 'notion_portfolio_root_path';
/** Snapshots older than this are refreshed quietly in the background on launch. */
export const SNAPSHOT_STALE_MS = 6 * 60 * 60 * 1000;

export function isStoreAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.electronAPI?.storeRead === 'function';
}

export function toSnapshot(roots: string[], projects: PortfolioProjectSummary[]): PortfolioSnapshot {
  const now = new Date().toISOString();
  return {
    version: 1,
    roots,
    savedAt: now,
    projects: projects.map((p) => ({
      scannedAt: p.scannedAt || now,
      workspace: {
        name: p.workspace.name,
        rootPath: p.workspace.rootPath,
        configFiles: p.workspace.configFiles,
        installedPackages: p.workspace.installedPackages,
      },
      auditReport: p.auditReport,
    })),
  };
}

export function fromSnapshot(snapshot: PortfolioSnapshot): PortfolioProjectSummary[] {
  return snapshot.projects.map((p) => ({
    fromSnapshot: true,
    scannedAt: p.scannedAt,
    auditReport: p.auditReport,
    workspace: {
      name: p.workspace.name,
      rootPath: p.workspace.rootPath,
      isLocalFolder: true,
      tree: { id: p.workspace.name, name: p.workspace.name, path: '', isFolder: true, children: [] },
      files: [],
      configFiles: p.workspace.configFiles || {},
      installedPackages: p.workspace.installedPackages,
    },
  }));
}

export async function loadPortfolioSnapshot(): Promise<PortfolioSnapshot | null> {
  if (!isStoreAvailable()) return null;
  try {
    const data = await window.electronAPI!.storeRead!(STORE_NAME);
    if (data && data.version === 1 && Array.isArray(data.projects) && Array.isArray(data.roots)) return data;
  } catch {
    // unreadable snapshot: fall through to legacy root
  }
  const legacyRoot = typeof localStorage !== 'undefined' ? localStorage.getItem(LEGACY_ROOT_KEY) : null;
  return legacyRoot ? { version: 1, roots: [legacyRoot], savedAt: new Date(0).toISOString(), projects: [] } : null;
}

let pendingSave: ReturnType<typeof setTimeout> | null = null;

/** Debounced so a burst of registry results produces one write. */
export function savePortfolioSnapshot(roots: string[], projects: PortfolioProjectSummary[]): void {
  if (!isStoreAvailable()) return;
  if (pendingSave) clearTimeout(pendingSave);
  pendingSave = setTimeout(() => {
    pendingSave = null;
    window.electronAPI!.storeWrite!(STORE_NAME, toSnapshot(roots, projects)).catch(() => {
      // disk full / permissions: the in-memory portfolio still works
    });
  }, 800);
}

/** Which configured root a project belongs to (longest matching prefix). */
export function rootOf(projectPath: string, roots: string[]): string | undefined {
  const norm = (p: string) => p.replace(/[\\/]+$/, '').toLowerCase();
  const target = norm(projectPath);
  return roots
    .filter((r) => target.startsWith(norm(r) + '\\') || target.startsWith(norm(r) + '/'))
    .sort((a, b) => b.length - a.length)[0];
}
