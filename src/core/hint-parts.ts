import { HintPart } from './types';

/** Concatenates the part texts; `Hint.text` must equal this. */
export function textOfParts(parts: HintPart[]): string {
  return parts.map((part) => part.text).join('');
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

/**
 * Builds the body of a conditional hint segment: the `:start-end` range when
 * shown and the two endpoints differ, then the display text (e.g. `#if X`) when
 * labels are on. A segment whose `fromLine === toLine` is display-only (used by
 * merged Rust `#[cfg]` spans). Returns an empty string when both parts are off
 * (the caller renders the bare marker then).
 */
export function segment(
  showRange: boolean,
  showLabel: boolean,
  fromLine: number,
  toLine: number,
  display: string,
  rangeHideThreshold: number
): string {
  const bits: string[] = [];
  if (fromLine !== toLine && shouldShowRange(showRange, rangeHideThreshold, fromLine, toLine)) {
    bits.push(`:${fromLine + 1}-${toLine + 1}`);
  }
  if (showLabel) bits.push(display);
  return bits.join(' ');
}
