import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { ClientOnly } from "../components/client-only";
import { DOMAIN_COLORS, edges, getSpec, specs } from "../lib/spec-registry";

interface SimNode {
  id: string;
  title: string;
  domain: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
}

function ForceGraph() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const navigate = useNavigate();
  const [tooltip, setTooltip] = useState<{ x: number; y: number; title: string; id: string } | null>(null);

  useEffect(() => {
    const wrap = wrapRef.current!;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;

    // Connected nodes only (specs that participate in at least one edge).
    const connected = new Set<string>();
    for (const e of edges) {
      connected.add(e.source);
      connected.add(e.target);
    }
    let W = wrap.clientWidth;
    let H = 600;

    const nodes: SimNode[] = [];
    const byId = new Map<string, SimNode>();
    let seed = 1;
    const rand = () => {
      // deterministic pseudo-random so layout is stable across runs
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (const id of connected) {
      const s = getSpec(id);
      if (!s) continue;
      const deg = edges.filter((e) => e.source === id || e.target === id).length;
      const n: SimNode = {
        id,
        title: s.title,
        domain: s.domain,
        x: W / 2 + (rand() - 0.5) * W * 0.8,
        y: H / 2 + (rand() - 0.5) * H * 0.8,
        vx: 0,
        vy: 0,
        r: 3 + Math.min(6, deg),
      };
      nodes.push(n);
      byId.set(id, n);
    }
    const links = edges
      .filter((e) => byId.has(e.source) && byId.has(e.target))
      .map((e) => ({ s: byId.get(e.source)!, t: byId.get(e.target)!, type: e.type }));

    let alpha = 1;
    let raf = 0;
    function ensureRunning() {
      if (!raf) raf = requestAnimationFrame(step);
    }
    function resize() {
      W = wrap.clientWidth;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      canvas.style.width = `${W}px`;
      canvas.style.height = `${H}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      alpha = Math.max(alpha, 0.3); // re-warm so the resized layout settles again
      ensureRunning();
    }
    resize();
    window.addEventListener("resize", resize);

    function step() {
      // repulsion (O(n^2), fine for a few hundred nodes)
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          let dx = a.x - b.x;
          let dy = a.y - b.y;
          let d2 = dx * dx + dy * dy || 0.01;
          const f = (1200 * alpha) / d2;
          const d = Math.sqrt(d2);
          const ux = dx / d;
          const uy = dy / d;
          a.vx += ux * f;
          a.vy += uy * f;
          b.vx -= ux * f;
          b.vy -= uy * f;
        }
      }
      // spring attraction along edges
      for (const l of links) {
        let dx = l.t.x - l.s.x;
        let dy = l.t.y - l.s.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const f = (d - 70) * 0.02 * alpha;
        const ux = dx / d;
        const uy = dy / d;
        l.s.vx += ux * f;
        l.s.vy += uy * f;
        l.t.vx -= ux * f;
        l.t.vy -= uy * f;
      }
      // gravity to center + integrate
      for (const n of nodes) {
        n.vx += (W / 2 - n.x) * 0.002 * alpha;
        n.vy += (H / 2 - n.y) * 0.002 * alpha;
        n.vx *= 0.85;
        n.vy *= 0.85;
        n.x += n.vx;
        n.y += n.vy;
        n.x = Math.max(n.r, Math.min(W - n.r, n.x));
        n.y = Math.max(n.r, Math.min(H - n.r, n.y));
      }
      alpha *= 0.98; // decay toward zero so the layout settles and the loop stops

      // draw
      ctx.clearRect(0, 0, W, H);
      ctx.lineWidth = 1;
      for (const l of links) {
        ctx.strokeStyle =
          l.type === "supersedes" ? "oklch(0.5 0.12 60 / 0.35)" : "oklch(0.5 0.1 220 / 0.25)";
        ctx.beginPath();
        ctx.moveTo(l.s.x, l.s.y);
        ctx.lineTo(l.t.x, l.t.y);
        ctx.stroke();
      }
      for (const n of nodes) {
        ctx.fillStyle = DOMAIN_COLORS[n.domain] ?? DOMAIN_COLORS.unknown;
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx.fill();
      }
      if (alpha > 0.004) raf = requestAnimationFrame(step);
      else raf = 0;
    }

    function nodeAt(mx: number, my: number): SimNode | null {
      for (const n of nodes) {
        const dx = n.x - mx;
        const dy = n.y - my;
        if (dx * dx + dy * dy <= (n.r + 4) * (n.r + 4)) return n;
      }
      return null;
    }
    function onMove(ev: MouseEvent) {
      const rect = canvas.getBoundingClientRect();
      const mx = ev.clientX - rect.left;
      const my = ev.clientY - rect.top;
      const n = nodeAt(mx, my);
      canvas.style.cursor = n ? "pointer" : "default";
      setTooltip(n ? { x: mx, y: my, title: n.title, id: n.id } : null);
    }
    function onClick(ev: MouseEvent) {
      const rect = canvas.getBoundingClientRect();
      const n = nodeAt(ev.clientX - rect.left, ev.clientY - rect.top);
      if (n) navigate(`/registry/${n.id}`);
    }
    canvas.addEventListener("mousemove", onMove);
    canvas.addEventListener("click", onClick);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      canvas.removeEventListener("mousemove", onMove);
      canvas.removeEventListener("click", onClick);
    };
  }, [navigate]);

  return (
    <div ref={wrapRef} className="relative">
      <canvas ref={canvasRef} className="rounded-lg border border-border/60 bg-card/30" />
      {tooltip && (
        <div
          className="pointer-events-none absolute z-10 max-w-xs rounded-md border border-primary/40 bg-card px-2.5 py-1.5 shadow-xl"
          style={{ left: tooltip.x + 12, top: tooltip.y + 12 }}
        >
          <div className="font-mono text-[10px] text-muted-foreground">{tooltip.id}</div>
          <div className="text-xs">{tooltip.title}</div>
        </div>
      )}
    </div>
  );
}

export default function RegistryGraph() {
  const domains = [...new Set(specs.map((s) => s.domain))].sort();
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2">
        <span className="font-mono text-sm text-muted-foreground">
          Relationship topology
        </span>
        <div className="flex flex-wrap items-center gap-3 font-mono text-[11px] text-muted-foreground">
          {domains.map((d) => (
            <span key={d} className="inline-flex items-center gap-1.5">
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: DOMAIN_COLORS[d] ?? DOMAIN_COLORS.unknown }}
              />
              {d}
            </span>
          ))}
          <span className="ml-2">{edges.length} edges (amends, supersedes, extends)</span>
        </div>
      </div>
      <ClientOnly
        fallback={
          <div className="flex h-[600px] items-center justify-center rounded-lg border border-border/60 bg-card/30 font-mono text-xs text-muted-foreground">
            Loading graph...
          </div>
        }
      >
        {() => <ForceGraph />}
      </ClientOnly>
      <p className="mt-3 font-mono text-[11px] text-muted-foreground">
        Nodes are specs that participate in a relationship edge; hover for the
        title, click to open the spec. Layout is a deterministic force
        simulation.
      </p>
    </div>
  );
}
