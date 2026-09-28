import { describe, expect, it } from 'vitest';
import { syntaxFor } from '../../src/core/language';

describe('syntaxFor', () => {
  it('returns the C profile for c', () => {
    const syntax = syntaxFor('c');
    expect(syntax.id).toBe('c');
    expect(syntax.rawStrings).toBe(false);
    expect(syntax.csharpLiterals).toBe(false);
  });

  it('returns the C++ profile for cpp', () => {
    const syntax = syntaxFor('cpp');
    expect(syntax.id).toBe('cpp');
    expect(syntax.rawStrings).toBe(true);
    expect(syntax.csharpLiterals).toBe(false);
  });

  it('returns the C# profile for csharp', () => {
    const syntax = syntaxFor('csharp');
    expect(syntax.id).toBe('csharp');
    expect(syntax.rawStrings).toBe(false);
    expect(syntax.csharpLiterals).toBe(true);
  });

  it('falls back to the C profile for unknown ids', () => {
    expect(syntaxFor('cuda')).toEqual(syntaxFor('c'));
  });
});
