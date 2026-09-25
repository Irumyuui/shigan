import { describe, expect, it } from 'vitest';
import { scan } from '../../src/core/lexer/tokenizer';
import { pairConditionals } from '../../src/core/match/preprocess';

const pair = (text: string) => pairConditionals(scan(text).directives);

describe('pairConditionals', () => {
  it('pairs if/else/endif', () => {
    const result = pair('#if X\n#else\n#endif\n');
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].branches.map((d) => d.name)).toEqual(['if', 'else']);
    expect(result.blocks[0].endif?.name).toBe('endif');
    expect(result.blocks[0].closed).toBe(true);
  });

  it('supports elifdef / elifndef chains', () => {
    const result = pair('#ifdef A\n#elifdef B\n#elifndef C\n#else\n#endif\n');
    expect(result.blocks[0].branches.map((d) => d.name)).toEqual([
      'ifdef',
      'elifdef',
      'elifndef',
      'else',
    ]);
  });

  it('handles nested blocks', () => {
    const result = pair('#if A\n#if B\n#endif\n#endif\n');
    expect(result.blocks).toHaveLength(2);
    expect(result.blocks.every((b) => b.closed)).toBe(true);
  });

  it('reports unclosed blocks', () => {
    const result = pair('#if A\n');
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].closed).toBe(false);
  });

  it('ignores stray branch / endif directives', () => {
    expect(pair('#else\n#endif\n').blocks).toHaveLength(0);
  });

  it('indexes directive lines to their block', () => {
    const result = pair('#if X\n#else\n#endif\n');
    expect(result.byLine.get(0)?.opener.line).toBe(0);
    expect(result.byLine.get(1)?.opener.line).toBe(0);
    expect(result.byLine.get(2)?.opener.line).toBe(0);
  });
});
