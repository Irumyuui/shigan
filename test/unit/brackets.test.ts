import { describe, expect, it } from 'vitest';
import { scan } from '../../src/core/lexer/tokenizer';
import { matchBrackets } from '../../src/core/match/brackets';

const match = (text: string) => matchBrackets(scan(text).brackets);

describe('matchBrackets', () => {
  it('pairs nested brackets in closing order', () => {
    const result = match('{ [ ( ) ] }');
    expect(result.pairs).toHaveLength(3);
    expect(result.unmatched).toHaveLength(0);
    expect(result.pairs.map((p) => p.open.char + p.close.char)).toEqual(['()', '[]', '{}']);
  });

  it('reports unmatched closing brackets', () => {
    const result = match('}');
    expect(result.pairs).toHaveLength(0);
    expect(result.unmatched.map((t) => t.char)).toEqual(['}']);
  });

  it('reports unmatched opening brackets', () => {
    const result = match('{ (');
    expect(result.pairs).toHaveLength(0);
    expect(result.unmatched.map((t) => t.char)).toEqual(['{', '(']);
  });

  it('indexes pairs by offset', () => {
    const result = match('(a)');
    const pair = result.pairs[0];
    expect(result.byOpenOffset.get(pair.open.offset)).toBe(pair);
    expect(result.byCloseOffset.get(pair.close.offset)).toBe(pair);
  });

  it('skips tokens reported as inactive', () => {
    const result = matchBrackets(scan('{ } ( )').brackets, (t) => t.offset < 4);
    expect(result.pairs.map((p) => p.open.char + p.close.char)).toEqual(['()']);
  });
});
