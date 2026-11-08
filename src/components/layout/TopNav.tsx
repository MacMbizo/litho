import React, { useState } from 'react';
import { 
  Sparkles, 
  Bot, 
  Code2, 
  Eye, 
  Share2, 
  Save, 
  Clock, 
  Tag, 
  Layers,
  Wrench,
  FileText,
  SlidersHorizontal,
  Download,
  Printer,
  FileCode,
  Check,
  PanelLeftOpen,
  Folder
} from 'lucide-react';
import { MarkdownFile } from '../../types/document';

interface TopNavProps {
  activeFile: MarkdownFile | null;
  onOpenAIModal: () => void;
  onOpenAgentTester?: () => void;
  isRawMarkdown: boolean;
  onToggleRawMarkdown: () => void;
  onSave: () => void;
  isSidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
  onOpenProjectOverview?: () => void;
}

export const TopNav: React.FC<TopNavProps> = ({
  activeFile,
  onOpenAIModal,
  onOpenAgentTester,
  isRawMarkdown,
  onToggleRawMarkdown,
  onSave,
  isSidebarCollapsed,
  onToggleSidebar,
  onOpenProjectOverview,
}) => {
  if (!activeFile) {
    return (
      <header className="h-12 border-b border-[#2f2f2f] bg-[#191919] px-4 flex items-center justify-between text-xs text-neutral-400">
        <span>No document selected</span>
      </header>
    );
  }

  const type = activeFile.frontmatter.type || 'document';
  const readingTime = Math.ceil((activeFile.wordCount || 1) / 200);
  const [showExportMenu, setShowExportMenu] = useState(false);

  const downloadFile = (filename: string, content: string, mime: string) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    setShowExportMenu(false);
  };

  const handleExportMarkdown = () => {
    const filename = activeFile.name.endsWith('.md') ? activeFile.name : `${activeFile.name}.md`;
    downloadFile(filename, activeFile.content, 'text/markdown');
  };

  const handleExportHTML = () => {
    const title = activeFile.frontmatter.title || activeFile.name;
    const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${title}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; line-height: 1.6; max-width: 800px; margin: 40px auto; padding: 0 20px; color: #1a1a1a; background: #fafafa; }
    h1, h2, h3 { color: #111; }
    pre { background: #2d2d2d; color: #f8f8f2; padding: 16px; border-radius: 8px; overflow-x: auto; }
    code { font-family: monospace; background: #e5e5e5; padding: 2px 4px; border-radius: 4px; }
    pre code { background: none; padding: 0; }
    blockquote { border-left: 4px solid #3b82f6; margin: 0; padding-left: 16px; color: #4b5563; }
    table { border-collapse: collapse; width: 100%; margin: 16px 0; }
    th, td { border: 1px solid #ddd; padding: 8px 12px; }
    th { background: #f3f4f6; }
  </style>
</head>
<body>
  <h1>${title}</h1>
  <pre style="background:#f3f4f6; color:#374151; padding:12px; border-radius:6px; font-size:12px;">${activeFile.content}</pre>
</body>
</html>`;
    downloadFile(`${title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.html`, htmlContent, 'text/html');
  };

  const getTypeBadge = () => {
    switch (type) {
      case 'agent':
        return (
          <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-purple-500/20 text-purple-300 border border-purple-500/30 flex items-center gap-1">
            <Bot className="w-3 h-3" /> Agent
          </span>
        );
      case 'skill':
        return (
          <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
            <Wrench className="w-3 h-3" /> Skill
          </span>
        );
      case 'project':
        return (
          <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-blue-500/20 text-blue-300 border border-blue-500/30 flex items-center gap-1">
            <Layers className="w-3 h-3" /> Project
          </span>
        );
      default:
        return (
          <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-neutral-800 text-neutral-300 border border-neutral-700 flex items-center gap-1">
            <FileText className="w-3 h-3" /> Note
          </span>
        );
    }
  };

  return (
    <header className="h-12 border-b border-[#2c2c30] bg-[#1a1a1c] px-4 flex items-center justify-between text-xs select-none">
      {/* Left: Uncollapse button + Breadcrumbs & Type Badge */}
      <div className="flex items-center gap-3 truncate">
        {isSidebarCollapsed && onToggleSidebar && (
          <button
            onClick={onToggleSidebar}
            className="p-1.5 rounded-lg hover:bg-[#252528] text-neutral-400 hover:text-white transition mr-1"
            title="Expand sidebar (Ctrl+\)"
          >
            <PanelLeftOpen className="w-4 h-4 text-neutral-300" />
          </button>
        )}

        <div className="flex items-center gap-1.5 text-neutral-400 text-xs truncate">
          <span 
            onClick={onOpenProjectOverview}
            className="hover:text-neutral-200 cursor-pointer flex items-center gap-1 transition"
            title="Go to Project Overview"
          >
            <Folder className="w-3 h-3 text-neutral-500" />
            <span>{activeFile.path.split('/')[0]}</span>
          </span>
          <span className="text-neutral-600">/</span>
          <span className="font-semibold text-neutral-200 truncate">{activeFile.frontmatter.title || activeFile.name}</span>
        </div>
        {getTypeBadge()}
        {activeFile.isDirty && (
          <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" title="Unsaved changes" />
        )}
      </div>

      {/* Right: Stats and Action Buttons */}
      <div className="flex items-center gap-2">
        <div className="hidden sm:flex items-center gap-3 text-neutral-500 text-[11px] mr-2">
          <span>{activeFile.wordCount} words</span>
          <span>•</span>
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" /> {readingTime} min read
          </span>
        </div>

        {/* AI Summarize & Tag */}
        <button
          onClick={onOpenAIModal}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-gradient-to-r from-purple-900/40 to-indigo-900/40 hover:from-purple-900/60 hover:to-indigo-900/60 border border-purple-500/30 text-purple-200 hover:text-white transition shadow-sm font-medium"
          title="Summarize or Auto-Categorize with AI"
        >
          <Sparkles className="w-3.5 h-3.5 text-purple-400" />
          <span>AI Assist</span>
        </button>

        {/* Test Agent button if type is agent */}
        {type === 'agent' && onOpenAgentTester && (
          <button
            onClick={onOpenAgentTester}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-purple-600 hover:bg-purple-500 text-white transition font-medium shadow-sm"
          >
            <Bot className="w-3.5 h-3.5" />
            <span>Run Agent</span>
          </button>
        )}

        {/* Toggle Raw Markdown vs WYSIWYG */}
        <button
          onClick={onToggleRawMarkdown}
          className={`flex items-center gap-1.5 px-2 py-1 rounded border transition ${
            isRawMarkdown
              ? 'bg-[#2a2a2a] text-blue-400 border-blue-500/40'
              : 'hover:bg-[#252525] text-neutral-400 hover:text-neutral-200 border-[#333333]'
          }`}
          title={isRawMarkdown ? 'Switch to Rich WYSIWYG View' : 'Switch to Raw Markdown View'}
        >
          {isRawMarkdown ? <Eye className="w-3.5 h-3.5" /> : <Code2 className="w-3.5 h-3.5" />}
          <span>{isRawMarkdown ? 'WYSIWYG' : 'Raw MD'}</span>
        </button>

        {/* Export Dropdown */}
        <div className="relative">
          <button
            onClick={() => setShowExportMenu(!showExportMenu)}
            className="flex items-center gap-1 p-1.5 rounded hover:bg-[#252525] text-neutral-400 hover:text-neutral-200 border border-[#333333] transition"
            title="Export Document"
          >
            <Download className="w-3.5 h-3.5" />
          </button>

          {showExportMenu && (
            <div className="absolute right-0 top-full mt-1.5 w-44 bg-[#222] border border-[#383838] rounded-lg shadow-xl py-1 z-50 font-sans">
              <button
                onClick={handleExportMarkdown}
                className="w-full text-left px-3 py-1.5 text-xs text-neutral-300 hover:bg-[#2c2c2c] hover:text-white flex items-center gap-2"
              >
                <FileCode className="w-3.5 h-3.5 text-blue-400" />
                <span>Export as .md</span>
              </button>
              <button
                onClick={handleExportHTML}
                className="w-full text-left px-3 py-1.5 text-xs text-neutral-300 hover:bg-[#2c2c2c] hover:text-white flex items-center gap-2"
              >
                <FileText className="w-3.5 h-3.5 text-amber-400" />
                <span>Export as HTML</span>
              </button>
              <button
                onClick={() => {
                  setShowExportMenu(false);
                  window.print();
                }}
                className="w-full text-left px-3 py-1.5 text-xs text-neutral-300 hover:bg-[#2c2c2c] hover:text-white flex items-center gap-2"
              >
                <Printer className="w-3.5 h-3.5 text-purple-400" />
                <span>Print / Save PDF</span>
              </button>
            </div>
          )}
        </div>

        {/* Save */}
        <button
          onClick={onSave}
          className="p-1.5 rounded hover:bg-[#252525] text-neutral-400 hover:text-neutral-200 border border-[#333333] transition"
          title="Save (Ctrl+S)"
        >
          <Save className="w-3.5 h-3.5" />
        </button>
      </div>
    </header>
  );
};
