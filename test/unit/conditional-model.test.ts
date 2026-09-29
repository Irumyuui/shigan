import { describe, expect, it } from 'vitest';
import { ConditionalHint, cursorActivates } from '../../src/core/conditionals';
import { computeHints } from '../../src/core/hints';
import { scan } from '../../src/core/lexer/tokenizer';
import { cConditionals } from '../../src/core/match/c-preprocessor';
import { Hint } from '../../src/core/types';
import { predicates, rustHarness } from './support';

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
    const endif = model.hints.find((hint) => hint.cursorFrom > hint.cursorTo);
    expect(endif).toBeDefined();
    expect(endif?.cursorFrom).toBe(4);
    expect(endif?.cursorTo).toBe(0);
    expect(endif?.segments).toHaveLength(2);
    expect(endif?.segments.map((segment) => segment.marker)).toEqual([' <- ', ' <= ']);
  });

  it('builds a single-segment #endif for single-branch blocks', () => {
    const model = cConditionals(scan('#if X\nint a;\n#endif\n').directives);
    const endif = model.hints.find((hint) => hint.cursorFrom > hint.cursorTo);
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

describe('computeHints (macros / conditional gates)', () => {
  /** A C directive pair; its model hint is `kind: 'macro'`. */
  const C_TEXT = '#if X\nint f(void) {\n}\n#endif\n';
  /** A Rust `#[cfg]`-gated item; its model hint is `kind: 'conditional'`. */
  const RUST_TEXT = '#[cfg(unix)]\nfn unix_only() {\n}\n';

  function renderC(macros: boolean, conditional: boolean): Hint[] {
    return computeHints(C_TEXT, {
      brackets: false,
      macros,
      conditional,
      trigger: 'always',
      conditionals: predicates(C_TEXT, { X: '1' }).conditionals,
    });
  }

  function renderRust(macros: boolean, conditional: boolean): Hint[] {
    const harness = rustHarness(RUST_TEXT);
    return computeHints(RUST_TEXT, {
      brackets: false,
      macros,
      conditional,
      trigger: 'always',
      scanned: harness.scanned,
      conditionals: harness.conditionals,
    });
  }

  const kinds = (hints: Hint[]): string[] => hints.map((hint) => hint.kind).sort();

  it('macros:false / conditional:true hides C #if but keeps Rust #[cfg]', () => {
    expect(kinds(renderC(false, true))).toEqual([]);
    expect(kinds(renderRust(false, true))).toEqual(['conditional']);
  });

  it('macros:true / conditional:false hides Rust #[cfg] but keeps C #if', () => {
    expect(kinds(renderC(true, false))).toEqual(['macro']);
    expect(kinds(renderRust(true, false))).toEqual([]);
  });

  it('hides both kinds when both gates are off', () => {
    expect(renderC(false, false)).toHaveLength(0);
    expect(renderRust(false, false)).toHaveLength(0);
  });

  it('shows both kinds when both gates are on', () => {
    expect(kinds(renderC(true, true))).toEqual(['macro']);
    expect(kinds(renderRust(true, true))).toEqual(['conditional']);
  });

  it('keeps excluding an inactive item from bracket matching when its cfg hint is hidden', () => {
    const text = '#[cfg(unix)]\nfn unix_only() {\n    let a = 1;\n}\n';
    // `-unix` decides the whole item inactive.
    const harness = rustHarness(text, { cfg: ['-unix'] });
    const options = {
      brackets: true,
      macros: true,
      trigger: 'always' as const,
      scanned: harness.scanned,
      conditionals: harness.conditionals,
      inactive: harness.inactive,
      skipInactiveBrackets: true,
    };

    const hidden = computeHints(text, { ...options, conditional: false });
    expect(hidden.some((hint) => hint.kind === 'conditional')).toBe(false);
    // The inactive braces are still excluded from matching, so no bracket hint
    // ends inside the dead item.
    expect(hidden).toHaveLength(0);

    const shown = computeHints(text, { ...options, conditional: true });
    expect(shown.map((hint) => hint.kind)).toContain('conditional');
  });

  it('skipInactiveDirectives hides an inactive Rust #[cfg] hint', () => {
    const text = '#[cfg(unix)]\nfn unix_only() {\n    let a = 1;\n}\n';
    const harness = rustHarness(text, { cfg: ['-unix'] });
    const base = {
      brackets: false,
      macros: true,
      conditional: true,
      trigger: 'always' as const,
      scanned: harness.scanned,
      conditionals: harness.conditionals,
      inactive: harness.inactive,
    };

    const shown = computeHints(text, base);
    expect(shown).toHaveLength(1);
    expect(shown[0].inactive).toBe(true);

    expect(computeHints(text, { ...base, skipInactiveDirectives: true })).toHaveLength(0);
  });
});
