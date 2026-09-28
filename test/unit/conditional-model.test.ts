import { describe, expect, it } from 'vitest';
import { ConditionalHint, cursorActivates } from '../../src/core/conditionals';
import { computeHints } from '../../src/core/hints';
import { scan } from '../../src/core/lexer/tokenizer';
import { cConditionals } from '../../src/core/match/c-preprocessor';
import { predicates } from './support';

const CORPUS = [
  '#if X\nint a;\n#else\nint b;\n#endif\n',
  '#ifdef OUTER\n#if 1\nint a;\n#endif\n#endif\n',
  '#if 0\n#elif 1\nint a;\n#else\nint b;\n#endif\n',
  '#region Outer\n#region Inner\nint a;\n#endregion\n#endregion\n',
];

describe('cConditionals', () => {
  it('applies activity from the model the caller builds', () => {
    const text = '#if 0\nint a;\n#elif 0\nint b;\n#endif\n';
    const { conditionals } = predicates(text);

    // Without a model the renderer is purely structural: nothing is known inactive.
    const structural = computeHints(text, { brackets: false, macros: true, trigger: 'always' });
    expect(structural.map((hint) => hint.inactive === true)).toEqual([false, false]);

    // The evaluator-backed model marks the branch and the block inactive.
    const modeled = computeHints(text, {
      brackets: false,
      macros: true,
      trigger: 'always',
      conditionals,
    });
    expect(modeled.map((hint) => hint.inactive === true)).toEqual([true, true]);
    expect(modeled.map((hint) => hint.text)).toEqual([
      ' <- :1-3 #if 0',
      ' <- :3-5 #elif 0 <= :1-5 #if 0',
    ]);
  });

  it('leaves activity unknown when no model is supplied', () => {
    for (const text of CORPUS) {
      const structural = computeHints(text, { brackets: false, macros: true, trigger: 'always' });
      expect(structural.every((hint) => hint.inactive !== true)).toBe(true);
    }
  });

  it('builds a two-segment #endif for multi-branch blocks', () => {
    const model = cConditionals(scan('#if X\nint a;\n#else\nint b;\n#endif\n').directives);
    const endif = model.hints.find((hint) => hint.isEndif);
    expect(endif).toBeDefined();
    expect(endif?.openerLine).toBe(0);
    expect(endif?.cursorFrom).toBe(4);
    expect(endif?.cursorTo).toBe(0);
    expect(endif?.segments).toHaveLength(2);
    expect(endif?.segments.map((segment) => segment.marker)).toEqual([' <- ', ' <= ']);
  });

  it('builds a single-segment #endif for single-branch blocks', () => {
    const model = cConditionals(scan('#if X\nint a;\n#endif\n').directives);
    const endif = model.hints.find((hint) => hint.isEndif);
    expect(endif?.segments).toHaveLength(1);
    expect(endif?.segments[0].marker).toBe(' <- ');
  });

  it('never marks regions inactive', () => {
    const model = cConditionals(
      scan('#if 0\n#region Dead\nint a;\n#endregion\n#endif\n').directives,
      { branchActive: () => false, blockActive: () => false }
    );
    const region = model.hints.find((hint) => hint.segments[0]?.display === '#region Dead');
    expect(region).toBeDefined();
    expect(region?.inactive).toBe(false);
  });

  describe('cursorActivates', () => {
    const hint = (cursorFrom: number, cursorTo: number): ConditionalHint => ({
      line: cursorFrom,
      cursorFrom,
      cursorTo,
      segments: [],
      inactive: false,
      isEndif: false,
      kind: 'macro',
    });

    it('treats an ordered pair as an inclusive range', () => {
      const entry = hint(1, 4);
      expect([0, 1, 2, 3, 4, 5].map((line) => cursorActivates(entry, line))).toEqual([
        false,
        true,
        true,
        true,
        true,
        false,
      ]);
    });

    it('activates only the two endpoints of an inverted pair', () => {
      const entry = hint(9, 4);
      expect([3, 4, 5, 8, 9, 10].map((line) => cursorActivates(entry, line))).toEqual([
        false,
        true,
        false,
        false,
        true,
        false,
      ]);
    });

    it('activates a single line when the endpoints are equal', () => {
      const entry = hint(3, 3);
      expect([2, 3, 4].map((line) => cursorActivates(entry, line))).toEqual([false, true, false]);
    });
  });
});
