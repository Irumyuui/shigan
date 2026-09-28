import { describe, expect, it } from 'vitest';
import { computeHints, labelFor } from '../../src/core/hints';
import { BracketToken } from '../../src/core/types';

function brace(line: number, col = 0): BracketToken {
  return { char: '{', offset: 0, line, col };
}

describe('labelFor (continuation-aware fallback)', () => {
  it('finds the declaration under a wrapped base list', () => {
    const lines = ['    class Foo', '        : Base,', '          IOther', '    {'];
    expect(labelFor(lines, brace(3, 4))).toBe('class Foo');
  });

  it('finds the declaration under a where clause', () => {
    const lines = ['    class Foo<T>', '        where T : class', '    {'];
    expect(labelFor(lines, brace(2, 4))).toBe('class Foo<T>');
  });

  it('does not walk into a lambda body', () => {
    const lines = ['Action a = () =>', '{'];
    expect(labelFor(lines, brace(1))).toBe('Action a = () =>');
  });

  it('does not walk into a collection initializer', () => {
    const lines = ['int[] x =', '{'];
    expect(labelFor(lines, brace(1))).toBe('int[] x =');
  });

  it('keeps the C multi-line parameter fallback', () => {
    const lines = ['int foo(', 'int a,', 'int b)', '{'];
    expect(labelFor(lines, brace(3))).toBe('int b)');
  });

  it('keeps the previous-line fallback for a plain signature', () => {
    const lines = ['void f()', '{'];
    expect(labelFor(lines, brace(1))).toBe('void f()');
  });

  it('does not look back when the brace shares the line', () => {
    const lines = ['class Foo {'];
    expect(labelFor(lines, brace(0, 10))).toBe('class Foo');
  });

  it('returns nothing for a lone brace on the first line', () => {
    expect(labelFor(['{'], brace(0))).toBe('');
  });
});

describe('labelFor end to end', () => {
  it('labels a wrapped class declaration in the rendered hint', () => {
    const text = 'class Foo\n    : Base\n{\n}\n';
    const hints = computeHints(text, { brackets: true, trigger: 'always' });
    expect(hints).toHaveLength(1);
    expect(hints[0].text).toBe(' <- :3-4 class Foo');
  });
});
