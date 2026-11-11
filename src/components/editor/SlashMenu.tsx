import React, { useState, useEffect } from 'react';
import { 
  Heading1, 
  Heading2, 
  Heading3, 
  List, 
  CheckSquare, 
  Code, 
  Quote, 
  Table, 
  Minus, 
  Bot, 
  Wrench,
  Sparkles,
  Link2,
  GitBranch,
  Sigma
} from 'lucide-react';

export interface SlashMenuItem {
  id: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  insertText: string;
}

interface SlashMenuProps {
  isOpen: boolean;
  position: { top: number; left: number };
  onClose: () => void;
  onSelect: (item: SlashMenuItem) => void;
  query: string;
}

export const SlashMenu: React.FC<SlashMenuProps> = ({
  isOpen,
  position,
  onClose,
  onSelect,
  query,
}) => {
  const [selectedIndex, setSelectedIndex] = useState(0);

  const items: SlashMenuItem[] = [
    {
      id: 'h1',
      title: 'Heading 1',
      description: 'Large section heading',
      icon: <Heading1 className="w-4 h-4 text-sky-400" />,
      insertText: '# ',
    },
    {
      id: 'h2',
      title: 'Heading 2',
      description: 'Medium sub-heading',
      icon: <Heading2 className="w-4 h-4 text-sky-400" />,
      insertText: '## ',
    },
    {
      id: 'h3',
      title: 'Heading 3',
      description: 'Small sub-heading',
      icon: <Heading3 className="w-4 h-4 text-sky-400" />,
      insertText: '### ',
    },
    {
      id: 'todo',
      title: 'To-do List',
      description: 'Interactive checklist item',
      icon: <CheckSquare className="w-4 h-4 text-emerald-400" />,
      insertText: '- [ ] ',
    },
    {
      id: 'bullet',
      title: 'Bulleted List',
      description: 'Simple bullet point',
      icon: <List className="w-4 h-4 text-neutral-400" />,
      insertText: '- ',
    },
    {
      id: 'callout',
      title: 'Callout Box',
      description: 'Highlighted callout container',
      icon: <Quote className="w-4 h-4 text-amber-400" />,
      insertText: '> 💡 **Note**: ',
    },
    {
      id: 'code',
      title: 'Code Block',
      description: 'Syntax highlighted code container',
      icon: <Code className="w-4 h-4 text-purple-400" />,
      insertText: '```typescript\n\n```',
    },
    {
      id: 'table',
      title: 'Table',
      description: 'Insert standard markdown table',
      icon: <Table className="w-4 h-4 text-blue-400" />,
      insertText: '| Header 1 | Header 2 | Header 3 |\n| --- | --- | --- |\n| Item 1 | Value A | 100 |\n| Item 2 | Value B | 200 |\n',
    },
    {
      id: 'divider',
      title: 'Divider',
      description: 'Visual horizontal line',
      icon: <Minus className="w-4 h-4 text-neutral-500" />,
      insertText: '\n---\n\n',
    },
    {
      id: 'wikilink',
      title: 'Wiki-Link [[Document]]',
      description: 'Link to another document, agent, or skill in vault',
      icon: <Link2 className="w-4 h-4 text-blue-400" />,
      insertText: '[[',
    },
    {
      id: 'mermaid_flow',
      title: 'Mermaid Flowchart',
      description: 'Interactive flowchart diagram block',
      icon: <GitBranch className="w-4 h-4 text-indigo-400" />,
      insertText: '```mermaid\nflowchart LR\n  Start([User Request]) --> Agent[AI Agent]\n  Agent --> Decision{Valid?}\n  Decision -->|Yes| Output([Execute Task])\n  Decision -->|No| Retry[Refine Prompt]\n```\n',
    },
    {
      id: 'mermaid_seq',
      title: 'Mermaid Sequence Diagram',
      description: 'Interactive actor sequence diagram',
      icon: <GitBranch className="w-4 h-4 text-sky-400" />,
      insertText: '```mermaid\nsequenceDiagram\n  participant User\n  participant Agent\n  participant Vault\n  User->>Agent: Query Knowledge Base\n  Agent->>Vault: Retrieve [[Wiki-Links]]\n  Vault-->>Agent: Relevant Context\n  Agent-->>User: Cited Response\n```\n',
    },
    {
      id: 'math',
      title: 'Math Equation (LaTeX)',
      description: 'Display mathematical formula block ($$...$$)',
      icon: <Sigma className="w-4 h-4 text-amber-400" />,
      insertText: '$$\n\\mathcal{L}(\\theta) = \\frac{1}{N} \\sum_{i=1}^{N} \\left( y_i - \\hat{y}_i \\right)^2 + \\lambda \\|\\theta\\|^2\n$$\n',
    },
    {
      id: 'agent_spec',
      title: 'Agent Persona Block',
      description: 'Insert AI agent system prompt template',
      icon: <Bot className="w-4 h-4 text-purple-400" />,
      insertText: '## System Prompt\nYou are an autonomous agent specialized in...\n\n## Tools & Capabilities\n- [ ] Tool 1\n',
    },
  ];

  const filtered = items.filter((item) =>
    item.title.toLowerCase().includes(query.toLowerCase()) ||
    item.description.toLowerCase().includes(query.toLowerCase())
  );

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % filtered.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + filtered.length) % filtered.length);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (filtered[selectedIndex]) {
          onSelect(filtered[selectedIndex]);
        }
      } else if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, filtered, selectedIndex, onSelect, onClose]);

  if (!isOpen || filtered.length === 0) return null;

  return (
    <div
      style={{ top: `${position.top}px`, left: `${position.left}px` }}
      className="fixed z-50 w-72 max-h-80 overflow-y-auto bg-[#222222] border border-[#383838] rounded-lg shadow-2xl p-1 font-sans text-xs"
    >
      <div className="px-2 py-1 text-[10px] uppercase font-semibold text-neutral-500 tracking-wider">
        Basic Blocks
      </div>
      <div className="space-y-0.5 mt-1">
        {filtered.map((item, index) => {
          const isSelected = index === selectedIndex;
          return (
            <div
              key={item.id}
              onClick={() => onSelect(item)}
              onMouseEnter={() => setSelectedIndex(index)}
              className={`flex items-center gap-3 px-2.5 py-2 rounded-md cursor-pointer transition ${
                isSelected ? 'bg-[#2f2f2f] text-white' : 'text-neutral-300 hover:bg-[#282828]'
              }`}
            >
              <div className="p-1.5 rounded bg-[#1c1c1c] border border-[#333]">
                {item.icon}
              </div>
              <div className="flex-1 truncate">
                <div className="font-medium truncate">{item.title}</div>
                <div className="text-[10px] text-neutral-500 truncate">{item.description}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
