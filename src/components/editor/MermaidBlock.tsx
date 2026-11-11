import React, { useState, useMemo } from 'react';
import { GitBranch, Code2, Eye, Copy, Check, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';

interface MermaidBlockProps {
  code: string;
}

interface ParsedNode {
  id: string;
  label: string;
  shape: 'rect' | 'round' | 'diamond' | 'circle' | 'stadium';
}

interface ParsedEdge {
  from: string;
  to: string;
  label?: string;
  dashed?: boolean;
}

interface SequenceActor {
  id: string;
  label: string;
}

interface SequenceMessage {
  from: string;
  to: string;
  text: string;
  dashed: boolean;
}

export const MermaidBlock: React.FC<MermaidBlockProps> = ({ code }) => {
  const [viewMode, setViewMode] = useState<'diagram' | 'code'>('diagram');
  const [copied, setCopied] = useState(false);
  const [zoom, setZoom] = useState(1);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const parsed = useMemo(() => {
    const rawLines = code
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('%%'));

    if (rawLines.length === 0) {
      return { type: 'empty' as const };
    }

    const header = rawLines[0].toLowerCase();

    // 1. Sequence Diagram
    if (header.startsWith('sequencediagram')) {
      const actorsMap = new Map<string, SequenceActor>();
      const messages: SequenceMessage[] = [];

      const ensureActor = (id: string, label?: string) => {
        const cleanId = id.trim();
        if (!actorsMap.has(cleanId)) {
          actorsMap.set(cleanId, {
            id: cleanId,
            label: (label || cleanId).replace(/^["']|["']$/g, ''),
          });
        } else if (label) {
          actorsMap.get(cleanId)!.label = label.replace(/^["']|["']$/g, '');
        }
      };

      for (let i = 1; i < rawLines.length; i++) {
        const line = rawLines[i];
        const partMatch = line.match(/^(?:participant|actor)\s+([^\s]+)(?:\s+as\s+(.+))?$/i);
        if (partMatch) {
          ensureActor(partMatch[1], partMatch[2]);
          continue;
        }

        const msgMatch = line.match(/^([A-Za-z0-9_.-]+)\s*(--?>?>?|->>|-->>|->|-->)\s*([A-Za-z0-9_.-]+)\s*:\s*(.+)$/);
        if (msgMatch) {
          const from = msgMatch[1];
          const arrow = msgMatch[2];
          const to = msgMatch[3];
          const text = msgMatch[4].trim();
          ensureActor(from);
          ensureActor(to);
          messages.push({
            from,
            to,
            text,
            dashed: arrow.startsWith('--'),
          });
        }
      }

      return {
        type: 'sequence' as const,
        actors: Array.from(actorsMap.values()),
        messages,
      };
    }

    // 2. Flowchart / Graph / State Diagram
    const isHorizontal = /\b(lr|rl)\b/i.test(header);
    const nodesMap = new Map<string, ParsedNode>();
    const edges: ParsedEdge[] = [];

    const parseNodeToken = (token: string): string => {
      const trimmed = token.trim();
      if (trimmed === '[*]') {
        if (!nodesMap.has('__start__')) {
          nodesMap.set('__start__', { id: '__start__', label: '●', shape: 'circle' });
        }
        return '__start__';
      }

      // Match ID + shape brackets: A["Label"], B(Label), C{Decision}, D((Circle)), E([Stadium])
      const match = trimmed.match(/^([A-Za-z0-9_.-]+)\s*(?:\(\((.+)\)\)|\(\[(.+)\]\)|\{(.+)\}|\[(.+)\]|\((.+)\))?$/);
      if (!match) {
        const fallbackId = trimmed.replace(/[^A-Za-z0-9_.-]/g, '_') || 'node';
        if (!nodesMap.has(fallbackId)) {
          nodesMap.set(fallbackId, { id: fallbackId, label: trimmed, shape: 'rect' });
        }
        return fallbackId;
      }

      const id = match[1];
      const circleLbl = match[2];
      const stadiumLbl = match[3];
      const diamondLbl = match[4];
      const rectLbl = match[5];
      const roundLbl = match[6];

      const cleanLabel = (lbl?: string) => (lbl ? lbl.replace(/^["']|["']$/g, '').trim() : id);

      if (circleLbl !== undefined) {
        nodesMap.set(id, { id, label: cleanLabel(circleLbl), shape: 'circle' });
      } else if (stadiumLbl !== undefined) {
        nodesMap.set(id, { id, label: cleanLabel(stadiumLbl), shape: 'stadium' });
      } else if (diamondLbl !== undefined) {
        nodesMap.set(id, { id, label: cleanLabel(diamondLbl), shape: 'diamond' });
      } else if (rectLbl !== undefined) {
        nodesMap.set(id, { id, label: cleanLabel(rectLbl), shape: 'rect' });
      } else if (roundLbl !== undefined) {
        nodesMap.set(id, { id, label: cleanLabel(roundLbl), shape: 'round' });
      } else if (!nodesMap.has(id)) {
        nodesMap.set(id, { id, label: id, shape: 'round' });
      }

      return id;
    };

    const startIdx = /^(graph|flowchart|statediagram)/i.test(header) ? 1 : 0;

    for (let i = startIdx; i < rawLines.length; i++) {
      const line = rawLines[i].replace(/;$/, '');
      if (/^(subgraph|end|direction|style|classDef|class)\b/i.test(line)) continue;

      // State diagram style: StateA --> StateB : label
      const stateEdgeMatch = line.match(/^(.+?)\s*(-->|-.->|==>)\s*(.+?)(?:\s*:\s*(.+))?$/);
      if (stateEdgeMatch && !line.includes('|')) {
        const leftRaw = stateEdgeMatch[1].trim();
        const arrow = stateEdgeMatch[2];
        const rightRaw = stateEdgeMatch[3].trim();
        const colonLabel = stateEdgeMatch[4]?.trim();

        // Check if leftRaw has inline label like A -- text --> B
        const inlineLabelMatch = leftRaw.match(/^(.+?)\s+-\.?-\s+(.+)$/);
        if (inlineLabelMatch) {
          const fromId = parseNodeToken(inlineLabelMatch[1]);
          const toId = parseNodeToken(rightRaw);
          edges.push({
            from: fromId,
            to: toId,
            label: inlineLabelMatch[2].trim(),
            dashed: arrow.includes('.'),
          });
        } else {
          const fromId = parseNodeToken(leftRaw);
          const toId = parseNodeToken(rightRaw);
          edges.push({
            from: fromId,
            to: toId,
            label: colonLabel,
            dashed: arrow.includes('.'),
          });
        }
        continue;
      }

      // Flowchart pipe label style: A -->|label| B
      const pipeEdgeMatch = line.match(/^(.+?)\s*(-->|-.->|==>|---)\s*(?:\|([^|]+)\|)?\s*(.+)$/);
      if (pipeEdgeMatch) {
        const fromId = parseNodeToken(pipeEdgeMatch[1]);
        const arrow = pipeEdgeMatch[2];
        const edgeLabel = pipeEdgeMatch[3]?.trim();
        const toId = parseNodeToken(pipeEdgeMatch[4]);
        edges.push({
          from: fromId,
          to: toId,
          label: edgeLabel,
          dashed: arrow.includes('.'),
        });
        continue;
      }

      // Standalone node definition
      parseNodeToken(line);
    }

    return {
      type: 'flowchart' as const,
      isHorizontal,
      nodes: Array.from(nodesMap.values()),
      edges,
    };
  }, [code]);

  const renderSequenceSVG = (actors: SequenceActor[], messages: SequenceMessage[]) => {
    const colWidth = 170;
    const padX = 70;
    const topY = 45;
    const rowHeight = 52;
    const width = Math.max(460, actors.length * colWidth + padX * 2);
    const height = Math.max(220, topY + 60 + messages.length * rowHeight + 50);

    const getActorX = (id: string) => {
      const idx = actors.findIndex((a) => a.id === id);
      return padX + (idx >= 0 ? idx : 0) * colWidth + 60;
    };

    return (
      <svg
        width={width * zoom}
        height={height * zoom}
        viewBox={`0 0 ${width} ${height}`}
        className="mx-auto select-none"
      >
        <defs>
          <marker id="seq-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
            <path d="M0,0 L8,4 L0,8 Z" fill="#60a5fa" />
          </marker>
        </defs>

        {/* Lifelines */}
        {actors.map((actor) => {
          const cx = getActorX(actor.id);
          return (
            <g key={actor.id}>
              <line
                x1={cx}
                y1={topY + 32}
                x2={cx}
                y2={height - 30}
                stroke="#32323c"
                strokeWidth="1.5"
                strokeDasharray="5,5"
              />
              <rect
                x={cx - 60}
                y={topY}
                width={120}
                height={34}
                rx={8}
                fill="#22222a"
                stroke="#4b5563"
                strokeWidth="1.5"
              />
              <text
                x={cx}
                y={topY + 21}
                textAnchor="middle"
                fill="#f3f4f6"
                fontSize="12"
                fontWeight="600"
              >
                {actor.label.slice(0, 16)}
              </text>
            </g>
          );
        })}

        {/* Messages */}
        {messages.map((msg, i) => {
          const x1 = getActorX(msg.from);
          const x2 = getActorX(msg.to);
          const y = topY + 72 + i * rowHeight;
          const midX = (x1 + x2) / 2;

          return (
            <g key={i}>
              <line
                x1={x1}
                y1={y}
                x2={x2}
                y2={y}
                stroke="#60a5fa"
                strokeWidth="1.75"
                strokeDasharray={msg.dashed ? '5,4' : undefined}
                markerEnd="url(#seq-arrow)"
              />
              <rect
                x={midX - Math.min(90, msg.text.length * 3.5 + 10)}
                y={y - 22}
                width={Math.min(180, msg.text.length * 7 + 20)}
                height={18}
                rx={4}
                fill="#16161a"
              />
              <text
                x={midX}
                y={y - 9}
                textAnchor="middle"
                fill="#cbd5e1"
                fontSize="11"
              >
                {msg.text}
              </text>
            </g>
          );
        })}
      </svg>
    );
  };

  const renderFlowchartSVG = (nodes: ParsedNode[], edges: ParsedEdge[], isHorizontal: boolean) => {
    if (nodes.length === 0) {
      return <div className="text-xs text-neutral-500 py-6 text-center">Empty diagram</div>;
    }

    // Compute topological levels via BFS
    const inDegree = new Map<string, number>();
    const adj = new Map<string, string[]>();
    nodes.forEach((n) => {
      inDegree.set(n.id, 0);
      adj.set(n.id, []);
    });
    edges.forEach((e) => {
      if (adj.has(e.from) && inDegree.has(e.to)) {
        adj.get(e.from)!.push(e.to);
        inDegree.set(e.to, (inDegree.get(e.to) || 0) + 1);
      }
    });

    const levels = new Map<string, number>();
    const queue: string[] = [];
    nodes.forEach((n) => {
      if ((inDegree.get(n.id) || 0) === 0) {
        levels.set(n.id, 0);
        queue.push(n.id);
      }
    });
    if (queue.length === 0 && nodes.length > 0) {
      levels.set(nodes[0].id, 0);
      queue.push(nodes[0].id);
    }

    while (queue.length > 0) {
      const curr = queue.shift()!;
      const currLvl = levels.get(curr) || 0;
      for (const next of adj.get(curr) || []) {
        if (!levels.has(next)) {
          levels.set(next, currLvl + 1);
          queue.push(next);
        }
      }
    }

    nodes.forEach((n) => {
      if (!levels.has(n.id)) levels.set(n.id, 0);
    });

    // Group nodes by level
    const levelGroups = new Map<number, ParsedNode[]>();
    nodes.forEach((n) => {
      const lvl = levels.get(n.id) || 0;
      if (!levelGroups.has(lvl)) levelGroups.set(lvl, []);
      levelGroups.get(lvl)!.push(n);
    });

    const maxLevel = Math.max(...Array.from(levelGroups.keys()), 0);
    const maxPerLevel = Math.max(...Array.from(levelGroups.values()).map((g) => g.length), 1);

    const nodeW = 148;
    const nodeH = 42;
    const gapMain = isHorizontal ? 210 : 96;
    const gapCross = isHorizontal ? 86 : 185;

    const width = isHorizontal
      ? Math.max(460, (maxLevel + 1) * gapMain + 80)
      : Math.max(460, maxPerLevel * gapCross + 100);
    const height = isHorizontal
      ? Math.max(220, maxPerLevel * gapCross + 80)
      : Math.max(220, (maxLevel + 1) * gapMain + 60);

    const coords = new Map<string, { x: number; y: number }>();
    levelGroups.forEach((group, lvl) => {
      group.forEach((node, idx) => {
        const offset = (idx - (group.length - 1) / 2) * gapCross;
        if (isHorizontal) {
          coords.set(node.id, {
            x: 95 + lvl * gapMain,
            y: height / 2 + offset,
          });
        } else {
          coords.set(node.id, {
            x: width / 2 + offset,
            y: 50 + lvl * gapMain,
          });
        }
      });
    });

    return (
      <svg
        width={width * zoom}
        height={height * zoom}
        viewBox={`0 0 ${width} ${height}`}
        className="mx-auto select-none"
      >
        <defs>
          <marker id="flow-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
            <path d="M0,0 L8,4 L0,8 Z" fill="#818cf8" />
          </marker>
        </defs>

        {/* Edges */}
        {edges.map((edge, idx) => {
          const from = coords.get(edge.from);
          const to = coords.get(edge.to);
          if (!from || !to) return null;

          const dx = to.x - from.x;
          const dy = to.y - from.y;
          const dist = Math.hypot(dx, dy) || 1;

          const startOffset = 26;
          const endOffset = 30;
          const x1 = from.x + (dx / dist) * startOffset;
          const y1 = from.y + (dy / dist) * startOffset;
          const x2 = to.x - (dx / dist) * endOffset;
          const y2 = to.y - (dy / dist) * endOffset;
          const midX = (x1 + x2) / 2;
          const midY = (y1 + y2) / 2;

          return (
            <g key={idx}>
              <path
                d={`M ${x1} ${y1} Q ${(x1 + midX) / 2} ${midY}, ${x2} ${y2}`}
                fill="none"
                stroke="#818cf8"
                strokeWidth="1.75"
                strokeDasharray={edge.dashed ? '5,4' : undefined}
                markerEnd="url(#flow-arrow)"
              />
              {edge.label && (
                <g>
                  <rect
                    x={midX - Math.min(60, edge.label.length * 3.5 + 8)}
                    y={midY - 10}
                    width={Math.min(120, edge.label.length * 7 + 16)}
                    height={18}
                    rx={4}
                    fill="#16161a"
                    stroke="#2e2e38"
                  />
                  <text
                    x={midX}
                    y={midY + 3}
                    textAnchor="middle"
                    fill="#a5b4fc"
                    fontSize="10"
                    fontWeight="500"
                  >
                    {edge.label}
                  </text>
                </g>
              )}
            </g>
          );
        })}

        {/* Nodes */}
        {nodes.map((node) => {
          const pos = coords.get(node.id);
          if (!pos) return null;

          return (
            <g key={node.id} transform={`translate(${pos.x}, ${pos.y})`}>
              {node.shape === 'diamond' ? (
                <polygon
                  points={`0,-26 74,0 0,26 -74,0`}
                  fill="#231f33"
                  stroke="#a855f7"
                  strokeWidth="1.5"
                />
              ) : node.shape === 'circle' ? (
                <circle
                  r={22}
                  fill="#1e293b"
                  stroke="#38bdf8"
                  strokeWidth="1.5"
                />
              ) : (
                <rect
                  x={-nodeW / 2}
                  y={-nodeH / 2}
                  width={nodeW}
                  height={nodeH}
                  rx={node.shape === 'stadium' ? 21 : node.shape === 'round' ? 10 : 4}
                  fill="#1f2028"
                  stroke="#6366f1"
                  strokeWidth="1.5"
                />
              )}
              <text
                x={0}
                y={4}
                textAnchor="middle"
                fill="#f3f4f6"
                fontSize="11.5"
                fontWeight="500"
              >
                {node.label.length > 20 ? node.label.slice(0, 19) + '…' : node.label}
              </text>
            </g>
          );
        })}
      </svg>
    );
  };

  return (
    <div className="my-4 rounded-xl bg-[#141417] border border-[#2b2b34] overflow-hidden shadow-md font-sans">
      {/* Header Bar */}
      <div className="flex items-center justify-between px-3.5 py-2 bg-[#1b1b20] border-b border-[#2b2b34] text-xs">
        <div className="flex items-center gap-2">
          <GitBranch className="w-3.5 h-3.5 text-indigo-400" />
          <span className="font-semibold text-indigo-300">Mermaid Diagram</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 font-mono">
            {parsed.type}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {viewMode === 'diagram' && (
            <div className="flex items-center gap-0.5 bg-[#141417] px-1.5 py-0.5 rounded-lg border border-[#2c2c34] mr-1">
              <button
                onClick={() => setZoom((z) => Math.max(0.6, +(z - 0.15).toFixed(2)))}
                className="p-1 text-neutral-400 hover:text-white transition"
                title="Zoom Out"
              >
                <ZoomOut className="w-3 h-3" />
              </button>
              <span className="text-[10px] text-neutral-400 font-mono px-1">
                {Math.round(zoom * 100)}%
              </span>
              <button
                onClick={() => setZoom((z) => Math.min(1.6, +(z + 0.15).toFixed(2)))}
                className="p-1 text-neutral-400 hover:text-white transition"
                title="Zoom In"
              >
                <ZoomIn className="w-3 h-3" />
              </button>
              <button
                onClick={() => setZoom(1)}
                className="p-1 text-neutral-400 hover:text-white transition"
                title="Reset Zoom"
              >
                <RotateCcw className="w-3 h-3" />
              </button>
            </div>
          )}

          <button
            onClick={() => setViewMode(viewMode === 'diagram' ? 'code' : 'diagram')}
            className="flex items-center gap-1 px-2 py-1 rounded-md bg-[#25252c] hover:bg-[#2f2f38] text-neutral-300 hover:text-white transition text-[11px]"
          >
            {viewMode === 'diagram' ? (
              <>
                <Code2 className="w-3 h-3 text-indigo-400" />
                <span>Source</span>
              </>
            ) : (
              <>
                <Eye className="w-3 h-3 text-emerald-400" />
                <span>Diagram</span>
              </>
            )}
          </button>

          <button
            onClick={handleCopy}
            className="flex items-center gap-1 px-2 py-1 rounded-md hover:bg-[#25252c] text-neutral-400 hover:text-white transition text-[11px]"
          >
            {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>
        </div>
      </div>

      {/* Content */}
      {viewMode === 'code' ? (
        <pre className="p-4 text-xs font-mono text-neutral-200 overflow-x-auto leading-relaxed">
          <code>{code}</code>
        </pre>
      ) : (
        <div className="p-4 overflow-x-auto bg-[#16161a]">
          {parsed.type === 'sequence'
            ? renderSequenceSVG(parsed.actors, parsed.messages)
            : parsed.type === 'flowchart'
            ? renderFlowchartSVG(parsed.nodes, parsed.edges, parsed.isHorizontal)
            : null}
        </div>
      )}
    </div>
  );
};
