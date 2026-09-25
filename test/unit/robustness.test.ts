import { describe, expect, it } from 'vitest';
import { computeHints } from '../../src/core/hints';
import { scan } from '../../src/core/lexer/tokenizer';

const BRACKETS = { brackets: true, macros: false, trigger: 'always' } as const;

describe('robustness', () => {
  it('handles a UTF-8 BOM', () => {
    const text = '\uFEFFint main(void) {\n}\n';
    expect(computeHints(text, BRACKETS)).toEqual([
      expect.objectContaining({ line: 1, text: ' <- :1-2 int main(void)' }),
    ]);
  });

  it('handles CRLF line endings', () => {
    const text = 'int main(void) {\r\n    return 0;\r\n}\r\n';
    expect(computeHints(text, BRACKETS)).toEqual([
      expect.objectContaining({ line: 2, text: ' <- :1-3 int main(void)' }),
    ]);
  });

  it('treats a tab as one column and falls back to the previous line', () => {
    const text = 'if (a)\n\t{\n}\n';
    expect(computeHints(text, BRACKETS)).toEqual([
      expect.objectContaining({ line: 2, text: ' <- :2-3 if (a)' }),
    ]);
  });

  it('does not throw on truncated input', () => {
    const truncated = ['/*', '/* unterminated', '"unterminated', "'", '\\', '#if', '#define X \\', '\uFEFF'];
    for (const text of truncated) {
      expect(() => scan(text)).not.toThrow();
      expect(() => computeHints(text, { brackets: true, macros: true, trigger: 'always' })).not.toThrow();
    }
  });

  it('handles an empty document', () => {
    expect(computeHints('', { brackets: true, macros: true, trigger: 'always' })).toEqual([]);
    expect(computeHints('\n\n\n', { brackets: true, macros: true, trigger: 'always' })).toEqual([]);
  });

  it('matches 200 nested braces across two lines', () => {
    const depth = 200;
    const text = '{'.repeat(depth) + '\n' + '}'.repeat(depth) + '\n';
    const start = performance.now();
    const hints = computeHints(text, BRACKETS);
    const elapsed = performance.now() - start;

    expect(hints).toHaveLength(depth);
    expect(hints.every((hint) => hint.line === 1)).toBe(true);
    expect(hints[0].target).toEqual({ line: 0, col: 0 });
    expect(elapsed).toBeLessThan(200);
  });

  it('drops same-line noise from deep single-line nesting', () => {
    const inner = 'f('.repeat(50) + 'x' + ')'.repeat(50);
    const text = `int g(void) {\n    return ${inner};\n}\n`;
    const hints = computeHints(text, BRACKETS);
    expect(hints).toEqual([expect.objectContaining({ line: 2, text: ' <- :1-3 int g(void)' })]);
  });

  it('ignores stray branch and endif directives', () => {
    expect(computeHints('#endif\n#else\nint f(void) {\n}\n', {
      brackets: false,
      macros: true,
      trigger: 'always',
    })).toEqual([]);
  });

  it('shows nothing for an unclosed #if', () => {
    expect(
      computeHints('#if X\nint f(void) {\n}\n', { brackets: false, macros: true, trigger: 'always' })
    ).toEqual([]);
  });

  it('joins a directive continued with a backslash', () => {
    const text = '#if defined(A) && \\\n    defined(B)\nint f(void) {\n}\n#endif\n';
    const hints = computeHints(text, { brackets: false, macros: true, trigger: 'always' });
    expect(hints).toHaveLength(1);
    expect(hints[0].text).toContain('#if defined(A) && defined(B)');
  });
});
