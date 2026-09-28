import { describe, expect, it } from 'vitest';
import { computeHints } from '../../src/core/hints';
import { formatRange, segment, shouldShowRange, textOfParts } from '../../src/core/hint-parts';

/** Display presets for the `segment` options object. */
const BOTH = { showRange: true, showLabel: true, rangeHideThreshold: 0 };
const RANGE_ONLY = { showRange: true, showLabel: false, rangeHideThreshold: 0 };
const LABEL_ONLY = { showRange: false, showLabel: true, rangeHideThreshold: 0 };
const NEITHER = { showRange: false, showLabel: false, rangeHideThreshold: 0 };

describe('hint-parts', () => {
  it('segment is empty when both range and label are off', () => {
    expect(segment(NEITHER, 0, 2, '#if X')).toBe('');
  });

  it('segment combines range and display', () => {
    expect(segment(BOTH, 0, 2, '#if X')).toBe(':1-3 #if X');
    expect(segment(RANGE_ONLY, 0, 2, '#if X')).toBe(':1-3');
    expect(segment(LABEL_ONLY, 0, 2, '#if X')).toBe('#if X');
  });

  it('omits the range when the endpoints are the same line', () => {
    expect(segment(BOTH, 3, 3, '#[cfg(x)]')).toBe('#[cfg(x)]');
    expect(segment(RANGE_ONLY, 3, 3, 'x')).toBe('');
  });

  it('formatRange renders one-based inclusive bounds', () => {
    expect(formatRange(0, 2)).toBe(':1-3');
    expect(formatRange(9, 4)).toBe(':10-5');
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
