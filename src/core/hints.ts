import { scan } from './lexer/tokenizer';
import { BracketMatchResult, BracketPair, matchBrackets } from './match/brackets';
import { ConditionalPairing, pairConditionals } from './match/preprocess';
import { BracketToken, DirectiveToken, Hint, HintPart, ScanResult, Trigger } from './types';

export interface HintOptions {
  /** Show bracket hints (default true). */
  brackets?: boolean;
  /** Show preprocessor hints (default true). */
  macros?: boolean;
  /** When to show hints; `hover` and `off` produce no inlay hints here. */
  trigger?: Trigger;
  cursorOffset?: number;
  showRange?: boolean;
  /**
   * Hide the `:start-end` range when the opening and closing lines are at most
   * this many lines apart. `0` (the default) always shows the range.
   */
  rangeHideThreshold?: number;
  showLabel?: boolean;
  /** Returns true for lines that live inside an inactive preprocessor branch. */
  inactive?: (line: number) => boolean;
  /** Whether the branch starting at a branch directive line is active. */
  branchActive?: (line: number) => boolean | undefined;
  /** Whether the conditional block opened at a line has an active branch. */
  blockActive?: (openerLine: number) => boolean | undefined;
  /** Exclude brackets in inactive branches from matching (default true). */
  skipInactiveBrackets?: boolean;
  /**
   * Skip directive hints whose branch/block is inactive (default false, i.e.
   * they are shown, mirroring `skipInactiveBrackets` on the bracket side).
   */
  skipInactiveDirectives?: boolean;
  /** Flag hints that live in inactive branches as `inactive` (default true). */
  markInactive?: boolean;
  /** Pre-computed scan result, to avoid scanning the same text twice. */
  scanned?: ScanResult;
}

/**
 * Computes all display hints for a document.
 *
 * Pure and VSCode-free so it can be unit tested directly. `hover` and `off`
 * produce nothing here; the hover provider handles `hover` itself.
 *
 * `always` is deliberately uniform across both kinds: every multi-line bracket
 * pair and every directive pair is hinted, regardless of `#if` state. Inactive
 * code is handled by explicit options instead of magic:
 *  - `skipInactiveBrackets` keeps brackets in a disabled branch out of the
 *    matching, so dead code never pairs with live code;
 *  - `skipInactiveDirectives` hides directive hints that refer to a disabled
 *    branch/block;
 *  - `markInactive` flags such hints as `inactive`.
 *
 * `cursor` reports the pair under the caret, flagged the same way.
 */
export function computeHints(text: string, options: HintOptions = {}): Hint[] {
  const trigger = options.trigger ?? 'always';
  const hints: Hint[] = [];
  if (trigger !== 'cursor' && trigger !== 'always') return hints;

  const showRange = options.showRange !== false;
  const rangeHideThreshold = options.rangeHideThreshold ?? 0;
  const showLabel = options.showLabel !== false;
  const inactive = options.inactive;
  const markInactive = options.markInactive !== false;

  const scanned = options.scanned ?? scan(text);
  const lines = splitLines(text);

  if (options.brackets !== false) {
    const excludeInactive =
      inactive && options.skipInactiveBrackets !== false
        ? (token: BracketToken) => inactive(token.line)
        : undefined;

    const result = matchBrackets(scanned.brackets, excludeInactive);
    const pairs =
      trigger === 'cursor'
        ? selectCursorPairs(result, options.cursorOffset ?? -1)
        : result.pairs.filter((pair) => pair.open.line !== pair.close.line);

    for (const pair of pairs) {
      const hint = bracketHint(lines, pair, showRange, showLabel, rangeHideThreshold);
      // `always` means always: inactive pairs are only excluded from matching
      // (see `skipInactiveBrackets`), never hidden here.
      const isInactive = inactive?.(hint.line) === true || inactive?.(pair.open.line) === true;
      if (markInactive && isInactive) hint.inactive = true;
      hints.push(hint);
    }
  }

  if (options.macros !== false) {
    const pairing = pairConditionals(scanned.directives);
    const entries = buildMacroHints(pairing, showRange, showLabel, rangeHideThreshold);
    const cursorLine =
      trigger === 'cursor' ? lineAtOffset(text, options.cursorOffset ?? -1) : -1;

    for (const entry of entries) {
      if (trigger === 'cursor') {
        const onDirective = entry.directiveLine === cursorLine;
        const onOpener = entry.isEndif && entry.openerLine === cursorLine;
        if (!onDirective && !onOpener) continue;
      }

      // `always` means always for directives: the hint is shown even when the
      // branch it refers to is disabled (it is flagged `inactive` instead).
      // `skipInactiveDirectives` is the counterpart of `skipInactiveBrackets`.
      const isInactiveInBranch = entry.isEndif
        ? options.blockActive?.(entry.referenceLine) === false
        : branchHintIsInactive(options.branchActive, entry.referenceLine, entry.directiveLine);

      if (isInactiveInBranch) {
        if (options.skipInactiveDirectives === true) continue;
        if (markInactive) entry.hint.inactive = true;
      }
      hints.push(entry.hint);
    }
  }

  hints.sort((a, b) => a.line - b.line || compareText(a.text, b.text));
  return hints;
}

