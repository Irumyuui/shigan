import { describe, expect, it } from 'vitest';
import { scanRust } from '../../src/core/lexer/rust';
import { pairCfgItems } from '../../src/core/match/rust/items';

const spansFor = (text: string) => pairCfgItems(scanRust(text), text.split('\n'));

describe('pairCfgItems (spans)', () => {
  it('pairs a cfg with a multi-line fn', () => {
    expect(spansFor('#[cfg(unix)]\nfn a() {\n}\n')).toEqual([
      { attrLine: 0, attrLines: [0], displays: ['#[cfg(unix)]'], endLine: 2 },
    ]);
  });

  it('pairs a cfg with a multi-line enum', () => {
    expect(spansFor('#[cfg(unix)]\nenum E {\n    A,\n    B,\n}\n')).toEqual([
      { attrLine: 0, attrLines: [0], displays: ['#[cfg(unix)]'], endLine: 4 },
    ]);
  });

  it('pairs a cfg with an impl body', () => {
    expect(spansFor('#[cfg(unix)]\nimpl S {\n    fn f(&self) {}\n}\n')).toEqual([
      { attrLine: 0, attrLines: [0], displays: ['#[cfg(unix)]'], endLine: 3 },
    ]);
  });

  it('finds an outer and a nested mod cfg as two spans', () => {
    expect(spansFor('#[cfg(a)]\nmod m {\n    #[cfg(b)]\n    fn f() {}\n}\n')).toEqual([
      { attrLine: 0, attrLines: [0], displays: ['#[cfg(a)]'], endLine: 4 },
      { attrLine: 2, attrLines: [2], displays: ['#[cfg(b)]'], endLine: 3 },
    ]);
  });

  it('pairs an impl member cfg nested in a mod body', () => {
    expect(spansFor('mod m {\n    impl S {\n        #[cfg(unix)]\n        fn f(&self) {}\n    }\n}\n')).toEqual([
      { attrLine: 2, attrLines: [2], displays: ['#[cfg(unix)]'], endLine: 3 },
    ]);
  });

  it('normalizes a multi-line attribute and spans the item', () => {
    expect(spansFor('#[cfg(\n    all(unix)\n)]\nfn f() {}\n')).toEqual([
      { attrLine: 0, attrLines: [0], displays: ['#[cfg( all(unix) )]'], endLine: 3 },
    ]);
  });

  it('ends a const-block item at the initializer brace', () => {
    expect(spansFor('#[cfg(unix)]\nconst X: i32 = { 1 };\n')).toEqual([
      { attrLine: 0, attrLines: [0], displays: ['#[cfg(unix)]'], endLine: 1 },
    ]);
  });
});

describe('pairCfgItems (no span)', () => {
  it('ignores semicolon-terminated items', () => {
    expect(spansFor('#[cfg(x)]\nstruct S;\n')).toEqual([]);
    expect(spansFor('#[cfg(x)]\nstruct S(i32);\n')).toEqual([]);
    expect(spansFor('#[cfg(x)]\nmod m;\n')).toEqual([]);
    expect(spansFor('#[cfg(x)]\nuse std::io;\n')).toEqual([]);
    expect(spansFor('#[cfg(x)]\ntype T = u8;\n')).toEqual([]);
    expect(spansFor('#[cfg(x)]\nstatic X: u8 = 1;\n')).toEqual([]);
  });

  it('lets the semicolon guard stop before a following item', () => {
    expect(spansFor('#[cfg(x)]\nuse a::b;\nfn f() {}\n')).toEqual([]);
  });

  it('ignores inner attributes and cfg_attr', () => {
    expect(spansFor('#![cfg(x)]\nfn f() {}\n')).toEqual([]);
    expect(spansFor('#[cfg_attr(unix, path = "a.rs")]\nfn f() {}\n')).toEqual([]);
  });

  it('ignores an inline (non-leading) attribute', () => {
    expect(spansFor('fn g(#[cfg(unix)] a: u32) {}\n')).toEqual([]);
  });

  it('ignores a cfg inside a macro_rules body', () => {
    expect(spansFor('macro_rules! m {\n    #[cfg(unix)]\n    fn f() {}\n}\n')).toEqual([]);
  });

  it('ignores a cfg inside a macro_rules arm body', () => {
    expect(
      spansFor('macro_rules! m {\n    () => {\n        #[cfg(x)]\n        fn f() {}\n    }\n}\n')
    ).toEqual([]);
  });

  it('does not leak the macro guard past a closed macro body', () => {
    const text = 'macro_rules! m {\n    () => {}\n}\n\n#[cfg(unix)]\nfn f() {}\n';
    expect(spansFor(text)).toEqual([
      { attrLine: 4, attrLines: [4], displays: ['#[cfg(unix)]'], endLine: 5 },
    ]);
  });

  it('ignores a cfg on a match arm', () => {
    expect(spansFor('fn m(x: u8) {\n    match x {\n        #[cfg(unix)]\n        1 => {}\n    }\n}\n')).toEqual([]);
  });

  it('ignores a cfg on a struct field', () => {
    expect(spansFor('struct S {\n    #[cfg(unix)]\n    x: u32,\n}\n')).toEqual([]);
  });

  it('ignores a cfg on a statement', () => {
    expect(spansFor('fn f() {\n    #[cfg(unix)]\n    let y = 1;\n}\n')).toEqual([]);
  });

  it('ignores a trailing attribute with no item', () => {
    expect(spansFor('#[cfg(unix)]\n')).toEqual([]);
  });

  it('ignores a body longer than the 300-line window', () => {
    const text = '#[cfg(unix)]\nfn f() {\n' + 'let x = 0;\n'.repeat(350) + '}\n';
    expect(spansFor(text)).toEqual([]);
  });

  it('ignores an unterminated item at EOF', () => {
    expect(spansFor('#[cfg(unix)]\nfn f() {\n')).toEqual([]);
  });
});

