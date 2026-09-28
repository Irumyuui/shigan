import { describe, expect, it } from 'vitest';
import { computeHints } from '../../src/core/hints';
import { segment, shouldShowRange, textOfParts } from '../../src/core/hint-parts';

describe('hint-parts', () => {
  it('segment is empty when both range and label are off', () => {
    expect(segment(false, false, 0, 2, '#if X', 0)).toBe('');
  });

  it('segment combines range and display', () => {
    expect(segment(true, true, 0, 2, '#if X', 0)).toBe(':1-3 #if X');
    expect(segment(true, false, 0, 2, '#if X', 0)).toBe(':1-3');
    expect(segment(false, true, 0, 2, '#if X', 0)).toBe('#if X');
  });

  it('shouldShowRange honours the threshold', () => {
    expect(shouldShowRange(true, 0, 0, 5)).toBe(true);
    expect(shouldShowRange(true, 2, 0, 2)).toBe(false);
    expect(shouldShowRange(true, 1, 0, 2)).toBe(true);
    expect(shouldShowRange(false, 0, 0, 5)).toBe(false);
  });

  it('textOfParts concatenates in order', () => {
    expect(textOfParts([{ text: ' <- ' }, { text: 'x' }])).toBe(' <- x');
  });

  it('renders an empty segment body as the bare marker', () => {
    const hints = computeHints('#region R\nint a;\n#endregion\n', {
      brackets: false,
      macros: true,
      trigger: 'always',
      showRange: false,
      showLabel: false,
    });
    expect(hints[0].text).toBe(' <-');
  });
});
