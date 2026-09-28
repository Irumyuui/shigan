import { describe, expect, it } from 'vitest';
import { parseCompileFlags } from '../../src/core/flags';
import { syntaxFor } from '../../src/core/language';

describe('parseCompileFlags', () => {
  it('injects no standard macros for C#', () => {
    const { macros } = parseCompileFlags(['-std=c++17'], undefined, syntaxFor('csharp'));
    expect(macros.has('__STDC__')).toBe(false);
    expect(macros.has('__STDC_VERSION__')).toBe(false);
    expect(macros.has('__cplusplus')).toBe(false);
  });
});
