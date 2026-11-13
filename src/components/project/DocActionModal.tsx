import React, { useState } from 'react';
import {
  X,
  AlertTriangle,
  Archive,
  FileWarning,
  Trash2,
  ExternalLink,
  FolderOpen,
  ArrowLeftRight,
  ShieldCheck,
  Link2,
  Wrench,
  RotateCcw,
  CheckCircle2,
  Clock,
  Link,
} from 'lucide-react';
import { MarkdownFile } from '../../types/document';
import { DetectedStackProfile, DocInventoryItem } from '../../types/docAudit';

interface DocActionModalProps {
  item: DocInventoryItem;
  canonicalItem?: DocInventoryItem;
  files: MarkdownFile[];
  stackProfile: DetectedStackProfile;
  isLocalFolder: boolean;
  onClose: () => void;
  onOpenInEditor: (fileId: string) => void;
  onRevealInExplorer: (file: MarkdownFile) => void;
  onArchiveFile: (file: MarkdownFile) => Promise<void>;
  onMarkDeprecated: (file: MarkdownFile, supersededByPath?: string) => Promise<void>;
  onRestoreActive?: (file: MarkdownFile) => Promise<void>;
  onAutoFixStale?: (file: MarkdownFile) => Promise<void>;
  onLinkOrphanInReadme?: (file: MarkdownFile) => Promise<void>;
  onMarkScopedDoc?: (file: MarkdownFile) => Promise<void>;
  onDeleteFile: (file: MarkdownFile) => Promise<void>;
}