function bracketHint(
  lines: string[],
  pair: BracketPair,
  showRange: boolean,
  showLabel: boolean,
  rangeHideThreshold: number
): Hint {
  const parts: string[] = [];
  if (shouldShowRange(showRange, rangeHideThreshold, pair.open.line, pair.close.line)) {
    parts.push(`:${pair.open.line + 1}-${pair.close.line + 1}`);
  }
  if (showLabel) {
    const label = labelFor(lines, pair.open);
    if (label) parts.push(label);
  }
  const text = parts.length > 0 ? ` <- ${parts.join(' ')}` : ' <-';
  const target = { line: pair.open.line, col: pair.open.col };
  const title = labelFor(lines, pair.open) || pair.open.char;
  return {
    line: pair.close.line,
    text,
    kind: 'bracket',
    openLine: pair.open.line,
    closeLine: pair.close.line,
    target,
    parts: [{ text, target, title }],
  };
}

interface MacroHintEntry {
  hint: Hint;
  /** Directive line this hint is attached to. */
  directiveLine: number;
  /** Set for `#endif` hints. */
  isEndif: boolean;
  /** Opening directive line of the conditional block. */
  openerLine: number;
  /** The directive line the hint references (the preceding branch, or the opener for `#endif`). */
  referenceLine: number;
}

function buildMacroHints(
  pairing: ConditionalPairing,
  showRange: boolean,
  showLabel: boolean,
  rangeHideThreshold: number
): MacroHintEntry[] {
  const entries: MacroHintEntry[] = [];

  for (const block of pairing.blocks) {
    const opener = block.opener;

    for (let k = 1; k < block.branches.length; k++) {
      const previous = block.branches[k - 1];
      const current = block.branches[k];
      const parts = macroParts(showRange, showLabel, previous, current, undefined, rangeHideThreshold);
      entries.push({
        hint: {
          line: current.line,
          text: textOfParts(parts),
          parts,
          kind: 'macro',
          target: parts[0]?.target,
        },
        directiveLine: current.line,
        isEndif: false,
        openerLine: opener.line,
        referenceLine: previous.line,
      });
    }

    if (block.endif) {
      const previous = block.branches[block.branches.length - 1];
      const hasMultipleBranches = block.branches.length > 1;
      const parts = macroParts(
        showRange,
        showLabel,
        previous,
        block.endif,
        hasMultipleBranches ? opener : undefined,
        rangeHideThreshold
      );
      entries.push({
        hint: {
          line: block.endif.line,
          text: textOfParts(parts),
          parts,
          kind: 'macro',
          target: parts[0]?.target,
        },
        directiveLine: block.endif.line,
        isEndif: true,
        openerLine: opener.line,
        referenceLine: opener.line,
      });
    }
  }

  return entries;
}

