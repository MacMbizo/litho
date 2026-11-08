import React, { useRef, useEffect, useState } from 'react';
import { Share2, ZoomIn, ZoomOut, RefreshCw, Filter, Bot, Wrench, Layers, FileText, Tag } from 'lucide-react';
import { MarkdownFile } from '../../types/document';

interface KnowledgeGraphProps {
  files: MarkdownFile[];
  onSelectFile: (id: string) => void;
}

interface GraphNode {
  id: string;
  label: string;
  type: 'project' | 'agent' | 'skill' | 'document' | 'tag';
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  fileId?: string;
  connections: number;
}

interface GraphLink {
  source: string;
  target: string;
}

export const KnowledgeGraph: React.FC<KnowledgeGraphProps> = ({ files, onSelectFile }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [filterType, setFilterType] = useState<string>('all');
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);
  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  const nodesRef = useRef<GraphNode[]>([]);
  const linksRef = useRef<GraphLink[]>([]);
  const isDraggingCanvasRef = useRef(false);
  const draggedNodeRef = useRef<GraphNode | null>(null);
  const lastMousePosRef = useRef({ x: 0, y: 0 });
  const animFrameIdRef = useRef<number | null>(null);

  // Initialize nodes and links from files
  useEffect(() => {
    const nodes: GraphNode[] = [];
    const links: GraphLink[] = [];
    const tagMap = new Map<string, string[]>(); // tag -> fileIds

    const width = 800;
    const height = 600;

    // 1. Create file nodes
    files.forEach((file, index) => {
      const type = file.frontmatter.type || 'document';
      if (filterType !== 'all' && filterType !== type) return;

      const angle = (index / files.length) * 2 * Math.PI;
      const dist = 180 + (index % 3) * 50;

      nodes.push({
        id: file.id,
        label: file.frontmatter.title || file.name,
        type: type as any,
        x: width / 2 + Math.cos(angle) * dist + (Math.random() - 0.5) * 40,
        y: height / 2 + Math.sin(angle) * dist + (Math.random() - 0.5) * 40,
        vx: 0,
        vy: 0,
        radius: type === 'project' ? 18 : type === 'agent' ? 16 : type === 'skill' ? 14 : 12,
        fileId: file.id,
        connections: 0,
      });

      // Collect tags
      (file.frontmatter.tags || []).forEach((t) => {
        if (!tagMap.has(t)) tagMap.set(t, []);
        tagMap.get(t)!.push(file.id);
      });
    });

    // 2. Create Tag nodes (if filter allows)
    if (filterType === 'all' || filterType === 'tag') {
      let tagIdx = 0;
      tagMap.forEach((fileIds, tagName) => {
        if (fileIds.length > 1) {
          const tagNodeId = `tag:${tagName}`;
          nodes.push({
            id: tagNodeId,
            label: `#${tagName}`,
            type: 'tag',
            x: width / 2 + (Math.random() - 0.5) * 300,
            y: height / 2 + (Math.random() - 0.5) * 300,
            vx: 0,
            vy: 0,
            radius: 9,
            connections: fileIds.length,
          });

          // Link tag to files
          fileIds.forEach((fId) => {
            if (nodes.some((n) => n.id === fId)) {
              links.push({ source: tagNodeId, target: fId });
            }
          });
          tagIdx++;
        }
      });
    }

    // 3. Detect internal links / references inside markdown body (e.g. "project-nexus" or agent mentions)
    files.forEach((fileA) => {
      files.forEach((fileB) => {
        if (fileA.id !== fileB.id) {
          const nameWithoutExt = fileB.name.replace('.md', '');
          if (fileA.body.includes(nameWithoutExt) || fileA.body.includes(fileB.path)) {
            if (nodes.some((n) => n.id === fileA.id) && nodes.some((n) => n.id === fileB.id)) {
              links.push({ source: fileA.id, target: fileB.id });
            }
          }
        }
      });
    });

    // Count connections
    links.forEach((l) => {
      const s = nodes.find((n) => n.id === l.source);
      const t = nodes.find((n) => n.id === l.target);
      if (s) s.connections++;
      if (t) t.connections++;
    });

    nodesRef.current = nodes;
    linksRef.current = links;
  }, [files, filterType]);

  // Force-directed simulation & canvas rendering loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let isRunning = true;

    const render = () => {
      if (!isRunning) return;

      const nodes = nodesRef.current;
      const links = linksRef.current;
      const width = canvas.width;
      const height = canvas.height;

      // Physics step: Repulsion between all nodes
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i];
          const b = nodes[j];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const minDist = a.radius + b.radius + 60;

          if (dist < minDist * 2) {
            const force = (minDist * 2 - dist) / dist * 0.04;
            if (a !== draggedNodeRef.current) {
              a.vx -= dx * force;
              a.vy -= dy * force;
            }
            if (b !== draggedNodeRef.current) {
              b.vx += dx * force;
              b.vy += dy * force;
            }
          }
        }
      }

      // Physics step: Spring attraction along links
      for (const link of links) {
        const source = nodes.find((n) => n.id === link.source);
        const target = nodes.find((n) => n.id === link.target);
        if (!source || !target) continue;

        const dx = target.x - source.x;
        const dy = target.y - source.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const targetDist = 120;
        const force = (dist - targetDist) * 0.003;

        if (source !== draggedNodeRef.current) {
          source.vx += dx * force;
          source.vy += dy * force;
        }
        if (target !== draggedNodeRef.current) {
          target.vx -= dx * force;
          target.vy -= dy * force;
        }
      }

      // Physics step: Centering force & velocity damping
      const cx = width / 2;
      const cy = height / 2;
      for (const node of nodes) {
        if (node === draggedNodeRef.current) continue;
        node.vx += (cx - node.x) * 0.0008;
        node.vy += (cy - node.y) * 0.0008;

        node.vx *= 0.88; // Damping
        node.vy *= 0.88;

        node.x += node.vx;
        node.y += node.vy;
      }

      // Draw background
      ctx.fillStyle = '#171717';
      ctx.fillRect(0, 0, width, height);

      // Apply zoom & pan transform
      ctx.save();
      ctx.translate(pan.x + width / 2, pan.y + height / 2);
      ctx.scale(zoom, zoom);
      ctx.translate(-width / 2, -height / 2);

      // Draw links
      ctx.strokeStyle = '#2d2d2d';
      ctx.lineWidth = 1.2;
      for (const link of links) {
        const source = nodes.find((n) => n.id === link.source);
        const target = nodes.find((n) => n.id === link.target);
        if (!source || !target) continue;

        ctx.beginPath();
        ctx.moveTo(source.x, source.y);
        ctx.lineTo(target.x, target.y);
        ctx.stroke();
      }

      // Draw nodes
      for (const node of nodes) {
        const isHovered = hoveredNode?.id === node.id;

        // Node fill color by type
        let fill = '#555555';
        let stroke = '#777777';
        if (node.type === 'agent') {
          fill = '#9333ea';
          stroke = '#c084fc';
        } else if (node.type === 'skill') {
          fill = '#059669';
          stroke = '#34d399';
        } else if (node.type === 'project') {
          fill = '#2563eb';
          stroke = '#60a5fa';
        } else if (node.type === 'tag') {
          fill = '#d97706';
          stroke = '#fbbf24';
        }

        // Outer glow on hover
        if (isHovered) {
          ctx.beginPath();
          ctx.arc(node.x, node.y, node.radius + 6, 0, Math.PI * 2);
          ctx.fillStyle = stroke + '44';
          ctx.fill();
        }

        // Main node circle
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
        ctx.fillStyle = fill;
        ctx.fill();
        ctx.strokeStyle = stroke;
        ctx.lineWidth = isHovered ? 2.5 : 1.5;
        ctx.stroke();

        // Node label
        ctx.fillStyle = isHovered ? '#ffffff' : '#d4d4d4';
        ctx.font = isHovered ? 'bold 11px Inter, sans-serif' : '10px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(node.label, node.x, node.y + node.radius + 12);
      }

      ctx.restore();

      animFrameIdRef.current = requestAnimationFrame(render);
    };

    render();

    return () => {
      isRunning = false;
      if (animFrameIdRef.current) cancelAnimationFrame(animFrameIdRef.current);
    };
  }, [pan, zoom, hoveredNode]);

  // Coordinate transforms
  const screenToWorld = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;

    const width = canvas.width;
    const height = canvas.height;

    const wx = (x - (pan.x + width / 2)) / zoom + width / 2;
    const wy = (y - (pan.y + height / 2)) / zoom + height / 2;
    return { x: wx, y: wy };
  };

  // Mouse interactions
  const handleMouseDown = (e: React.MouseEvent) => {
    const { x, y } = screenToWorld(e.clientX, e.clientY);
    const clickedNode = nodesRef.current.find((n) => {
      const dx = n.x - x;
      const dy = n.y - y;
      return Math.sqrt(dx * dx + dy * dy) <= n.radius + 4;
    });

    if (clickedNode) {
      draggedNodeRef.current = clickedNode;
    } else {
      isDraggingCanvasRef.current = true;
      lastMousePosRef.current = { x: e.clientX, y: e.clientY };
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const { x, y } = screenToWorld(e.clientX, e.clientY);

    if (draggedNodeRef.current) {
      draggedNodeRef.current.x = x;
      draggedNodeRef.current.y = y;
      draggedNodeRef.current.vx = 0;
      draggedNodeRef.current.vy = 0;
      return;
    }

    if (isDraggingCanvasRef.current) {
      const dx = e.clientX - lastMousePosRef.current.x;
      const dy = e.clientY - lastMousePosRef.current.y;
      setPan((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
      lastMousePosRef.current = { x: e.clientX, y: e.clientY };
      return;
    }

    // Hover detection
    const hovered = nodesRef.current.find((n) => {
      const dx = n.x - x;
      const dy = n.y - y;
      return Math.sqrt(dx * dx + dy * dy) <= n.radius + 4;
    });
    setHoveredNode(hovered || null);
  };

  const handleMouseUp = () => {
    draggedNodeRef.current = null;
    isDraggingCanvasRef.current = false;
  };

  const handleClick = (e: React.MouseEvent) => {
    const { x, y } = screenToWorld(e.clientX, e.clientY);
    const clickedNode = nodesRef.current.find((n) => {
      const dx = n.x - x;
      const dy = n.y - y;
      return Math.sqrt(dx * dx + dy * dy) <= n.radius + 4;
    });

    if (clickedNode && clickedNode.fileId) {
      onSelectFile(clickedNode.fileId);
    }
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    setZoom((prev) => Math.min(Math.max(prev * factor, 0.4), 3.0));
  };

  return (
    <div className="flex-1 h-full flex flex-col bg-[#171717] font-sans relative overflow-hidden select-none">
      {/* Top Header & Filter Bar */}
      <div className="absolute top-4 left-6 right-6 z-10 flex items-center justify-between pointer-events-none">
        <div className="bg-[#202020]/90 backdrop-blur-md px-4 py-2 rounded-xl border border-[#333] shadow-lg pointer-events-auto">
          <div className="flex items-center gap-2">
            <Share2 className="w-4 h-4 text-purple-400" />
            <span className="font-semibold text-xs text-neutral-100">Interactive Knowledge Graph</span>
            <span className="text-[10px] text-neutral-500 font-mono">({nodesRef.current.length} nodes)</span>
          </div>
        </div>

        {/* Filters & Zoom controls */}
        <div className="flex items-center gap-2 pointer-events-auto">
          {/* Type Filter Buttons */}
          <div className="flex items-center bg-[#202020]/90 backdrop-blur-md p-1 rounded-xl border border-[#333] shadow-lg text-xs">
            {[
              { id: 'all', label: 'All' },
              { id: 'agent', label: 'Agents', icon: <Bot className="w-3 h-3 text-purple-400" /> },
              { id: 'skill', label: 'Skills', icon: <Wrench className="w-3 h-3 text-emerald-400" /> },
              { id: 'project', label: 'Projects', icon: <Layers className="w-3 h-3 text-blue-400" /> },
              { id: 'tag', label: 'Tags', icon: <Tag className="w-3 h-3 text-amber-400" /> },
            ].map((f) => (
              <button
                key={f.id}
                onClick={() => setFilterType(f.id)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg transition text-[11px] ${
                  filterType === f.id
                    ? 'bg-[#333333] text-white font-medium shadow-sm'
                    : 'text-neutral-400 hover:text-white'
                }`}
              >
                {f.icon}
                <span>{f.label}</span>
              </button>
            ))}
          </div>

          {/* Zoom controls */}
          <div className="flex items-center bg-[#202020]/90 backdrop-blur-md p-1 rounded-xl border border-[#333] shadow-lg">
            <button
              onClick={() => setZoom((z) => Math.min(z * 1.2, 3))}
              className="p-1.5 rounded hover:bg-[#303030] text-neutral-400 hover:text-white transition"
              title="Zoom In"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setZoom((z) => Math.max(z / 1.2, 0.4))}
              className="p-1.5 rounded hover:bg-[#303030] text-neutral-400 hover:text-white transition"
              title="Zoom Out"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => {
                setZoom(1);
                setPan({ x: 0, y: 0 });
              }}
              className="p-1.5 rounded hover:bg-[#303030] text-neutral-400 hover:text-white transition"
              title="Reset View"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Main Graph Canvas */}
      <canvas
        ref={canvasRef}
        width={1200}
        height={800}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onClick={handleClick}
        onWheel={handleWheel}
        className="w-full h-full cursor-grab active:cursor-grabbing"
      />

      {/* Bottom Hint */}
      <div className="absolute bottom-4 left-6 pointer-events-none text-[11px] text-neutral-500 bg-[#202020]/80 px-3 py-1 rounded-md border border-[#2d2d2d]">
        Click any node to open document • Drag nodes to explore connections • Scroll to zoom
      </div>
    </div>
  );
};
