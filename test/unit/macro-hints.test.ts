import { describe, expect, it } from 'vitest';
import { computeHints } from '../../src/core/hints';

const CHAIN = '#if X\n\n#else\n\n#endif\n';

describe('computeHints (macros)', () => {
  it('builds branch and endif hints', () => {
    const hints = computeHints(CHAIN, { brackets: false, macros: true, trigger: 'always' });
    expect(hints.map((h) => h.text)).toEqual([
      ' <- :1-3 #if X',
      ' <- :3-5 #else <= :1-5 #if X',
    ]);
    expect(hints.map((h) => h.line)).toEqual([2, 4]);
    expect(hints.every((h) => h.kind === 'macro')).toBe(true);
  });

  it('makes each segment clickable, with its own target and title', () => {
    const hints = computeHints(CHAIN, { brackets: false, macros: true, trigger: 'always' });

    expect(hints[0].parts).toEqual([
      { text: ' <- :1-3 #if X', target: { line: 0, col: 0 }, title: '#if X' },
    ]);

    // `#endif` has two segments: the preceding `#else` and the opening `#if`.
    expect(hints[1].parts).toEqual([
      { text: ' <- :3-5 #else', target: { line: 2, col: 0 }, title: '#else' },
      { text: ' <= :1-5 #if X', target: { line: 0, col: 0 }, title: '#if X' },
    ]);
    expect(hints[1].text).toBe(' <- :3-5 #else <= :1-5 #if X');
    expect(hints[1].target).toEqual({ line: 2, col: 0 });
  });

  it('targets the preceding branch from each branch, and both from #endif', () => {
    const text = '#ifdef A\nx\n#elif defined(B)\ny\n#else\nz\n#endif\n';
    const hints = computeHints(text, { brackets: false, macros: true, trigger: 'always' });
    expect(hints.map((h) => [h.line, h.parts?.map((part) => part.target)])).toEqual([
      [2, [{ line: 0, col: 0 }]],
      [4, [{ line: 2, col: 0 }]],
      [6, [{ line: 4, col: 0 }, { line: 0, col: 0 }]],
    ]);
  });

  it('omits the outer segment for single-branch blocks', () => {
    const hints = computeHints('#if X\nint a;\n#endif\n', {
      brackets: false,
      macros: true,
      trigger: 'always',
    });
    expect(hints).toHaveLength(1);
    expect(hints[0].text).toBe(' <- :1-3 #if X');
  });

  it('shows the hint for the directive under the cursor', () => {
    const hints = computeHints(CHAIN, {
      brackets: false,
      macros: true,
      trigger: 'cursor',
      cursorOffset: CHAIN.indexOf('#else'),
    });
    expect(hints.map((h) => h.line)).toEqual([2]);
  });

  it('shows the endif hint when the cursor is on the opener', () => {
    const hints = computeHints(CHAIN, {
      brackets: false,
      macros: true,
      trigger: 'cursor',
      cursorOffset: 0,
    });
    expect(hints.map((h) => h.line)).toEqual([4]);
    expect(hints[0].text).toBe(' <- :3-5 #else <= :1-5 #if X');
  });

  it('honours showRange / showLabel', () => {
    const hints = computeHints(CHAIN, {
      brackets: false,
      macros: true,
      trigger: 'always',
      showRange: false,
      showLabel: false,
    });
    expect(hints.map((h) => h.text)).toEqual([' <-', ' <- <=']);
  });

  it('applies the range threshold to each segment', () => {
    // #if X (line 0) / #else (line 1) / #endif (line 2)
    const text = '#if X\n#else\n#endif\n';
    const hints = computeHints(text, {
      brackets: false,
      macros: true,
      trigger: 'always',
      rangeHideThreshold: 1,
    });
    // The `<-` segments span one line and hide their range; the `<=` segment
    // spans two and keeps it.
    expect(hints.map((h) => h.text)).toEqual([' <- #if X', ' <- #else <= :1-3 #if X']);
  });

  it('produces no macro hints for hover/off triggers', () => {
    expect(computeHints(CHAIN, { brackets: false, macros: true, trigger: 'hover' })).toHaveLength(0);
    expect(computeHints(CHAIN, { brackets: false, macros: true, trigger: 'off' })).toHaveLength(0);
  });

  it('can combine bracket and macro hints', () => {
    const text = '#if X\nint f(void) {\n    return 0;\n}\n#endif\n';
    const hints = computeHints(text, {
      brackets: true,
      macros: true,
      trigger: 'always',
    });
    expect(hints.map((h) => [h.kind, h.line])).toEqual([
      ['bracket', 3],
      ['macro', 4],
    ]);
  });
});
