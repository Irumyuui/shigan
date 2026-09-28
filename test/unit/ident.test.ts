import { describe, expect, it } from 'vitest';
import { countNewlines, isIdentPart, isIdentStart } from '../../src/core/ident';

describe('isIdentStart', () => {
  it('accepts ASCII letters and underscore', () => {
    expect(isIdentStart('a')).toBe(true);
    expect(isIdentStart('Z')).toBe(true);
    expect(isIdentStart('_')).toBe(true);
  });

  it('rejects digits, punctuation and undefined', () => {
    expect(isIdentStart('0')).toBe(false);
    expect(isIdentStart('-')).toBe(false);
    expect(isIdentStart('')).toBe(false);
    expect(isIdentStart(undefined)).toBe(false);
  });
});

describe('isIdentPart', () => {
  it('accepts digits on top of identifier starts', () => {
    expect(isIdentPart('a')).toBe(true);
    expect(isIdentPart('_')).toBe(true);
    expect(isIdentPart('7')).toBe(true);
  });

  it('rejects punctuation and undefined', () => {
    expect(isIdentPart('-')).toBe(false);
    expect(isIdentPart(undefined)).toBe(false);
  });
});

describe('countNewlines', () => {
  it('counts \\n only, so \\r\\n counts once', () => {
    expect(countNewlines('')).toBe(0);
    expect(countNewlines('a\nb\n')).toBe(2);
    expect(countNewlines('a\r\nb\r\n')).toBe(2);
    expect(countNewlines('a\rb')).toBe(0);
  });
});
