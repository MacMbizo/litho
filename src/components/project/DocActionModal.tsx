import React, { useEffect, useMemo, useState } from 'react';
import {
  X,
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
  Link,
  Play,
  Tag,
  Loader2,
} from 'lucide-react';
import { MarkdownFile } from '../../types/document';
import { DetectedStackProfile, DocInventoryItem } from '../../types/docAudit';
import { applyDriftFixes } from '../../services/docRemediation';
import { DocPassportBadge, STATUS_META } from './docPassport';

export interface DocActionHandlers {
  onArchiveFile: (file: MarkdownFile) => Promise<void>;
  onMarkDeprecated: (file: MarkdownFile, supersededByPath?: string) => Promise<void>;
  onRestoreActive: (file: MarkdownFile) => Promise<void>;
  onAutoFixStale: (file: MarkdownFile) => Promise<void>;
  onLinkOrphanInReadme: (file: MarkdownFile) => Promise<void>;
  onMarkScopedDoc: (file: MarkdownFile) => Promise<void>;
  onClearScope: (file: MarkdownFile) => Promise<void>;
  onDeleteFile: (file: MarkdownFile) => Promise<void>;
  onRunAgent: (fileId: string) => void;
  onRevealInExplorer: (file: MarkdownFile) => void;
}

interface DocActionModalProps {
  item: DocInventoryItem;
  canonicalItem?: DocInventoryItem;
  files: MarkdownFile[];
  stackProfile: DetectedStackProfile;
  isLocalFolder: boolean;
  onClose: () => void;
  onOpenInEditor: (fileId: string) => void;
  actions: DocActionHandlers;
}

const BTN = 'px-3.5 py-2 rounded-lg border text-xs font-medium flex items-center gap-2 transition disabled:opacity-50 disabled:cursor-not-allowed';
const BTN_PRIMARY = `${BTN} bg-emerald-500/20 hover:bg-emerald-500/30 border-emerald-500/40 text-emerald-200`;
const BTN_INFO = `${BTN} bg-sky-500/20 hover:bg-sky-500/30 border-sky-500/40 text-sky-200`;
const BTN_ARCHIVE = `${BTN} bg-indigo-500/20 hover:bg-indigo-500/30 border-indigo-500/40 text-indigo-200`;
const BTN_WARN = `${BTN} bg-amber-500/20 hover:bg-amber-500/30 border-amber-500/40 text-amber-200`;
const BTN_NEUTRAL = `${BTN} bg-[#262626] hover:bg-[#303030] border-[#3a3a3a] text-neutral-200`;

const MODAL_TITLES: Record<DocInventoryItem['status'], string> = {
  duplicate: 'Duplicate Comparison & Safe Resolution',
  stale: 'Stale Document Review & Drift Fix',
  deprecated: 'Deprecated Document Cleanup',
  orphan: 'Orphan / Unlinked Note Actions',
  'module-doc': 'Scoped Module Document',
  'agent-system': 'Agent / Skill Specification',
  canonical: 'Canonical Document',
  healthy: 'Healthy Document',
};

