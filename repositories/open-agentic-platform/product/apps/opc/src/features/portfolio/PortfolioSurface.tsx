import React, { useEffect, useRef, useState, useMemo } from 'react';
import { AlertCircle, Loader2, ArrowUpDown } from 'lucide-react';
import { Button } from '@opc/ui/button';
import { Badge } from '@opc/ui/badge';
import { usePortfolioData, type EnrichedFeature } from './usePortfolioData';

interface PortfolioSurfaceProps {
  projectPath?: string;
}

type SortKey = 'title' | 'status' | 'owner' | 'total_loc' | 'max_complexity' | 'test_coverage_ratio';
type SortDir = 'asc' | 'desc';

function statusBadgeVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'approved': return 'default';
    case 'draft': return 'outline';
    case 'superseded':
    case 'retired': return 'destructive';
    default: return 'secondary';
  }
}

function riskLabel(f: EnrichedFeature): string {
  if (f.max_complexity > 20 && f.test_coverage_ratio < 0.1) return 'high';
  if (f.max_complexity > 10 || f.test_coverage_ratio < 0.2) return 'medium';
  return 'low';
}

function riskBadgeVariant(risk: string): 'default' | 'secondary' | 'destructive' {
  switch (risk) {
    case 'high': return 'destructive';
    case 'medium': return 'default';
    default: return 'secondary';
  }
}

export const PortfolioSurface: React.FC<PortfolioSurfaceProps> = ({ projectPath }) => {
  const [repoRoot, setRepoRoot] = useState(projectPath ?? '');
  const { state, load, reset } = usePortfolioData();
  const autoLoaded = useRef(false);
  const [sortKey, setSortKey] = useState<SortKey>('title');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [filter, setFilter] = useState('');

  useEffect(() => {
    if (projectPath && !autoLoaded.current) {
      autoLoaded.current = true;
      setRepoRoot(projectPath);
      void load(projectPath);
    }
  }, [projectPath, load]);

  const busy = state.status === 'loading';

  const sortedFeatures = useMemo(() => {
    if (state.status !== 'success') return [];
    let items = [...state.data.features];
    if (filter) {
      const q = filter.toLowerCase();
      items = items.filter(f =>
        f.title.toLowerCase().includes(q) ||
        f.feature_id.toLowerCase().includes(q) ||
        f.owner.toLowerCase().includes(q)
      );
    }
    items.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      const cmp = typeof av === 'string'
        ? (av as string).localeCompare(bv as string)
        : (av as number) - (bv as number);
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return items;
  }, [state, sortKey, sortDir, filter]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  return (
    <div className="p-6 h-full flex flex-col gap-4 text-foreground">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold">Portfolio Intelligence</h1>
        <p className="text-sm text-muted-foreground">
          Enriched feature health across the workspace — status, complexity, test coverage, and risk.
        </p>
      </header>

      <div className="flex items-center gap-2">
        <input
          type="text"
          value={repoRoot}
          onChange={e => setRepoRoot(e.target.value)}
          placeholder="Repository root path"
          className="flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm"
        />
        <Button size="sm" onClick={() => void load(repoRoot)} disabled={busy || !repoRoot.trim()}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Load'}
        </Button>
        {state.status !== 'idle' && (
          <Button size="sm" variant="ghost" onClick={reset}>Clear</Button>
        )}
      </div>

      {state.status === 'error' && (
        <div className="flex items-center gap-2 text-destructive text-sm">
          <AlertCircle className="h-4 w-4" />
          {state.message}
        </div>
      )}

      {state.status === 'success' && (
        <>
          {/* Aggregate cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="border rounded-md p-3 bg-muted/30">
              <div className="text-xs text-muted-foreground">Features</div>
              <div className="text-xl font-bold">{state.data.aggregates.totalFeatures}</div>
            </div>
            <div className="border rounded-md p-3 bg-muted/30">
              <div className="text-xs text-muted-foreground">Total LOC</div>
              <div className="text-xl font-bold">{state.data.aggregates.totalLoc.toLocaleString()}</div>
            </div>
            <div className="border rounded-md p-3 bg-muted/30">
              <div className="text-xs text-muted-foreground">Avg Test Coverage</div>
              <div className="text-xl font-bold">{(state.data.aggregates.avgTestCoverage * 100).toFixed(1)}%</div>
            </div>
            <div className="border rounded-md p-3 bg-muted/30">
              <div className="text-xs text-muted-foreground">By Risk</div>
              <div className="flex gap-1 mt-1">
                {Object.entries(state.data.aggregates.byRisk).map(([risk, count]) => (
                  <Badge key={risk} variant={riskBadgeVariant(risk)} className="text-[10px]">
                    {risk}: {count}
                  </Badge>
                ))}
              </div>
            </div>
          </div>

          {/* Filter */}
          <input
            type="text"
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder="Filter by name, ID, or owner..."
            className="rounded-md border border-input bg-background px-3 py-1.5 text-sm"
          />

          {/* Feature table */}
          <div className="flex-1 overflow-auto border rounded-md">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/80 backdrop-blur">
                <tr>
                  {([
                    ['title', 'Feature'],
                    ['status', 'Status'],
                    ['owner', 'Owner'],
                    ['total_loc', 'LOC'],
                    ['max_complexity', 'Complexity'],
                    ['test_coverage_ratio', 'Test Coverage'],
                  ] as [SortKey, string][]).map(([key, label]) => (
                    <th
                      key={key}
                      className="px-3 py-2 text-left font-medium text-muted-foreground cursor-pointer hover:text-foreground select-none"
                      onClick={() => toggleSort(key)}
                    >
                      <span className="inline-flex items-center gap-1">
                        {label}
                        {sortKey === key && <ArrowUpDown className="h-3 w-3" />}
                      </span>
                    </th>
                  ))}
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">Risk</th>
                </tr>
              </thead>
              <tbody>
                {sortedFeatures.map(f => {
                  const risk = riskLabel(f);
                  return (
                    <tr key={f.feature_id} className="border-t hover:bg-muted/30">
                      <td className="px-3 py-2">
                        <div className="font-medium">{f.title}</div>
                        <div className="text-xs text-muted-foreground">{f.feature_id}</div>
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant={statusBadgeVariant(f.status)} className="text-[10px]">{f.status}</Badge>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{f.owner}</td>
                      <td className="px-3 py-2 tabular-nums">{f.total_loc.toLocaleString()}</td>
                      <td className="px-3 py-2 tabular-nums">{f.max_complexity}</td>
                      <td className="px-3 py-2 tabular-nums">{(f.test_coverage_ratio * 100).toFixed(1)}%</td>
                      <td className="px-3 py-2">
                        <Badge variant={riskBadgeVariant(risk)} className="text-[10px]">{risk}</Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
};
