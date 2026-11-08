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
  Info
} from 'lucide-react';
import { MarkdownFile } from '../../types/document';
import { FrontmatterMeta } from './FrontmatterMeta';
import { SlashMenu, SlashMenuItem } from './SlashMenu';
import { MarkdownService } from '../../services/markdown';

interface NotionEditorProps {
  file: MarkdownFile;
  onChange: (updatedContent: string, updatedFrontmatter?: any) => void;
  isRawMarkdown: boolean;
  onOpenAIModal?: () => void;
}

export const NotionEditor: React.FC<NotionEditorProps> = ({
  file,
  onChange,
  isRawMarkdown,
  onOpenAIModal,
}) => {
  const [slashMenuOpen, setSlashMenuOpen] = useState(false);
  const [slashQuery, setSlashQuery] = useState('');
  const [slashPos, setSlashPos] = useState({ top: 0, left: 0 });
  const [copiedCodeIndex, setCopiedCodeIndex] = useState<number | null>(null);

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
        left: Math.min(rect.left + 60, window.innerWidth - 320),
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

    // Markdown Auto-Formatting shortcuts on Enter
    if (e.key === 'Enter') {
      const text = textarea.value;
      const currentLineStart = text.lastIndexOf('\n', cursor - 1) + 1;
      const currentLine = text.substring(currentLineStart, cursor);

      // Continue checklist
      const todoMatch = currentLine.match(/^\s*-\s*\[([ xX])\]\s*(.*)$/);
      if (todoMatch) {
        if (todoMatch[2].trim() === '') {
          // If empty checklist item, remove it on enter
          e.preventDefault();
          const newBody = text.substring(0, currentLineStart) + text.substring(cursor);
          handleBodyChange(newBody);
          return;
        }
        e.preventDefault();
        const indent = currentLine.match(/^\s*/)?.[0] || '';
        const insert = `\n${indent}- [ ] `;
        const newBody = text.substring(0, cursor) + insert + text.substring(cursor);
        handleBodyChange(newBody);
        setTimeout(() => {
          textarea.setSelectionRange(cursor + insert.length, cursor + insert.length);
        }, 10);
        return;
      }

      // Continue bulleted list
      const bulletMatch = currentLine.match(/^\s*-\s+(.*)$/);
      if (bulletMatch && !bulletMatch[1].startsWith('[')) {
        if (bulletMatch[1].trim() === '') {
          e.preventDefault();
          const newBody = text.substring(0, currentLineStart) + text.substring(cursor);
          handleBodyChange(newBody);
          return;
        }
        e.preventDefault();
        const indent = currentLine.match(/^\s*/)?.[0] || '';
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
          // End code block
          const codeText = codeBuffer.join('\n');
          const idx = codeIndex++;
          elements.push(
            <div key={`code-${i}`} className="my-4 rounded-lg bg-[#141414] border border-[#2d2d2d] overflow-hidden group">
              <div className="flex items-center justify-between px-3 py-1.5 bg-[#1e1e1e] border-b border-[#2d2d2d] text-[11px] text-neutral-400 font-mono">
                <span>{codeLang || 'plaintext'}</span>
                <button
                  onClick={() => handleCopyCode(codeText, idx)}
                  className="flex items-center gap-1 hover:text-white px-2 py-0.5 rounded transition"
                >
                  {copiedCodeIndex === idx ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  <span>{copiedCodeIndex === idx ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
              <pre className="p-3 text-xs font-mono text-neutral-300 overflow-x-auto leading-relaxed">
                <code>{codeText}</code>
              </pre>
            </div>
          );
          codeBuffer = [];
          inCodeBlock = false;
        } else {
          // Start code block
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
          <h1 key={`h1-${i}`} className="text-2xl font-bold text-neutral-100 tracking-tight mt-6 mb-3 border-b border-[#282828] pb-1">
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
          <h3 key={`h3-${i}`} className="text-base font-medium text-neutral-300 tracking-tight mt-4 mb-2">
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
            className="flex items-start gap-2.5 my-1 group cursor-pointer select-none"
            onClick={() => handleToggleTask(i, isChecked)}
          >
            <div className="pt-0.5">
              <input
                type="checkbox"
                checked={isChecked}
                onChange={() => {}}
                className="w-4 h-4 rounded bg-[#252525] border border-[#444] text-emerald-500 focus:ring-0 cursor-pointer accent-emerald-500"
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
          <div key={`callout-${i}`} className="my-3 px-3.5 py-2.5 rounded-r-md bg-[#222] border-l-4 border-amber-500/80 text-neutral-300 text-sm flex items-start gap-2.5">
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
          <div key={`bullet-${i}`} className="flex items-start gap-2 my-1 text-sm text-neutral-200">
            <span className="text-neutral-500 mt-1 font-bold">•</span>
            <span className="leading-relaxed">{line.slice(2)}</span>
          </div>
        );
        continue;
      }

      // Standard paragraph
      elements.push(
        <p key={`p-${i}`} className="text-sm text-neutral-300 leading-relaxed my-1">
          {line}
        </p>
      );
    }

    return elements;
  };

  return (
    <div ref={editorContainerRef} className="flex-1 h-full overflow-y-auto bg-[#191919] font-sans">
      <div className="max-w-4xl mx-auto px-8 py-8">
        {/* Notion Style Property Header */}
        <FrontmatterMeta metadata={file.frontmatter} onChange={handleFrontmatterChange} />

        {/* Floating Quick Action Toolbar */}
        <div className="sticky top-0 z-20 mb-4 py-1.5 px-2 bg-[#222222]/90 backdrop-blur-md border border-[#333333] rounded-lg shadow-lg flex items-center gap-1 text-xs">
          <button
            onClick={() => insertTextAtCursor('**', '**')}
            className="p-1.5 rounded hover:bg-[#303030] text-neutral-300 hover:text-white transition"
            title="Bold (Ctrl+B)"
          >
            <Bold className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => insertTextAtCursor('*', '*')}
            className="p-1.5 rounded hover:bg-[#303030] text-neutral-300 hover:text-white transition"
            title="Italic (Ctrl+I)"
          >
            <Italic className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => insertTextAtCursor('~~', '~~')}
            className="p-1.5 rounded hover:bg-[#303030] text-neutral-300 hover:text-white transition"
            title="Strikethrough"
          >
            <Strikethrough className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => insertTextAtCursor('`', '`')}
            className="p-1.5 rounded hover:bg-[#303030] text-neutral-300 hover:text-white transition"
            title="Inline Code"
          >
            <Code className="w-3.5 h-3.5" />
          </button>

          <div className="w-[1px] h-4 bg-[#383838] mx-1" />

          <button
            onClick={() => insertTextAtCursor('# ')}
            className="p-1.5 rounded hover:bg-[#303030] text-neutral-300 hover:text-white transition"
            title="Heading 1"
          >
            <Heading1 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => insertTextAtCursor('## ')}
            className="p-1.5 rounded hover:bg-[#303030] text-neutral-300 hover:text-white transition"
            title="Heading 2"
          >
            <Heading2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => insertTextAtCursor('- [ ] ')}
            className="p-1.5 rounded hover:bg-[#303030] text-emerald-400 hover:text-emerald-300 transition"
            title="Checklist Item"
          >
            <CheckSquare className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => insertTextAtCursor('- ')}
            className="p-1.5 rounded hover:bg-[#303030] text-neutral-300 hover:text-white transition"
            title="Bulleted List"
          >
            <List className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => insertTextAtCursor('> ')}
            className="p-1.5 rounded hover:bg-[#303030] text-amber-400 hover:text-amber-300 transition"
            title="Callout Box"
          >
            <Quote className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => insertTextAtCursor('\n```typescript\n', '\n```\n')}
            className="p-1.5 rounded hover:bg-[#303030] text-purple-400 hover:text-purple-300 transition"
            title="Code Block"
          >
            <Code className="w-3.5 h-3.5" />
          </button>

          <div className="w-[1px] h-4 bg-[#383838] mx-1" />

          <span className="text-[11px] text-neutral-500 ml-auto hidden sm:inline">
            Type <kbd className="px-1 py-0.5 bg-[#181818] rounded border border-[#383838] text-neutral-400">/</kbd> for blocks
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
              placeholder="Write your markdown body here or type '/' for blocks..."
              className="w-full min-h-[600px] bg-[#141414] text-neutral-200 font-mono text-sm leading-relaxed p-4 rounded-lg border border-[#2d2d2d] focus:outline-none focus:border-blue-500/50 resize-y"
              spellCheck={false}
            />
          </div>
        ) : (
          /* Notion WYSIWYG / Live Edit View */
          <div className="space-y-6">
            {/* Visual Block Rendering */}
            <div className="bg-[#1e1e1e]/60 p-6 rounded-xl border border-[#2a2a2a] shadow-sm">
              <div className="text-[10px] uppercase font-semibold text-neutral-500 tracking-wider mb-4 flex items-center justify-between">
                <span>Notion Rich View (Click items or checkboxes to interact)</span>
                <span className="text-emerald-400 font-normal">● Live Sync</span>
              </div>
              <div className="prose prose-invert max-w-none">
                {renderRichPreview()}
              </div>
            </div>

            {/* Quick Inline Markdown Editor */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-neutral-400">
                <span className="font-medium">Direct Markdown Stream</span>
                <span className="text-[11px] text-neutral-500">Edit below to update both views instantly</span>
              </div>
              <textarea
                ref={textareaRef}
                value={file.body}
                onChange={(e) => handleBodyChange(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Continue writing here..."
                rows={10}
                className="w-full bg-[#181818] text-neutral-200 font-sans text-sm leading-relaxed p-4 rounded-lg border border-[#2f2f2f] focus:outline-none focus:border-blue-500/50 resize-y"
              />
            </div>
          </div>
        )}

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