export const DocActionModal: React.FC<DocActionModalProps> = ({
  item,
  canonicalItem,
  files,
  stackProfile,
  isLocalFolder,
  onClose,
  onOpenInEditor,
  onRevealInExplorer,
  onArchiveFile,
  onMarkDeprecated,
  onRestoreActive,
  onAutoFixStale,
  onLinkOrphanInReadme,
  onMarkScopedDoc,
  onDeleteFile,
}) => {
  const [swapped, setSwapped] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  const isDuplicateMode = item.status === 'duplicate' && Boolean(canonicalItem);
  const canSwap = Boolean(isDuplicateMode && canonicalItem && canonicalItem.fileId !== item.fileId);
  const activeTargetItem = swapped && canonicalItem ? canonicalItem : item;
  const activeCanonicalItem = swapped && canonicalItem ? item : canonicalItem;

  const targetFile = files.find((f) => f.id === activeTargetItem.fileId);
  const canonicalFile =
    isDuplicateMode && activeCanonicalItem
      ? files.find((f) => f.id === activeCanonicalItem.fileId)
      : undefined;

  if (!targetFile) return null;

  const hasIncomingRefs = activeTargetItem.incomingLinksCount > 0;
  const isHealthyOrCanonical =
    item.status === 'canonical' || item.status === 'healthy' || item.status === 'agent-system';
  const allowDestructiveDelete =
    item.status === 'duplicate' || item.status === 'deprecated' || item.status === 'orphan';

  const runAction = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const modalTitle =
    item.status === 'duplicate'
      ? 'Duplicate Comparison & Safe Resolution'
      : item.status === 'stale'
        ? 'Stale Document Review & Drift Fix'
        : item.status === 'deprecated'
          ? 'Deprecated Document Cleanup'
          : item.status === 'orphan'
            ? 'Orphan / Unlinked Note Actions'
            : 'Document Details & Quick Actions';

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-4xl max-h-[90vh] bg-[#1c1c1c] border border-[#323232] rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-[#2b2b2b] flex items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-neutral-100 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-sky-400" />
              <span>{modalTitle}</span>
            </h3>
            <p className="text-xs text-neutral-400 mt-0.5 font-mono">{activeTargetItem.path}</p>
          </div>

          <div className="flex items-center gap-2">
            {canSwap && (
              <button
                onClick={() => {
                  setSwapped((s) => !s);
                  setConfirmDelete(false);
                }}
                className="px-2.5 py-1.5 rounded-lg bg-[#262626] hover:bg-[#303030] border border-[#3a3a3a] text-xs text-neutral-200 flex items-center gap-1.5 transition"
                title="Swap which file is kept as Canonical vs treated as Duplicate"
              >
                <ArrowLeftRight className="w-3.5 h-3.5 text-sky-400" />
                <span>Swap Keep / Target</span>
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-[#2a2a2a] text-neutral-400 hover:text-neutral-100 transition"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Status Summary Banner */}
          {isHealthyOrCanonical && (
            <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-200 flex items-center gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>
                This document is in a <strong>{item.status}</strong> state ({item.wordCount} words,{' '}
                {item.incomingLinksCount} incoming link{item.incomingLinksCount === 1 ? '' : 's'}).
                Destructive or duplicate actions are disabled to protect healthy project docs.
              </span>
            </div>
          )}

          {item.status === 'stale' && (
            <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-200 space-y-1.5">
              <div className="font-semibold flex items-center gap-1.5">
                <Clock className="w-4 h-4 text-amber-400" />
                <span>Why this file is marked Stale:</span>
              </div>
              <ul className="list-disc list-inside space-y-0.5 text-amber-200/90">
                {item.issues.map((iss, i) => (
                  <li key={i}>{iss}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Reference Guard Warning (only when considering archive/delete on non-healthy docs) */}
          {!isHealthyOrCanonical && hasIncomingRefs && (
            <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/40 text-xs text-amber-200 space-y-1">
              <div className="font-semibold flex items-center gap-1.5">
                <Link2 className="w-4 h-4 text-amber-400" />
                <span>
                  Active References Detected ({activeTargetItem.incomingLinksCount} file
                  {activeTargetItem.incomingLinksCount > 1 ? 's' : ''} link to this path)
                </span>
              </div>
              <p className="text-amber-200/85">
                Referenced by:{' '}
                <span className="font-mono">{activeTargetItem.referencedByFiles.join(', ')}</span>.
                Prefer <strong>Mark Deprecated In-Place</strong> so existing links do not break.
              </p>
            </div>
          )}

          {/* Preview: Side-by-Side ONLY for Duplicates; Single Preview for all other states */}
          <div
            className={`grid gap-4 ${
              isDuplicateMode && canonicalFile && activeCanonicalItem
                ? 'grid-cols-1 md:grid-cols-2'
                : 'grid-cols-1'
            }`}
          >
            {isDuplicateMode && canonicalFile && activeCanonicalItem && (
              <div className="rounded-xl bg-[#161616] border border-emerald-500/30 flex flex-col overflow-hidden">
                <div className="px-4 py-2.5 bg-emerald-500/10 border-b border-emerald-500/20 flex items-center justify-between">
                  <span className="text-xs font-semibold text-emerald-300">Keep as Canonical</span>
                  <span className="text-[10px] font-mono text-emerald-300/80">
                    Confidence Score {activeCanonicalItem.canonicalScore}
                  </span>
                </div>
                <div className="px-4 py-2 border-b border-[#252525] text-[11px] text-neutral-400 space-y-0.5">
                  <div className="font-mono text-neutral-200 truncate">{activeCanonicalItem.path}</div>
                  <div>
                    {activeCanonicalItem.wordCount} words • {activeCanonicalItem.incomingLinksCount}{' '}
                    incoming links
                    {activeCanonicalItem.lastModifiedMs
                      ? ` • Updated ${new Date(activeCanonicalItem.lastModifiedMs).toLocaleDateString()}`
                      : ''}
                  </div>
                </div>
                <pre className="p-4 text-[11px] text-neutral-300 font-mono whitespace-pre-wrap max-h-60 overflow-y-auto leading-relaxed">
                  {canonicalFile.content.slice(0, 1800)}
                </pre>
              </div>
            )}

            <div className="rounded-xl bg-[#161616] border border-[#2f2f2f] flex flex-col overflow-hidden">
              <div className="px-4 py-2.5 bg-[#222] border-b border-[#2f2f2f] flex items-center justify-between">
                <span className="text-xs font-semibold text-neutral-200">
                  {isDuplicateMode ? 'Candidate Duplicate (Target)' : 'Document Preview'}
                </span>
                <span className="text-[10px] font-mono text-neutral-400">
                  {activeTargetItem.category} • {activeTargetItem.wordCount} words
                </span>
              </div>
              <div className="px-4 py-2 border-b border-[#252525] text-[11px] text-neutral-400 space-y-0.5">
                <div className="font-mono text-neutral-200 truncate">{activeTargetItem.path}</div>
                <div>
                  {activeTargetItem.incomingLinksCount} incoming links
                  {activeTargetItem.lastModifiedMs
                    ? ` • Updated ${new Date(activeTargetItem.lastModifiedMs).toLocaleDateString()}`
                    : ''}
                </div>
              </div>
              <pre className="p-4 text-[11px] text-neutral-300 font-mono whitespace-pre-wrap max-h-60 overflow-y-auto leading-relaxed">
                {targetFile.content.slice(0, 1800)}
              </pre>
            </div>
          </div>

          {/* State-Specific Actions */}
          <div className="space-y-3 pt-2 border-t border-[#2a2a2a]">
            <div className="text-xs font-semibold text-neutral-200 uppercase tracking-wider">
              Recommended Actions for <span className="text-sky-300">{item.status.toUpperCase()}</span> State
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              {/* Always available: Open in Editor */}
              <button
                disabled={busy}
                onClick={() => {
                  onOpenInEditor(targetFile.id);
                  onClose();
                }}
                className="px-3.5 py-2 rounded-lg bg-sky-500/20 hover:bg-sky-500/30 border border-sky-500/40 text-sky-200 text-xs font-medium flex items-center gap-2 transition"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Open in Editor</span>
              </button>

              {/* STALE actions: Auto-fix port/SDK drift & touch updated_at */}
              {item.status === 'stale' && onAutoFixStale && (
                <button
                  disabled={busy}
                  onClick={() => runAction(() => onAutoFixStale(targetFile))}
                  className="px-3.5 py-2 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-200 text-xs font-medium flex items-center gap-2 transition disabled:opacity-50"
                >
                  <Wrench className="w-3.5 h-3.5" />
                  <span>
                    Auto-Sync Drift &amp; Mark Reviewed
                    {stackProfile.localPort ? ` (Port :${stackProfile.localPort})` : ''}
                  </span>
                </button>
              )}

              {/* ORPHAN actions: Link in README.md */}
              {item.status === 'orphan' && onLinkOrphanInReadme && (
                <button
                  disabled={busy}
                  onClick={() => runAction(() => onLinkOrphanInReadme(targetFile))}
                  className="px-3.5 py-2 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-200 text-xs font-medium flex items-center gap-2 transition disabled:opacity-50"
                >
                  <Link className="w-3.5 h-3.5" />
                  <span>Add Link in README.md (Adopt Doc)</span>
                </button>
              )}

              {/* DEPRECATED action: Restore to Active */}
              {item.status === 'deprecated' && onRestoreActive && (
                <button
                  disabled={busy}
                  onClick={() => runAction(() => onRestoreActive(targetFile))}
                  className="px-3.5 py-2 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-200 text-xs font-medium flex items-center gap-2 transition disabled:opacity-50"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Restore to Active Status</span>
                </button>
              )}

              {/* DUPLICATE: Keep Both (Mark as Scoped Module Doc) */}
              {item.status === 'duplicate' && onMarkScopedDoc && (
                <button
                  disabled={busy}
                  onClick={() => runAction(() => onMarkScopedDoc(targetFile))}
                  className="px-3.5 py-2 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-200 text-xs font-medium flex items-center gap-2 transition disabled:opacity-50"
                  title="Marks frontmatter scope: module so unrelated submodule READMEs are never flagged as duplicates"
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>Keep Both (Mark as Module Doc)</span>
                </button>
              )}

              {/* DUPLICATE / DEPRECATED / ORPHAN: Archive to _archive/ */}
              {(item.status === 'duplicate' ||
                item.status === 'deprecated' ||
                item.status === 'orphan') && (
                <button
                  disabled={busy}
                  onClick={() => runAction(() => onArchiveFile(targetFile))}
                  className="px-3.5 py-2 rounded-lg bg-indigo-500/20 hover:bg-indigo-500/30 border border-indigo-500/40 text-indigo-200 text-xs font-medium flex items-center gap-2 transition disabled:opacity-50"
                >
                  <Archive className="w-3.5 h-3.5" />
                  <span>Move to _archive/ (Safe &amp; Reversible)</span>
                </button>
              )}

              {/* DUPLICATE / STALE: Mark Deprecated In-Place */}
              {(item.status === 'duplicate' || item.status === 'stale') && (
                <button
                  disabled={busy}
                  onClick={() =>
                    runAction(() => onMarkDeprecated(targetFile, activeCanonicalItem?.path))
                  }
                  className="px-3.5 py-2 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-200 text-xs font-medium flex items-center gap-2 transition disabled:opacity-50"
                >
                  <FileWarning className="w-3.5 h-3.5" />
                  <span>Mark Deprecated In-Place (Keep Path)</span>
                </button>
              )}

              {isLocalFolder && targetFile.fullPath && (
                <button
                  disabled={busy}
                  onClick={() => onRevealInExplorer(targetFile)}
                  className="px-3.5 py-2 rounded-lg bg-[#262626] hover:bg-[#303030] border border-[#3a3a3a] text-neutral-200 text-xs font-medium flex items-center gap-2 transition"
                >
                  <FolderOpen className="w-3.5 h-3.5" />
                  <span>Reveal in Explorer</span>
                </button>
              )}
            </div>

            {/* Guarded Permanent Delete ONLY for duplicate, deprecated, or orphan */}
            {allowDestructiveDelete && (
              <div className="mt-3 p-3 rounded-xl bg-rose-950/20 border border-rose-500/25 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <label className="flex items-center gap-2 text-xs text-rose-200/90 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={confirmDelete}
                    onChange={(e) => setConfirmDelete(e.target.checked)}
                    className="rounded border-rose-500/50 bg-[#1a1a1a]"
                  />
                  <span>
                    I have verified <code className="font-mono text-rose-300">{activeTargetItem.path}</code>{' '}
                    is not needed and want to permanently delete it
                  </span>
                </label>

                <button
                  disabled={!confirmDelete || busy}
                  onClick={() => runAction(() => onDeleteFile(targetFile))}
                  className="px-3 py-1.5 rounded-lg bg-rose-600/80 hover:bg-rose-600 text-white text-xs font-medium flex items-center gap-1.5 transition disabled:opacity-35 disabled:cursor-not-allowed shrink-0"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Delete Permanently</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
