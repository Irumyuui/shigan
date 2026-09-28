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

  it('consumes an unterminated non-verbatim hole to EOF when there is no newline', () => {
    // No unescaped newline to stop at, so the literal runs to EOF.
    expect(bracketChars('var s = $"{ "a }')).toBe('');
    expect(bracketChars('var s = $"{ x')).toBe('');
  });

  it('stops an unterminated non-verbatim hole at the newline, keeping later brackets', () => {
    // The hole is unterminated, but a non-verbatim literal cannot span lines,
    // so the damage stays on its own line: the function pair below survives.
    const text = 'var s = $"{ x\nvoid f() {\n    g();\n}\n';
    expect(bracketChars(text)).toBe('(){()}');
    expect(scan(text, CSHARP).brackets.map((b) => b.line)).toEqual([1, 1, 1, 2, 2, 3]);
  });

  it('does not let an escaped newline end an unterminated non-verbatim hole', () => {
    // `\`+newline is a splice, so the continued hole is still opaque; only the
    // following unescaped newline ends the literal. `(y)` must not leak.
    const text = 'var s = $"{ x \\\n (y)\nif (a) { }';
    expect(bracketChars(text)).toBe('(){}');
  });

  it('consumes through the closing quote when a line comment swallows the hole line', () => {
    // The `// }` comment hides the hole's `}`, but the literal still closes on
    // the continuation line. The hole scanner must reach that quote (rather
    // than treating the newline as the end) so `+ y }";` leaves no `}` leak
    // and the true closing brace on line 5 keeps its pair.
    const text = 'class C {\n  void M() {\n    var s = $"{ x // }\n   + y }";\n  }\n}\n';
    expect(bracketChars(text)).toBe('{(){}}');
    expect(scan(text, CSHARP).brackets.map((b) => b.line)).toEqual([0, 1, 1, 1, 4, 5]);
  });

  it('stops an unterminated block comment in a non-verbatim hole at the line end', () => {
    // An unterminated `/*` used to make the hole consume the whole document;
    // it must stay line-scoped so the function below keeps its pair.
    const text = 'var s = $"{ x /* oops\nvoid f() {\n    g();\n}\n';
    expect(bracketChars(text)).toBe('(){()}');
    expect(scan(text, CSHARP).brackets.map((b) => b.line)).toEqual([1, 1, 1, 2, 2, 3]);
  });

  it('keeps a terminated block comment inside a non-verbatim hole opaque', () => {
    // A closed `/* ... */` is still skipped in full, braces and all.
    expect(bracketChars('var s = $"{ /* } { */ x }"; }')).toBe('}');
  });

  it('consumes an unterminated hole in a verbatim interpolated literal to EOF', () => {
    // A verbatim interpolated literal may span lines, so it stays conservative
    // and swallows the rest of the document rather than guessing.
    expect(bracketChars('var s = $@"{ x\nvoid f() {\n    g();\n}\n')).toBe('');
    expect(bracketChars('var s = @$"{ x\n{\n')).toBe('');
  });
});
