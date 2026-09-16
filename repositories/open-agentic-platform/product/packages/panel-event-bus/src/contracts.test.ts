import { describe, it, expect } from 'vitest';
import { defineContract, mergeContracts, validateContract } from './contracts.js';

describe('contracts', () => {
  describe('defineContract', () => {
    it('creates a valid contract', () => {
      const c = defineContract('terminal', ['terminal:command_executed'], ['files:changed']);
      expect(c.panelType).toBe('terminal');
      expect(c.emits).toEqual(['terminal:command_executed']);
      expect(c.subscribes).toEqual(['files:changed']);
    });

    it('throws on empty panelType', () => {
      expect(() => defineContract('', [], [])).toThrow('non-empty');
    });

    it('returns defensive copies', () => {
      const emits = ['a'];
      const c = defineContract('t', emits, []);
      emits.push('b');
      expect(c.emits).toEqual(['a']);
    });
  });

  describe('mergeContracts', () => {
    it('merges emits and subscribes', () => {
      const a = defineContract('terminal', ['a', 'b'], ['x']);
      const b = defineContract('terminal', ['b', 'c'], ['x', 'y']);
      const merged = mergeContracts(a, b);
      expect(merged.emits).toEqual(['a', 'b', 'c']);
      expect(merged.subscribes).toEqual(['x', 'y']);
    });

    it('throws on different panelTypes', () => {
      const a = defineContract('terminal', [], []);
      const b = defineContract('editor', [], []);
      expect(() => mergeContracts(a, b)).toThrow('different panel types');
    });
  });

  describe('validateContract', () => {
    it('returns empty for valid contract', () => {
      const types = new Set(['files:changed', 'git:operation_commit']);
      const c = defineContract('t', ['files:changed'], ['git:operation_commit']);
      expect(validateContract(c, types)).toEqual([]);
    });

    it('reports unregistered emit types', () => {
      const types = new Set(['files:changed']);
      const c = defineContract('t', ['unknown:event'], []);
      const errors = validateContract(c, types);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('unknown:event');
    });

    it('reports unregistered subscribe types', () => {
      const types = new Set(['files:changed']);
      const c = defineContract('t', [], ['missing:event']);
      const errors = validateContract(c, types);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('missing:event');
    });

    it('skips wildcard subscribes', () => {
      const types = new Set(['files:changed']);
      const c = defineContract('t', [], ['git:operation_*']);
      expect(validateContract(c, types)).toEqual([]);
    });
  });
});
