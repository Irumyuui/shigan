import { describe, expect, it } from 'vitest';
import { scanRust } from '../../src/core/lexer/rust';
import { scan } from '../../src/core/lexer/tokenizer';

const chars = (text: string): string =>
  scanRust(text)
    .brackets.map((b) => b.char)
    .join('');
const cfgs = (text: string) => scanRust(text).cfgs ?? [];

describe('rust lifetimes vs chars', () => {
  it('scans lifetimes without treating them as char literals', () => {
    expect(chars("fn f<'a, 'b>(x: &'a T, y: &'b U) -> &'a str { x }")).toBe('(){}');
  });

  it('scans a static lifetime', () => {
    expect(chars("fn g() -> &'static str { \"s\" }")).toBe('(){}');
  });

  it('scans a labelled loop and its break label', () => {
    const b = scanRust("'outer: loop { break 'outer; }").brackets;
    expect(b.map((x) => x.char).join('')).toBe('{}');
    expect(b).toEqual([
      { char: '{', offset: 13, line: 0, col: 13 },
      { char: '}', offset: 29, line: 0, col: 29 },
    ]);
  });

  it('scans a label on a for loop and its continue target', () => {
    const b = scanRust("'outer: for x in xs { continue 'outer; }").brackets;
    expect(b.map((x) => x.char).join('')).toBe('{}');
    expect(b[0]).toMatchObject({ offset: 20, line: 0, col: 20 });
  });

  it('scans labels on a while and a while let', () => {
    expect(chars("'o: while cond { break 'o; }")).toBe('{}');
    expect(chars("'o: while let Some(x) = y { break 'o; }")).toBe('(){}');
  });

  it('keeps a label and a following char literal apart', () => {
    const b = scanRust("'a: loop { break 'a; } let c = 'a';").brackets;
    expect(b.map((x) => x.char).join('')).toBe('{}');
    expect(b).toEqual([
      { char: '{', offset: 9, line: 0, col: 9 },
      { char: '}', offset: 21, line: 0, col: 21 },
    ]);
  });

  it('skips braced unicode escape char literals', () => {
    expect(chars("'\\u{1F600}'")).toBe('');
    expect(chars("'\\u{7F}'")).toBe('');
  });

  it('scans a raw lifetime', () => {
    expect(chars("'r#lt")).toBe('');
  });

  it('tells a label from a char literal at the same position', () => {
    const label = scanRust("'a: loop {}").brackets;
    expect(label.map((x) => x.char).join('')).toBe('{}');
    expect(label[0].col).toBe(9);
    expect(scanRust("'a'").brackets).toEqual([]);
  });

  it('distinguishes an underscore char from an underscore lifetime', () => {
    expect(chars("'_'")).toBe('');
    expect(chars("'_x")).toBe('');
  });

  it('skips char literals made of brackets, commas and digits', () => {
    expect(chars("'{' '}' ',' '0'..='9'")).toBe('');
  });

  it('skips escaped char literals', () => {
    expect(chars("'\\n' '\\''")).toBe('');
  });

  it('skips byte char literals', () => {
    expect(chars("b'}'")).toBe('');
  });
});

describe('rust strings', () => {
  it('skips raw strings with and without hashes', () => {
    expect(chars('let s = r"( ) { }";')).toBe('');
    expect(chars('let s = r#"a ] b"#;')).toBe('');
  });

  it('does not let a shorter hash run close a raw string', () => {
    expect(chars('let s = r##"a "# b"##;')).toBe('');
  });

  it('skips br/cr raw and byte/C strings', () => {
    expect(chars('let s = br#"a { } b"#;')).toBe('');
    expect(chars('let s = cr#"a } b"#;')).toBe('');
    expect(chars('let s = c"( )";')).toBe('');
    expect(chars('let s = b"a [ b";')).toBe('');
  });

  it('consumes an unterminated raw string to EOF', () => {
    expect(chars('let s = r#"a { b')).toBe('');
  });

  it('treats r#ident as a raw identifier but r#" as a raw string', () => {
    expect(chars('let r#match = r#type::Value; r#fn(); let x = r#"raw"#;')).toBe('()');
  });
});

