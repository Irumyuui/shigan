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
    expect(chars("'outer: loop { break 'outer; }")).toBe('{}');
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