/**
 * Builds the clickable segments of a directive hint.
 *
 * - the `<-` segment references the preceding branch and jumps to it;
 * - the `<=` segment (only on an `#endif` with more than one branch)
 *   references the whole block and jumps to its opening `#if`.
 */
function macroParts(
  showRange: boolean,
  showLabel: boolean,
  previous: DirectiveToken,
  current: DirectiveToken,
  outer: DirectiveToken | undefined,
  rangeHideThreshold: number
): HintPart[] {
  const parts: HintPart[] = [];

  const previousSegment = segment(
    showRange,
    showLabel,
    previous.line,
    current.line,
    previous,
    rangeHideThreshold
  );
  parts.push({
    text: previousSegment ? ` <- ${previousSegment}` : ' <-',
    target: { line: previous.line, col: 0 },
    title: previous.display,
  });

  if (outer) {
    const outerSegment = segment(
      showRange,
      showLabel,
      outer.line,
      current.line,
      outer,
      rangeHideThreshold
    );
    parts.push({
      text: outerSegment ? ` <= ${outerSegment}` : ' <=',
      target: { line: outer.line, col: 0 },
      title: outer.display,
    });
  }

  return parts;
}

function textOfParts(parts: HintPart[]): string {
  return parts.map((part) => part.text).join('');
}

function segment(
  showRange: boolean,
  showLabel: boolean,
  fromLine: number,
  toLine: number,
  directive: DirectiveToken,
  rangeHideThreshold: number
): string {
  const bits: string[] = [];
  if (shouldShowRange(showRange, rangeHideThreshold, fromLine, toLine)) {
    bits.push(`:${fromLine + 1}-${toLine + 1}`);
  }
  if (showLabel) bits.push(directive.display);
  return bits.join(' ');
}

/**
 * Label shown for an opening bracket: the trimmed text before the bracket on
 * its own line. When the bracket is alone on its line (a brace on its own
 * line), fall back to the previous line's trimmed text.
 */
export function labelFor(lines: string[], open: BracketToken): string {
  const lineText = lines[open.line] ?? '';
  const before = lineText.slice(0, open.col).trim();
  if (before) return before;
  return open.line > 0 ? (lines[open.line - 1] ?? '').trim() : '';
}

function selectCursorPairs(result: BracketMatchResult, cursorOffset: number): BracketPair[] {
  if (cursorOffset < 0) return [];
  for (const delta of [0, -1, 1]) {
    const at = cursorOffset + delta;
    const byOpen = result.byOpenOffset.get(at);
    if (byOpen) return [byOpen];
    const byClose = result.byCloseOffset.get(at);
    if (byClose) return [byClose];
  }
  return [];
}

function lineAtOffset(text: string, offset: number): number {
  if (offset < 0) return -1;
  let line = 0;
  const end = Math.min(offset, text.length);
  for (let i = 0; i < end; i++) {
    if (text.charCodeAt(i) === 10) line++;
  }
  return line;
}

function splitLines(text: string): string[] {
  return text.split(/\r?\n/);
}

/** `0` disables the threshold, so the range is always shown. */
function shouldShowRange(
  showRange: boolean,
  rangeHideThreshold: number,
  fromLine: number,
  toLine: number
): boolean {
  if (!showRange) return false;
  if (rangeHideThreshold > 0 && toLine - fromLine <= rangeHideThreshold) return false;
  return true;
}

function branchHintIsInactive(
  branchActive: ((line: number) => boolean | undefined) | undefined,
  previousLine: number,
  currentLine: number
): boolean {
  if (!branchActive) return false;
  return branchActive(previousLine) === false && branchActive(currentLine) === false;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
