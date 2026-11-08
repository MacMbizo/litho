import React from 'react';
import { Bot, Wrench, Layers, FileText, Play, Tag, ExternalLink } from 'lucide-react';
import { MarkdownFile } from '../../types/document';

interface GalleryViewProps {
  files: MarkdownFile[];
  onSelectFile: (id: string) => void;
  onRunAgent?: (file: MarkdownFile) => void;
}

export const GalleryView: React.FC<GalleryViewProps> = ({
  files,
  onSelectFile,
  onRunAgent,
}) => {
  const getDocIcon = (type?: string) => {
    switch (type) {
      case 'agent':
        return <Bot className="w-5 h-5 text-purple-400" />;
      case 'skill':
        return <Wrench className="w-5 h-5 text-emerald-400" />;
      case 'project':
        return <Layers className="w-5 h-5 text-blue-400" />;
      default:
        return <FileText className="w-5 h-5 text-neutral-400" />;
    }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 pb-8 font-sans">
      {files.map((file) => {
        const meta = file.frontmatter;
        const snippet = file.body.replace(/^[#>\s\-*`]+/gm, '').trim().slice(0, 120);

        return (
          <div
            key={file.id}
            onClick={() => onSelectFile(file.id)}
            className="group flex flex-col justify-between p-4 rounded-xl bg-[#1d1d1d] hover:bg-[#232323] border border-[#2e2e2e] hover:border-neutral-500 transition cursor-pointer shadow-sm relative overflow-hidden"
          >
            {/* Top Row: Icon + Type Badge */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="p-2 rounded-lg bg-[#262626] border border-[#363636]">
                  {getDocIcon(meta.type)}
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] uppercase font-semibold px-2 py-0.5 rounded-full bg-[#282828] text-neutral-400 border border-[#383838]">
                    {meta.type || 'document'}
                  </span>
                  {meta.status && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-medium">
                      {meta.status}
                    </span>
                  )}
                </div>
              </div>

              {/* Title */}
              <h3 className="font-semibold text-sm text-neutral-200 group-hover:text-white line-clamp-1 mb-1.5">
                {meta.title || file.name}
              </h3>

              {/* Snippet */}
              <p className="text-xs text-neutral-400 line-clamp-3 leading-relaxed mb-4">
                {snippet || 'No preview text available...'}
              </p>
            </div>

            {/* Bottom Meta & Action */}
            <div className="pt-3 border-t border-[#2a2a2a] space-y-2.5">
              {/* Agent Tools / Model */}
              {meta.type === 'agent' && (
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-mono text-purple-300 bg-purple-950/40 px-1.5 py-0.5 rounded border border-purple-800/40">
                    {meta.model || 'default-llm'}
                  </span>
                  {onRunAgent && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onRunAgent(file);
                      }}
                      className="flex items-center gap-1 px-2 py-1 rounded bg-purple-600 hover:bg-purple-500 text-white font-medium text-xs transition shadow-sm"
                    >
                      <Play className="w-3 h-3 fill-current" />
                      <span>Run</span>
                    </button>
                  )}
                </div>
              )}

              {/* Tags */}
              {(meta.tags || []).length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {meta.tags!.slice(0, 3).map((tag) => (
                    <span
                      key={tag}
                      className="text-[10px] text-neutral-400 bg-[#252525] px-1.5 py-0.2 rounded border border-[#333]"
                    >
                      #{tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};
