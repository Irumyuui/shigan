import { describe, expect, it } from 'vitest';
import { syntaxFor } from '../../src/core/language';
import { scan } from '../../src/core/lexer/tokenizer';
import { bracketChars } from './helpers';

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

  it('keeps brackets opaque inside a C# interpolation hole', () => {
    const chars = scan('var s = $"{ "}" }";', syntaxFor('csharp'))
      .brackets.map((b) => b.char)
      .join('');
    expect(chars).toBe('');
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

  it('strips a trailing line comment from the display but keeps the code', () => {
    const directives = scan('#if 1 // note\n#endif\n').directives;
    expect(directives[0].display).toBe('#if 1');
  });

  it('strips an inline block comment from the display', () => {
    const directives = scan('#if /* c */ 1\n#endif\n').directives;
    expect(directives[0].display).toBe('#if 1');
  });

  it('keeps comment-like text inside string literals', () => {
    const directives = scan('#define URL "http://x"\n').directives;
    expect(directives[0].display).toBe('#define URL "http://x"');
  });

  it('recognizes a directive preceded by a same-line block comment', () => {
    const directives = scan('/* c */ #if 1\nint a;\n/* x */ #endif\n').directives;
    expect(directives.map((d) => d.name)).toEqual(['if', 'endif']);
    expect(directives[0].display).toBe('#if 1');
    expect(directives[0].line).toBe(0);
  });
});


