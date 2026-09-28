import { describe, expect, it } from 'vitest';
import { syntaxFor } from '../../src/core/language';
import { scan } from '../../src/core/lexer/tokenizer';

const CSHARP = syntaxFor('csharp');

function bracketChars(text: string, syntax = CSHARP): string {
  return scan(text, syntax)
    .brackets.map((b) => b.char)
    .join('');
}

describe('tokenizer C# literals', () => {
  it('skips a verbatim string, treating "" as a doubled quote', () => {
    expect(bracketChars('var s = @"a ""b"" c"; }')).toBe('}');
  });

  it('skips a verbatim string with backslashes and braces', () => {
    expect(bracketChars('var p = @"C:\\dir\\{x}"; }')).toBe('}');
  });

  it('skips an interpolated string including its hole', () => {
    expect(bracketChars('var s = $"{x}"; }')).toBe('}');
  });

  it('skips an interpolated verbatim string', () => {
    expect(bracketChars('var s = $@"{x} ""y"""; }')).toBe('}');
  });

  it('skips @$-ordered interpolated verbatim strings', () => {
    expect(bracketChars('var s = @$"{(x)}"; }')).toBe('}');
  });

  it('skips a multi-line raw string with inner quotes and brackets', () => {
    expect(bracketChars('var s = """\n{ "inner" } [x]\n"""; }')).toBe('}');
  });

  it('skips an interpolated raw string with $$', () => {
    expect(bracketChars('var s = $$"""\n{x} {y}\n"""; }')).toBe('}');
  });

  it('ends the raw string at the first matching quote run', () => {
    expect(bracketChars('"""a "b" c"""; }')).toBe('}');
  });

  it('tokenizes ordinary code after the literal', () => {
    expect(bracketChars('var s = """x"""; if (a) { }')).toBe('(){}');
  });

  it('leaves C scanning unaffected (no verbatim semantics)', () => {
    const text = '@"C:\\" }';
    expect(bracketChars(text, syntaxFor('c'))).toBe('');
    expect(bracketChars(text, CSHARP)).toBe('}');
  });

  it('does not treat @class / @if verbatim identifiers as string prefixes', () => {
    const chars = scan('var @class = new[] { 1 }; if (@if) { }', CSHARP).brackets.map(
      (b) => b.char
    );
    expect(chars).toEqual(['[', ']', '{', '}', '(', ')', '{', '}']);
  });

  it('skips char literals containing brackets', () => {
    expect(bracketChars("char a = '}'; char b = '{'; char c = '\\}'; }")).toBe('}');
  });

  it('consumes an unterminated verbatim string to EOF', () => {
    expect(bracketChars('var s = @"oops { ( } ]')).toBe('');
  });

  it('consumes an unterminated raw string to EOF', () => {
    expect(bracketChars('var s = """oops { ( } ]')).toBe('');
  });

  it('lets a 4-quote raw string contain a 3-quote run', () => {
    expect(bracketChars('var s = """"a """ b""""; }')).toBe('}');
  });

  it('handles a verbatim string ending with an escaped quote', () => {
    expect(bracketChars('var s = @"a"""; }')).toBe('}');
  });

  it('treats an interpolated string with a quoted hole as opaque', () => {
    expect(bracketChars('$"{ "a } b }"')).toBe('');
  });

  it('keeps a hole containing a quoted string from leaking brackets', () => {
    const text = 'class C {\n  string s = $"{ "} { " }";\n}\n';
    expect(bracketChars(text)).toBe('{}');
    expect(scan(text, CSHARP).brackets.map((b) => b.line)).toEqual([0, 2]);
  });

  it('skips a nested interpolated string inside a hole', () => {
    expect(bracketChars('var s = $"{ $"{"} "}" }"; }')).toBe('}');
  });

  it('skips braces of a nested collection initializer inside a hole', () => {
    expect(bracketChars('var x = $"{ new[] { 1, 2 }.Length }"; }')).toBe('}');
  });

  it('honours {{ and }} literal escapes in an interpolated string', () => {
    expect(bracketChars('var s = $"a {{b}} {x} c"; }')).toBe('}');
    expect(bracketChars('var s = $"{{{x}}}" ; }')).toBe('}');
  });

  it('honours "" doubling in a verbatim interpolated string', () => {
    expect(bracketChars('var s = $@"a ""b"" {x} c"; }')).toBe('}');
  });

  it('honours escapes inside a non-verbatim interpolation hole', () => {
    expect(bracketChars('var s = $"{ "a\\"b\\\\c" }"; }')).toBe('}');
  });

  it('consumes an unterminated interpolation hole to EOF', () => {
    expect(bracketChars('var s = $"{ "a }')).toBe('');
    expect(bracketChars('var s = $"{ x')).toBe('');
  });
});
