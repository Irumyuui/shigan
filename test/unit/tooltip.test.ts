import { describe, expect, it } from 'vitest';
import { buildJumpTooltip, previewLines } from '../../src/render/tooltip';

const CHAIN = ['#if X', '', '#else', '', '#endif'];

describe('buildJumpTooltip', () => {
  it('shows a title, the line number and a code preview', () => {
    expect(buildJumpTooltip('#else', 2, CHAIN)).toBe(
      ['`#else` — line 3', '', '```c', '#else', '', '#endif', '```'].join('\n')
    );
  });

  it('falls back to a generic title', () => {
    expect(buildJumpTooltip(undefined, 0, CHAIN).startsWith('jump target — line 1')).toBe(true);
  });

  it('escapes backticks in the title', () => {
    expect(buildJumpTooltip('a`b', 0, CHAIN).startsWith("`a'b` — line 1")).toBe(true);
  });

  it('clips the preview at the end of the document', () => {
    expect(buildJumpTooltip('#endif', 4, CHAIN)).toBe(
      ['`#endif` — line 5', '', '```c', '#endif', '```'].join('\n')
    );
  });

  it('handles an empty document', () => {
    expect(buildJumpTooltip('#if X', 0, [])).toBe('`#if X` — line 1');
  });

  it('accepts localized labels', () => {
    expect(
      buildJumpTooltip('#else', 2, CHAIN, {
        fallbackTitle: '跳转目标',
        lineSuffix: (line) => `— 第 ${line} 行`,
      })
    ).toBe(['`#else` — 第 3 行', '', '```c', '#else', '', '#endif', '```'].join('\n'));

    expect(
      buildJumpTooltip(undefined, 0, CHAIN, {
        fallbackTitle: 'ジャンプ先',
        lineSuffix: (line) => `— ${line} 行目`,
      }).startsWith('ジャンプ先 — 1 行目')
    ).toBe(true);
  });
});

describe('previewLines', () => {
  it('returns the target line plus the following lines', () => {
    expect(previewLines(['a', 'b', 'c', 'd'], 1, 2)).toEqual(['b', 'c']);
  });

  it('trims trailing whitespace and caps long lines', () => {
    const long = 'x'.repeat(200);
    const preview = previewLines(['  short  ', long], 0, 2);
    expect(preview[0]).toBe('  short');
    expect(preview[1]).toHaveLength(161);
    expect(preview[1].endsWith('…')).toBe(true);
  });

  it('clamps a negative start line', () => {
    expect(previewLines(['a'], -5, 3)).toEqual(['a']);
  });
});
