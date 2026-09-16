import { useState } from "react";
import { X } from "./icons";

// Interactive inline-SVG diagram (spec 004 section 3.4): clickable nodes reveal
// a description. Harvested from the OAP whitepaper site, with framer-motion
// swapped for a plain CSS transition and the lucide icon swapped for the inline
// set, so the reader carries no animation or icon-library dependency.

export interface ArchNode {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  description: string;
  color: string;
}

export interface ArchEdge {
  from: string;
  to: string;
  label?: string;
}

export interface ArchDiagram {
  title: string;
  caption: string;
  viewBox: string;
  nodes: ArchNode[];
  edges: ArchEdge[];
}

function nodeCenter(node: ArchNode) {
  return { x: node.x + node.width / 2, y: node.y + node.height / 2 };
}

export function ArchitectureExplorer({ title, caption, nodes, edges, viewBox }: ArchDiagram) {
  const [activeNode, setActiveNode] = useState<ArchNode | null>(null);

  return (
    <div className="my-10 overflow-hidden rounded-lg border border-border bg-card/30">
      <div className="flex items-center justify-between border-b border-border bg-secondary/20 px-4 py-3">
        <h4 className="font-mono text-xs font-medium uppercase tracking-wider text-primary">
          {title}
        </h4>
        <span className="font-mono text-[10px] text-muted-foreground">
          Click nodes to explore
        </span>
      </div>

      <div className="relative bg-[oklch(0.12_0.005_250)] p-4">
        <svg viewBox={viewBox} className="h-auto w-full" style={{ minHeight: "280px" }}>
          <defs>
            <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
              <polygon points="0 0, 8 3, 0 6" fill="oklch(0.55 0.12 195)" />
            </marker>
            <filter id="node-glow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feFlood floodColor="oklch(0.75 0.18 195)" floodOpacity="0.4" result="color" />
              <feComposite in="color" in2="blur" operator="in" result="shadow" />
              <feMerge>
                <feMergeNode in="shadow" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
              <path d="M 20 0 L 0 0 0 20" fill="none" stroke="oklch(0.20 0.005 250)" strokeWidth="0.5" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" opacity="0.4" />

          {edges.map((edge, i) => {
            const fromNode = nodes.find((n) => n.id === edge.from);
            const toNode = nodes.find((n) => n.id === edge.to);
            if (!fromNode || !toNode) return null;
            const from = nodeCenter(fromNode);
            const to = nodeCenter(toNode);
            return (
              <g key={i}>
                <line
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                  stroke="oklch(0.45 0.08 195)"
                  strokeWidth="1.5"
                  strokeDasharray="4 2"
                  markerEnd="url(#arrowhead)"
                />
                {edge.label && (
                  <text
                    x={(from.x + to.x) / 2}
                    y={(from.y + to.y) / 2 - 8}
                    textAnchor="middle"
                    fill="oklch(0.60 0.06 195)"
                    fontSize="9"
                    fontFamily="monospace"
                  >
                    {edge.label}
                  </text>
                )}
              </g>
            );
          })}

          {nodes.map((node) => {
            const isActive = activeNode?.id === node.id;
            return (
              <g
                key={node.id}
                onClick={() => setActiveNode(isActive ? null : node)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setActiveNode(isActive ? null : node);
                  }
                }}
                className="cursor-pointer"
                role="button"
                tabIndex={0}
                aria-pressed={isActive}
                aria-label={node.label}
                filter={isActive ? "url(#node-glow)" : undefined}
              >
                <rect
                  x={node.x}
                  y={node.y}
                  width={node.width}
                  height={node.height}
                  rx="8"
                  ry="8"
                  fill={node.color}
                  stroke={isActive ? "oklch(0.75 0.18 195)" : "oklch(0.45 0.06 195)"}
                  strokeWidth={isActive ? "2.5" : "1"}
                />
                <text
                  x={node.x + node.width / 2}
                  y={node.y + node.height / 2}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill="oklch(0.92 0.02 195)"
                  fontSize="10"
                  fontFamily="system-ui, -apple-system, sans-serif"
                  fontWeight="600"
                >
                  {node.label}
                </text>
              </g>
            );
          })}
        </svg>

        {activeNode && (
          <div className="absolute bottom-4 left-4 right-4 rounded-lg border border-primary/40 bg-[oklch(0.16_0.01_250)] p-4 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h5 className="mb-1.5 text-sm font-semibold text-primary">{activeNode.label}</h5>
                <p className="text-xs leading-relaxed text-[oklch(0.78_0.01_250)]">
                  {activeNode.description}
                </p>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setActiveNode(null);
                }}
                aria-label="Close node detail"
                className="shrink-0 rounded p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-border bg-secondary/10 px-4 py-3">
        <p className="text-xs italic text-muted-foreground">{caption}</p>
      </div>
    </div>
  );
}
