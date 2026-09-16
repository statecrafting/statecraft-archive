import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@opc/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@opc/ui/dialog';
import { Input } from '@opc/ui/input';
import { Label } from '@opc/ui/label';
import { api } from '@/lib/api';

const DEFAULT_URL = 'https://statecraft.ing';

interface ServerSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
}

export function ServerSettingsDialog({ open, onOpenChange, onSaved }: ServerSettingsDialogProps) {
  const [currentUrl, setCurrentUrl] = useState('');
  const [input, setInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    (async () => {
      try {
        const url = await api.getStatecraftBaseUrl();
        setCurrentUrl(url);
        setInput(url);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, [open]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.setStatecraftBaseUrl(input.trim());
      onSaved?.();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setInput(DEFAULT_URL);
  };

  const isDirty = input.trim() !== currentUrl.trim();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Server settings</DialogTitle>
          <DialogDescription>
            The Statecraft control plane this app authenticates against. Switching
            the server signs you out of the current one.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2 py-2">
          <Label htmlFor="statecraft-url">Statecraft base URL</Label>
          <Input
            id="statecraft-url"
            type="url"
            placeholder={DEFAULT_URL}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            autoFocus
            disabled={saving}
          />
          <p className="text-xs text-muted-foreground">
            Current: <code className="font-mono">{currentUrl || '(not configured)'}</code>
          </p>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={handleReset} disabled={saving}>
            Reset to default
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving || !isDirty}
            className="gap-2"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
