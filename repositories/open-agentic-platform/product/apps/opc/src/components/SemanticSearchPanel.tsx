import React, { useEffect, useRef, useState } from 'react';
import { Button } from '@opc/ui/button';
import { Loader2 } from 'lucide-react';

interface SemanticSearchPanelProps {
  /** When provided, used as the project identifier for semantic search. */
  projectPath?: string;
}

export const SemanticSearchPanel: React.FC<SemanticSearchPanelProps> = ({ projectPath }) => {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const indexing = false;
  const [indexError, setIndexError] = useState<string | null>(null);
  const indexed = false;
  const autoIndexed = useRef(false);

  // Auto-index is not available — blockoli_index_project removed (blockoli absorbed into axiomregent).
  useEffect(() => {
    if (!projectPath || autoIndexed.current) return;
    autoIndexed.current = true;
    setIndexError('Semantic indexing is not available in this build.');
  }, [projectPath]);

  const handleSearch = async () => {
    if (!query) return;
    setLoading(true);
    try {
      // blockoli_search has been removed (blockoli crate absorbed into axiomregent).
      throw new Error('Semantic search is not available in this build.');
    } catch (err) {
      console.error(err);
      setResult({ error: String(err) });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 h-full flex flex-col gap-4 text-foreground">
      <h1 className="text-2xl font-bold">Semantic Search</h1>
      {projectPath && (
        <p className="text-sm text-muted-foreground -mt-2 font-mono truncate">{projectPath}</p>
      )}

      {/* Indexing status */}
      {indexing && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground border border-border rounded-md px-3 py-2 bg-muted/30">
          <Loader2 className="h-4 w-4 animate-spin" />
          Indexing project for semantic search...
        </div>
      )}
      {indexError && (
        <div className="text-sm border border-destructive/50 rounded-md px-3 py-2 bg-destructive/10 text-destructive">
          Indexing failed: {indexError}
        </div>
      )}
      {indexed && !indexing && (
        <div className="text-sm text-muted-foreground border border-border rounded-md px-3 py-2 bg-muted/30">
          Project indexed and ready for search.
        </div>
      )}

      <div className="flex gap-2">
        <input
          className="flex-1 px-3 py-2 bg-background border border-input rounded-md text-foreground"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search codebase naturally..."
          onKeyDown={e => e.key === 'Enter' && handleSearch()}
          disabled={indexing}
        />
        <Button onClick={handleSearch} disabled={loading || !query || indexing}>
          {loading ? 'Searching...' : 'Search'}
        </Button>
      </div>
      <div className="flex-1 overflow-auto bg-muted p-4 rounded-md border text-foreground">
        {result ? (
          <pre className="text-sm whitespace-pre-wrap font-mono">
            {JSON.stringify(result, null, 2)}
          </pre>
        ) : (
          <div className="text-muted-foreground text-center mt-10">
            {indexing
              ? 'Waiting for indexing to complete...'
              : 'Enter a query to search semantically across the indexed codebase.'}
          </div>
        )}
      </div>
    </div>
  );
};
