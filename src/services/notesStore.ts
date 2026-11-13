import { ProjectWorkspace } from '../types/document';
import { ProjectScannerService } from './projectScanner';
import { buildNotesWorkspace, ExternalFile, samePath } from './notesWorkspace';

/** Desktop-only: the Notes folder plus the remembered outside files, persisted in the app's JSON store. */

const STORE_NAME = 'notes';

export async function getNotesFolder(): Promise<string | null> {
  if (!ProjectScannerService.isElectron() || !window.electronAPI?.getNotesFolder) return null;
  return window.electronAPI.getNotesFolder();
}

export async function loadExternalPaths(): Promise<string[]> {
  try {
    const data = await window.electronAPI?.storeRead?.(STORE_NAME);
    return Array.isArray(data?.externalPaths) ? data.externalPaths.filter((p: unknown) => typeof p === 'string') : [];
  } catch {
    return [];
  }
}

export async function saveExternalPaths(paths: string[]): Promise<void> {
  try {
    await window.electronAPI?.storeWrite?.(STORE_NAME, { externalPaths: paths });
  } catch {
    // Not fatal: the list just won't survive a restart.
  }
}

/** Adds paths to the list (no duplicates, existing order kept). */
export function withExternalPaths(current: string[], added: string[]): string[] {
  const next = [...current];
  for (const p of added) if (!next.some((q) => samePath(q, p))) next.push(p);
  return next;
}

/**
 * Scans the notes folder (and starts watching it) and reads each outside file. Outside files that no
 * longer exist are dropped; `kept` is the surviving list so the caller can persist it.
 */
export async function loadNotesWorkspace(
  notesDir: string,
  externalPaths: string[]
): Promise<{ workspace: ProjectWorkspace; kept: string[] }> {
  const base = await ProjectScannerService.scanPath(notesDir);
  if (!base) throw new Error(`Could not read ${notesDir}`);

  const externals: ExternalFile[] = [];
  const kept: string[] = [];
  for (const fullPath of externalPaths) {
    try {
      const info = await window.electronAPI!.fileInfo?.(fullPath);
      if (info && !info.exists) continue;
      const content = await window.electronAPI!.readFile(fullPath);
      externals.push({ fullPath, content, lastModifiedMs: info?.lastModifiedMs });
      kept.push(fullPath);
    } catch {
      // unreadable or gone: drop it
    }
  }
  return { workspace: buildNotesWorkspace(base, externals), kept };
}
