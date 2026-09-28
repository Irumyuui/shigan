import { HintKind, HintTarget } from './types';

/**
 * One clickable segment of a conditional hint.
 *
 * `marker` is the rendered prefix (`<-` references the preceding branch,
 * `<=` references the enclosing block); `fromLine`/`toLine` are the range shown
 * as `:start-end`; `display` is both the label and the tooltip title.
 */
export interface ConditionalSegment {
  marker: ' <- ' | ' <= ';
  fromLine: number;
  toLine: number;
  /** Target text used as the label and the tooltip title (directive/attribute display). */
  display: string;
  target: HintTarget;
}

/**
 * A language-neutral conditional hint. The renderer turns this into an
 * inlay hint; the model owns the pairing and activity semantics.
 */
export interface ConditionalHint {
  /** Line the hint is attached to. */
  line: number;
  /**
   * Cursor activation endpoints. When `cursorFrom <= cursorTo` the whole
   * inclusive range activates the hint (used for Rust item spans); when
   * `cursorFrom > cursorTo` only the two endpoint lines activate it (C
   * `#endif`/`#region`, where `cursorTo` is the opener/region line). Prefer
   * {@link cursorActivates} over comparing the fields by hand.
   */
  cursorFrom: number;
  cursorTo: number;
  segments: readonly ConditionalSegment[];
  /** Model truth: the referenced branch/block/span is known inactive. */
  inactive: boolean;
  /** `#endif`-style entries use the block-level rule; `openerLine` must be set for them. */
  isEndif: boolean;
  openerLine?: number;
  kind: HintKind;
}

/** The conditional hints for a document, plus inactive lines when known. */
export interface ConditionalModel {
  hints: readonly ConditionalHint[];
  /** Lines inside inactive regions, when the model itself knows them (Rust later; optional). */
  inactiveLines?: ReadonlySet<number>;
}

/**
 * Whether the caret line activates a conditional hint. See
 * {@link ConditionalHint.cursorFrom} for the two supported shapes.
 */
export function cursorActivates(entry: ConditionalHint, cursorLine: number): boolean {
  return entry.cursorFrom <= entry.cursorTo
    ? cursorLine >= entry.cursorFrom && cursorLine <= entry.cursorTo
    : cursorLine === entry.cursorFrom || cursorLine === entry.cursorTo;
}
