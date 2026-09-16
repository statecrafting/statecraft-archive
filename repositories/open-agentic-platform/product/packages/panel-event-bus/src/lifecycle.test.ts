import { describe, it, expect } from 'vitest';
import { EventBus } from './event-bus.js';
import { mountPanel } from './lifecycle.js';
import type { BusEvent } from './types.js';

describe('lifecycle', () => {
  function setup() {
    const bus = new EventBus();
    bus.registerEventType({ name: 'files:changed' });
    bus.registerEventType({ name: 'git:operation_commit' });
    bus.registerEventType({ name: 'terminal:command_executed' });
    return bus;
  }

  it('mountPanel registers the panel on the bus', () => {
    const bus = setup();
    const handle = mountPanel(bus, 'p1', {
      panelType: 'editor',
      emits: ['files:changed'],
      subscribes: [],
    });
    expect(bus.hasPanel('p1')).toBe(true);
    expect(handle.instanceId).toBe('p1');
    expect(handle.mounted).toBe(true);
  });

  it('handle.emit emits through the bus', () => {
    const bus = setup();
    const emitter = mountPanel(bus, 'p1', {
      panelType: 'editor',
      emits: ['files:changed'],
      subscribes: [],
    });
    const receiver = mountPanel(bus, 'p2', {
      panelType: 'git',
      emits: [],
      subscribes: ['files:changed'],
    });

    const received: BusEvent[] = [];
    receiver.subscribe('files:changed', (e) => received.push(e));
    emitter.emit('files:changed', { path: '/a.ts' });

    expect(received).toHaveLength(1);
    expect(received[0].payload).toEqual({ path: '/a.ts' });
  });

  it('handle.subscribe tracks subscriptions', () => {
    const bus = setup();
    const emitter = mountPanel(bus, 'p1', {
      panelType: 'editor',
      emits: ['files:changed'],
      subscribes: [],
    });
    const receiver = mountPanel(bus, 'p2', {
      panelType: 'git',
      emits: [],
      subscribes: ['files:changed'],
    });

    const received: BusEvent[] = [];
    const unsub = receiver.subscribe('files:changed', (e) => received.push(e));

    emitter.emit('files:changed', 'first');
    unsub();
    emitter.emit('files:changed', 'second');

    expect(received).toHaveLength(1);
  });

  it('unmount removes all subscriptions (SC-005)', () => {
    const bus = setup();
    const emitter = mountPanel(bus, 'p1', {
      panelType: 'editor',
      emits: ['files:changed'],
      subscribes: [],
    });
    const receiver = mountPanel(bus, 'p2', {
      panelType: 'git',
      emits: [],
      subscribes: ['files:changed'],
    });

    const received: BusEvent[] = [];
    receiver.subscribe('files:changed', (e) => received.push(e));

    emitter.emit('files:changed', 'before');
    expect(received).toHaveLength(1);

    receiver.unmount();
    expect(receiver.mounted).toBe(false);
    expect(bus.hasPanel('p2')).toBe(false);

    emitter.emit('files:changed', 'after');
    expect(received).toHaveLength(1); // no new events
  });

  it('unmount is idempotent', () => {
    const bus = setup();
    const handle = mountPanel(bus, 'p1', {
      panelType: 'editor',
      emits: [],
      subscribes: [],
    });
    handle.unmount();
    handle.unmount(); // no throw
    expect(handle.mounted).toBe(false);
  });

  it('emit after unmount throws', () => {
    const bus = setup();
    const handle = mountPanel(bus, 'p1', {
      panelType: 'editor',
      emits: ['files:changed'],
      subscribes: [],
    });
    handle.unmount();
    expect(() => handle.emit('files:changed', {})).toThrow('not mounted');
  });

  it('subscribe after unmount throws', () => {
    const bus = setup();
    const handle = mountPanel(bus, 'p1', {
      panelType: 'editor',
      emits: [],
      subscribes: ['files:changed'],
    });
    handle.unmount();
    expect(() => handle.subscribe('files:changed', () => {})).toThrow('not mounted');
  });

  it('replay works through handle', () => {
    const bus = setup();
    const emitter = mountPanel(bus, 'p1', {
      panelType: 'editor',
      emits: ['files:changed'],
      subscribes: [],
    });

    emitter.emit('files:changed', 'a');
    emitter.emit('files:changed', 'b');

    const receiver = mountPanel(bus, 'p2', {
      panelType: 'git',
      emits: [],
      subscribes: ['files:changed'],
    });

    const replayed: BusEvent[] = [];
    receiver.subscribe('files:changed', (e) => replayed.push(e), { replay: 2 });

    expect(replayed).toHaveLength(2);
    expect(replayed.map(e => e.payload)).toEqual(['a', 'b']);
  });

  it('multiple subscriptions all cleaned up on unmount', () => {
    const bus = setup();
    const emitter = mountPanel(bus, 'p1', {
      panelType: 'multi',
      emits: ['files:changed', 'git:operation_commit'],
      subscribes: [],
    });
    const receiver = mountPanel(bus, 'p2', {
      panelType: 'dashboard',
      emits: [],
      subscribes: ['files:changed', 'git:operation_commit'],
    });

    const events1: BusEvent[] = [];
    const events2: BusEvent[] = [];
    receiver.subscribe('files:changed', (e) => events1.push(e));
    receiver.subscribe('git:operation_commit', (e) => events2.push(e));

    emitter.emit('files:changed', 'f1');
    emitter.emit('git:operation_commit', 'c1');
    expect(events1).toHaveLength(1);
    expect(events2).toHaveLength(1);

    receiver.unmount();
    emitter.emit('files:changed', 'f2');
    emitter.emit('git:operation_commit', 'c2');
    expect(events1).toHaveLength(1);
    expect(events2).toHaveLength(1);
  });
});
