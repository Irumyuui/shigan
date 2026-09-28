import { HintPart } from './types';

/** Concatenates the part texts; `Hint.text` must equal this. */
export function textOfParts(parts: HintPart[]): string {
  return parts.map((part) => part.text).join('');
}

/** The one-based `:start-end` range label; the single home for range formatting. */
export function formatRange(fromLine: number, toLine: number): string {
  return `:${fromLine + 1}-${toLine + 1}`;
}

/** `0` disables the threshold, so the range is always shown. */
export function shouldShowRange(
  showRange: boolean,
  rangeHideThreshold: number,
  fromLine: number,
  toLine: number
): boolean {
  if (!showRange) return false;
  if (rangeHideThreshold > 0 && toLine - fromLine <= rangeHideThreshold) return false;
  return true;
}

/** Display switches shared by every segment of a document. */
export interface HintTextOptions {
  showRange: boolean;
  showLabel: boolean;
  rangeHideThreshold: number;
}

/**
 * Builds the body of a conditional hint segment: the `:start-end` range when
 * shown and the two endpoints differ, then the display text (e.g. `#if X`) when
 * labels are on. A segment whose `fromLine === toLine` is display-only (used by
 * merged Rust `#[cfg]` spans). Returns an empty string when both parts are off
 * (the caller renders the bare marker then).
 */
export function segment(
  options: HintTextOptions,
  fromLine: number,
  toLine: number,
  display: string
): string {
  const bits: string[] = [];
  if (
    fromLine !== toLine &&
    shouldShowRange(options.showRange, options.rangeHideThreshold, fromLine, toLine)
  ) {
    bits.push(formatRange(fromLine, toLine));
  }
  if (options.showLabel) bits.push(display);
  return bits.join(' ');
}
