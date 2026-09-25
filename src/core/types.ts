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

export interface ScanResult {
  brackets: BracketToken[];
  directives: DirectiveToken[];
}

export type HintKind = 'bracket' | 'macro';

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
  /** Clickable segments, in order. */
  parts?: HintPart[];
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
