// Feature: SCHEDULING
// Spec: specs/079-scheduling/spec.md
import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, ToggleLeft, ToggleRight, Clock, Zap, Loader2, AlertCircle } from 'lucide-react';
import { Button } from '@opc/ui/button';
import { Card, CardContent } from '@opc/ui/card';
import { ScheduleDialog } from './ScheduleDialog';
import { withControlTokenHeader } from '@/lib/controlToken';

// ---------------------------------------------------------------------------
// Types (mirror of the Rust API types)
// ---------------------------------------------------------------------------

export type ScheduleTrigger =
  | { type: 'Cron'; expr: string }
  | { type: 'Event'; event_type: string };

export interface Schedule {
  id: string;
  name: string;
  prompt: string;
  trigger: ScheduleTrigger;
  enabled: boolean;
  last_run_at: number | null;
  created_at: number;
}

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatEpoch(epoch: number | null): string {
  if (epoch === null) return 'Never';
  return new Date(epoch * 1000).toLocaleString();
}

function triggerLabel(trigger: ScheduleTrigger): string {
  if (trigger.type === 'Cron') return trigger.expr;
  return trigger.event_type;
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  // /api/schedules requires the control token (spec: opc-web auth hardening).
  const response = await fetch(path, {
    headers: withControlTokenHeader({ 'Content-Type': 'application/json' }),
    ...options,
  });
  const result: ApiResponse<T> = await response.json();
  if (!result.success) {
    throw new Error(result.error ?? 'Request failed');
  }
  return result.data as T;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const SchedulePanel: React.FC = () => {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const loadSchedules = useCallback(async () => {
    try {
      const data = await apiFetch<Schedule[]>('/api/schedules');
      setSchedules(data);
      setError(null);
    } catch (err) {
      console.error('[SchedulePanel] Failed to load schedules:', err);
      setError('Failed to load schedules');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSchedules();
    const interval = setInterval(loadSchedules, 30_000);
    return () => clearInterval(interval);
  }, [loadSchedules]);

  const handleDelete = async (id: string) => {
    try {
      await apiFetch<void>(`/api/schedules/${id}`, { method: 'DELETE' });
      setSchedules((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      console.error('[SchedulePanel] Failed to delete schedule:', err);
    }
  };

  const handleToggle = async (id: string) => {
    try {
      const updated = await apiFetch<Schedule>(`/api/schedules/${id}/toggle`, { method: 'PUT' });
      setSchedules((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
    } catch (err) {
      console.error('[SchedulePanel] Failed to toggle schedule:', err);
    }
  };

  const handleCreated = (schedule: Schedule) => {
    setSchedules((prev) => [schedule, ...prev]);
    setDialogOpen(false);
  };

  if (loading && schedules.length === 0) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-4 h-full flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Schedules</h2>
          <p className="text-xs text-muted-foreground">
            Cron and event-triggered agent runs
          </p>
        </div>
        <Button size="sm" onClick={() => setDialogOpen(true)}>
          <Plus className="h-4 w-4 mr-1" />
          New Schedule
        </Button>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 text-sm text-destructive border border-destructive/40 rounded-md px-3 py-2 bg-destructive/10">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Empty state */}
      {!error && schedules.length === 0 && (
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
          No schedules yet. Click "New Schedule" to create one.
        </div>
      )}

      {/* Schedule list */}
      <div className="flex-1 overflow-auto space-y-2">
        {schedules.map((schedule) => (
          <Card key={schedule.id} className="transition-all hover:shadow-sm">
            <CardContent className="p-3">
              <div className="flex items-start justify-between gap-3">
                {/* Left: details */}
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm truncate">{schedule.name}</span>
                    {schedule.enabled ? (
                      <span className="text-xs text-green-600 font-medium">Enabled</span>
                    ) : (
                      <span className="text-xs text-muted-foreground">Disabled</span>
                    )}
                  </div>

                  {/* Trigger badge */}
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    {schedule.trigger.type === 'Cron' ? (
                      <>
                        <Clock className="h-3 w-3 flex-shrink-0" />
                        <span className="font-mono">{triggerLabel(schedule.trigger)}</span>
                      </>
                    ) : (
                      <>
                        <Zap className="h-3 w-3 flex-shrink-0" />
                        <span>{triggerLabel(schedule.trigger)}</span>
                      </>
                    )}
                  </div>

                  {/* Last run */}
                  <p className="text-xs text-muted-foreground">
                    Last run: {formatEpoch(schedule.last_run_at)}
                  </p>
                </div>

                {/* Right: actions */}
                <div className="flex items-center gap-1 flex-shrink-0">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0"
                    onClick={() => handleToggle(schedule.id)}
                    title={schedule.enabled ? 'Disable schedule' : 'Enable schedule'}
                  >
                    {schedule.enabled ? (
                      <ToggleRight className="h-4 w-4 text-green-600" />
                    ) : (
                      <ToggleLeft className="h-4 w-4 text-muted-foreground" />
                    )}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                    onClick={() => handleDelete(schedule.id)}
                    title="Delete schedule"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Create dialog */}
      <ScheduleDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onCreated={handleCreated}
      />
    </div>
  );
};