export const DocActionModal: React.FC<DocActionModalProps> = ({
  item,
  canonicalItem,
  files,
  stackProfile,
  isLocalFolder,
  onClose,
  onOpenInEditor,
  actions,
}) => {
  const [swapped, setSwapped] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busyAction) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busyAction]);

  const isDuplicateMode = item.status === 'duplicate' && Boolean(canonicalItem);
  const canSwap = Boolean(isDuplicateMode && canonicalItem && canonicalItem.fileId !== item.fileId);
  const activeTargetItem = swapped && canonicalItem ? canonicalItem : item;
  const activeCanonicalItem = swapped && canonicalItem ? item : canonicalItem;

  const targetFile = files.find((f) => f.id === activeTargetItem.fileId);
  const canonicalFile =
    isDuplicateMode && activeCanonicalItem ? files.find((f) => f.id === activeCanonicalItem.fileId) : undefined;

  // Preview exactly what Auto-Sync will change before the user commits.
  const driftPreview = useMemo(
    () => (targetFile && item.status === 'stale' ? applyDriftFixes(targetFile.body, stackProfile).changes : []),
    [targetFile, item.status, stackProfile]
  );

  if (!targetFile) return null;

  const status = item.status;
  const busy = busyAction !== null;
  const hasIncomingRefs = activeTargetItem.incomingLinksCount > 0;
  const isProtected = status === 'canonical' || status === 'healthy' || status === 'agent-system' || status === 'module-doc';
  const allowDestructive = status === 'duplicate' || status === 'deprecated' || status === 'orphan';
  const isArchived = /^_archive\//i.test(targetFile.path);

  const run = (key: string, fn: () => Promise<void>) => async () => {
    setBusyAction(key);
    try {
      await fn();
      onClose();
    } finally {
      setBusyAction(null);
    }
  };

  const ActionIcon: React.FC<{ k: string; Icon: React.ComponentType<{ className?: string }> }> = ({ k, Icon }) =>
    busyAction === k ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Icon className="w-3.5 h-3.5" />;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={MODAL_TITLES[status]}
    >
      <div className="w-full max-w-4xl max-h-[90vh] bg-[#1c1c1c] border border-[#323232] rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-[#2b2b2b] flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-neutral-100 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-sky-400 shrink-0" />
              <span className="truncate">{MODAL_TITLES[status]}</span>
              <DocPassportBadge item={item} detailed />
            </h3>
            <p className="text-xs text-neutral-400 mt-0.5 font-mono truncate">{activeTargetItem.path}</p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {canSwap && (
              <button
                onClick={() => {
                  setSwapped((s) => !s);
                  setConfirmDelete(false);
                }}
                disabled={busy}
                className="px-2.5 py-1.5 rounded-lg bg-[#262626] hover:bg-[#303030] border border-[#3a3a3a] text-xs text-neutral-200 flex items-center gap-1.5 transition"
                title="Swap which file is kept as canonical and which is treated as the duplicate"
              >
                <ArrowLeftRight className="w-3.5 h-3.5 text-sky-400" />
                <span>Swap Keep / Target</span>
              </button>
            )}
            <button
              onClick={onClose}
              disabled={busy}
              aria-label="Close"
              className="p-1.5 rounded-lg hover:bg-[#2a2a2a] text-neutral-400 hover:text-neutral-100 transition"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Why this passport */}
          {isProtected ? (
            <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-200 flex items-start gap-2.5">
              {React.createElement(STATUS_META[status].Icon, { className: 'w-4 h-4 text-emerald-400 shrink-0 mt-0.5' })}
              <span>
                {STATUS_META[status].description} {item.wordCount} words · {item.incomingLinksCount} incoming link
                {item.incomingLinksCount === 1 ? '' : 's'}. Destructive actions are hidden to protect this document.
              </span>
            </div>
          ) : (
            item.issues.length > 0 && (
              <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-200 space-y-1.5">
                <div className="font-semibold">Why this file is marked {STATUS_META[status].label}:</div>
                <ul className="list-disc list-inside space-y-0.5 text-amber-200/90">
                  {item.issues.map((iss, i) => (
                    <li key={i}>{iss}</li>
                  ))}
                </ul>
              </div>
            )
          )}

          {/* Reference guard */}
          {!isProtected && hasIncomingRefs && (
            <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/40 text-xs text-amber-200 space-y-1">
              <div className="font-semibold flex items-center gap-1.5">
                <Link2 className="w-4 h-4 text-amber-400" />
                <span>
                  {activeTargetItem.incomingLinksCount} file{activeTargetItem.incomingLinksCount > 1 ? 's' : ''} link to this
                  path
                </span>
              </div>
              <p className="text-amber-200/85">
                Referenced by <span className="font-mono">{activeTargetItem.referencedByFiles.join(', ')}</span>. Prefer{' '}
                <strong>Mark Deprecated In-Place</strong> so those links keep working.
              </p>
            </div>
          )}

          {/* Previews: side by side for duplicates, single otherwise */}
          <div className={`grid gap-4 ${isDuplicateMode && canonicalFile ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1'}`}>
            {isDuplicateMode && canonicalFile && activeCanonicalItem && (
              <div className="rounded-xl bg-[#161616] border border-emerald-500/30 flex flex-col overflow-hidden">
                <div className="px-4 py-2.5 bg-emerald-500/10 border-b border-emerald-500/20 flex items-center justify-between">
                  <span className="text-xs font-semibold text-emerald-300">Keep as Canonical</span>
                  <span className="text-[10px] font-mono text-emerald-300/80">
                    Authority score {activeCanonicalItem.canonicalScore}
                  </span>
                </div>
                <div className="px-4 py-2 border-b border-[#252525] text-[11px] text-neutral-400 space-y-0.5">
                  <div className="font-mono text-neutral-200 truncate">{activeCanonicalItem.path}</div>
                  <div>
                    {activeCanonicalItem.wordCount} words · {activeCanonicalItem.incomingLinksCount} incoming links
                    {activeCanonicalItem.lastModifiedMs
                      ? ` · Updated ${new Date(activeCanonicalItem.lastModifiedMs).toLocaleDateString()}`
                      : ''}
                  </div>
                </div>
                <pre className="p-4 text-[11px] text-neutral-300 font-mono whitespace-pre-wrap max-h-60 overflow-y-auto leading-relaxed">
                  {canonicalFile.content.slice(0, 2400)}
                </pre>
              </div>
            )}

            <div className="rounded-xl bg-[#161616] border border-[#2f2f2f] flex flex-col overflow-hidden">
              <div className="px-4 py-2.5 bg-[#222] border-b border-[#2f2f2f] flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-neutral-200">
                  {isDuplicateMode ? 'Candidate Duplicate (Target)' : 'Document Preview'}
                </span>
                <span className="text-[10px] font-mono text-neutral-400">
                  {activeTargetItem.category} · {activeTargetItem.wordCount} words
                  {isDuplicateMode && item.similarityScore !== undefined ? ` · ${item.similarityScore}% overlap` : ''}
                </span>
              </div>
              <div className="px-4 py-2 border-b border-[#252525] text-[11px] text-neutral-400 space-y-0.5">
                <div className="font-mono text-neutral-200 truncate">{activeTargetItem.path}</div>
                <div>
                  {activeTargetItem.incomingLinksCount} incoming links
                  {activeTargetItem.lastModifiedMs
                    ? ` · Updated ${new Date(activeTargetItem.lastModifiedMs).toLocaleDateString()}`
                    : ''}
                </div>
              </div>
              <pre className="p-4 text-[11px] text-neutral-300 font-mono whitespace-pre-wrap max-h-60 overflow-y-auto leading-relaxed">
                {targetFile.content.slice(0, 2400)}
              </pre>
            </div>
          </div>

          {status === 'stale' && driftPreview.length > 0 && (
            <div className="p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/25 text-[11px] text-emerald-200/90">
              <span className="font-semibold text-emerald-300">Auto-Sync will change: </span>
              <span className="font-mono">{driftPreview.join(' · ')}</span>
              <span className="text-emerald-200/60"> and set updated_at to today.</span>
            </div>
          )}

          {/* State-specific actions */}
          <div className="space-y-3 pt-2 border-t border-[#2a2a2a]">
            <div className="text-xs font-semibold text-neutral-200 uppercase tracking-wider">
              Actions for <span className="text-sky-300">{STATUS_META[status].label}</span>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <button
                disabled={busy}
                onClick={() => {
                  onOpenInEditor(targetFile.id);
                  onClose();
                }}
                className={BTN_INFO}
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Open in Editor</span>
              </button>

              {status === 'agent-system' && (
                <button
                  disabled={busy}
                  onClick={() => {
                    actions.onRunAgent(targetFile.id);
                    onClose();
                  }}
                  className={`${BTN} bg-purple-500/20 hover:bg-purple-500/30 border-purple-500/40 text-purple-200`}
                >
                  <Play className="w-3.5 h-3.5" />
                  <span>Run in Agent Playground</span>
                </button>
              )}

              {status === 'module-doc' && targetFile.frontmatter.scope === 'module' && (
                <button
                  disabled={busy}
                  onClick={run('scope', () => actions.onClearScope(targetFile))}
                  className={BTN_NEUTRAL}
                  title="Removes `scope: module` so the document is compared against the canonical doc again"
                >
                  <ActionIcon k="scope" Icon={Tag} />
                  <span>Edit Scope (Remove Module Flag)</span>
                </button>
              )}

              {status === 'stale' && (
                <button disabled={busy} onClick={run('sync', () => actions.onAutoFixStale(targetFile))} className={BTN_PRIMARY}>
                  <ActionIcon k="sync" Icon={Wrench} />
                  <span>{driftPreview.length > 0 ? 'Auto-Sync Drift & Mark Reviewed' : 'Mark Reviewed Today'}</span>
                </button>
              )}

              {status === 'orphan' && (
                <button disabled={busy} onClick={run('adopt', () => actions.onLinkOrphanInReadme(targetFile))} className={BTN_PRIMARY}>
                  <ActionIcon k="adopt" Icon={Link} />
                  <span>Add Link in README.md (Adopt Doc)</span>
                </button>
              )}

              {status === 'deprecated' && (
                <button disabled={busy} onClick={run('restore', () => actions.onRestoreActive(targetFile))} className={BTN_PRIMARY}>
                  <ActionIcon k="restore" Icon={RotateCcw} />
                  <span>{isArchived ? 'Restore from _archive/ to Active' : 'Restore to Active Status'}</span>
                </button>
              )}

              {status === 'duplicate' && (
                <button
                  disabled={busy}
                  onClick={run('keep', () => actions.onMarkScopedDoc(targetFile))}
                  className={BTN_PRIMARY}
                  title="Sets `scope: module` in frontmatter so this file is never flagged as a duplicate again"
                >
                  <ActionIcon k="keep" Icon={ShieldCheck} />
                  <span>Keep Both (Mark as Module Doc)</span>
                </button>
              )}

              {allowDestructive && !isArchived && (
                <button disabled={busy} onClick={run('archive', () => actions.onArchiveFile(targetFile))} className={BTN_ARCHIVE}>
                  <ActionIcon k="archive" Icon={Archive} />
                  <span>Move to _archive/ (Reversible)</span>
                </button>
              )}

              {(status === 'duplicate' || status === 'stale') && (
                <button
                  disabled={busy}
                  onClick={run('deprecate', () =>
                    actions.onMarkDeprecated(targetFile, status === 'duplicate' ? activeCanonicalItem?.path : undefined)
                  )}
                  className={BTN_WARN}
                >
                  <ActionIcon k="deprecate" Icon={FileWarning} />
                  <span>Mark Deprecated In-Place (Keep Path)</span>
                </button>
              )}

              {isLocalFolder && targetFile.fullPath && (
                <button disabled={busy} onClick={() => actions.onRevealInExplorer(targetFile)} className={BTN_NEUTRAL}>
                  <FolderOpen className="w-3.5 h-3.5" />
                  <span>Reveal in Explorer</span>
                </button>
              )}
            </div>

            {/* Guarded permanent delete: duplicates, deprecated and orphans only */}
            {allowDestructive && (
              <div className="mt-3 p-3 rounded-xl bg-rose-950/20 border border-rose-500/25 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <label className="flex items-center gap-2 text-xs text-rose-200/90 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={confirmDelete}
                    onChange={(e) => setConfirmDelete(e.target.checked)}
                    className="rounded border-rose-500/50 bg-[#1a1a1a]"
                  />
                  <span>
                    I have verified <code className="font-mono text-rose-300">{activeTargetItem.path}</code> is not needed
                    and want to delete it permanently
                  </span>
                </label>

                <button
                  disabled={!confirmDelete || busy}
                  onClick={run('delete', () => actions.onDeleteFile(targetFile))}
                  className="px-3 py-1.5 rounded-lg bg-rose-600/80 hover:bg-rose-600 text-white text-xs font-medium flex items-center gap-1.5 transition disabled:opacity-35 disabled:cursor-not-allowed shrink-0"
                >
                  <ActionIcon k="delete" Icon={Trash2} />
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
