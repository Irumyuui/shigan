import { describe, expect, it } from 'vitest';
import { mergeCSharpMacros } from '../../src/core/csharp';
import { syntaxFor } from '../../src/core/language';
import { scan } from '../../src/core/lexer/tokenizer';
import { evaluateConditionals } from '../../src/core/match/c-preprocessor';
import { MacroDef } from '../../src/core/types';

const symbol = (value: string): MacroDef => ({ value, functionLike: false });

describe('mergeCSharpMacros', () => {
  it('applies precedence project < define < flags', () => {
    const flags = new Map<string, MacroDef>([
      ['FOO', symbol('2')],
      ['FLAG_ONLY', { value: '3', functionLike: true }],
    ]);

    const macros = mergeCSharpMacros(['FOO', 'PROJ_ONLY'], ['FOO', 'DEF_ONLY'], flags);

    expect(macros.get('FOO')).toEqual(symbol('2'));
    expect(macros.get('PROJ_ONLY')).toEqual(symbol('1'));
    expect(macros.get('DEF_ONLY')).toEqual(symbol('1'));
    expect(macros.get('FLAG_ONLY')).toEqual({ value: '3', functionLike: true });
    expect(macros.size).toBe(4);
  });

  it('skips invalid identifiers in project symbols and defines', () => {
    const macros = mergeCSharpMacros(
      ['GOOD', 'BAD-NAME', '1BAD', '', '   ', 'has space'],
      ['ALSO_GOOD', 'x!', '9lives'],
      new Map()
    );

    expect([...macros.keys()].sort()).toEqual(['ALSO_GOOD', 'GOOD']);
    expect(macros.get('GOOD')).toEqual(symbol('1'));
    expect(macros.get('ALSO_GOOD')).toEqual(symbol('1'));
  });

  it('trims valid symbols with surrounding whitespace', () => {
    const macros = mergeCSharpMacros(['  PADDED  '], ['\tTABBED\n'], new Map());
    expect([...macros.keys()].sort()).toEqual(['PADDED', 'TABBED']);
  });

  it('collapses duplicate names', () => {
    const macros = mergeCSharpMacros(
      ['DUP', 'DUP'],
      ['DUP', 'ONLY'],
      new Map([['DUP', symbol('7')]])
    );

    expect(macros.size).toBe(2);
    expect(macros.get('DUP')).toEqual(symbol('7'));
    expect(macros.get('ONLY')).toEqual(symbol('1'));
  });

  it('accepts undefined/empty sources', () => {
    const macros = mergeCSharpMacros(undefined, [], new Map());
    expect(macros.size).toBe(0);

    const onlyFlags = mergeCSharpMacros(undefined, [], new Map([['X', symbol('9')]]));
    expect(onlyFlags.get('X')).toEqual(symbol('9'));
  });

  it('copies flag macros unchanged, preserving function-like definitions', () => {
    const fnLike: MacroDef = { value: '((x) * 2)', functionLike: true };
    const macros = mergeCSharpMacros([], [], new Map([['DOUBLE', fnLike]]));
    expect(macros.get('DOUBLE')).toEqual(fnLike);
    expect(macros.get('DOUBLE')).toBe(fnLike);
  });

  it('lets a file-level #define win over the merged map', () => {
    const text = '#define FOO 0\n#if FOO\nAAAA\n#else\nBBBB\n#endif\n';
    const syntax = syntaxFor('csharp');
    const macros = mergeCSharpMacros(['FOO'], ['FOO'], new Map([['FOO', symbol('1')]]));

    const result = evaluateConditionals(scan(text, syntax).directives, { macros, syntax });

    // FOO is seeded as 1, but `#define FOO 0` (line 0) overrides it, so the
    // first branch is inactive and the `#else` body is active.
    expect(result.inactiveLines.has(2)).toBe(true);
    expect(result.inactiveLines.has(4)).toBe(false);
  });
});
