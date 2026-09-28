export interface Position {
  /** Character offset from the start of the document. */
  offset: number;
  /** Zero-based line number. */
  line: number;
  /** Zero-based column (character index within the line). */
  col: number;
}

export interface BracketToken extends Position {
  char: string;
}

export interface DirectiveToken {
  /** Lower-cased directive name, e.g. `if`, `ifdef`, `elif`, `else`, `endif`. */
  name: string;
  /** Original logical line text (without the trailing newline). */
  raw: string;
  /** Normalized display text, e.g. `#if defined(X) && BAR`. */
  display: string;
  /** Zero-based start line. */
  line: number;
  /** Zero-based end line (inclusive) for directives continued with `\`. */
  endLine: number;
  offset: number;
}

/** A Rust `#[cfg(...)]` / `#[cfg_attr(...)]` attribute (or its `#![...]` form). */
export interface CfgAttributeToken {
  /** `cfg` or `cfg_attr`. */
  name: 'cfg' | 'cfg_attr';
  /** True for an inner attribute (`#![…]`). */
  inner: boolean;
  /** Normalized attribute text, e.g. `#[cfg(all(unix, feature = "a"))]`. */
  display: string;
  line: number;
  offset: number;
  col: number;
}

export interface ScanResult {
  brackets: BracketToken[];
  directives: DirectiveToken[];
  /** Rust-only: recognized `cfg` attributes (undefined for C-family scans). */
  cfgs?: CfgAttributeToken[];
}

/**
 * Which producer emitted a hint. `conditional` is used by Rust `#[cfg]` gating
 * hints; it is a distinct kind so it is never rendered as a bracket label.
 */
export type HintKind = 'bracket' | 'macro' | 'conditional';

export interface Hint {
  /** Zero-based line the hint is attached to. */
  line: number;
  /** Full text of the hint; equal to the concatenation of `parts`. */
  text: string;
  kind: HintKind;
  openLine?: number;
  closeLine?: number;
  /** True when the hint lives inside an inactive preprocessor branch. */
  inactive?: boolean;
  /** Primary target: the first part that has one. */
  target?: HintTarget;
  /** Clickable segments, in order. Every producer sets them. */
  parts: HintPart[];
}

export interface HintTarget {
  line: number;
  col: number;
}

export interface HintPart {
  /** Literal text of this segment. */
  text: string;
  /** Where clicking this segment navigates to. */
  target?: HintTarget;
  /** Short description of the target, e.g. `#else` or `int main(void)`. */
  title?: string;
}

export type Trigger = 'cursor' | 'always' | 'hover' | 'off';

export type PairKind = 'brackets' | 'macros';

export interface MacroDef {
  /** Replacement text; `'1'` for a flag-style `-DFOO`. */
  value: string;
  functionLike: boolean;
}