describe('pairCfgItems (attribute-line tails)', () => {
  it('pairs the item after a non-cfg attribute on the next line', () => {
    expect(spansFor('#[cfg(feature = "nope")]\n#[test] fn t() {}\n')).toEqual([
      { attrLine: 0, attrLines: [0], displays: ['#[cfg(feature = "nope")]'], endLine: 1 },
    ]);
  });

  it('pairs a struct behind a derive attribute on the next line', () => {
    expect(
      spansFor('#[cfg(feature = "nope")]\n#[derive(Clone)] struct S {\n    a: u32,\n}\n')
    ).toEqual([
      { attrLine: 0, attrLines: [0], displays: ['#[cfg(feature = "nope")]'], endLine: 3 },
    ]);
  });

  it('does not attach a cfg to an ungated item after a self-contained one', () => {
    expect(spansFor('#[cfg(feature = "nope")]\n#[test] fn t() {}\nfn g() {\n}\n')).toEqual([
      { attrLine: 0, attrLines: [0], displays: ['#[cfg(feature = "nope")]'], endLine: 1 },
    ]);
  });

  it('merges same-line attributes separated by a non-cfg attribute', () => {
    expect(
      spansFor('#[cfg(unix)] #[allow(dead_code)] #[cfg(feature = "a")] fn f() {}\n')
    ).toEqual([
      {
        attrLine: 0,
        attrLines: [0, 0],
        displays: ['#[cfg(unix)]', '#[cfg(feature = "a")]'],
        endLine: 0,
      },
    ]);
  });

  it('treats a non-comment `*` line as an item head, not a comment', () => {
    expect(spansFor('#[cfg(unix)]\n*p += 1;\nfn g() {\n}\n')).toEqual([]);
  });

  it('skips a doc comment between the attribute and the item', () => {
    expect(spansFor('#[cfg(unix)]\n/// docs\nfn f() {}\n')).toEqual([
      { attrLine: 0, attrLines: [0], displays: ['#[cfg(unix)]'], endLine: 2 },
    ]);
  });
});

describe('pairCfgItems (bracket-depth semicolons)', () => {
  it('pairs an item with a semicolon inside an array type', () => {
    expect(spansFor('#[cfg(unix)] fn f(a: [u8; 4]) {\n}\n')).toEqual([
      { attrLine: 0, attrLines: [0], displays: ['#[cfg(unix)]'], endLine: 1 },
    ]);
  });

  it('pairs a generic item with a semicolon inside a const parameter', () => {
    expect(spansFor('#[cfg(unix)]\nfn f<const N: usize>(a: [u8; N]) {\n}\n')).toEqual([
      { attrLine: 0, attrLines: [0], displays: ['#[cfg(unix)]'], endLine: 2 },
    ]);
  });

  it('still rejects a top-level semicolon before the next item', () => {
    expect(spansFor('#[cfg(x)]\nconst N: usize = 4;\nfn f() {}\n')).toEqual([]);
  });
});

