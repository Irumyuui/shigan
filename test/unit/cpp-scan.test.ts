import { describe, expect, it } from 'vitest';
import { C_SYNTAX, CPP_SYNTAX, syntaxFor } from '../../src/core/language';
import { scan } from '../../src/core/lexer/tokenizer';

const CPP = syntaxFor('cpp');

function bracketChars(text: string, syntax = CPP): string {
  return scan(text, syntax)
    .brackets.map((b) => b.char)
    .join('');
}

describe('tokenizer raw strings', () => {
  it('skips a plain raw string', () => {
    expect(bracketChars('R"(( ) [ ])"; int x;')).toBe('');
  });

  it('skips a raw string with a custom delimiter', () => {
    expect(bracketChars('R"xy( { } )xy"; int x;')).toBe('');
  });

  it('skips u8- and L-prefixed raw strings', () => {
    expect(bracketChars('u8R"({ })"; LR"([ ])";')).toBe('');
  });

  it('spans multiple lines and keeps line tracking', () => {
    const result = scan('R"(\n{ [] }\n)"\n{\n', CPP);
    expect(result.brackets.map((b) => b.char)).toEqual(['{']);
    expect(result.brackets[0].line).toBe(3);
    expect(result.brackets[0].col).toBe(0);
  });

  it('allows quotes and brackets in the body', () => {
    expect(bracketChars('R"a("quotes" and { } )a";')).toBe('');
  });

  it('ignores directives inside a raw string', () => {
    const names = scan('R"(\n#if 0\n)"\n#endif\n', CPP).directives.map((d) => d.name);
    expect(names).toEqual(['endif']);
  });

  it('resumes ordinary scanning after the literal', () => {
    expect(bracketChars('R"(x)"; { }')).toBe('{}');
  });

  it('consumes an unterminated raw string to the end', () => {
    expect(bracketChars('R"(unterminated { }')).toBe('');
  });

  it('does not treat a bare R as a raw string', () => {
    expect(bracketChars('int R = 1; { }')).toBe('{}');
  });

  it('keeps normal strings and char literals working in C++', () => {
    expect(bracketChars('a = "}"; b = \')\';')).toBe('');
  });

  it('leaves C scanning unchanged (rawStrings off)', () => {
    // In C, `"` simply opens an ordinary string literal and swallows the body.
    expect(bracketChars('R"({ }', C_SYNTAX)).toBe('');
  });
});

describe('syntaxFor', () => {
  it('maps cpp to the raw-string profile', () => {
    expect(syntaxFor('cpp')).toEqual(CPP_SYNTAX);
    expect(syntaxFor('cpp').rawStrings).toBe(true);
  });

  it('keeps c and unknown ids on the C profile', () => {
    expect(syntaxFor('c')).toEqual(C_SYNTAX);
    expect(syntaxFor('cuda')).toEqual(C_SYNTAX);
  });
});
