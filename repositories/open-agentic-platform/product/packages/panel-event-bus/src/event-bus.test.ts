import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventBus } from './event-bus.js';
import type { BusEvent } from './types.js';

describe('EventBus', () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus();
  });

  // --- Event type registration (FR-002) ---

  describe('event type registration', () => {
    it('registers an event type', () => {
      bus.registerEventType({ name: 'files:changed' });
      expect(bus.hasEventType('files:changed')).toBe(true);
    });

    it('lists registered event types', () => {
      bus.registerEventType({ name: 'files:changed' });
      bus.registerEventType({ name: 'git:operation_commit' });
      expect(bus.getEventTypeNames()).toContain('files:changed');
      expect(bus.getEventTypeNames()).toContain('git:operation_commit');
    });

    it('rejects emission of unregistered event type', () => {
      bus.registerPanel('p1', { panelType: 'test', emits: ['unknown:event'], subscribes: [] });
      expect(() => bus.emit('p1', 'unknown:event', {})).toThrow('not registered');
    });
  });

  // --- Panel registration ---

  describe('panel registration', () => {
    it('registers and checks a panel', () => {
      bus.registerPanel('p1', { panelType: 'terminal', emits: [], subscribes: [] });
      expect(bus.hasPanel('p1')).toBe(true);
    });

    it('unregisters a panel', () => {
      bus.registerPanel('p1', { panelType: 'terminal', emits: [], subscribes: [] });
      bus.unregisterPanel('p1');
      expect(bus.hasPanel('p1')).toBe(false);
    });
  });

  // --- Emission and contract enforcement (FR-003) ---

  describe('emit', () => {
    it('emits an event and returns BusEvent', () => {
      bus.registerEventType({ name: 'files:changed' });
      bus.registerPanel('p1', { panelType: 'editor', emits: ['files:changed'], subscribes: [] });
      const event = bus.emit('p1', 'files:changed', { path: '/a.ts' });
      expect(event.type).toBe('files:changed');
      expect(event.sourcePanel).toBe('p1');
      expect(event.payload).toEqual({ path: '/a.ts' });
      expect(event.id).toBeTruthy();
      expect(event.timestamp).toBeGreaterThan(0);
    });

    it('throws if panel not registered', () => {
      bus.registerEventType({ name: 'files:changed' });
      expect(() => bus.emit('ghost', 'files:changed', {})).toThrow('not registered');
    });

    it('throws if panel contract does not declare emit (SC-004)', () => {
      bus.registerEventType({ name: 'files:changed' });
      bus.registerPanel('p1', { panelType: 'terminal', emits: [], subscribes: [] });
      expect(() => bus.emit('p1', 'files:changed', {})).toThrow('not allowed to emit');
    });
  });

  // --- Subscription and delivery (FR-004) ---

  describe('subscribe and deliver', () => {
    it('delivers events to subscribers', () => {
      bus.registerEventType({ name: 'files:changed' });
      bus.registerPanel('p1', { panelType: 'editor', emits: ['files:changed'], subscribes: [] });
      bus.registerPanel('p2', { panelType: 'git', emits: [], subscribes: ['files:changed'] });

      const received: BusEvent[] = [];
      bus.subscribe('p2', 'files:changed', (e) => received.push(e));
      bus.emit('p1', 'files:changed', 'update');

      expect(received).toHaveLength(1);
      expect(received[0].payload).toBe('update');
    });

    it('auto-excludes source panel (FR-004, SC-001)', () => {
      bus.registerEventType({ name: 'terminal:command_executed' });
      bus.registerPanel('p1', {
        panelType: 'terminal',
        emits: ['terminal:command_executed'],
        subscribes: ['terminal:command_executed'],
      });
      bus.registerPanel('p2', {
        panelType: 'file-panel',
        emits: [],
        subscribes: ['terminal:command_executed'],
      });

      const p1Events: BusEvent[] = [];
      const p2Events: BusEvent[] = [];
      bus.subscribe('p1', 'terminal:command_executed', (e) => p1Events.push(e));
      bus.subscribe('p2', 'terminal:command_executed', (e) => p2Events.push(e));

      bus.emit('p1', 'terminal:command_executed', { cmd: 'ls' });

      expect(p1Events).toHaveLength(0); // source excluded
      expect(p2Events).toHaveLength(1);
    });

    it('unsubscribe function works', () => {
      bus.registerEventType({ name: 'files:changed' });
      bus.registerPanel('p1', { panelType: 'editor', emits: ['files:changed'], subscribes: [] });
      bus.registerPanel('p2', { panelType: 'git', emits: [], subscribes: ['files:changed'] });

      const received: BusEvent[] = [];
      const unsub = bus.subscribe('p2', 'files:changed', (e) => received.push(e));
      bus.emit('p1', 'files:changed', 'first');
      unsub();
      bus.emit('p1', 'files:changed', 'second');

      expect(received).toHaveLength(1);
    });

    it('throws if panel subscribe contract not declared', () => {
      bus.registerEventType({ name: 'files:changed' });
      bus.registerPanel('p1', { panelType: 'terminal', emits: [], subscribes: [] });
      expect(() => bus.subscribe('p1', 'files:changed', () => {})).toThrow('not allowed to subscribe');
    });
  });

  // --- Ring buffer / history (FR-005, FR-008) ---

  describe('history and replay', () => {
    it('history returns recent events newest first (FR-008)', () => {
      bus.registerEventType({ name: 'files:changed' });
      bus.registerPanel('p1', { panelType: 'editor', emits: ['files:changed'], subscribes: [] });

      bus.emit('p1', 'files:changed', 'a');
      bus.emit('p1', 'files:changed', 'b');
      bus.emit('p1', 'files:changed', 'c');

      const history = bus.history('files:changed', 2);
      expect(history).toHaveLength(2);
      expect(history[0].payload).toBe('c');
      expect(history[1].payload).toBe('b');
    });

    it('history returns empty for untracked type', () => {
      expect(bus.history('nonexistent')).toEqual([]);
    });

    it('replay delivers past events on subscribe (FR-005, SC-002)', () => {
      bus.registerEventType({ name: 'files:changed' });
      bus.registerPanel('p1', { panelType: 'editor', emits: ['files:changed'], subscribes: [] });

      bus.emit('p1', 'files:changed', 'x');
      bus.emit('p1', 'files:changed', 'y');
      bus.emit('p1', 'files:changed', 'z');

      // Late subscriber
      bus.registerPanel('p2', { panelType: 'git', emits: [], subscribes: ['files:changed'] });
      const replayed: BusEvent[] = [];
      bus.subscribe('p2', 'files:changed', (e) => replayed.push(e), { replay: 3 });

      expect(replayed).toHaveLength(3);
      expect(replayed.map(e => e.payload)).toEqual(['x', 'y', 'z']); // oldest first
    });

    it('ring buffer respects maxPerType', () => {
      const smallBus = new EventBus({ ringBuffer: { maxPerType: 2 } });
      smallBus.registerEventType({ name: 'test' });
      smallBus.registerPanel('p1', { panelType: 't', emits: ['test'], subscribes: [] });

      smallBus.emit('p1', 'test', 1);
      smallBus.emit('p1', 'test', 2);
      smallBus.emit('p1', 'test', 3);

      const h = smallBus.history('test');
      expect(h).toHaveLength(2);
      expect(h[0].payload).toBe(3);
      expect(h[1].payload).toBe(2);
    });
  });

  // --- Wildcard subscriptions (FR-006, SC-003) ---

  describe('wildcard subscriptions', () => {
    it('glob pattern matches multiple event types (SC-003)', () => {
      bus.registerEventType({ name: 'git:operation_commit' });
      bus.registerEventType({ name: 'git:operation_push' });
      bus.registerEventType({ name: 'git:operation_pull' });

      bus.registerPanel('p1', { panelType: 'git', emits: ['git:operation_commit', 'git:operation_push', 'git:operation_pull'], subscribes: [] });
      bus.registerPanel('p2', { panelType: 'status', emits: [], subscribes: ['git:operation_*'] });

      const received: BusEvent[] = [];
      bus.subscribe('p2', 'git:operation_*', (e) => received.push(e));

      bus.emit('p1', 'git:operation_commit', { sha: 'abc' });
      bus.emit('p1', 'git:operation_push', { remote: 'origin' });
      bus.emit('p1', 'git:operation_pull', {});

      expect(received).toHaveLength(3);
      expect(received.map(e => e.type)).toEqual([
        'git:operation_commit',
        'git:operation_push',
        'git:operation_pull',
      ]);
    });

    it('wildcard does not match unrelated types', () => {
      bus.registerEventType({ name: 'git:operation_commit' });
      bus.registerEventType({ name: 'files:changed' });

      bus.registerPanel('p1', { panelType: 'multi', emits: ['git:operation_commit', 'files:changed'], subscribes: [] });
      bus.registerPanel('p2', { panelType: 'status', emits: [], subscribes: ['git:operation_*'] });

      const received: BusEvent[] = [];
      bus.subscribe('p2', 'git:operation_*', (e) => received.push(e));

      bus.emit('p1', 'files:changed', {});
      bus.emit('p1', 'git:operation_commit', {});

      expect(received).toHaveLength(1);
      expect(received[0].type).toBe('git:operation_commit');
    });

    it('wildcard replay collects from matching buffers', () => {
      bus.registerEventType({ name: 'git:operation_commit' });
      bus.registerEventType({ name: 'git:operation_push' });

      bus.registerPanel('p1', { panelType: 'git', emits: ['git:operation_commit', 'git:operation_push'], subscribes: [] });
      bus.emit('p1', 'git:operation_commit', 'c1');
      bus.emit('p1', 'git:operation_push', 'p1-push');

      bus.registerPanel('p2', { panelType: 'status', emits: [], subscribes: ['git:operation_*'] });
      const replayed: BusEvent[] = [];
      bus.subscribe('p2', 'git:operation_*', (e) => replayed.push(e), { replay: 10 });

      expect(replayed).toHaveLength(2);
    });
  });

  // --- Unregister removes subscriptions (FR-007, SC-005) ---

  describe('unregister panel', () => {
    it('removes all subscriptions on unregister (SC-005)', () => {
      bus.registerEventType({ name: 'files:changed' });
      bus.registerPanel('p1', { panelType: 'editor', emits: ['files:changed'], subscribes: [] });
      bus.registerPanel('p2', { panelType: 'git', emits: [], subscribes: ['files:changed'] });

      const received: BusEvent[] = [];
      bus.subscribe('p2', 'files:changed', (e) => received.push(e));

      bus.emit('p1', 'files:changed', 'before');
      expect(received).toHaveLength(1);

      bus.unregisterPanel('p2');
      bus.emit('p1', 'files:changed', 'after');
      expect(received).toHaveLength(1); // no new events
    });
  });

  // --- Reset ---

  describe('reset', () => {
    it('clears all state', () => {
      bus.registerEventType({ name: 'test' });
      bus.registerPanel('p1', { panelType: 't', emits: ['test'], subscribes: [] });
      bus.emit('p1', 'test', 'data');

      bus.reset();

      expect(bus.hasEventType('test')).toBe(false);
      expect(bus.hasPanel('p1')).toBe(false);
      expect(bus.history('test')).toEqual([]);
    });
  });
});