describe('pairCfgItems (merged attributes)', () => {
  it('merges consecutive cfg attributes into one span', () => {
    expect(spansFor('#[cfg(a)]\n#[cfg(b)]\nfn f() {}\n')).toEqual([
      {
        attrLine: 0,
        attrLines: [0, 1],
        displays: ['#[cfg(a)]', '#[cfg(b)]'],
        endLine: 2,
      },
    ]);
  });

  it('merges cfg attributes with another attribute in between', () => {
    expect(spansFor('#[cfg(a)]\n#[allow(dead_code)]\n#[cfg(b)]\nfn f() {}\n')).toEqual([
      {
        attrLine: 0,
        attrLines: [0, 2],
        displays: ['#[cfg(a)]', '#[cfg(b)]'],
        endLine: 3,
      },
    ]);
  });
});

describe('pairCfgItems (same-line items)', () => {
  it('spans an item on the attribute line', () => {
    expect(spansFor('#[cfg(unix)] fn f() {}\n')).toEqual([
      { attrLine: 0, attrLines: [0], displays: ['#[cfg(unix)]'], endLine: 0 },
    ]);
  });

  it('spans a same-line mod item', () => {
    expect(spansFor('#[cfg(test)] mod tests {}\n')).toEqual([
      { attrLine: 0, attrLines: [0], displays: ['#[cfg(test)]'], endLine: 0 },
    ]);
  });

  it('merges attributes that share the attribute line', () => {
    expect(spansFor('#[cfg(unix)] #[cfg(feature = "a")] fn f() {}\n')).toEqual([
      {
        attrLine: 0,
        attrLines: [0, 0],
        displays: ['#[cfg(unix)]', '#[cfg(feature = "a")]'],
        endLine: 0,
      },
    ]);
  });

  it('keeps the semicolon guard for same-line items', () => {
    expect(spansFor('#[cfg(unix)] struct S;\n')).toEqual([]);
    expect(spansFor('#[cfg(unix)] use a::b; fn g() {}\n')).toEqual([]);
  });
});

describe('pairCfgItems (block comments before the item)', () => {
  it('skips a multi-line block comment between the attribute and the item', () => {
    expect(spansFor('#[cfg(unix)]\n/*\n * c\n */\nfn f() {}\n')).toEqual([
      { attrLine: 0, attrLines: [0], displays: ['#[cfg(unix)]'], endLine: 4 },
    ]);
  });

  it('skips an empty-looking multi-line block comment', () => {
    expect(spansFor('#[cfg(unix)]\n/*\n*/\nfn f() {}\n')).toEqual([
      { attrLine: 0, attrLines: [0], displays: ['#[cfg(unix)]'], endLine: 3 },
    ]);
  });

  it('skips a same-line block comment before the item', () => {
    expect(spansFor('#[cfg(unix)] /* c */ fn f() {\n}\n')).toEqual([
      { attrLine: 0, attrLines: [0], displays: ['#[cfg(unix)]'], endLine: 1 },
    ]);
  });

  it('still treats a non-comment `*` line as an item head, not a comment', () => {
    expect(spansFor('#[cfg(unix)]\n*p += 1;\nfn g() {\n}\n')).toEqual([]);
  });
});

describe('pairCfgItems (brackets inside an attribute comment)', () => {
  it('does not close a cfg attribute on a bracket inside a block comment', () => {
    expect(spansFor('#[cfg(/* [ */ unix)]\nfn f() {}\n')).toEqual([
      { attrLine: 0, attrLines: [0], displays: ['#[cfg(/* [ */ unix)]'], endLine: 1 },
    ]);
  });
});

describe('pairCfgItems (brace expressions in generic arguments)', () => {
  it('does not treat a brace inside a generic argument as a type-alias body', () => {
    expect(spansFor('#[cfg(unix)]\ntype T = Bar<{ N }>;\nfn g() {\n}\n')).toEqual([]);
  });

  it('does not treat a brace inside a generic argument as a static body', () => {
    expect(spansFor('#[cfg(unix)]\nstatic S: Bar<{ N }> = X;\nfn g() {\n}\n')).toEqual([]);
    expect(spansFor('#[cfg(unix)]\nstatic S: Bar<{N}> = 0;\n')).toEqual([]);
  });

  it('still pairs a body after a balanced generic parameter list', () => {
    expect(spansFor('#[cfg(unix)]\nfn f<T: Bar<u8>>(a: T) {\n}\n')).toEqual([
      { attrLine: 0, attrLines: [0], displays: ['#[cfg(unix)]'], endLine: 2 },
    ]);
  });
});
