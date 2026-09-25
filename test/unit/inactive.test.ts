import { describe, expect, it } from 'vitest';
import { computeHints } from '../../src/core/hints';
import { predicates } from './support';

describe('inactive branches', () => {
  const TEXT = 'int g(void) {\n#if 0\n}\n#endif\n    return 0;\n}\n';

  it('skips brackets inside an inactive branch in always mode', () => {
    const hints = computeHints(TEXT, {
      brackets: true,
      macros: false,
      trigger: 'always',
      skipInactiveBrackets: true,
      ...predicates(TEXT),
    });
    expect(hints).toEqual([expect.objectContaining({ line: 5, text: ' <- :1-6 int g(void)' })]);
  });

  it('shows the mis-paired hint, flagged, when inactive brackets are matched', () => {
    // With skipping off, the `}` on line 2 pairs with the `{` on line 0.
    // `always` still shows it, but it is flagged as inactive.
    const hints = computeHints(TEXT, {
      brackets: true,
      macros: false,
      trigger: 'always',
      skipInactiveBrackets: false,
      ...predicates(TEXT),
    });
    expect(hints).toEqual([
      expect.objectContaining({ line: 2, inactive: true, text: ' <- :1-3 int g(void)' }),
    ]);
  });

  it('reports inactive pairs in cursor mode, flagged as inactive', () => {
    const hints = computeHints(TEXT, {
      brackets: true,
      macros: false,
      trigger: 'cursor',
      cursorOffset: TEXT.indexOf('}'),
      skipInactiveBrackets: false,
      ...predicates(TEXT),
    });
    expect(hints).toEqual([
      expect.objectContaining({ line: 2, inactive: true, text: ' <- :1-3 int g(void)' }),
    ]);
  });

  it('keeps branch hints that touch live code', () => {
    // #if 0 (dead) / #elif 1 (live) / #else (dead)
    const text = '#if 0\nint a;\n#elif 1\nint b;\n#else\nint c;\n#endif\n';
    const hints = computeHints(text, {
      brackets: false,
      macros: true,
      trigger: 'always',
      ...predicates(text),
    });
    expect(hints.map((h) => [h.line, h.inactive === true])).toEqual([
      [2, false],
      [4, false],
      [6, false],
    ]);
  });

  it('shows a fully inactive chain, flagged', () => {
    const text = '#if 0\nint a;\n#elif 0\nint b;\n#endif\n';
    const hints = computeHints(text, {
      brackets: false,
      macros: true,
      trigger: 'always',
      ...predicates(text),
    });
    expect(hints.map((h) => [h.line, h.inactive === true])).toEqual([
      [2, true],
      [4, true],
    ]);
  });

  it('shows the #endif of a fully inactive block, flagged', () => {
    const text = '#if 0\nint a;\n#endif\n';
    const hints = computeHints(text, {
      brackets: false,
      macros: true,
      trigger: 'always',
      ...predicates(text),
    });
    expect(hints).toEqual([expect.objectContaining({ line: 2, inactive: true })]);
  });

  it('keeps the #else of an undefined #ifdef (its branch is live)', () => {
    const text = '#ifdef FEATURE\nint a;\n#else\nint b;\n#endif\n';
    const hints = computeHints(text, {
      brackets: false,
      macros: true,
      trigger: 'always',
      ...predicates(text),
    });
    expect(hints.map((h) => [h.line, h.inactive === true])).toEqual([
      [2, false],
      [4, false],
    ]);
  });

  it('can hide inactive directive hints with skipInactiveDirectives', () => {
    const chain = '#if 0\nint a;\n#elif 0\nint b;\n#endif\n';
    expect(
      computeHints(chain, {
        brackets: false,
        macros: true,
        trigger: 'always',
        skipInactiveDirectives: true,
        ...predicates(chain),
      })
    ).toEqual([]);

    const block = '#if 0\nint a;\n#endif\n';
    expect(
      computeHints(block, {
        brackets: false,
        macros: true,
        trigger: 'always',
        skipInactiveDirectives: true,
        ...predicates(block),
      })
    ).toEqual([]);
  });

  it('still shows live directive hints with skipInactiveDirectives', () => {
    const text = '#if 1\nint a;\n#else\nint b;\n#endif\n';
    const hints = computeHints(text, {
      brackets: false,
      macros: true,
      trigger: 'always',
      skipInactiveDirectives: true,
      ...predicates(text),
    });
    expect(hints.map((h) => h.line)).toEqual([2, 4]);
  });

  it('reports hints that touch only inactive branches in cursor mode, flagged', () => {
    const text = '#if 0\nint a;\n#elif 0\nint b;\n#endif\n';
    const hints = computeHints(text, {
      brackets: false,
      macros: true,
      trigger: 'cursor',
      cursorOffset: text.indexOf('#elif'),
      ...predicates(text),
    });
    expect(hints).toEqual([expect.objectContaining({ line: 2, inactive: true })]);
  });

  it('still reports a fully inactive block when the caret is on its opener', () => {
    const text = '#if 0\nint a;\n#endif\n';
    const hints = computeHints(text, {
      brackets: false,
      macros: true,
      trigger: 'cursor',
      cursorOffset: 0,
      ...predicates(text),
    });
    expect(hints).toEqual([expect.objectContaining({ line: 2, inactive: true })]);
  });

  it('does not flag hints that touch active branches', () => {
    const text = '#if 1\nint a;\n#else\nint b;\n#endif\n';
    const hints = computeHints(text, {
      brackets: false,
      macros: true,
      trigger: 'always',
      ...predicates(text),
    });
    expect(hints.map((h) => h.line)).toEqual([2, 4]);
    expect(hints.every((h) => h.inactive !== true)).toBe(true);
  });
});
