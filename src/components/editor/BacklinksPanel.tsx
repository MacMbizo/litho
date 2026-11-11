import React from 'react';
import { Link2, FileText, Bot, Wrench, Layers, ExternalLink } from 'lucide-react';
import { MarkdownFile } from '../../types/document';
import { MarkdownService } from '../../services/markdown';

interface BacklinksPanelProps {
  activeFile: MarkdownFile;
  allFiles: MarkdownFile[];
  onSelectFile: (id: string) => void;
}

export const BacklinksPanel: React.FC<BacklinksPanelProps> = ({
  activeFile,
  allFiles,
  onSelectFile,
}) => {
  const fileNameWithoutExt = activeFile.name.replace(/\.[^/.]+$/, '');
  const title = activeFile.frontmatter.title || '';

  const isExplicitWikiLink = (other: MarkdownFile) => {
    const wikiLinks = MarkdownService.extractWikiLinks(other.body);
    return wikiLinks.some((wl) => {
      const target = wl.target.toLowerCase();
      return (
        target === fileNameWithoutExt.toLowerCase() ||
        (title && target === title.toLowerCase()) ||
        target === activeFile.path.toLowerCase()
      );
    });
  };

  // Find files that mention or [[Wiki-Link]] this file
  const backlinks = allFiles.filter((other) => {
    if (other.id === activeFile.id) return false;
    if (isExplicitWikiLink(other)) return true;
    const body = other.body.toLowerCase();
    const mentionsName = body.includes(fileNameWithoutExt.toLowerCase());
    const mentionsTitle = title && body.includes(title.toLowerCase());
    const mentionsPath = body.includes(activeFile.path.toLowerCase());
    return mentionsName || mentionsTitle || mentionsPath;
  });

  if (backlinks.length === 0) return null;

  const getDocIcon = (type?: string) => {
    switch (type) {
      case 'agent':
        return <Bot className="w-3.5 h-3.5 text-purple-400 shrink-0" />;
      case 'skill':
        return <Wrench className="w-3.5 h-3.5 text-emerald-400 shrink-0" />;
      case 'project':
        return <Layers className="w-3.5 h-3.5 text-blue-400 shrink-0" />;
      default:
        return <FileText className="w-3.5 h-3.5 text-neutral-400 shrink-0" />;
    }
  };

  return (
    <div className="mt-12 pt-6 border-t border-[#26262a] font-sans">
      <div className="flex items-center gap-2 mb-3 text-xs font-semibold text-neutral-400 uppercase tracking-wider">
        <Link2 className="w-3.5 h-3.5 text-blue-400" />
        <span>Linked References ({backlinks.length})</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
        {backlinks.map((linkFile) => {
          // Extract a preview snippet around the match
          const body = linkFile.body;
          const matchIdx = Math.max(
            body.toLowerCase().indexOf(fileNameWithoutExt.toLowerCase()),
            body.toLowerCase().indexOf(title.toLowerCase())
          );
          const snippetStart = Math.max(0, matchIdx - 40);
          const snippet = body.slice(snippetStart, snippetStart + 110).trim();

          return (
            <div
              key={linkFile.id}
              onClick={() => onSelectFile(linkFile.id)}
              className="p-3 rounded-xl bg-[#1b1b1e] hover:bg-[#222226] border border-[#2c2c30] hover:border-neutral-500 transition cursor-pointer group flex flex-col justify-between"
            >
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2 font-medium text-xs text-neutral-200 group-hover:text-white truncate">
                  {getDocIcon(linkFile.frontmatter.type)}
                  <span className="truncate">{linkFile.frontmatter.title || linkFile.name}</span>
                  {isExplicitWikiLink(linkFile) && (
                    <span className="px-1.5 py-0.5 rounded bg-blue-500/15 border border-blue-500/30 text-[9px] text-blue-300 font-mono">
                      [[Wiki-Link]]
                    </span>
                  )}
                </div>
                <ExternalLink className="w-3 h-3 text-neutral-500 group-hover:text-neutral-300" />
              </div>
              <p className="text-[11px] text-neutral-400 line-clamp-2 italic bg-[#151517] p-2 rounded-lg border border-[#252528] mt-1">
                "...{snippet}..."
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
};
