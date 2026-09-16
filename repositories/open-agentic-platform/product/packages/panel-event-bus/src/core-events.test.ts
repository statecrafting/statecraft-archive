import { describe, it, expect } from 'vitest';
import { CORE_EVENT_SCHEMAS, CORE_EVENT_NAMES, createBusWithCoreEvents } from './core-events.js';
import type { BusEvent } from './types.js';

describe('core-events', () => {
  it('defines 11 core event schemas', () => {
    expect(CORE_EVENT_SCHEMAS).toHaveLength(11);
  });

  it('CORE_EVENT_NAMES matches schema names', () => {
    expect(CORE_EVENT_NAMES).toEqual(CORE_EVENT_SCHEMAS.map(s => s.name));
  });

  it('includes all expected namespaces', () => {
    const namespaces = new Set(CORE_EVENT_NAMES.map(n => n.split(':')[0]));
    expect(namespaces).toEqual(new Set(['terminal', 'files', 'git', 'agent']));
  });

  it('terminal events', () => {
    expect(CORE_EVENT_NAMES).toContain('terminal:command_executed');
    expect(CORE_EVENT_NAMES).toContain('terminal:output_received');
  });

  it('files events', () => {
    expect(CORE_EVENT_NAMES).toContain('files:changed');
    expect(CORE_EVENT_NAMES).toContain('files:opened');
    expect(CORE_EVENT_NAMES).toContain('files:saved');
  });

  it('git events', () => {
    expect(CORE_EVENT_NAMES).toContain('git:operation_commit');
    expect(CORE_EVENT_NAMES).toContain('git:operation_push');
    expect(CORE_EVENT_NAMES).toContain('git:operation_pull');
    expect(CORE_EVENT_NAMES).toContain('git:operation_branch');
  });

  it('agent events', () => {
    expect(CORE_EVENT_NAMES).toContain('agent:message_received');
    expect(CORE_EVENT_NAMES).toContain('agent:tool_invoked');
  });

  describe('createBusWithCoreEvents', () => {
    it('returns a bus with all core types registered', () => {
      const bus = createBusWithCoreEvents();
      for (const name of CORE_EVENT_NAMES) {
        expect(bus.hasEventType(name)).toBe(true);
      }
    });

    it('passes options through', () => {
      const bus = createBusWithCoreEvents({ ringBuffer: { maxPerType: 10 } });
      bus.registerPanel('p1', {
        panelType: 'terminal',
        emits: ['terminal:command_executed'],
        subscribes: [],
      });
      // Emit 15 events, buffer should only hold 10
      for (let i = 0; i < 15; i++) {
        bus.emit('p1', 'terminal:command_executed', { cmd: `cmd-${i}` });
      }
      expect(bus.history('terminal:command_executed')).toHaveLength(10);
    });

    it('supports end-to-end emit/subscribe with core events (SC-001)', () => {
      const bus = createBusWithCoreEvents();

      bus.registerPanel('terminal-1', {
        panelType: 'terminal',
        emits: ['terminal:command_executed'],
        subscribes: ['terminal:command_executed'],
      });
      bus.registerPanel('file-panel', {
        panelType: 'files',
        emits: [],
        subscribes: ['terminal:command_executed'],
      });
      bus.registerPanel('git-panel', {
        panelType: 'git',
        emits: [],
        subscribes: ['terminal:command_executed'],
      });

      const terminalEvents: BusEvent[] = [];
      const fileEvents: BusEvent[] = [];
      const gitEvents: BusEvent[] = [];

      bus.subscribe('terminal-1', 'terminal:command_executed', (e) => terminalEvents.push(e));
      bus.subscribe('file-panel', 'terminal:command_executed', (e) => fileEvents.push(e));
      bus.subscribe('git-panel', 'terminal:command_executed', (e) => gitEvents.push(e));

      bus.emit('terminal-1', 'terminal:command_executed', { command: 'git status', exitCode: 0 });

      // SC-001: terminal panel does NOT receive its own event
      expect(terminalEvents).toHaveLength(0);
      // SC-001: file and git panels DO receive it
      expect(fileEvents).toHaveLength(1);
      expect(gitEvents).toHaveLength(1);
    });

    it('wildcard git:operation_* subscription (SC-003)', () => {
      const bus = createBusWithCoreEvents();

      bus.registerPanel('git-source', {
        panelType: 'git',
        emits: ['git:operation_commit', 'git:operation_push', 'git:operation_pull'],
        subscribes: [],
      });
      bus.registerPanel('status-panel', {
        panelType: 'status',
        emits: [],
        subscribes: ['git:operation_*'],
      });

      const received: BusEvent[] = [];
      bus.subscribe('status-panel', 'git:operation_*', (e) => received.push(e));

      bus.emit('git-source', 'git:operation_commit', { sha: 'abc' });
      bus.emit('git-source', 'git:operation_push', { remote: 'origin' });
      bus.emit('git-source', 'git:operation_pull', { remote: 'origin' });

      expect(received).toHaveLength(3);
      expect(received.map(e => e.type)).toEqual([
        'git:operation_commit',
        'git:operation_push',
        'git:operation_pull',
      ]);
    });
  });
});
