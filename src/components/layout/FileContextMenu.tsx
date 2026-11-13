import React, { useEffect, useRef } from 'react';
import { 
  FilePlus, 
  FolderPlus, 
  Edit3, 
  Trash2, 
  ExternalLink, 
  Sparkles, 
  Layers,
  Unlink,
} from 'lucide-react';
import { FileTreeNode } from '../../types/document';
import { ProjectScannerService } from '../../services/projectScanner';
import { ELSEWHERE_PREFIX, isElsewhereId } from '../../services/notesWorkspace';

export interface ContextMenuState {
  x: number;
  y: number;
  node: FileTreeNode;
}

interface FileContextMenuProps {
  menu: ContextMenuState | null;
  onClose: () => void;
  onNewFile: (parentFolderNode: FileTreeNode) => void;
  onNewFolder: (parentFolderNode: FileTreeNode) => void;
  onRename: (node: FileTreeNode) => void;
  onDelete: (node: FileTreeNode) => void;
  onAIAssist?: (node: FileTreeNode) => void;
}

export const FileContextMenu: React.FC<FileContextMenuProps> = ({
  menu,
  onClose,
  onNewFile,
  onNewFolder,
  onRename,
  onDelete,
  onAIAssist,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    window.addEventListener('mousedown', handleOutsideClick);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handleOutsideClick);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  if (!menu) return null;

  const { x, y, node } = menu;
  const isElectron = ProjectScannerService.isElectron();
  // Files opened from elsewhere are only listed in Notes: "remove" forgets them, never deletes them.
  const isElsewhere = isElsewhereId(node.id);
  const isVirtualFolder = node.id === ELSEWHERE_PREFIX;

  // Keep menu within screen boundaries
  const adjustedX = Math.min(x, window.innerWidth - 220);
  const adjustedY = Math.min(y, window.innerHeight - 260);

  return (
    <div
      ref={menuRef}
      style={{ top: `${adjustedY}px`, left: `${adjustedX}px` }}
      className="fixed z-50 w-52 bg-[#222222] border border-[#383838] rounded-xl shadow-2xl py-1 text-xs text-neutral-200 font-sans select-none"
    >
      <div className="px-3 py-1.5 text-[10px] uppercase font-semibold text-neutral-500 border-b border-[#2e2e2e] truncate">
        {node.name}
      </div>

      <div className="p-1 space-y-0.5">
        {/* If it's a folder: New File / Subfolder */}
        {node.isFolder && !isVirtualFolder && (
          <>
            <button
              onClick={() => {
                onNewFile(node);
                onClose();
              }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-[#2e2e2e] hover:text-white transition text-left"
            >
              <FilePlus className="w-3.5 h-3.5 text-blue-400" />
              <span>New File in Folder</span>
            </button>
            <button
              onClick={() => {
                onNewFolder(node);
                onClose();
              }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-[#2e2e2e] hover:text-white transition text-left"
            >
              <FolderPlus className="w-3.5 h-3.5 text-amber-400" />
              <span>New Subfolder</span>
            </button>
            <div className="h-[1px] bg-[#2e2e2e] my-1" />
          </>
        )}

        {/* If it's a file: AI assist */}
        {!node.isFolder && onAIAssist && (
          <button
            onClick={() => {
              onAIAssist(node);
              onClose();
            }}
            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-[#2e2e2e] text-purple-300 hover:text-purple-200 transition text-left"
          >
            <Sparkles className="w-3.5 h-3.5 text-purple-400" />
            <span>AI Summarize & Tag</span>
          </button>
        )}

        {/* Rename */}
        {!isVirtualFolder && (
        <button
          onClick={() => {
            onRename(node);
            onClose();
          }}
          className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-[#2e2e2e] hover:text-white transition text-left"
        >
          <Edit3 className="w-3.5 h-3.5 text-neutral-400" />
          <span>Rename</span>
        </button>
        )}

        {/* Reveal in explorer (Electron only) */}
        {isElectron && node.fullPath && (
          <button
            onClick={() => {
              ProjectScannerService.revealInExplorer(node.fullPath!);
              onClose();
            }}
            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-[#2e2e2e] hover:text-white transition text-left"
          >
            <ExternalLink className="w-3.5 h-3.5 text-neutral-400" />
            <span>Reveal in File Explorer</span>
          </button>
        )}

        <div className="h-[1px] bg-[#2e2e2e] my-1" />

        {/* Delete (or, for files opened from elsewhere, just stop listing them) */}
        {isElsewhere ? (
          <button
            onClick={() => {
              onDelete(node);
              onClose();
            }}
            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-[#2e2e2e] hover:text-white transition text-left"
            title="The file stays where it is on disk"
          >
            <Unlink className="w-3.5 h-3.5 text-neutral-400" />
            <span>{isVirtualFolder ? 'Remove all from Notes' : 'Remove from Notes'}</span>
          </button>
        ) : (
        <button
          onClick={() => {
            onDelete(node);
            onClose();
          }}
          className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-rose-950/40 text-rose-400 hover:text-rose-300 transition text-left"
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span>Delete</span>
        </button>
        )}
      </div>
    </div>
  );
};
