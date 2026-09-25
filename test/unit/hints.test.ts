import { describe, expect, it } from 'vitest';
import { computeHints, labelFor } from '../../src/core/hints';

const SAME_LINE = 'if (a == 1) {\n   // somethings...\n}\n';
const OWN_LINE = 'if (a == 1)\n{\n   // somethings...\n}\n';

describe('computeHints (brackets)', () => {
  it('labels a brace with the opening statement on the same line', () => {
    expect(computeHints(SAME_LINE, { brackets: true, trigger: 'always' })).toEqual([
      expect.objectContaining({
        line: 2,
        text: ' <- :1-3 if (a == 1)',
        target: { line: 0, col: 12 },
      }),
    ]);
  });

  it('falls back to the previous line when the brace is on its own line', () => {
    expect(computeHints(OWN_LINE, { brackets: true, trigger: 'always' })).toEqual([
      expect.objectContaining({
        line: 3,
        text: ' <- :2-4 if (a == 1)',
        target: { line: 1, col: 0 },
      }),
    ]);
  });

  it('omits single-line pairs in always mode', () => {
    expect(computeHints('foo(a);\n', { brackets: true, trigger: 'always' })).toHaveLength(0);
  });

  it('shows the pair under the cursor in cursor mode', () => {
    const hints = computeHints(SAME_LINE, {
      brackets: true,
      trigger: 'cursor',
      cursorOffset: 4,
    });
    expect(hints).toEqual([
      expect.objectContaining({ line: 0, text: ' <- :1-1 if', target: { line: 0, col: 3 } }),
    ]);
  });

  it('shows nothing in cursor mode when no bracket is nearby', () => {
    expect(
      computeHints(SAME_LINE, { brackets: true, trigger: 'cursor', cursorOffset: 7 })
    ).toHaveLength(0);
  });

  it('honours showRange / showLabel', () => {
    const hints = computeHints(SAME_LINE, {
      brackets: true,
      trigger: 'always',
      showRange: false,
      showLabel: false,
    });
    expect(hints[0].text).toBe(' <-');
  });

  it('hides the range for short spans and keeps it for longer ones', () => {
    // `{` on line 1, `}` on line 3 -> two lines apart.
    expect(
      computeHints(SAME_LINE, { brackets: true, trigger: 'always', rangeHideThreshold: 2 })[0].text
    ).toBe(' <- if (a == 1)');
    expect(
      computeHints(SAME_LINE, { brackets: true, trigger: 'always', rangeHideThreshold: 1 })[0].text
    ).toBe(' <- :1-3 if (a == 1)');
  });

  it('treats a threshold of 0 as "always show the range"', () => {
    expect(
      computeHints(SAME_LINE, { brackets: true, trigger: 'always', rangeHideThreshold: 0 })[0].text
    ).toBe(' <- :1-3 if (a == 1)');
  });

  it('exposes brackets as a single clickable part', () => {
    const hints = computeHints(SAME_LINE, { brackets: true, trigger: 'always' });
    expect(hints[0].parts).toEqual([
      {
        text: ' <- :1-3 if (a == 1)',
        target: { line: 0, col: 12 },
        title: 'if (a == 1)',
      },
    ]);
  });

  it('produces no hints for hover/off triggers', () => {
    expect(computeHints(SAME_LINE, { brackets: true, trigger: 'hover' })).toHaveLength(0);
    expect(computeHints(SAME_LINE, { brackets: true, trigger: 'off' })).toHaveLength(0);
  });

  it('can omit one kind', () => {
    const text = '#if X\nint f(void) {\n}\n#endif\n';
    expect(computeHints(text, { brackets: false, trigger: 'always' }).every((h) => h.kind === 'macro')).toBe(true);
    expect(computeHints(text, { macros: false, trigger: 'always' }).every((h) => h.kind === 'bracket')).toBe(true);
  });
});

describe('labelFor', () => {
  it('prefers text before the bracket', () => {
    expect(labelFor(['if (a) {'], { char: '{', offset: 7, line: 0, col: 7 })).toBe('if (a)');
  });

  it('falls back to the previous line', () => {
    expect(labelFor(['if (a)', '{'], { char: '{', offset: 7, line: 1, col: 0 })).toBe('if (a)');
  });
});
