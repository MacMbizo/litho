import React, { useState } from 'react';
import { 
  Tag, 
  Activity, 
  AlertCircle, 
  Bot, 
  Wrench, 
  User, 
  Calendar, 
  Plus, 
  X,
  Layers,
  ChevronDown
} from 'lucide-react';
import { DocumentMetadata, DocType } from '../../types/document';

interface FrontmatterMetaProps {
  metadata: DocumentMetadata;
  onChange: (updated: DocumentMetadata) => void;
}

export const FrontmatterMeta: React.FC<FrontmatterMetaProps> = ({ metadata, onChange }) => {
  const [newTagInput, setNewTagInput] = useState('');
  const [showTagInput, setShowTagInput] = useState(false);
  const [newToolInput, setNewToolInput] = useState('');
  const [showToolInput, setShowToolInput] = useState(false);

  const updateField = (key: keyof DocumentMetadata, value: any) => {
    onChange({
      ...metadata,
      [key]: value,
    });
  };

  const addTag = (tag: string) => {
    const trimmed = tag.trim().toLowerCase();
    if (!trimmed) return;
    const currentTags = metadata.tags || [];
    if (!currentTags.includes(trimmed)) {
      updateField('tags', [...currentTags, trimmed]);
    }
    setNewTagInput('');
    setShowTagInput(false);
  };

  const removeTag = (tagToRemove: string) => {
    updateField('tags', (metadata.tags || []).filter((t) => t !== tagToRemove));
  };

  const addTool = (tool: string) => {
    const trimmed = tool.trim();
    if (!trimmed) return;
    const currentTools = metadata.tools || [];
    if (!currentTools.includes(trimmed)) {
      updateField('tools', [...currentTools, trimmed]);
    }
    setNewToolInput('');
    setShowToolInput(false);
  };

  const removeTool = (toolToRemove: string) => {
    updateField('tools', (metadata.tools || []).filter((t) => t !== toolToRemove));
  };

  const getStatusColor = (status?: string) => {
    switch (status) {
      case 'Active':
      case 'Done':
        return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40';
      case 'In Progress':
        return 'bg-blue-500/20 text-blue-300 border-blue-500/40';
      case 'Review':
        return 'bg-amber-500/20 text-amber-300 border-amber-500/40';
      case 'Critical':
        return 'bg-rose-500/20 text-rose-300 border-rose-500/40';
      default:
        return 'bg-neutral-800 text-neutral-400 border-neutral-700';
    }
  };

  return (
    <div className="mb-8 pb-6 border-b border-[#2b2b2b] space-y-3 font-sans text-xs">
      {/* Title Header */}
      <input
        type="text"
        value={metadata.title || ''}
        onChange={(e) => updateField('title', e.target.value)}
        placeholder="Untitled"
        className="w-full text-3xl font-bold bg-transparent text-neutral-100 placeholder-neutral-600 focus:outline-none mb-3 tracking-tight"
      />

      {/* Property Grid (Notion-style) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-y-2 gap-x-6 max-w-2xl text-neutral-400">
        {/* Type Selector */}
        <div className="flex items-center gap-3">
          <div className="w-24 flex items-center gap-1.5 text-neutral-500 shrink-0">
            <Layers className="w-3.5 h-3.5" />
            <span>Type</span>
          </div>
          <select
            value={metadata.type || 'document'}
            onChange={(e) => updateField('type', e.target.value as DocType)}
            className="bg-[#242424] text-neutral-200 border border-[#333] rounded px-2 py-1 text-xs focus:outline-none cursor-pointer hover:border-neutral-500"
          >
            <option value="document">Document</option>
            <option value="project">Project</option>
            <option value="agent">Agent</option>
            <option value="skill">Skill</option>
            <option value="note">Quick Note</option>
          </select>
        </div>

        {/* Status */}
        <div className="flex items-center gap-3">
          <div className="w-24 flex items-center gap-1.5 text-neutral-500 shrink-0">
            <Activity className="w-3.5 h-3.5" />
            <span>Status</span>
          </div>
          <select
            value={metadata.status || 'Draft'}
            onChange={(e) => updateField('status', e.target.value)}
            className={`rounded px-2.5 py-0.5 text-xs border font-medium cursor-pointer focus:outline-none ${getStatusColor(metadata.status)}`}
          >
            <option value="Draft" className="bg-[#242424] text-neutral-300">Draft</option>
            <option value="Backlog" className="bg-[#242424] text-neutral-300">Backlog</option>
            <option value="In Progress" className="bg-[#242424] text-blue-300">In Progress</option>
            <option value="Review" className="bg-[#242424] text-amber-300">Review</option>
            <option value="Active" className="bg-[#242424] text-emerald-300">Active</option>
            <option value="Done" className="bg-[#242424] text-emerald-300">Done</option>
          </select>
        </div>

        {/* Priority */}
        <div className="flex items-center gap-3">
          <div className="w-24 flex items-center gap-1.5 text-neutral-500 shrink-0">
            <AlertCircle className="w-3.5 h-3.5" />
            <span>Priority</span>
          </div>
          <select
            value={metadata.priority || 'Medium'}
            onChange={(e) => updateField('priority', e.target.value)}
            className="bg-[#242424] text-neutral-200 border border-[#333] rounded px-2 py-1 text-xs focus:outline-none cursor-pointer"
          >
            <option value="Low">Low</option>
            <option value="Medium">Medium</option>
            <option value="High">High</option>
            <option value="Critical">Critical</option>
          </select>
        </div>

        {/* Author / Owner */}
        <div className="flex items-center gap-3">
          <div className="w-24 flex items-center gap-1.5 text-neutral-500 shrink-0">
            <User className="w-3.5 h-3.5" />
            <span>Owner</span>
          </div>
          <input
            type="text"
            value={metadata.author || ''}
            onChange={(e) => updateField('author', e.target.value)}
            placeholder="Assign owner..."
            className="bg-transparent hover:bg-[#242424] focus:bg-[#242424] px-2 py-0.5 rounded text-neutral-200 border border-transparent hover:border-[#333] focus:border-[#444] focus:outline-none"
          />
        </div>

        {/* Agent Specific: Model */}
        {metadata.type === 'agent' && (
          <div className="flex items-center gap-3">
            <div className="w-24 flex items-center gap-1.5 text-neutral-500 shrink-0">
              <Bot className="w-3.5 h-3.5" />
              <span>Model</span>
            </div>
            <input
              type="text"
              value={metadata.model || ''}
              onChange={(e) => updateField('model', e.target.value)}
              placeholder="e.g. llama3, gemini-1.5-pro"
              className="bg-[#242424] px-2 py-1 rounded text-neutral-200 border border-[#333] text-xs focus:outline-none font-mono"
            />
          </div>
        )}

        {/* Skill Specific: Category */}
        {metadata.type === 'skill' && (
          <div className="flex items-center gap-3">
            <div className="w-24 flex items-center gap-1.5 text-neutral-500 shrink-0">
              <Wrench className="w-3.5 h-3.5" />
              <span>Category</span>
            </div>
            <input
              type="text"
              value={metadata.category || ''}
              onChange={(e) => updateField('category', e.target.value)}
              placeholder="e.g. AI Ops, Dev Tools"
              className="bg-[#242424] px-2 py-1 rounded text-neutral-200 border border-[#333] text-xs focus:outline-none"
            />
          </div>
        )}
      </div>

      {/* Tags Row */}
      <div className="flex items-start gap-3 pt-1">
        <div className="w-24 flex items-center gap-1.5 text-neutral-500 pt-1 shrink-0">
          <Tag className="w-3.5 h-3.5" />
          <span>Tags</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {(metadata.tags || []).map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#282828] text-neutral-300 border border-[#383838] hover:border-neutral-500 transition text-[11px]"
            >
              #{tag}
              <button
                onClick={() => removeTag(tag)}
                className="text-neutral-500 hover:text-rose-400 ml-0.5"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </span>
          ))}

          {showTagInput ? (
            <div className="inline-flex items-center gap-1">
              <input
                type="text"
                value={newTagInput}
                onChange={(e) => setNewTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') addTag(newTagInput);
                  if (e.key === 'Escape') setShowTagInput(false);
                }}
                autoFocus
                placeholder="tag name..."
                className="bg-[#252525] border border-blue-500/50 rounded px-2 py-0.5 text-[11px] text-white focus:outline-none w-24"
              />
              <button
                onClick={() => addTag(newTagInput)}
                className="px-1.5 py-0.5 rounded bg-blue-600 text-white text-[10px]"
              >
                Add
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowTagInput(true)}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-neutral-500 hover:text-neutral-300 hover:bg-[#252525] text-[11px] transition"
            >
              <Plus className="w-3 h-3" /> Add Tag
            </button>
          )}
        </div>
      </div>

      {/* Tools Row (For Agents) */}
      {metadata.type === 'agent' && (
        <div className="flex items-start gap-3 pt-1">
          <div className="w-24 flex items-center gap-1.5 text-neutral-500 pt-1 shrink-0">
            <Wrench className="w-3.5 h-3.5" />
            <span>Tools</span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {(metadata.tools || []).map((tool) => (
              <span
                key={tool}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-purple-950/40 text-purple-300 border border-purple-800/40 text-[11px] font-mono"
              >
                {tool}
                <button
                  onClick={() => removeTool(tool)}
                  className="text-purple-400 hover:text-rose-400 ml-0.5"
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              </span>
            ))}

            {showToolInput ? (
              <div className="inline-flex items-center gap-1">
                <input
                  type="text"
                  value={newToolInput}
                  onChange={(e) => setNewToolInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') addTool(newToolInput);
                    if (e.key === 'Escape') setShowToolInput(false);
                  }}
                  autoFocus
                  placeholder="tool_name"
                  className="bg-[#252525] border border-purple-500/50 rounded px-2 py-0.5 text-[11px] text-white focus:outline-none w-28 font-mono"
                />
                <button
                  onClick={() => addTool(newToolInput)}
                  className="px-1.5 py-0.5 rounded bg-purple-600 text-white text-[10px]"
                >
                  Add
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowToolInput(true)}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-neutral-500 hover:text-neutral-300 hover:bg-[#252525] text-[11px] transition"
              >
                <Plus className="w-3 h-3" /> Add Tool
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
