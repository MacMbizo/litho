import React from 'react';
import { 
  Bold, 
  Italic, 
  Strikethrough, 
  Code, 
  Heading1, 
  Heading2, 
  CheckSquare, 
  Quote, 
  Sparkles 
} from 'lucide-react';

interface FloatingSelectionToolbarProps {
  position: { top: number; left: number } | null;
  onFormat: (prefix: string, suffix?: string) => void;
  onAIAssist?: () => void;
}

export const FloatingSelectionToolbar: React.FC<FloatingSelectionToolbarProps> = ({
  position,
  onFormat,
  onAIAssist,
}) => {
  if (!position) return null;

  return (
    <div
      style={{
        top: `${position.top - 46}px`,
        left: `${position.left}px`,
      }}
      className="fixed z-50 -translate-x-1/2 flex items-center gap-0.5 p-1 bg-[#222225] border border-[#38383e] rounded-xl shadow-2xl backdrop-blur-md text-neutral-300 font-sans text-xs select-none animate-in fade-in zoom-in-95 duration-150"
    >
      <button
        onMouseDown={(e) => {
          e.preventDefault();
          onFormat('**', '**');
        }}
        className="p-1.5 rounded-lg hover:bg-[#323238] hover:text-white transition"
        title="Bold (Ctrl+B)"
      >
        <Bold className="w-3.5 h-3.5" />
      </button>

      <button
        onMouseDown={(e) => {
          e.preventDefault();
          onFormat('*', '*');
        }}
        className="p-1.5 rounded-lg hover:bg-[#323238] hover:text-white transition"
        title="Italic (Ctrl+I)"
      >
        <Italic className="w-3.5 h-3.5" />
      </button>

      <button
        onMouseDown={(e) => {
          e.preventDefault();
          onFormat('~~', '~~');
        }}
        className="p-1.5 rounded-lg hover:bg-[#323238] hover:text-white transition"
        title="Strikethrough"
      >
        <Strikethrough className="w-3.5 h-3.5" />
      </button>

      <button
        onMouseDown={(e) => {
          e.preventDefault();
          onFormat('`', '`');
        }}
        className="p-1.5 rounded-lg hover:bg-[#323238] hover:text-white transition"
        title="Inline Code"
      >
        <Code className="w-3.5 h-3.5" />
      </button>

      <div className="w-[1px] h-4 bg-[#35353c] mx-1" />

      <button
        onMouseDown={(e) => {
          e.preventDefault();
          onFormat('# ');
        }}
        className="p-1.5 rounded-lg hover:bg-[#323238] hover:text-white transition"
        title="Heading 1"
      >
        <Heading1 className="w-3.5 h-3.5" />
      </button>

      <button
        onMouseDown={(e) => {
          e.preventDefault();
          onFormat('## ');
        }}
        className="p-1.5 rounded-lg hover:bg-[#323238] hover:text-white transition"
        title="Heading 2"
      >
        <Heading2 className="w-3.5 h-3.5" />
      </button>

      <button
        onMouseDown={(e) => {
          e.preventDefault();
          onFormat('- [ ] ');
        }}
        className="p-1.5 rounded-lg hover:bg-[#323238] text-emerald-400 hover:text-emerald-300 transition"
        title="Checklist Item"
      >
        <CheckSquare className="w-3.5 h-3.5" />
      </button>

      <button
        onMouseDown={(e) => {
          e.preventDefault();
          onFormat('> ');
        }}
        className="p-1.5 rounded-lg hover:bg-[#323238] text-amber-400 hover:text-amber-300 transition"
        title="Callout"
      >
        <Quote className="w-3.5 h-3.5" />
      </button>

      {onAIAssist && (
        <>
          <div className="w-[1px] h-4 bg-[#35353c] mx-1" />
          <button
            onMouseDown={(e) => {
              e.preventDefault();
              onAIAssist();
            }}
            className="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-purple-950/40 text-purple-300 hover:text-purple-200 transition font-medium"
            title="Ask AI about selection"
          >
            <Sparkles className="w-3 h-3 text-purple-400" />
            <span className="text-[11px]">AI</span>
          </button>
        </>
      )}
    </div>
  );
};
