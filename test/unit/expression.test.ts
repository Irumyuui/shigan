import { describe, expect, it } from 'vitest';
import { evaluateExpression } from '../../src/core/match/expression';
import { MacroDef } from '../../src/core/types';

function macros(entries: Record<string, string | MacroDef>): Map<string, MacroDef> {
  const map = new Map<string, MacroDef>();
  for (const [name, value] of Object.entries(entries)) {
    map.set(name, typeof value === 'string' ? { value, functionLike: false } : value);
  }
  return map;
}

describe('evaluateExpression', () => {
  it('evaluates arithmetic, comparison and shift operators', () => {
    expect(evaluateExpression('1 + 2 * 3', macros({}))).toBe(7);
    expect(evaluateExpression('(1 + 2) * 3', macros({}))).toBe(9);
    expect(evaluateExpression('10 % 3 == 1', macros({}))).toBe(1);
    expect(evaluateExpression('1 << 4', macros({}))).toBe(16);
    expect(evaluateExpression('1 < 2 && 2 <= 2', macros({}))).toBe(1);
  });

  it('treats undefined identifiers as 0', () => {
    expect(evaluateExpression('FOO', macros({}))).toBe(0);
    expect(evaluateExpression('!FOO', macros({}))).toBe(1);
  });

  it('uses macro values', () => {
    expect(evaluateExpression('FOO + 1', macros({ FOO: '41' }))).toBe(42);
    expect(evaluateExpression('LEVEL > 1', macros({ LEVEL: '2' }))).toBe(1);
  });

  it('expands nested object-like macros', () => {
    expect(evaluateExpression('A', macros({ A: 'B + 1', B: '2' }))).toBe(3);
  });

  it('supports defined()', () => {
    expect(evaluateExpression('defined(FOO)', macros({ FOO: '1' }))).toBe(1);
    expect(evaluateExpression('defined FOO', macros({}))).toBe(0);
    expect(evaluateExpression('defined(FOO) && defined(BAR)', macros({ FOO: '1', BAR: '1' }))).toBe(1);
  });

  it('supports the ternary operator', () => {
    expect(evaluateExpression('FOO ? 10 : 20', macros({ FOO: '1' }))).toBe(10);
    expect(evaluateExpression('FOO ? 10 : 20', macros({ FOO: '0' }))).toBe(20);
  });

  it('returns undefined for function-like macros', () => {
    expect(
      evaluateExpression('MAX(1,2)', macros({ MAX: { value: '((a)>(b)?(a):(b))', functionLike: true } }))
    ).toBeUndefined();
  });

  it('returns undefined on division by zero and leftover tokens', () => {
    expect(evaluateExpression('1 / 0', macros({}))).toBeUndefined();
    expect(evaluateExpression('1 2', macros({}))).toBeUndefined();
  });

  it('parses hex, octal and suffixed literals', () => {
    expect(evaluateExpression('0x10', macros({}))).toBe(16);
    expect(evaluateExpression('010', macros({}))).toBe(8);
    expect(evaluateExpression('42L', macros({}))).toBe(42);
  });

  it('evaluates character literals', () => {
    expect(evaluateExpression("'A'", macros({}))).toBe(65);
    expect(evaluateExpression("'\\n'", macros({}))).toBe(10);
  });

  it('resolves every C escape sequence to its C value', () => {
    const cases: Array<[string, number]> = [
      ['\\a', 7],
      ['\\b', 8],
      ['\\f', 12],
      ['\\n', 10],
      ['\\r', 13],
      ['\\t', 9],
      ['\\v', 11],
      ['\\0', 0],
      ['\\\\', 92],
      ["\\'", 39],
      ['\\"', 34],
      ['\\?', 63],
      ['\\123', 0o123],
      ['\\x41', 0x41],
    ];
    for (const [escape, value] of cases) {
      expect(evaluateExpression(`'${escape}'`, macros({}))).toBe(value);
    }
  });

  it('decides an #if-style escape comparison correctly', () => {
    expect(evaluateExpression("'\\a' == 7", macros({}))).toBe(1);
    expect(evaluateExpression("'\\v' == 11", macros({}))).toBe(1);
    expect(evaluateExpression("'\\x41' == 'A'", macros({}))).toBe(1);
  });

  it('falls back to unknown for malformed character escapes', () => {
    expect(evaluateExpression("'\\x'", macros({}))).toBeUndefined();
    expect(evaluateExpression("'\\q'", macros({}))).toBeUndefined();
    expect(evaluateExpression("'\\'", macros({}))).toBeUndefined();
    expect(evaluateExpression("'A", macros({}))).toBeUndefined();
    expect(evaluateExpression("'AB'", macros({}))).toBeUndefined();
  });

  it('treats comments inside an expression as whitespace', () => {
    expect(evaluateExpression('0 // reason', macros({}))).toBe(0);
    expect(evaluateExpression('// leading\n1', macros({}))).toBe(1);
    expect(evaluateExpression('/* c */ 1', macros({}))).toBe(1);
    expect(evaluateExpression('1 /* between */ + 2', macros({}))).toBe(3);
  });

  it('stays conservative when a block comment is unterminated', () => {
    expect(evaluateExpression('1 /* unterminated', macros({}))).toBeUndefined();
  });
});
