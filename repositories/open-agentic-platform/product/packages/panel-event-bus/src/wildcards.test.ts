import { describe, it, expect } from 'vitest';
import { isWildcard, patternToRegExp, matchesPattern } from './wildcards.js';

describe('wildcards', () => {
  describe('isWildcard', () => {
    it('returns false for exact patterns', () => {
      expect(isWildcard('files:changed')).toBe(false);
    });

    it('returns true for glob patterns', () => {
      expect(isWildcard('git:operation_*')).toBe(true);
      expect(isWildcard('*')).toBe(true);
      expect(isWildcard('*:*')).toBe(true);
    });
  });

  describe('patternToRegExp', () => {
    it('converts simple wildcard', () => {
      const re = patternToRegExp('git:operation_*');
      expect(re.test('git:operation_commit')).toBe(true);
      expect(re.test('git:operation_push')).toBe(true);
      expect(re.test('files:changed')).toBe(false);
    });

    it('escapes regex special chars', () => {
      const re = patternToRegExp('test.event_*');
      expect(re.test('test.event_foo')).toBe(true);
      expect(re.test('testXevent_foo')).toBe(false);
    });

    it('matches full string only', () => {
      const re = patternToRegExp('git:*');
      expect(re.test('git:operation_commit')).toBe(true);
      expect(re.test('xgit:operation_commit')).toBe(false);
    });
  });

  describe('matchesPattern', () => {
    it('exact match', () => {
      expect(matchesPattern('files:changed', 'files:changed')).toBe(true);
      expect(matchesPattern('files:changed', 'files:opened')).toBe(false);
    });

    it('glob match', () => {
      expect(matchesPattern('git:operation_commit', 'git:operation_*')).toBe(true);
      expect(matchesPattern('git:operation_pull', 'git:operation_*')).toBe(true);
      expect(matchesPattern('files:changed', 'git:operation_*')).toBe(false);
    });

    it('catch-all wildcard', () => {
      expect(matchesPattern('anything:here', '*')).toBe(true);
    });

    it('namespace wildcard', () => {
      expect(matchesPattern('git:operation_commit', 'git:*')).toBe(true);
      expect(matchesPattern('terminal:command_executed', 'git:*')).toBe(false);
    });
  });
});
