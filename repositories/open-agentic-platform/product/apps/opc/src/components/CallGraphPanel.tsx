import React, { useState } from 'react';
import { Button } from '@opc/ui/button';

interface CallGraphPanelProps {
  /** When provided, pre-fills the project path input. */
  projectPath?: string;
}

export const CallGraphPanel: React.FC<CallGraphPanelProps> = ({ projectPath }) => {
  const [path, setPath] = useState(projectPath ?? '');
  const [configToml, setConfigToml] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);

  const handleIndex = async () => {
    if (!path) return;
    setLoading(true);
    try {
      // stackwalk_index has been removed (stackwalk crate absorbed into axiomregent).
      throw new Error('Call graph indexing is not available in this build.');
    } catch (err) {
      console.error(err);
      setResult({ error: String(err) });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 h-full flex flex-col gap-4 text-foreground">
      <h1 className="text-2xl font-bold">Stackwalk Call Graph</h1>
      <div className="flex gap-2">
        <input
          className="flex-1 px-3 py-2 bg-background border border-input rounded-md text-foreground"
          value={path}
          onChange={e => setPath(e.target.value)}
          placeholder="Enter absolute project path..."
        />
        <Button onClick={handleIndex} disabled={loading || !path}>
          {loading ? 'Indexing...' : 'Generate Call Graph'}
        </Button>
      </div>
      <textarea
        className="w-full h-32 px-3 py-2 bg-background border border-input rounded-md text-foreground font-mono text-sm"
        value={configToml}
        onChange={e => setConfigToml(e.target.value)}
        placeholder="Optional TOML configuration for Stackwalk..."
      />
      <div className="flex-1 overflow-auto bg-muted p-4 rounded-md border text-foreground">
        {result ? (
          <pre className="text-sm whitespace-pre-wrap font-mono">
            {JSON.stringify(result, null, 2)}
          </pre>
        ) : (
          <div className="text-muted-foreground text-center mt-10">
            Enter a path and generate a call graph based on semantic tracing.
          </div>
        )}
      </div>
    </div>
  );
};
