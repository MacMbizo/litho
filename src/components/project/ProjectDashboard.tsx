import React from 'react';
import { 
  Folder, 
  FileText, 
  Bot, 
  Wrench, 
  Layers, 
  CheckSquare, 
  ExternalLink, 
  Plus, 
  RefreshCw, 
  Sparkles, 
  Share2, 
  BookOpen, 
  Activity,
  HardDrive
} from 'lucide-react';
import { ProjectWorkspace, MarkdownFile, ViewMode } from '../../types/document';
import { ProjectScannerService } from '../../services/projectScanner';

interface ProjectDashboardProps {
  project: ProjectWorkspace;
  onSelectFile: (id: string) => void;
  onSelectViewMode: (mode: ViewMode) => void;
  onNewFile: () => void;
  onRefreshProject: () => void;
}

export const ProjectDashboard: React.FC<ProjectDashboardProps> = ({
  project,
  onSelectFile,
  onSelectViewMode,
  onNewFile,
  onRefreshProject,
}) => {
  const files = project.files;

  // Compute project metrics
  const totalDocs = files.length;
  const totalWords = files.reduce((acc, f) => acc + (f.wordCount || 0), 0);
  const totalTasks = files.reduce((acc, f) => acc + (f.tasks?.length || 0), 0);
  const completedTasks = files.reduce(
    (acc, f) => acc + (f.tasks?.filter((t) => t.completed).length || 0),
    0
  );
  const percentComplete = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  // Breakdown by entity type
  const agents = files.filter((f) => f.frontmatter.type === 'agent');
  const skills = files.filter((f) => f.frontmatter.type === 'skill');
  const projects = files.filter((f) => f.frontmatter.type === 'project');

  // Key documents: README, ARCHITECTURE, ADR, ROADMAP
  const keyDocs = files.filter((f) => {
    const lower = f.name.toLowerCase();
    return (
      lower.includes('readme') ||
      lower.includes('architecture') ||
      lower.includes('adr') ||
      lower.includes('roadmap') ||
      lower.includes('contributing')
    );
  });

  return (
    <div className="flex-1 h-full flex flex-col bg-[#181818] font-sans overflow-y-auto">
      {/* Top Project Banner */}
      <div className="p-8 border-b border-[#2b2b2b] bg-[#1d1d1d] shrink-0">
        <div className="max-w-5xl mx-auto space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400">
                <Folder className="w-6 h-6" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-neutral-100 tracking-tight flex items-center gap-2">
                  <span>{project.name}</span>
                </h1>
                <p className="text-xs text-neutral-400 font-mono flex items-center gap-1.5 mt-0.5">
                  <HardDrive className="w-3.5 h-3.5 text-neutral-500" />
                  <span className="truncate max-w-xl">{project.rootPath}</span>
                </p>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2">
              <button
                onClick={onRefreshProject}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#282828] hover:bg-[#333] border border-[#383838] text-neutral-300 text-xs transition"
                title="Rescan project folder"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Rescan</span>
              </button>
              <button
                onClick={onNewFile}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium text-xs transition shadow-sm"
              >
                <Plus className="w-4 h-4" />
                <span>New Doc</span>
              </button>
            </div>
          </div>

          {/* Key Metrics Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
            <div className="p-3.5 rounded-xl bg-[#222] border border-[#2e2e2e]">
              <div className="text-[11px] font-medium text-neutral-400 uppercase tracking-wider">
                Markdown Files
              </div>
              <div className="text-xl font-bold text-neutral-100 mt-1">{totalDocs}</div>
              <div className="text-[10px] text-neutral-500 mt-0.5">{totalWords.toLocaleString()} total words</div>
            </div>

            <div className="p-3.5 rounded-xl bg-[#222] border border-[#2e2e2e]">
              <div className="text-[11px] font-medium text-neutral-400 uppercase tracking-wider">
                Action Items
              </div>
              <div className="text-xl font-bold text-emerald-400 mt-1">
                {completedTasks}/{totalTasks}
              </div>
              <div className="text-[10px] text-neutral-500 mt-0.5">{percentComplete}% completed</div>
            </div>

            <div className="p-3.5 rounded-xl bg-[#222] border border-[#2e2e2e]">
              <div className="text-[11px] font-medium text-neutral-400 uppercase tracking-wider">
                Agents & Skills
              </div>
              <div className="text-xl font-bold text-purple-400 mt-1">
                {agents.length + skills.length}
              </div>
              <div className="text-[10px] text-neutral-500 mt-0.5">{agents.length} agents, {skills.length} skills</div>
            </div>

            <div className="p-3.5 rounded-xl bg-[#222] border border-[#2e2e2e]">
              <div className="text-[11px] font-medium text-neutral-400 uppercase tracking-wider">
                Project Lens
              </div>
              <div className="flex items-center gap-1.5 mt-2">
                <button
                  onClick={() => onSelectViewMode('database')}
                  className="px-2 py-1 rounded bg-[#2a2a2a] hover:bg-[#333] text-amber-300 text-[11px] font-medium transition"
                >
                  Database
                </button>
                <button
                  onClick={() => onSelectViewMode('graph')}
                  className="px-2 py-1 rounded bg-[#2a2a2a] hover:bg-[#333] text-violet-300 text-[11px] font-medium transition"
                >
                  Graph
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Body */}
      <div className="max-w-5xl mx-auto p-8 space-y-8 w-full">
        {/* Key Documentation Spotlight */}
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-neutral-200 uppercase tracking-wider flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-sky-400" />
            <span>Key Project Documentation ({keyDocs.length})</span>
          </h2>

          {keyDocs.length === 0 ? (
            <div className="p-6 rounded-xl border border-dashed border-[#2d2d2d] text-center text-xs text-neutral-500">
              No README or architecture specs found at the root.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {keyDocs.map((doc) => (
                <div
                  key={doc.id}
                  onClick={() => onSelectFile(doc.id)}
                  className="p-4 rounded-xl bg-[#202020] hover:bg-[#252525] border border-[#2d2d2d] hover:border-neutral-500 transition cursor-pointer group flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2 font-semibold text-xs text-neutral-100 group-hover:text-white">
                        <FileText className="w-3.5 h-3.5 text-blue-400" />
                        <span className="truncate">{doc.frontmatter.title || doc.name}</span>
                      </div>
                      <span className="text-[10px] text-neutral-500 font-mono">{doc.path}</span>
                    </div>
                    <p className="text-xs text-neutral-400 line-clamp-2 leading-relaxed">
                      {doc.body.replace(/^[#>\s\-*`]+/gm, '').trim().slice(0, 100) || 'Empty document'}
                    </p>
                  </div>
                  <div className="flex items-center justify-between pt-3 mt-2 border-t border-[#2a2a2a] text-[10px] text-neutral-500">
                    <span>{doc.wordCount} words</span>
                    <span className="group-hover:text-neutral-300 flex items-center gap-1">
                      <span>Open in editor</span>
                      <ExternalLink className="w-3 h-3" />
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* AI Agents & Skills in this Project */}
        {(agents.length > 0 || skills.length > 0) && (
          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-neutral-200 uppercase tracking-wider flex items-center gap-2">
              <Bot className="w-4 h-4 text-purple-400" />
              <span>Project AI Agents & Skills</span>
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {agents.map((agent) => (
                <div
                  key={agent.id}
                  onClick={() => onSelectFile(agent.id)}
                  className="p-3.5 rounded-xl bg-[#202020] hover:bg-[#252525] border border-purple-500/20 hover:border-purple-500/50 transition cursor-pointer"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <div className="p-1 rounded bg-purple-500/20 text-purple-300">
                      <Bot className="w-4 h-4" />
                    </div>
                    <span className="font-semibold text-xs text-neutral-200 truncate">
                      {agent.frontmatter.title || agent.name}
                    </span>
                  </div>
                  <div className="text-[10px] font-mono text-purple-400 bg-purple-950/40 px-2 py-0.5 rounded border border-purple-800/40 inline-block mb-2">
                    {agent.frontmatter.model || 'model unspecified'}
                  </div>
                  <div className="text-xs text-neutral-400 line-clamp-2">
                    {agent.body.replace(/^[#>\s\-*`]+/gm, '').trim().slice(0, 80)}
                  </div>
                </div>
              ))}

              {skills.map((skill) => (
                <div
                  key={skill.id}
                  onClick={() => onSelectFile(skill.id)}
                  className="p-3.5 rounded-xl bg-[#202020] hover:bg-[#252525] border border-emerald-500/20 hover:border-emerald-500/50 transition cursor-pointer"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <div className="p-1 rounded bg-emerald-500/20 text-emerald-300">
                      <Wrench className="w-4 h-4" />
                    </div>
                    <span className="font-semibold text-xs text-neutral-200 truncate">
                      {skill.frontmatter.title || skill.name}
                    </span>
                  </div>
                  <div className="text-[10px] text-emerald-400 bg-emerald-950/40 px-2 py-0.5 rounded border border-emerald-800/40 inline-block mb-2">
                    {skill.frontmatter.category || 'General Skill'}
                  </div>
                  <div className="text-xs text-neutral-400 line-clamp-2">
                    {skill.body.replace(/^[#>\s\-*`]+/gm, '').trim().slice(0, 80)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
