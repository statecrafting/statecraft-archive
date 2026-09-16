import { describe, it, expect } from 'vitest';
import { RingBuffer } from './ring-buffer.js';
import type { BusEvent } from './types.js';

function makeEvent(id: string, type = 'test'): BusEvent<string> {
  return { id, type, payload: id, sourcePanel: 'p1', timestamp: Date.now() };
}

describe('RingBuffer', () => {
  it('starts empty', () => {
    const buf = new RingBuffer(5);
    expect(buf.size).toBe(0);
    expect(buf.last()).toEqual([]);
  });

  it('stores events up to capacity', () => {
    const buf = new RingBuffer(3);
    buf.push(makeEvent('a'));
    buf.push(makeEvent('b'));
    buf.push(makeEvent('c'));
    expect(buf.size).toBe(3);
    const events = buf.last();
    expect(events.map(e => e.id)).toEqual(['c', 'b', 'a']);
  });

  it('overwrites oldest when full', () => {
    const buf = new RingBuffer(2);
    buf.push(makeEvent('a'));
    buf.push(makeEvent('b'));
    buf.push(makeEvent('c')); // overwrites 'a'
    expect(buf.size).toBe(2);
    expect(buf.last().map(e => e.id)).toEqual(['c', 'b']);
  });

  it('last(n) returns at most n events', () => {
    const buf = new RingBuffer(10);
    buf.push(makeEvent('a'));
    buf.push(makeEvent('b'));
    buf.push(makeEvent('c'));
    expect(buf.last(2).map(e => e.id)).toEqual(['c', 'b']);
  });

  it('last(n) clamps to available', () => {
    const buf = new RingBuffer(10);
    buf.push(makeEvent('a'));
    expect(buf.last(5).map(e => e.id)).toEqual(['a']);
  });

  it('clear resets buffer', () => {
    const buf = new RingBuffer(3);
    buf.push(makeEvent('a'));
    buf.push(makeEvent('b'));
    buf.clear();
    expect(buf.size).toBe(0);
    expect(buf.last()).toEqual([]);
  });

  it('wraps around correctly after multiple overwrites', () => {
    const buf = new RingBuffer(3);
    for (let i = 0; i < 7; i++) {
      buf.push(makeEvent(String(i)));
    }
    expect(buf.size).toBe(3);
    expect(buf.last().map(e => e.id)).toEqual(['6', '5', '4']);
  });
});
