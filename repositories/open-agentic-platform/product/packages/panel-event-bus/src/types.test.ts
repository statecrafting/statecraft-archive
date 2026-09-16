import { describe, it, expect } from 'vitest';
import type {
  EventTypeName,
  PanelInstanceId,
  EventTypeSchema,
  BusEvent,
  PanelEventContract,
  EventHandler,
  SubscribeOptions,
  RingBufferOptions,
  EventBusOptions,
} from './types.js';
import { DEFAULT_RING_BUFFER_SIZE } from './types.js';

describe('types', () => {
  it('exports DEFAULT_RING_BUFFER_SIZE as 50', () => {
    expect(DEFAULT_RING_BUFFER_SIZE).toBe(50);
  });

  it('EventTypeName is a string alias', () => {
    const name: EventTypeName = 'terminal:command_executed';
    expect(typeof name).toBe('string');
  });

  it('PanelInstanceId is a string alias', () => {
    const id: PanelInstanceId = 'panel-1';
    expect(typeof id).toBe('string');
  });

  it('EventTypeSchema shape', () => {
    const schema: EventTypeSchema<{ cmd: string }> = {
      name: 'terminal:command_executed',
      validate: (p): p is { cmd: string } => typeof (p as any)?.cmd === 'string',
    };
    expect(schema.name).toBe('terminal:command_executed');
    expect(schema.validate?.({ cmd: 'ls' })).toBe(true);
  });

  it('BusEvent shape', () => {
    const event: BusEvent<string> = {
      id: 'evt-1',
      type: 'files:changed',
      payload: '/src/foo.ts',
      sourcePanel: 'panel-a',
      timestamp: 1000,
    };
    expect(event.type).toBe('files:changed');
    expect(event.sourcePanel).toBe('panel-a');
  });

  it('PanelEventContract shape', () => {
    const contract: PanelEventContract = {
      panelType: 'terminal',
      emits: ['terminal:command_executed'],
      subscribes: ['files:changed'],
    };
    expect(contract.panelType).toBe('terminal');
    expect(contract.emits).toHaveLength(1);
  });

  it('EventHandler type accepts BusEvent', () => {
    const handler: EventHandler<number> = (event) => {
      expect(event.payload).toBe(42);
    };
    handler({
      id: 'e1',
      type: 'test',
      payload: 42,
      sourcePanel: 'p1',
      timestamp: 0,
    });
  });

  it('SubscribeOptions replay is optional', () => {
    const opts: SubscribeOptions = {};
    expect(opts.replay).toBeUndefined();
    const withReplay: SubscribeOptions = { replay: 5 };
    expect(withReplay.replay).toBe(5);
  });

  it('EventBusOptions has optional ringBuffer', () => {
    const opts: EventBusOptions = { ringBuffer: { maxPerType: 100 } };
    expect(opts.ringBuffer?.maxPerType).toBe(100);
  });
});