describe('rust comments', () => {
  it('nests block comments', () => {
    expect(chars('/* a { /* b } */ c */ { }')).toBe('{}');
  });

  it('treats doc comments as opaque', () => {
    expect(chars('/// { }\nlet a = 1;')).toBe('');
    expect(chars('//! { }\nlet a = 1;')).toBe('');
    expect(chars('/** { } */ let a = 1;')).toBe('');
    expect(chars('/*! { } */ let a = 1;')).toBe('');
  });

  it('does not follow a backslash line splice out of a line comment', () => {
    expect(chars('// comment \\\nlet a = 1;')).toBe('');
  });
});

describe('rust attributes', () => {
  it('treats non-cfg attributes as opaque', () => {
    const text = '#[derive(Clone, Debug)] fn a() {}';
    expect(chars(text)).toBe('(){}');
    expect(cfgs(text)).toEqual([]);
  });

  it('records a cfg attribute and keeps the fn braces', () => {
    const text = '#[cfg(all(unix, feature = "a"))] fn b() {}';
    expect(chars(text)).toBe('(){}');
    const list = cfgs(text);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      name: 'cfg',
      inner: false,
      display: '#[cfg(all(unix, feature = "a"))]',
      line: 0,
      endLine: 0,
      offset: 0,
      col: 0,
    });
  });

  it('normalizes a multi-line cfg attribute', () => {
    const text = '#[cfg(\n    all(unix)\n)] fn c() {}';
    expect(chars(text)).toBe('(){}');
    const list = cfgs(text);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      name: 'cfg',
      inner: false,
      display: '#[cfg( all(unix) )]',
      line: 0,
      endLine: 2,
    });
  });

  it('treats #![…] as an opaque inner attribute', () => {
    expect(chars('#![allow(dead_code)]')).toBe('');
    expect(cfgs('#![allow(dead_code)]')).toEqual([]);
  });

  it('records an inner cfg attribute', () => {
    const list = cfgs('#![cfg(unix)]');
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: 'cfg', inner: true, display: '#![cfg(unix)]' });
  });

  it('records cfg_attr', () => {
    const list = cfgs('#[cfg_attr(feature = "x", derive(Debug))]');
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('cfg_attr');
  });
});

describe('rust control flow', () => {
  it('scans a bare loop', () => {
    expect(chars('loop { }')).toBe('{}');
  });

  it('scans a while loop', () => {
    expect(chars('while cond { }')).toBe('{}');
  });

  it('scans a while let binding', () => {
    expect(chars('while let Some(x) = y { }')).toBe('(){}');
  });

  it('scans a for over an iterator', () => {
    expect(chars('for x in xs { }')).toBe('{}');
  });

  it('scans a for over an exclusive and an inclusive range', () => {
    expect(chars('for i in 0..10 { }')).toBe('{}');
    expect(chars('for i in 0..=10 { }')).toBe('{}');
  });

  it('scans nested for, while and loop braces', () => {
    const b = scanRust('for i in xs { while c { loop { } } }').brackets;
    expect(b.map((x) => x.char).join('')).toBe('{{{}}}');
    expect(b.map((x) => [x.line, x.col])).toEqual([
      [0, 12],
      [0, 22],
      [0, 29],
      [0, 31],
      [0, 33],
      [0, 35],
    ]);
  });

  it('scans if let with an else block', () => {
    expect(chars('if let Some(x) = y { } else { }')).toBe('(){}{}');
  });

  it('scans a match with block arms', () => {
    expect(chars('match x { _ => { } }')).toBe('{{}}');
  });

  it('records no cfgs for pure control flow', () => {
    expect(cfgs('loop { }')).toEqual([]);
    expect(cfgs('if let Some(x) = y { } else { }')).toEqual([]);
  });
});

