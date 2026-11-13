import React, { useState, useRef } from 'react';
import { 
  Bold, 
  Italic, 
  Strikethrough, 
  Code, 
  List, 
  CheckSquare, 
  Heading1, 
  Heading2, 
  Quote, 
  Copy, 
  Check, 
  Info,
  FileText,
  Link2,
  GitBranch,
  Sigma,
  Bot,
  Wrench,
  Layers,
  ExternalLink
} from 'lucide-react';
import { MarkdownFile } from '../../types/document';
import { FrontmatterMeta } from './FrontmatterMeta';
import { SlashMenu, SlashMenuItem } from './SlashMenu';
import { WikiLinkMenu } from './WikiLinkMenu';
import { MermaidBlock } from './MermaidBlock';
import { MathBlock, InlineMath } from './MathBlock';
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
  allFiles = [],
  onSelectFile,
}) => {
  const [slashMenuOpen, setSlashMenuOpen] = useState(false);
  const [slashQuery, setSlashQuery] = useState('');
  const [slashPos, setSlashPos] = useState({ top: 0, left: 0 });

  // [[Wiki-Link]] Autocomplete State
  const [wikiMenuOpen, setWikiMenuOpen] = useState(false);
  const [wikiQuery, setWikiQuery] = useState('');
  const [wikiPos, setWikiPos] = useState({ top: 0, left: 0 });

  const [selectionPos, setSelectionPos] = useState<{ top: number; left: number } | null>(null);
  const [copiedCodeIndex, setCopiedCodeIndex] = useState<number | null>(null);
  const [editorMode, setEditorMode] = useState<'visual' | 'split' | 'reader'>('visual');

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const editorContainerRef = useRef<HTMLDivElement>(null);

  // Sync frontmatter changes
  const handleFrontmatterChange = (newMetadata: any) => {
    const fullMarkdown = MarkdownService.stringify(newMetadata, file.body);
    onChange(fullMarkdown, newMetadata);
  };

  // Sync body changes & detect [[Wiki-Link]] trigger
  const handleBodyChange = (newBody: string, cursorOverride?: number) => {
    const fullMarkdown = MarkdownService.rebuild(file, file.frontmatter, newBody);
    onChange(fullMarkdown, file.frontmatter);

    const textarea = textareaRef.current;
    const cursor = cursorOverride ?? textarea?.selectionStart ?? newBody.length;
    const textBefore = newBody.slice(0, cursor);

    // Check if user is currently typing inside an unclosed [[...
    const wikiMatch = textBefore.match(/\[\[([^\]\n]*)$/);
    if (wikiMatch && textarea) {
      const rect = textarea.getBoundingClientRect();
      const linesUpToCursor = textBefore.split('\n').length;
      const approxTop = Math.min(rect.top + Math.min(linesUpToCursor * 22, 260), window.innerHeight - 320);
      const approxLeft = Math.min(rect.left + 80, window.innerWidth - 340);

      setWikiPos({ top: Math.max(80, approxTop), left: Math.max(60, approxLeft) });
      setWikiQuery(wikiMatch[1]);
      setWikiMenuOpen(true);
      setSlashMenuOpen(false);
    } else {
      setWikiMenuOpen(false);
    }
  };

  // Resolve a [[Wiki-Link]] target string to a MarkdownFile in the workspace
  const resolveLinkedFile = (target: string): MarkdownFile | undefined => {
    const tLower = target.trim().toLowerCase();
    return allFiles.find((f) => {
      const title = (f.frontmatter.title || '').toLowerCase();
      const nameNoExt = f.name.replace(/\.[^/.]+$/, '').toLowerCase();
      const pathLower = f.path.toLowerCase();
      const pathNoExt = f.path.replace(/\.[^/.]+$/, '').toLowerCase();
      return (
        title === tLower ||
        nameNoExt === tLower ||
        pathLower === tLower ||
        pathNoExt === tLower
      );
    });
  };

  // Handle selecting a document from [[WikiLinkMenu]]
  const handleWikiSelect = (targetTitle: string) => {
    const textarea = textareaRef.current;
    if (!textarea) {
      setWikiMenuOpen(false);
      return;
    }

    const cursor = textarea.selectionStart;
    const textBefore = file.body.slice(0, cursor);
    const textAfter = file.body.slice(cursor);

    const lastOpenBrackets = textBefore.lastIndexOf('[[');
    if (lastOpenBrackets !== -1) {
      const hasClosingBrackets = textAfter.startsWith(']]');
      const insertion = `[[${targetTitle}]]`;
      const nextBody =
        file.body.slice(0, lastOpenBrackets) +
        insertion +
        (hasClosingBrackets ? textAfter.slice(2) : textAfter);

      const fullMarkdown = MarkdownService.rebuild(file, file.frontmatter, nextBody);
      onChange(fullMarkdown, file.frontmatter);
      setWikiMenuOpen(false);

      setTimeout(() => {
        textarea.focus();
        const nextCursor = lastOpenBrackets + insertion.length;
        textarea.setSelectionRange(nextCursor, nextCursor);
      }, 10);
    } else {
      setWikiMenuOpen(false);
    }
  };

  // Trigger [[Wiki-Link]] autocomplete at cursor from toolbar button
  const handleTriggerWikiLink = () => {
    const textarea = textareaRef.current;
    if (!textarea) {
      setEditorMode('visual');
      return;
    }
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;
    const selected = text.substring(start, end);

    if (selected) {
      // Wrap selected text in [[selected]]
      const replacement = `[[${selected}]]`;
      const nextBody = text.substring(0, start) + replacement + text.substring(end);
      handleBodyChange(nextBody, start + replacement.length);
    } else {
      const nextBody = text.substring(0, start) + '[[' + text.substring(end);
      handleBodyChange(nextBody, start + 2);
      setTimeout(() => {
        textarea.focus();
        textarea.setSelectionRange(start + 2, start + 2);
      }, 10);
    }
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
      const textUpToCursor = textarea.value.slice(0, start);
      const lines = textUpToCursor.split('\n');
      const lineNum = lines.length;
      const lineHeight = 24;

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

    handleBodyChange(nextBody, start + prefix.length);
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
      const nextPos = lastSlash + item.insertText.length;
      const newBody = file.body.substring(0, lastSlash) + item.insertText + file.body.substring(cursor);
      setSlashMenuOpen(false);
      handleBodyChange(newBody, nextPos);
      setTimeout(() => {
        textarea.focus();
        textarea.setSelectionRange(nextPos, nextPos);
      }, 10);
    } else {
      setSlashMenuOpen(false);
    }
  };

  // Keyboard shortcut & slash detector
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const textarea = e.currentTarget;
    const cursor = textarea.selectionStart;

    if (wikiMenuOpen) {
      if (e.key === 'Escape') {
        e.preventDefault();
        setWikiMenuOpen(false);
        return;
      }
    }

    // Detect Slash `/`
    if (e.key === '/' && !wikiMenuOpen) {
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
    if (e.key === 'Tab' && !wikiMenuOpen && !slashMenuOpen) {
      e.preventDefault();
      const text = textarea.value;
      const currentLineStart = text.lastIndexOf('\n', cursor - 1) + 1;

      if (e.shiftKey) {
        if (text.substring(currentLineStart, currentLineStart + 2) === '  ') {
          const newBody = text.substring(0, currentLineStart) + text.substring(currentLineStart + 2);
          handleBodyChange(newBody);
          setTimeout(() => {
            textarea.setSelectionRange(Math.max(cursor - 2, currentLineStart), Math.max(cursor - 2, currentLineStart));
          }, 10);
        }
      } else {
        const newBody = text.substring(0, currentLineStart) + '  ' + text.substring(currentLineStart);
        handleBodyChange(newBody);
        setTimeout(() => {
          textarea.setSelectionRange(cursor + 2, cursor + 2);
        }, 10);
      }
      return;
    }

    // Markdown Auto-Formatting shortcuts on Enter
    if (e.key === 'Enter' && !wikiMenuOpen && !slashMenuOpen) {
      const text = textarea.value;
      const currentLineStart = text.lastIndexOf('\n', cursor - 1) + 1;
      const currentLine = text.substring(currentLineStart, cursor);

      // Continue checklist
      const todoMatch = currentLine.match(/^(\s*)-\s*\[([ xX])\]\s*(.*)$/);
      if (todoMatch) {
        if (todoMatch[3].trim() === '') {
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

  const getDocTypeIcon = (type?: string) => {
    switch (type) {
      case 'agent':
        return <Bot className="w-3 h-3 text-purple-400 shrink-0" />;
      case 'skill':
        return <Wrench className="w-3 h-3 text-emerald-400 shrink-0" />;
      case 'project':
        return <Layers className="w-3 h-3 text-blue-400 shrink-0" />;
      default:
        return <FileText className="w-3 h-3 text-blue-300 shrink-0" />;
    }
  };

  /**
   * Render rich inline content: [[Wiki-Links]], $Inline Math$, `code`, **bold**, *italic*
   */
  const renderInlineContent = (text: string): React.ReactNode => {
    const tokens: React.ReactNode[] = [];
    const inlineRegex = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]|\$([^$\n]+)\$|`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*/g;
    let lastIdx = 0;
    let match: RegExpExecArray | null;
    let k = 0;

    while ((match = inlineRegex.exec(text)) !== null) {
      if (match.index > lastIdx) {
        tokens.push(text.slice(lastIdx, match.index));
      }

      if (match[1] !== undefined) {
        // [[Wiki-Link]]
        const target = match[1].trim();
        const alias = (match[2] || match[1]).trim();
        const linkedFile = resolveLinkedFile(target);

        tokens.push(
          <span key={`wiki-${k++}`} className="relative inline-block group/wiki mx-0.5 align-baseline">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (linkedFile && onSelectFile) {
                  onSelectFile(linkedFile.id);
                }
              }}
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium transition border ${
                linkedFile
                  ? 'bg-blue-500/15 hover:bg-blue-500/25 text-blue-300 border-blue-500/30 cursor-pointer'
                  : 'bg-neutral-800/80 text-neutral-400 border-neutral-700/60 cursor-default'
              }`}
            >
              {getDocTypeIcon(linkedFile?.frontmatter.type)}
              <span>{alias}</span>
              {linkedFile && <ExternalLink className="w-2.5 h-2.5 opacity-60" />}
            </button>

            {/* Hover Preview Card */}
            {linkedFile && (
              <div className="invisible group-hover/wiki:visible opacity-0 group-hover/wiki:opacity-100 transition-all duration-150 absolute left-0 bottom-full mb-2 w-72 p-3 rounded-xl bg-[#1b1b20] border border-[#34343e] shadow-2xl z-40 pointer-events-none text-left">
                <div className="flex items-center gap-2 mb-1">
                  {getDocTypeIcon(linkedFile.frontmatter.type)}
                  <span className="text-xs font-semibold text-white truncate">
                    {linkedFile.frontmatter.title || linkedFile.name}
                  </span>
                </div>
                <div className="text-[10px] text-neutral-500 font-mono mb-1.5 truncate">
                  {linkedFile.path}
                </div>
                <p className="text-[11px] text-neutral-300 line-clamp-3 leading-relaxed">
                  {linkedFile.body.replace(/^#+\s+.+$/gm, '').trim().slice(0, 140) || 'No preview text'}
                </p>
              </div>
            )}
          </span>
        );
      } else if (match[3] !== undefined) {
        // Inline Math $...$
        tokens.push(<InlineMath key={`math-${k++}`} latex={match[3]} />);
      } else if (match[4] !== undefined) {
        // Inline `code`
        tokens.push(
          <code
            key={`code-${k++}`}
            className="px-1.5 py-0.5 mx-0.5 rounded bg-[#25252c] border border-[#34343e] text-amber-300 font-mono text-[0.85em]"
          >
            {match[4]}
          </code>
        );
      } else if (match[5] !== undefined) {
        // **Bold**
        tokens.push(
          <strong key={`bold-${k++}`} className="font-semibold text-white">
            {match[5]}
          </strong>
        );
      } else if (match[6] !== undefined) {
        // *Italic*
        tokens.push(
          <em key={`italic-${k++}`} className="italic text-neutral-200">
            {match[6]}
          </em>
        );
      }

      lastIdx = inlineRegex.lastIndex;
    }

    if (lastIdx < text.length) {
      tokens.push(text.slice(lastIdx));
    }

    return tokens;
  };

  // Extract special blocks (Wiki-Links, Mermaid, Display Math) for the Live Companion Bar in In-Place mode
  const extractedWikiLinks = MarkdownService.extractWikiLinks(file.body);
  const extractedMermaidBlocks: string[] = [];
  const extractedMathBlocks: string[] = [];

  (() => {
    const mermaidRegex = /```mermaid\r?\n([\s\S]*?)```/g;
    let m: RegExpExecArray | null;
    while ((m = mermaidRegex.exec(file.body)) !== null) {
      if (m[1].trim()) extractedMermaidBlocks.push(m[1].trim());
    }

    const mathBlockRegex = /\$\$\r?\n?([\s\S]*?)\r?\n?\$\$/g;
    let mb: RegExpExecArray | null;
    while ((mb = mathBlockRegex.exec(file.body)) !== null) {
      if (mb[1].trim()) extractedMathBlocks.push(mb[1].trim());
    }
  })();

  // Render Notion-style preview blocks
  const renderRichPreview = () => {
    const lines = file.body.split('\n');
    const elements: React.ReactNode[] = [];
    let inCodeBlock = false;
    let codeBuffer: string[] = [];
    let codeLang = '';
    let codeIndex = 0;

    let inMathBlock = false;
    let mathBuffer: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Multi-line or single-line $$ Math Block
      if (!inCodeBlock && line.trim().startsWith('$$')) {
        const trimmed = line.trim();
        // Single-line $$ ... $$
        if (trimmed.length > 4 && trimmed.endsWith('$$')) {
          const singleLatex = trimmed.slice(2, -2).trim();
          elements.push(<MathBlock key={`math-single-${i}`} latex={singleLatex} />);
          continue;
        }
        if (inMathBlock) {
          elements.push(<MathBlock key={`math-block-${i}`} latex={mathBuffer.join('\n')} />);
          mathBuffer = [];
          inMathBlock = false;
        } else {
          inMathBlock = true;
          const afterOpen = trimmed.slice(2).trim();
          mathBuffer = afterOpen ? [afterOpen] : [];
        }
        continue;
      }

      if (inMathBlock) {
        mathBuffer.push(line);
        continue;
      }

      // Code block start / end
      if (line.trim().startsWith('```')) {
        if (inCodeBlock) {
          const codeText = codeBuffer.join('\n');
          const langLower = codeLang.toLowerCase();

          if (langLower === 'mermaid') {
            elements.push(<MermaidBlock key={`mermaid-${i}`} code={codeText} />);
          } else if (langLower === 'math' || langLower === 'latex') {
            elements.push(<MathBlock key={`math-code-${i}`} latex={codeText} />);
          } else {
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
          }
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
            {renderInlineContent(line.slice(2))}
          </h1>
        );
        continue;
      }

      // Heading 2
      if (line.startsWith('## ')) {
        elements.push(
          <h2 key={`h2-${i}`} className="text-xl font-semibold text-neutral-200 tracking-tight mt-5 mb-2">
            {renderInlineContent(line.slice(3))}
          </h2>
        );
        continue;
      }

      // Heading 3
      if (line.startsWith('### ')) {
        elements.push(
          <h3 key={`h3-${i}`} className="text-base font-medium text-neutral-300 tracking-tight mt-4 mb-1.5">
            {renderInlineContent(line.slice(4))}
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
              {renderInlineContent(taskMatch[3])}
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
              {renderInlineContent(line.slice(2))}
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
            <span className="leading-relaxed">{renderInlineContent(line.slice(2))}</span>
          </div>
        );
        continue;
      }

      // Standard paragraph
      elements.push(
        <p key={`p-${i}`} className="text-sm text-neutral-300 leading-relaxed my-1.5">
          {renderInlineContent(line)}
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
        <div className="sticky top-0 z-20 mb-5 py-1.5 px-3 bg-[#202023]/90 backdrop-blur-md border border-[#303036] rounded-xl shadow-lg flex items-center gap-1 text-xs flex-wrap">
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

          <div className="w-[1px] h-4 bg-[#35353c] mx-1" />

          {/* [[Wiki-Link]], Mermaid Diagram & Math Equation Buttons */}
          <button
            onClick={handleTriggerWikiLink}
            className="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-blue-500/20 text-blue-400 hover:text-blue-300 transition font-medium"
            title="Insert [[Wiki-Link]] to Document"
          >
            <Link2 className="w-3.5 h-3.5" />
            <span className="text-[11px]">[[Link]]</span>
          </button>
          <button
            onClick={() =>
              insertTextAtCursor(
                '\n```mermaid\nflowchart LR\n  A([Start]) --> B[Process]\n  B --> C{Decision}\n  C -->|Yes| D([Done])\n```\n'
              )
            }
            className="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-indigo-500/20 text-indigo-400 hover:text-indigo-300 transition font-medium"
            title="Insert Mermaid Diagram"
          >
            <GitBranch className="w-3.5 h-3.5" />
            <span className="text-[11px]">Mermaid</span>
          </button>
          <button
            onClick={() =>
              insertTextAtCursor('\n$$\nE = mc^2 \\quad \\text{where } \\gamma = \\frac{1}{\\sqrt{1 - v^2/c^2}}\n$$\n')
            }
            className="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-amber-500/20 text-amber-400 hover:text-amber-300 transition font-medium"
            title="Insert Math Equation ($$...$$)"
          >
            <Sigma className="w-3.5 h-3.5" />
            <span className="text-[11px]">Math</span>
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
              <button
                onClick={() => setEditorMode('reader')}
                className={`px-2 py-0.5 rounded text-[11px] font-medium transition ${
                  editorMode === 'reader' ? 'bg-[#2b2b32] text-white shadow-sm' : 'text-neutral-400 hover:text-white'
                }`}
              >
                Rich Reader
              </button>
            </div>
          )}

          <span className="text-[11px] text-neutral-500 ml-auto hidden xl:inline font-sans">
            Type <kbd className="px-1 py-0.5 bg-[#18181a] rounded border border-[#35353c] text-neutral-400 font-mono text-[10px]">/</kbd> for blocks or <kbd className="px-1 py-0.5 bg-[#18181a] rounded border border-[#35353c] text-blue-400 font-mono text-[10px]">[[</kbd> to link
          </span>
        </div>

        {/* Editor Body */}
        {isRawMarkdown ? (
          /* Raw Markdown Editor */
          <div className="relative">
            <textarea
              ref={textareaRef}
              value={file.body}
              onChange={(e) => handleBodyChange(e.target.value, e.target.selectionStart)}
              onKeyDown={handleKeyDown}
              onSelect={handleSelectText}
              onMouseUp={handleSelectText}
              placeholder="Write your markdown body here, type '/' for blocks or '[[' to link documents..."
              className="w-full min-h-[600px] bg-[#141416] text-neutral-200 font-mono text-sm leading-relaxed p-5 rounded-xl border border-[#2c2c32] focus:outline-none focus:border-blue-500/50 resize-y shadow-inner"
              spellCheck={false}
            />
          </div>
        ) : editorMode === 'visual' ? (
          /* In-Place Live Notion Canvas + Live Interactive Blocks */
          <div className="space-y-6">
            <div className="relative rounded-2xl bg-[#1d1d20]/70 border border-[#2c2c32] p-8 shadow-sm">
              <div className="mb-4 flex items-center justify-between text-[11px] text-neutral-500 pb-2 border-b border-[#28282c]">
                <div className="flex items-center gap-3">
                  <span className="font-medium text-neutral-400">In-Place Notion Canvas</span>
                  {extractedWikiLinks.length > 0 && (
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-neutral-600">•</span>
                      {extractedWikiLinks.map((wl, idx) => {
                        const targetDoc = resolveLinkedFile(wl.target);
                        return (
                          <button
                            key={idx}
                            onClick={() => targetDoc && onSelectFile && onSelectFile(targetDoc.id)}
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] transition border ${
                              targetDoc
                                ? 'bg-blue-500/15 hover:bg-blue-500/25 text-blue-300 border-blue-500/30 cursor-pointer'
                                : 'bg-neutral-800 text-neutral-400 border-neutral-700'
                            }`}
                            title={targetDoc ? `Open ${targetDoc.path}` : `Unresolved link: ${wl.target}`}
                          >
                            {getDocTypeIcon(targetDoc?.frontmatter.type)}
                            <span>{wl.alias}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
                <span className="text-emerald-400 flex items-center gap-1.5 shrink-0">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  Live Sync
                </span>
              </div>

              {/* Seamless Interactive Writing Surface */}
              <textarea
                ref={textareaRef}
                value={file.body}
                onChange={(e) => handleBodyChange(e.target.value, e.target.selectionStart)}
                onKeyDown={handleKeyDown}
                onSelect={handleSelectText}
                onMouseUp={handleSelectText}
                placeholder="Write your thoughts here, type '/' for commands, '[[' to link documents, or paste markdown..."
                rows={Math.max(18, file.body.split('\n').length + 4)}
                className="w-full bg-transparent text-neutral-100 font-sans text-base leading-relaxed focus:outline-none resize-none selection:bg-amber-500/20 selection:text-amber-200"
              />
            </div>

            {/* Live Rendered Diagrams & Equations Preview under In-Place Canvas */}
            {(extractedMermaidBlocks.length > 0 || extractedMathBlocks.length > 0) && (
              <div className="rounded-2xl bg-[#19191d] border border-[#2a2a32] p-6 space-y-4">
                <div className="flex items-center justify-between text-xs text-neutral-400 pb-2 border-b border-[#26262e]">
                  <span className="font-semibold text-neutral-300 flex items-center gap-2">
                    <GitBranch className="w-3.5 h-3.5 text-indigo-400" />
                    Live Interactive Diagrams & Equations ({extractedMermaidBlocks.length + extractedMathBlocks.length})
                  </span>
                  <span className="text-[11px] text-neutral-500">Auto-rendered from canvas</span>
                </div>
                {extractedMermaidBlocks.map((code, i) => (
                  <MermaidBlock key={`live-mermaid-${i}`} code={code} />
                ))}
                {extractedMathBlocks.map((latex, i) => (
                  <MathBlock key={`live-math-${i}`} latex={latex} />
                ))}
              </div>
            )}
          </div>
        ) : editorMode === 'reader' ? (
          /* Rich Interactive Reader Mode */
          <div className="rounded-2xl bg-[#1b1b1e] p-8 border border-[#2c2c32] min-h-[540px] shadow-sm">
            <div className="mb-4 flex items-center justify-between text-[11px] text-neutral-500 pb-2 border-b border-[#28282c]">
              <span className="font-medium text-neutral-400">Interactive Rich Reader (Click [[Links]] or Toggle Tasks)</span>
              <button
                onClick={() => setEditorMode('visual')}
                className="text-blue-400 hover:text-blue-300 font-medium"
              >
                Switch to Editor
              </button>
            </div>
            {renderRichPreview()}
          </div>
        ) : (
          /* Split Preview Mode */
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="space-y-2">
              <div className="text-[11px] text-neutral-500 font-medium">Editor Stream</div>
              <textarea
                ref={textareaRef}
                value={file.body}
                onChange={(e) => handleBodyChange(e.target.value, e.target.selectionStart)}
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

        {/* [[Wiki-Link]] Autocomplete Menu */}
        <WikiLinkMenu
          isOpen={wikiMenuOpen}
          position={wikiPos}
          query={wikiQuery}
          files={allFiles}
          activeFileId={file.id}
          onSelect={handleWikiSelect}
          onClose={() => setWikiMenuOpen(false)}
        />
      </div>
    </div>
  );
};
