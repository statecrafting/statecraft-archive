// Feature: SCHEDULING
// Spec: specs/079-scheduling/spec.md
import React, { useState } from 'react';
import { Button } from '@opc/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@opc/ui/dialog';
import type { Schedule } from './SchedulePanel';
import { withControlTokenHeader } from '@/lib/controlToken';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TriggerType = 'Cron' | 'Event';

const EVENT_OPTIONS = ['SessionStart', 'SessionStop', 'FileChanged'] as const;
type EventOption = typeof EVENT_OPTIONS[number];

interface CreateScheduleRequest {
  name: string;
  prompt: string;
  trigger:
    | { type: 'Cron'; expr: string }
    | { type: 'Event'; event_type: string };
}

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface ScheduleDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: (schedule: Schedule) => void;
}

export const ScheduleDialog: React.FC<ScheduleDialogProps> = ({
  open,
  onClose,
  onCreated,
}) => {
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [triggerType, setTriggerType] = useState<TriggerType>('Cron');
  const [cronExpr, setCronExpr] = useState('');
  const [eventType, setEventType] = useState<EventOption>('SessionStart');
  const [submitting, setSubmitting] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);

  const resetForm = () => {
    setName('');
    setPrompt('');
    setTriggerType('Cron');
    setCronExpr('');
    setEventType('SessionStart');
    setValidationError(null);
    setApiError(null);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const validate = (): boolean => {
    if (!name.trim()) {
      setValidationError('Name is required.');
      return false;
    }
    if (!prompt.trim()) {
      setValidationError('Prompt is required.');
      return false;
    }
    if (triggerType === 'Cron' && !cronExpr.trim()) {
      setValidationError('Cron expression is required.');
      return false;
    }
    return true;
  };

  const handleSubmit = async () => {
    setValidationError(null);
    setApiError(null);

    if (!validate()) return;

    const body: CreateScheduleRequest = {
      name: name.trim(),
      prompt: prompt.trim(),
      trigger:
        triggerType === 'Cron'
          ? { type: 'Cron', expr: cronExpr.trim() }
          : { type: 'Event', event_type: eventType },
    };

    setSubmitting(true);
    try {
      // /api/schedules requires the control token (spec: opc-web auth hardening).
      const response = await fetch('/api/schedules', {
        method: 'POST',
        headers: withControlTokenHeader({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(body),
      });
      const result: ApiResponse<Schedule> = await response.json();
      if (!result.success || !result.data) {
        throw new Error(result.error ?? 'Failed to create schedule');
      }
      resetForm();
      onCreated(result.data);
    } catch (err) {
      console.error('[ScheduleDialog] Failed to create schedule:', err);
      setApiError(err instanceof Error ? err.message : 'Failed to create schedule');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>New Schedule</DialogTitle>
          <DialogDescription>
            Create a cron-based or event-triggered schedule for recurring agent runs.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Name */}
          <div className="space-y-1">
            <label className="text-sm font-medium" htmlFor="schedule-name">
              Name
            </label>
            <input
              id="schedule-name"
              className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="e.g. Daily lint check"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={submitting}
            />
          </div>

          {/* Prompt */}
          <div className="space-y-1">
            <label className="text-sm font-medium" htmlFor="schedule-prompt">
              Prompt
            </label>
            <textarea
              id="schedule-prompt"
              className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
              placeholder="The prompt to send to the agent on each run..."
              rows={3}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              disabled={submitting}
            />
          </div>

          {/* Trigger type */}
          <div className="space-y-1">
            <label className="text-sm font-medium" htmlFor="trigger-type">
              Trigger type
            </label>
            <select
              id="trigger-type"
              className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              value={triggerType}
              onChange={(e) => setTriggerType(e.target.value as TriggerType)}
              disabled={submitting}
            >
              <option value="Cron">Cron (time-based)</option>
              <option value="Event">Event (lifecycle)</option>
            </select>
          </div>

          {/* Cron expression */}
          {triggerType === 'Cron' && (
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="cron-expr">
                Cron expression
              </label>
              <input
                id="cron-expr"
                className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="e.g. 0 9 * * 1-5"
                value={cronExpr}
                onChange={(e) => setCronExpr(e.target.value)}
                disabled={submitting}
              />
              <p className="text-xs text-muted-foreground">
                Standard POSIX cron format: minute hour day month weekday
              </p>
            </div>
          )}

          {/* Event type */}
          {triggerType === 'Event' && (
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="event-type">
                Event
              </label>
              <select
                id="event-type"
                className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                value={eventType}
                onChange={(e) => setEventType(e.target.value as EventOption)}
                disabled={submitting}
              >
                {EVENT_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Validation error */}
          {validationError && (
            <p className="text-xs text-destructive">{validationError}</p>
          )}

          {/* API error */}
          {apiError && (
            <p className="text-xs text-destructive">{apiError}</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? 'Creating...' : 'Create Schedule'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