describe('rust impl and definition blocks', () => {
  it('scans an impl body and its method braces', () => {
    const b = scanRust('impl Foo { fn a(&self) { } fn b() -> u8 { 0 } }').brackets;
    expect(b.map((x) => x.char).join('')).toBe('{(){}(){}}');
    expect(b).toEqual([
      { char: '{', offset: 9, line: 0, col: 9 },
      { char: '(', offset: 15, line: 0, col: 15 },
      { char: ')', offset: 21, line: 0, col: 21 },
      { char: '{', offset: 23, line: 0, col: 23 },
      { char: '}', offset: 25, line: 0, col: 25 },
      { char: '(', offset: 31, line: 0, col: 31 },
      { char: ')', offset: 32, line: 0, col: 32 },
      { char: '{', offset: 40, line: 0, col: 40 },
      { char: '}', offset: 44, line: 0, col: 44 },
      { char: '}', offset: 46, line: 0, col: 46 },
    ]);
  });

  it('scans a generic impl with a where clause across lines', () => {
    const b = scanRust('impl<T: Trait> Foo<T>\nwhere T: Debug {\n    fn x(&self) { }\n}').brackets;
    expect(b.map((x) => x.char).join('')).toBe('{(){}}');
    expect(b.map((x) => [x.char, x.line, x.col])).toEqual([
      ['{', 1, 15],
      ['(', 2, 8],
      [')', 2, 14],
      ['{', 2, 16],
      ['}', 2, 18],
      ['}', 3, 0],
    ]);
  });

  it('scans a trait impl head', () => {
    const b = scanRust('impl Trait for Foo { fn f(&self) {} }').brackets;
    expect(b.map((x) => x.char).join('')).toBe('{(){}}');
    expect(b[0]).toMatchObject({ offset: 19, line: 0, col: 19 });
  });

  it('scans a lifetime in an impl head', () => {
    expect(chars("impl<'a> Foo<'a> { fn f(&'a self) {} }")).toBe('{(){}}');
  });

  it('scans nested control flow inside a method body', () => {
    const b = scanRust('impl Foo { fn f(&self) { if x { } for i in 0..1 { } while y { } } }').brackets;
    expect(b.map((x) => x.char).join('')).toBe('{(){{}{}{}}}');
    expect(b.map((x) => [x.char, x.col])).toEqual([
      ['{', 9],
      ['(', 15],
      [')', 21],
      ['{', 23],
      ['{', 30],
      ['}', 32],
      ['{', 48],
      ['}', 50],
      ['{', 60],
      ['}', 62],
      ['}', 64],
      ['}', 66],
    ]);
  });

  it('scans struct, enum, trait and mod blocks', () => {
    expect(chars('struct S { a: u8 }')).toBe('{}');
    expect(chars('enum E { A, B }')).toBe('{}');
    expect(chars('trait T { fn f(&self); }')).toBe('{()}');
    expect(chars('mod m { }')).toBe('{}');
  });

  it('scans an impl block containing a labeled loop', () => {
    const b = scanRust(
      "impl Foo {\n    fn run(&self) {\n        'outer: for x in xs {\n            continue 'outer;\n        }\n    }\n}"
    ).brackets;
    expect(b.map((x) => x.char).join('')).toBe('{(){{}}}');
    expect(b.map((x) => [x.char, x.line, x.col])).toEqual([
      ['{', 0, 9],
      ['(', 1, 10],
      [')', 1, 16],
      ['{', 1, 18],
      ['{', 2, 28],
      ['}', 4, 8],
      ['}', 5, 4],
      ['}', 6, 0],
    ]);
  });

  it('records no cfgs for impl or definition blocks', () => {
    expect(cfgs('impl Foo { fn f(&self) {} }')).toEqual([]);
    expect(cfgs('impl<T: Trait> Foo<T> where T: Debug { fn x(&self) {} }')).toEqual([]);
    expect(cfgs('trait T { fn f(&self); }')).toEqual([]);
    expect(cfgs('mod m { }')).toEqual([]);
  });
});

describe('rust shebang, shape and the C scanner', () => {
  it('skips a shebang line', () => {
    expect(chars('#!/usr/bin/env rust\nfn main() {}\n')).toBe('(){}');
    expect(cfgs('#!/usr/bin/env rust\nfn main() {}\n')).toEqual([]);
  });

  it('returns empty directives and a cfgs array', () => {
    const result = scanRust('fn main() {}');
    expect(result.directives).toEqual([]);
    expect(result.cfgs).toEqual([]);
  });

  it('tracks line and column', () => {
    expect(scanRust('a\n  {\n}\n').brackets).toEqual([
      { char: '{', offset: 4, line: 1, col: 2 },
      { char: '}', offset: 6, line: 2, col: 0 },
    ]);
  });

  it('leaves the C scanner untouched', () => {
    const result = scan('int main(void) {\n}\n');
    expect(result.brackets.map((b) => b.char).join('')).toBe('(){}');
    expect(result.cfgs).toBeUndefined();
  });
});
