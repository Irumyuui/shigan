import { describe, expect, it } from 'vitest';
import { scan } from '../../src/core/lexer/tokenizer';

describe('tokenizer.brackets', () => {
  it('collects brackets outside comments and strings', () => {
    expect(bracketChars('a{b[c(d)e]f}g')).toBe('{[()]}');
  });

  it('ignores brackets in line comments', () => {
    expect(bracketChars('a; // ) } ]\nb;')).toBe('');
  });

  it('ignores brackets in block comments', () => {
    expect(bracketChars('a; /* ) } ]\n still */ b;')).toBe('');
  });

  it('ignores brackets in strings and char literals', () => {
    expect(bracketChars('a = "}"; b = \')\'; c = "[{";')).toBe('');
  });

  it('handles escaped quotes inside strings', () => {
    expect(bracketChars('a = "\\")"; }')).toBe('}');
  });

  it('follows backslash-newline continuations inside // comments', () => {
    expect(bracketChars('// comment \\\n still comment }\nreal;')).toBe('');
  });

  it('tracks line and column', () => {
    expect(scan('a\n  {\n').brackets).toEqual([{ char: '{', offset: 4, line: 1, col: 2 }]);
  });
});

describe('tokenizer.directives', () => {
  it('detects directives only at the start of a logical line', () => {
    const names = scan('  #if X\nint a = 1; // #endif\n#endif\n').directives.map((d) => d.name);
    expect(names).toEqual(['if', 'endif']);
  });

  it('ignores directive-like text inside block comments', () => {
    const directives = scan('/*\n#if 0\n*/\n#endif\n').directives;
    expect(directives.map((d) => d.name)).toEqual(['endif']);
    expect(directives[0].line).toBe(3);
  });

  it('joins directives continued with a backslash', () => {
    const directives = scan('#define X \\\n  1\n#if defined(X)\n#endif\n').directives;
    expect(directives[0].name).toBe('define');
    expect(directives[0].display).toBe('#define X 1');
    expect(directives[0].endLine).toBe(1);
    expect(directives[1].display).toBe('#if defined(X)');
  });

  it('exposes the normalized display text', () => {
    const directives = scan('#if   defined(A)   &&   B\n#endif\n').directives;
    expect(directives[0].display).toBe('#if defined(A) && B');
  });
});

function bracketChars(text: string): string {
  return scan(text)
    .brackets.map((b) => b.char)
    .join('');
}
