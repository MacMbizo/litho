import React, { useState, useRef, useEffect } from 'react';
import { 
  Bold, 
  Italic, 
  Strikethrough, 
  Code, 
  List, 
  CheckSquare, 
  Heading1, 
  Heading2, 
  Heading3, 
  Quote, 
  Table, 
  Copy, 
  Check, 
  Sparkles,
  Link,
  Info,
  Sliders,
  Eye,
  Code2,
  FileText
} from 'lucide-react';
import { MarkdownFile } from '../../types/document';
import { FrontmatterMeta } from './FrontmatterMeta';
import { SlashMenu, SlashMenuItem } from './SlashMenu';
import { FloatingSelectionToolbar } from './FloatingSelectionToolbar';
import { BacklinksPanel } from './BacklinksPanel';
import { MarkdownService } from '../../services/markdown';

interface NotionEditorProps {
  file: MarkdownFile;
  onChange: (updatedContent: string, updatedFrontmatter?: any) => void;
  isRawMarkdown: boolean;
  onOpenAIModal?: () => void;
  allFiles?: MarkdownFile[];
  onSelectFile?: (id: string) => void;
}

export const NotionEditor: React.FC<NotionEditorProps> = ({
  file,
  onChange,
  isRawMarkdown,
  onOpenAIModal,
  allFiles,
  onSelectFile,
}) => {
  const [slashMenuOpen, setSlashMenuOpen] = useState(false);
  const [slashQuery, setSlashQuery] = useState('');
  const [slashPos, setSlashPos] = useState({ top: 0, left: 0 });
  const [selectionPos, setSelectionPos] = useState<{ top: number; left: number } | null>(null);
  const [copiedCodeIndex, setCopiedCodeIndex] = useState<number | null>(null);
  const [editorMode, setEditorMode] = useState<'visual' | 'split'>('visual');

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const editorContainerRef = useRef<HTMLDivElement>(null);

  // Sync frontmatter changes
  const handleFrontmatterChange = (newMetadata: any) => {
    const fullMarkdown = MarkdownService.stringify(newMetadata, file.body);
    onChange(fullMarkdown, newMetadata);
  };

  // Sync body changes
  const handleBodyChange = (newBody: string) => {
    const fullMarkdown = MarkdownService.stringify(file.frontmatter, newBody);
    onChange(fullMarkdown, file.frontmatter);
  };

  // Toggle checklist checkbox directly inside markdown
  const handleToggleTask = (lineIndex: number, currentStatus: boolean) => {
    const lines = file.body.split('\n');
    if (lineIndex < 0 || lineIndex >= lines.length) return;

    const taskRegex = /^(\s*-\s*\[)([ xX])(\]\s*.+)$/;
    const match = lines[lineIndex].match(taskRegex);
    if (match) {
      lines[lineIndex] = `${match[1]}${currentStatus ? ' ' : 'x'}${match[3]}`;
      handleBodyChange(lines.join('\n'));
    }
  };

  // Text selection detection for floating toolbar
  const handleSelectText = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;

    if (start !== end && end - start > 1) {
      const rect = textarea.getBoundingClientRect();
      // Calculate approximate position near cursor
      const textUpToCursor = textarea.value.slice(0, start);
      const lines = textUpToCursor.split('\n');
      const lineNum = lines.length;
      const lineHeight = 24; // approximate line height

      const top = Math.max(rect.top + 60, Math.min(rect.top + lineNum * lineHeight, rect.bottom - 40));
      const left = Math.min(Math.max(rect.left + 200, 240), window.innerWidth - 240);

      setSelectionPos({ top, left });
    } else {
      setSelectionPos(null);
    }
  };

  // Insert block or text formatting
  const insertTextAtCursor = (prefix: string, suffix: string = '') => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;
    const selected = text.substring(start, end);

    const replacement = `${prefix}${selected}${suffix}`;
    const nextBody = text.substring(0, start) + replacement + text.substring(end);

    handleBodyChange(nextBody);
    setSelectionPos(null);

    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + prefix.length, end + prefix.length);
    }, 10);
  };

  // Handle Slash Command Selection
  const handleSlashSelect = (item: SlashMenuItem) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const cursor = textarea.selectionStart;
    const textBefore = file.body.substring(0, cursor);
    const lastSlash = textBefore.lastIndexOf('/');

    if (lastSlash !== -1) {
      const newBody = file.body.substring(0, lastSlash) + item.insertText + file.body.substring(cursor);
      handleBodyChange(newBody);
      setTimeout(() => {
        textarea.focus();
        const nextPos = lastSlash + item.insertText.length;
        textarea.setSelectionRange(nextPos, nextPos);
      }, 10);
    }
    setSlashMenuOpen(false);
  };

  // Keyboard shortcut & slash detector
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const textarea = e.currentTarget;
    const cursor = textarea.selectionStart;

    // Detect Slash `/`
    if (e.key === '/') {
      const rect = textarea.getBoundingClientRect();
      setSlashPos({
        top: Math.min(rect.top + 80, window.innerHeight - 320),
        left: Math.min(rect.left + 80, window.innerWidth - 320),
      });
      setSlashQuery('');
      setSlashMenuOpen(true);
      return;
    }

    if (slashMenuOpen) {
      if (e.key === 'Escape') {
        setSlashMenuOpen(false);
      } else if (e.key === 'Backspace') {
        if (slashQuery.length > 0) {
          setSlashQuery((prev) => prev.slice(0, -1));
        } else {
          setSlashMenuOpen(false);
        }
      } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
        setSlashQuery((prev) => prev + e.key);
      }
    }

    // Ctrl+B (Bold)
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
      e.preventDefault();
      insertTextAtCursor('**', '**');
      return;
    }

    // Ctrl+I (Italic)
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'i') {
      e.preventDefault();
      insertTextAtCursor('*', '*');
      return;
    }

    // Tab / Shift+Tab for Indentation
    if (e.key === 'Tab') {
      e.preventDefault();
      const text = textarea.value;
      const currentLineStart = text.lastIndexOf('\n', cursor - 1) + 1;

      if (e.shiftKey) {
        // Outdent 2 spaces if present
        if (text.substring(currentLineStart, currentLineStart + 2) === '  ') {
          const newBody = text.substring(0, currentLineStart) + text.substring(currentLineStart + 2);
          handleBodyChange(newBody);
          setTimeout(() => {
            textarea.setSelectionRange(Math.max(cursor - 2, currentLineStart), Math.max(cursor - 2, currentLineStart));
          }, 10);
        }
      } else {
        // Indent 2 spaces
        const newBody = text.substring(0, currentLineStart) + '  ' + text.substring(currentLineStart);
        handleBodyChange(newBody);
        setTimeout(() => {
          textarea.setSelectionRange(cursor + 2, cursor + 2);
        }, 10);
      }
      return;
    }

    // Markdown Auto-Formatting shortcuts on Enter
    if (e.key === 'Enter') {
      const text = textarea.value;
      const currentLineStart = text.lastIndexOf('\n', cursor - 1) + 1;
      const currentLine = text.substring(currentLineStart, cursor);

      // Continue checklist
      const todoMatch = currentLine.match(/^(\s*)-\s*\[([ xX])\]\s*(.*)$/);
      if (todoMatch) {
        if (todoMatch[3].trim() === '') {
          // If empty checklist item, remove it on enter
          e.preventDefault();
          const newBody = text.substring(0, currentLineStart) + text.substring(cursor);
          handleBodyChange(newBody);
          return;
        }
        e.preventDefault();
        const indent = todoMatch[1] || '';
        const insert = `\n${indent}- [ ] `;
        const newBody = text.substring(0, cursor) + insert + text.substring(cursor);
        handleBodyChange(newBody);
        setTimeout(() => {
          textarea.setSelectionRange(cursor + insert.length, cursor + insert.length);
        }, 10);
        return;
      }

      // Continue bulleted list
      const bulletMatch = currentLine.match(/^(\s*)-\s+(.*)$/);
      if (bulletMatch && !bulletMatch[2].startsWith('[')) {
        if (bulletMatch[2].trim() === '') {
          e.preventDefault();
          const newBody = text.substring(0, currentLineStart) + text.substring(cursor);
          handleBodyChange(newBody);
          return;
        }
        e.preventDefault();
        const indent = bulletMatch[1] || '';
        const insert = `\n${indent}- `;
        const newBody = text.substring(0, cursor) + insert + text.substring(cursor);
        handleBodyChange(newBody);
        setTimeout(() => {
          textarea.setSelectionRange(cursor + insert.length, cursor + insert.length);
        }, 10);
        return;
      }
    }
  };

  // Copy code block contents
  const handleCopyCode = (text: string, index: number) => {
    navigator.clipboard.writeText(text);
    setCopiedCodeIndex(index);
    setTimeout(() => setCopiedCodeIndex(null), 2000);
  };

  // Render Notion-style preview blocks
  const renderRichPreview = () => {
    const lines = file.body.split('\n');
    const elements: React.ReactNode[] = [];
    let inCodeBlock = false;
    let codeBuffer: string[] = [];
    let codeLang = '';
    let codeIndex = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Code block start / end
      if (line.trim().startsWith('```')) {
        if (inCodeBlock) {
          const codeText = codeBuffer.join('\n');
          const idx = codeIndex++;
          elements.push(
            <div key={`code-${i}`} className="my-4 rounded-xl bg-[#141416] border border-[#2b2b30] overflow-hidden group">
              <div className="flex items-center justify-between px-3.5 py-1.5 bg-[#1b1b1e] border-b border-[#2b2b30] text-[11px] text-neutral-400 font-mono">
                <span>{codeLang || 'code'}</span>
                <button
                  onClick={() => handleCopyCode(codeText, idx)}
                  className="flex items-center gap-1 hover:text-white px-2 py-0.5 rounded transition"
                >
                  {copiedCodeIndex === idx ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  <span>{copiedCodeIndex === idx ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
              <pre className="p-4 text-xs font-mono text-neutral-200 overflow-x-auto leading-relaxed">
                <code>{codeText}</code>
              </pre>
            </div>
          );
          codeBuffer = [];
          inCodeBlock = false;
        } else {
          inCodeBlock = true;
          codeLang = line.trim().slice(3).trim();
          codeBuffer = [];
        }
        continue;
      }

      if (inCodeBlock) {
        codeBuffer.push(line);
        continue;
      }

      // Empty line
      if (line.trim() === '') {
        elements.push(<div key={`empty-${i}`} className="h-3" />);
        continue;
      }

      // Heading 1
      if (line.startsWith('# ')) {
        elements.push(
          <h1 key={`h1-${i}`} className="text-2xl font-bold text-neutral-100 tracking-tight mt-6 mb-2 border-b border-[#26262b] pb-2">
            {line.slice(2)}
          </h1>
        );
        continue;
      }

      // Heading 2
      if (line.startsWith('## ')) {
        elements.push(
          <h2 key={`h2-${i}`} className="text-xl font-semibold text-neutral-200 tracking-tight mt-5 mb-2">
            {line.slice(3)}
          </h2>
        );
        continue;
      }

      // Heading 3
      if (line.startsWith('### ')) {
        elements.push(
          <h3 key={`h3-${i}`} className="text-base font-medium text-neutral-300 tracking-tight mt-4 mb-1.5">
            {line.slice(4)}
          </h3>
        );
        continue;
      }

      // Checklist item (- [ ] / - [x])
      const taskMatch = line.match(/^(\s*)-\s*\[([ xX])\]\s*(.+)$/);
      if (taskMatch) {
        const isChecked = taskMatch[2].toLowerCase() === 'x';
        elements.push(
          <div
            key={`task-${i}`}
            className="flex items-start gap-2.5 my-1.5 group cursor-pointer select-none"
            onClick={() => handleToggleTask(i, isChecked)}
          >
            <div className="pt-0.5">
              <input
                type="checkbox"
                checked={isChecked}
                onChange={() => {}}
                className="w-4 h-4 rounded bg-[#242428] border border-[#444] text-emerald-500 focus:ring-0 cursor-pointer accent-emerald-500"
              />
            </div>
            <span className={`text-sm leading-relaxed transition ${
              isChecked ? 'line-through text-neutral-500' : 'text-neutral-200'
            }`}>
              {taskMatch[3]}
            </span>
          </div>
        );
        continue;
      }

      // Callout box (> ...)
      if (line.startsWith('> ')) {
        elements.push(
          <div key={`callout-${i}`} className="my-3.5 px-4 py-3 rounded-r-xl bg-[#202024] border-l-4 border-amber-500/80 text-neutral-200 text-sm flex items-start gap-3 shadow-sm">
            <Info className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div className="flex-1 leading-relaxed">
              {line.slice(2)}
            </div>
          </div>
        );
        continue;
      }

      // Bullet item (- ...)
      if (line.startsWith('- ')) {
        elements.push(
          <div key={`bullet-${i}`} className="flex items-start gap-2.5 my-1 text-sm text-neutral-200">
            <span className="text-neutral-500 mt-1 font-bold">•</span>
            <span className="leading-relaxed">{line.slice(2)}</span>
          </div>
        );
        continue;
      }

      // Standard paragraph
      elements.push(
        <p key={`p-${i}`} className="text-sm text-neutral-300 leading-relaxed my-1.5">
          {line}
        </p>
      );
    }

    return elements;
  };

  return (
    <div ref={editorContainerRef} className="flex-1 h-full overflow-y-auto bg-[#171719] font-sans">
      <div className="max-w-4xl mx-auto px-8 py-8">
        {/* Notion Style Property Header */}
        <FrontmatterMeta metadata={file.frontmatter} onChange={handleFrontmatterChange} />

        {/* Floating Quick Action Toolbar */}
        <div className="sticky top-0 z-20 mb-5 py-1.5 px-3 bg-[#202023]/90 backdrop-blur-md border border-[#303036] rounded-xl shadow-lg flex items-center gap-1 text-xs">
          <button
            onClick={() => insertTextAtCursor('**', '**')}
            className="p-1.5 rounded-lg hover:bg-[#2b2b32] text-neutral-300 hover:text-white transition"
            title="Bold (Ctrl+B)"
          >
            <Bold className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => insertTextAtCursor('*', '*')}
            className="p-1.5 rounded-lg hover:bg-[#2b2b32] text-neutral-300 hover:text-white transition"
            title="Italic (Ctrl+I)"
          >
            <Italic className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => insertTextAtCursor('~~', '~~')}
            className="p-1.5 rounded-lg hover:bg-[#2b2b32] text-neutral-300 hover:text-white transition"
            title="Strikethrough"
          >
            <Strikethrough className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => insertTextAtCursor('`', '`')}
            className="p-1.5 rounded-lg hover:bg-[#2b2b32] text-neutral-300 hover:text-white transition"
            title="Inline Code"
          >
            <Code className="w-3.5 h-3.5" />
          </button>

          <div className="w-[1px] h-4 bg-[#35353c] mx-1" />

          <button
            onClick={() => insertTextAtCursor('# ')}
            className="p-1.5 rounded-lg hover:bg-[#2b2b32] text-neutral-300 hover:text-white transition"
            title="Heading 1"
          >
            <Heading1 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => insertTextAtCursor('## ')}
            className="p-1.5 rounded-lg hover:bg-[#2b2b32] text-neutral-300 hover:text-white transition"
            title="Heading 2"
          >
            <Heading2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => insertTextAtCursor('- [ ] ')}
            className="p-1.5 rounded-lg hover:bg-[#2b2b32] text-emerald-400 hover:text-emerald-300 transition"
            title="Checklist Item"
          >
            <CheckSquare className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => insertTextAtCursor('- ')}
            className="p-1.5 rounded-lg hover:bg-[#2b2b32] text-neutral-300 hover:text-white transition"
            title="Bulleted List"
          >
            <List className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => insertTextAtCursor('> ')}
            className="p-1.5 rounded-lg hover:bg-[#2b2b32] text-amber-400 hover:text-amber-300 transition"
            title="Callout Box"
          >
            <Quote className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => insertTextAtCursor('\n```typescript\n', '\n```\n')}
            className="p-1.5 rounded-lg hover:bg-[#2b2b32] text-purple-400 hover:text-purple-300 transition"
            title="Code Block"
          >
            <Code className="w-3.5 h-3.5" />
          </button>

          <div className="w-[1px] h-4 bg-[#35353c] mx-1" />

          {/* Mode Switcher */}
          {!isRawMarkdown && (
            <div className="flex items-center gap-1 bg-[#1a1a1c] p-0.5 rounded-lg border border-[#2d2d33] ml-1">
              <button
                onClick={() => setEditorMode('visual')}
                className={`px-2 py-0.5 rounded text-[11px] font-medium transition ${
                  editorMode === 'visual' ? 'bg-[#2b2b32] text-white shadow-sm' : 'text-neutral-400 hover:text-white'
                }`}
              >
                In-Place Live
              </button>
              <button
                onClick={() => setEditorMode('split')}
                className={`px-2 py-0.5 rounded text-[11px] font-medium transition ${
                  editorMode === 'split' ? 'bg-[#2b2b32] text-white shadow-sm' : 'text-neutral-400 hover:text-white'
                }`}
              >
                Split Preview
              </button>
            </div>
          )}

          <span className="text-[11px] text-neutral-500 ml-auto hidden sm:inline font-sans">
            Type <kbd className="px-1.5 py-0.5 bg-[#18181a] rounded border border-[#35353c] text-neutral-400 font-mono text-[10px]">/</kbd> for blocks
          </span>
        </div>

        {/* Editor Body */}
        {isRawMarkdown ? (
          /* Raw Markdown Editor */
          <div className="relative">
            <textarea
              ref={textareaRef}
              value={file.body}
              onChange={(e) => handleBodyChange(e.target.value)}
              onKeyDown={handleKeyDown}
              onSelect={handleSelectText}
              onMouseUp={handleSelectText}
              placeholder="Write your markdown body here or type '/' for blocks..."
              className="w-full min-h-[600px] bg-[#141416] text-neutral-200 font-mono text-sm leading-relaxed p-5 rounded-xl border border-[#2c2c32] focus:outline-none focus:border-blue-500/50 resize-y shadow-inner"
              spellCheck={false}
            />
          </div>
        ) : editorMode === 'visual' ? (
          /* In-Place Live Notion Canvas */
          <div className="relative rounded-2xl bg-[#1d1d20]/70 border border-[#2c2c32] p-8 shadow-sm">
            <div className="mb-4 flex items-center justify-between text-[11px] text-neutral-500 pb-2 border-b border-[#28282c]">
              <span className="font-medium text-neutral-400">In-Place Notion Canvas</span>
              <span className="text-emerald-400 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Live Sync
              </span>
            </div>

            {/* Seamless Interactive Writing Surface */}
            <textarea
              ref={textareaRef}
              value={file.body}
              onChange={(e) => handleBodyChange(e.target.value)}
              onKeyDown={handleKeyDown}
              onSelect={handleSelectText}
              onMouseUp={handleSelectText}
              placeholder="Write your thoughts here, type '/' for commands or paste markdown..."
              rows={Math.max(18, file.body.split('\n').length + 4)}
              className="w-full bg-transparent text-neutral-100 font-sans text-base leading-relaxed focus:outline-none resize-none selection:bg-amber-500/20 selection:text-amber-200"
            />
          </div>
        ) : (
          /* Split Preview Mode */
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="space-y-2">
              <div className="text-[11px] text-neutral-500 font-medium">Editor Stream</div>
              <textarea
                ref={textareaRef}
                value={file.body}
                onChange={(e) => handleBodyChange(e.target.value)}
                onKeyDown={handleKeyDown}
                onSelect={handleSelectText}
                onMouseUp={handleSelectText}
                rows={22}
                className="w-full bg-[#18181a] text-neutral-200 font-sans text-sm leading-relaxed p-4 rounded-xl border border-[#2c2c32] focus:outline-none focus:border-blue-500/50 resize-y"
              />
            </div>
            <div className="space-y-2">
              <div className="text-[11px] text-neutral-500 font-medium">Rendered Blocks (Interactive)</div>
              <div className="bg-[#1b1b1e] p-6 rounded-xl border border-[#2c2c32] min-h-[500px]">
                {renderRichPreview()}
              </div>
            </div>
          </div>
        )}

        {/* Linked References / Backlinks */}
        {allFiles && onSelectFile && (
          <BacklinksPanel
            activeFile={file}
            allFiles={allFiles}
            onSelectFile={onSelectFile}
          />
        )}

        {/* Floating Text Selection Toolbar */}
        <FloatingSelectionToolbar
          position={selectionPos}
          onFormat={insertTextAtCursor}
          onAIAssist={onOpenAIModal}
        />

        {/* Slash Command Popover Menu */}
        <SlashMenu
          isOpen={slashMenuOpen}
          position={slashPos}
          onClose={() => setSlashMenuOpen(false)}
          onSelect={handleSlashSelect}
          query={slashQuery}
        />
      </div>
    </div>
  );
};
