import { ProjectWorkspace } from '../types/document';
import { ProjectScannerService } from './projectScanner';
import { buildNotesWorkspace, ExternalFile, relativeInside, samePath } from './notesWorkspace';

/**
 * Desktop-only persistence for Notes, in the app's JSON store (userData/docatlas/notes.json):
 * the chosen notes folder (absent = Documents\DocAtlas Notes) and the files opened from elsewhere.
 */

const STORE_NAME = 'notes';

interface NotesStoreData {
  folder?: string;
  externalPaths: string[];
}

async function readStore(): Promise<NotesStoreData> {
  try {
    const data = await window.electronAPI?.storeRead?.(STORE_NAME);
    return {
      folder: typeof data?.folder === 'string' && data.folder ? data.folder : undefined,
      externalPaths: Array.isArray(data?.externalPaths) ? data.externalPaths.filter((p: unknown) => typeof p === 'string') : [],
    };
  } catch {
    return { externalPaths: [] };
  }
}

async function patchStore(patch: Partial<NotesStoreData>): Promise<void> {
  try {
    const current = await readStore();
    await window.electronAPI?.storeWrite?.(STORE_NAME, { ...current, ...patch });
  } catch {
    // Not fatal: the setting just won't survive a restart.
  }
}

/** The notes folder in use (created if missing). Falls back to the default if a chosen one can't be used. */
export async function getNotesFolder(): Promise<string | null> {
  if (!ProjectScannerService.isElectron() || !window.electronAPI?.getNotesFolder) return null;
  const { folder } = await readStore();
  return window.electronAPI.getNotesFolder(folder);
}

export async function getDefaultNotesFolder(): Promise<string | null> {
  return window.electronAPI?.getDefaultNotesFolder?.() ?? null;
}

/** Saves the chosen folder (null = back to the default) and returns the folder now in use. */
export async function setNotesFolder(folder: string | null): Promise<string | null> {
  await patchStore({ folder: folder ?? undefined });
  return getNotesFolder();
}

export async function loadExternalPaths(): Promise<string[]> {
  return (await readStore()).externalPaths;
}

export async function saveExternalPaths(paths: string[]): Promise<void> {
  await patchStore({ externalPaths: paths });
}

/** Adds paths to the list (no duplicates, existing order kept). */
export function withExternalPaths(current: string[], added: string[]): string[] {
  const next = [...current];
  for (const p of added) if (!next.some((q) => samePath(q, p))) next.push(p);
  return next;
}

/**
 * Scans the notes folder (and starts watching it) and reads each outside file. Outside files that no
 * longer exist are dropped; `kept` is the surviving list so the caller can persist it. Listed files that
 * now sit inside the notes folder (after a folder change) already appear there, so they aren't repeated.
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
      kept.push(fullPath);
      if (relativeInside(fullPath, notesDir) !== null) continue;
      const content = await window.electronAPI!.readFile(fullPath);
      externals.push({ fullPath, content, lastModifiedMs: info?.lastModifiedMs });
    } catch {
      // unreadable or gone: drop it
    }
  }
  return { workspace: buildNotesWorkspace(base, externals), kept };
}
