import { ConditionalModel, cursorActivates } from './conditionals';
import { segment, shouldShowRange, textOfParts } from './hint-parts';
import { scan } from './lexer/tokenizer';
import { BracketMatchResult, BracketPair, matchBrackets } from './match/brackets';
import { cConditionals } from './match/c-preprocessor';
import { BracketToken, Hint, HintPart, ScanResult, Trigger } from './types';

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
  /**
   * Pre-computed conditional model. When omitted the renderer builds one from
   * `scanned.directives` using the legacy `branchActive`/`blockActive`
   * callbacks; when provided, those callbacks are ignored for macros.
   */
  conditionals?: ConditionalModel;
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
    const model =
      options.conditionals ??
      cConditionals(scanned.directives, {
        branchActive: options.branchActive,
        blockActive: options.blockActive,
      });
    const cursorLine =
      trigger === 'cursor' ? lineAtOffset(text, options.cursorOffset ?? -1) : -1;

    for (const entry of model.hints) {
      if (trigger === 'cursor' && !cursorActivates(entry, cursorLine)) continue;

      // `always` means always for directives: the hint is shown even when the
      // branch it refers to is disabled (it is flagged `inactive` instead).
      // `skipInactiveDirectives` is the counterpart of `skipInactiveBrackets`.
      if (entry.inactive && options.skipInactiveDirectives === true) continue;

      const parts: HintPart[] = entry.segments.map((seg) => {
        const body = segment(
          showRange,
          showLabel,
          seg.fromLine,
          seg.toLine,
          seg.display,
          rangeHideThreshold
        );
        // An empty body renders as the bare marker, without a trailing space.
        const text = body ? `${seg.marker}${body}` : seg.marker.trimEnd();
        return { text, target: seg.target, title: seg.display };
      });

      const hint: Hint = {
        line: entry.line,
        text: textOfParts(parts),
        parts,
        kind: entry.kind,
        target: parts[0]?.target,
      };
      if (entry.inactive && markInactive) hint.inactive = true;
      hints.push(hint);
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

/** A line that continues the previous one (base list, `where`, chain). */
const CONTINUATION_START = /^(?:[:,.](?=\s|$)|->|where\b)/;
/** A previous line that leaves the next one a continuation. */
const CONTINUATION_END = /[,:(<&|.]$|->$/;
/** A type declaration, optionally preceded by modifiers. */
const TYPE_DECLARATION = /^(?:[\w@]+\s+)*(class|struct|interface|enum|namespace|record|union)\b/;
/** How far the continuation walk may climb before giving up. */
const MAX_CONTINUATION_STEPS = 16;

/**
 * Label shown for an opening bracket: the trimmed text before the bracket on
 * its own line. When the brace is alone on its line, walk back over a wrapped
 * declaration (base list / `where` clause) and return the type declaration
 * when one is found; otherwise fall back to the previous line's trimmed text.
 */
export function labelFor(lines: string[], open: BracketToken): string {
  const lineText = lines[open.line] ?? '';
  const before = lineText.slice(0, open.col).trim();
  if (before) return before;
  if (open.line === 0) return '';

  const fallback = (lines[open.line - 1] ?? '').trim();
  const candidate = continuationStart(lines, open.line - 1);
  return TYPE_DECLARATION.test(candidate) ? candidate : fallback;
}

/**
 * Walks upward from `start` over continuation lines and returns the first
 * non-continuation line's trimmed text (bounded by `MAX_CONTINUATION_STEPS`
 * and line 0).
 */
function continuationStart(lines: string[], start: number): string {
  let index = start;
  let steps = 0;

  while (index > 0 && steps < MAX_CONTINUATION_STEPS) {
    const cur = (lines[index] ?? '').trim();
    const prev = (lines[index - 1] ?? '').trim();
    const continues = CONTINUATION_START.test(cur) || CONTINUATION_END.test(prev);
    if (!continues) break;
    index--;
    steps++;
  }

  return (lines[index] ?? '').trim();
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

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
