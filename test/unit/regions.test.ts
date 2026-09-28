import { describe, expect, it } from 'vitest';
import { computeHints } from '../../src/core/hints';
import { scan } from '../../src/core/lexer/tokenizer';
import { pairRegions } from '../../src/core/match/preprocess';
import { predicates } from './support';

const SIMPLE = '#region Name\nint a;\n#endregion\n';
const NESTED = '#region Outer\n#region Inner\nint a;\n#endregion\n#endregion\n';

describe('pairRegions', () => {
  it('pairs a simple #region / #endregion', () => {
    const pairs = pairRegions(scan(SIMPLE).directives);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].opener.display).toBe('#region Name');
    expect(pairs[0].endregion.name).toBe('endregion');
    expect(pairs[0].endregion.line).toBe(2);
  });

  it('supports nesting, innermost first', () => {
    const pairs = pairRegions(scan(NESTED).directives);
    expect(pairs.map((pair) => pair.opener.display)).toEqual(['#region Inner', '#region Outer']);
    expect(pairs.map((pair) => pair.endregion.line)).toEqual([3, 4]);
  });

  it('ignores an unmatched #endregion', () => {
    expect(pairRegions(scan('#endregion\nint a;\n').directives)).toEqual([]);
  });

  it('ignores an unclosed #region', () => {
    expect(pairRegions(scan('#region Foo\nint a;\n').directives)).toEqual([]);
  });
});

describe('computeHints (#region)', () => {
  it('hints a simple pair, attached to the #endregion', () => {
    const hints = computeHints(SIMPLE, { brackets: false, macros: true, trigger: 'always' });
    expect(hints).toEqual([
      {
        line: 2,
        text: ' <- :1-3 #region Name',
        parts: [
          { text: ' <- :1-3 #region Name', target: { line: 0, col: 0 }, title: '#region Name' },
        ],
        kind: 'macro',
        target: { line: 0, col: 0 },
      },
    ]);
  });

  it('hints nested regions on their own #endregion lines', () => {
    const hints = computeHints(NESTED, { brackets: false, macros: true, trigger: 'always' });
    expect(hints.map((hint) => `${hint.line}:${hint.text}`)).toEqual([
      '3: <- :2-4 #region Inner',
      '4: <- :1-5 #region Outer',
    ]);
  });

  it('still hints a region that lives inside an inactive #if block', () => {
    const text = '#if 0\n#region Dead\nint a;\n#endregion\n#endif\n';
    const hints = computeHints(text, {
      brackets: false,
      macros: true,
      trigger: 'always',
      ...predicates(text),
    });
    const region = hints.find((hint) => hint.line === 3);
    expect(region?.text).toBe(' <- :2-4 #region Dead');
    // Regions are structural: v1 never flags them inactive.
    expect(region?.inactive).toBeUndefined();
  });

  it('selects the region hint by cursor line for both directives', () => {
    const options = { brackets: false, macros: true, trigger: 'cursor' as const };
    // `#region Name\n` is 13 chars, so line 1 starts at 13 and line 2 at 20.
    expect(computeHints(SIMPLE, { ...options, cursorOffset: 20 })).toHaveLength(1);
    expect(computeHints(SIMPLE, { ...options, cursorOffset: 0 })).toHaveLength(1);
    expect(computeHints(SIMPLE, { ...options, cursorOffset: 13 })).toHaveLength(0);
  });

  it('honours showLabel / showRange', () => {
    expect(
      computeHints(SIMPLE, {
        brackets: false,
        macros: true,
        trigger: 'always',
        showLabel: false,
      })[0].text
    ).toBe(' <- :1-3');
    expect(
      computeHints(SIMPLE, {
        brackets: false,
        macros: true,
        trigger: 'always',
        showRange: false,
      })[0].text
    ).toBe(' <- #region Name');
    expect(
      computeHints(SIMPLE, {
        brackets: false,
        macros: true,
        trigger: 'always',
        showRange: false,
        showLabel: false,
      })[0].text
    ).toBe(' <-');
  });
});
