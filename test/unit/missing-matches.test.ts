import { describe, expect, it } from 'vitest';
import { computeHints } from '../../src/core/hints';
import { matchBrackets } from '../../src/core/match/brackets';
import { scan } from '../../src/core/lexer/tokenizer';
import { predicates } from './support';

const BRACKETS = { brackets: true, macros: false, trigger: 'always' } as const;

describe('missing matches', () => {
  it('keeps the pairs that are still complete when a closing brace is missing', () => {
    const text = 'int f(void) {\n    if (x) {\n        y();\n}\n';
    const hints = computeHints(text, BRACKETS);
    // The inner block still pairs; the outer `{` is unmatched and silent.
    expect(hints).toEqual([expect.objectContaining({ line: 3, text: ' <- :2-4 if (x)' })]);
  });

  it('survives an extra closing brace before the real block', () => {
    const text = '}\nint f(void) {\n}\n';
    expect(computeHints(text, BRACKETS)).toEqual([
      expect.objectContaining({ line: 2, text: ' <- :2-3 int f(void)' }),
    ]);
  });

  it('reports only the well-nested pairs when bracket types are mismatched', () => {
    const text = '{\n    (\n}\n)\n';
    // `}` cannot close `(`, so the parentheses pair and `{` stays unmatched.
    expect(computeHints(text, BRACKETS)).toEqual([
      expect.objectContaining({ line: 3, text: ' <- :2-4 {' }),
    ]);
  });

  it('loses matches that a macro would produce', () => {
    const text = '#define OPEN {\nint f(void)\nOPEN\n    return 0;\n}\n';
    // Documented limitation: `OPEN` expands to `{` only in the preprocessor.
    expect(computeHints(text, BRACKETS)).toEqual([]);
  });

  it('never matches brackets written inside a directive line', () => {
    const text = '#define PAIR ( )\nint f(void) {\n}\n';
    expect(computeHints(text, BRACKETS)).toEqual([
      expect.objectContaining({ line: 2, text: ' <- :2-3 int f(void)' }),
    ]);
  });

  it('ignores brackets inside strings even when they would balance', () => {
    const text = 'int f(void) {\n    char *s = "}";\n';
    // The `}` in the string is not a token, so `{` stays unmatched.
    expect(computeHints(text, BRACKETS)).toEqual([]);
  });

  it('stops matching after an unterminated block comment', () => {
    expect(computeHints('int f(void) {\n/* never closed\n', BRACKETS)).toEqual([]);
  });

  it('handles thousands of unmatched opening brackets', () => {
    const text = '{'.repeat(2000) + '\n';
    const start = performance.now();
    expect(computeHints(text, BRACKETS)).toEqual([]);
    expect(performance.now() - start).toBeLessThan(200);
  });

  it('keeps a live pair even when a bracket in a dead branch was dropped', () => {
    const text = '#if 0\n{\n#endif\nint f(void) {\n}\n';
    const hints = computeHints(text, {
      ...BRACKETS,
      skipInactiveBrackets: true,
      ...predicates(text),
    });
    expect(hints).toEqual([
      expect.objectContaining({ line: 4, text: ' <- :4-5 int f(void)' }),
    ]);
  });

  it('reports unmatched tokens separately from pairs', () => {
    const result = matchBrackets(scan('{ ( } )').brackets);
    expect(result.pairs).toHaveLength(1);
    expect(result.pairs[0].open.char + result.pairs[0].close.char).toBe('()');
    expect(result.unmatched.map((token) => token.char).sort()).toEqual(['{', '}']);
  });
});
