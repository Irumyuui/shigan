import { describe, expect, it } from 'vitest';
import { parseCompileFlags } from '../../src/core/flags';
import { syntaxFor } from '../../src/core/language';

describe('parseCompileFlags standard macros', () => {
  it('injects __cplusplus for C++ from -std', () => {
    const { macros } = parseCompileFlags(['-std=c++17'], undefined, syntaxFor('cpp'));
    expect(macros.get('__cplusplus')?.value).toBe('201703');
    expect(macros.has('__STDC__')).toBe(false);
    expect(macros.has('__STDC_VERSION__')).toBe(false);
  });

  it('maps every C++ standard', () => {
    const value = (standard: string): string | undefined =>
      parseCompileFlags([`-std=${standard}`], undefined, syntaxFor('cpp')).macros.get('__cplusplus')
        ?.value;
    expect(value('c++98')).toBe('199711');
    expect(value('c++03')).toBe('199711');
    expect(value('c++11')).toBe('201103');
    expect(value('c++14')).toBe('201402');
    expect(value('c++20')).toBe('202002');
    expect(value('c++23')).toBe('202302');
    expect(value('gnu++17')).toBe('201703');
  });
});
