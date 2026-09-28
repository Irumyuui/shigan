import { BracketToken, CfgAttributeToken, ScanResult } from '../../types';
import { matchBrackets } from '../brackets';

export interface CfgItemSpan {
  /** Line of the FIRST cfg attribute of the merged group. */
  attrLine: number;
  /** Every cfg attribute line of the group, source order (one clickable segment each). */
  attrLines: readonly number[];
  /**
   * Every line of the item's leading attribute/doc-comment block from its first
   * such line through the LAST cfg attribute line (always includes `attrLines`).
   * rust-analyzer's inactive-code range starts at the item's first attribute, so
   * this is what an explicit `shigan.rust.cfg` decision suppresses.
   */
  headLines: readonly number[];
  /** Each attribute's normalized display, source order. */
  displays: readonly string[];
  /** Inclusive end line of the gated item. */
  endLine: number;
}

/** How far past the first attribute line a gated item (and its body) may start/end. */
const MAX_LOOKAHEAD = 300;

/** Optional item modifier chain, then one of Rust's item keywords. */
const ITEM_HEAD =
  /^(?:(?:pub(?:\s*\([^)]*\))?|async|unsafe|extern(?:\s+"[^"]*")?|const|default)\s+)*(fn|struct|enum|union|trait|impl|mod|macro_rules|macro|type|static|use|const|extern)\b/;

const OPENERS = new Set(['(', '[', '{']);

/**
 * A macro definition's head at the END of a line: `macro_rules! name` or
 * `macro name`, optionally behind `pub`, preceded by a non-word boundary so a
 * path like `my_macro m` cannot match. The delimiter that follows (possibly on
 * a later line) opens the macro body.
 */
const MACRO_HEAD_TAIL =
  /(?:^|[^\w])(?:pub(?:\s*\([^)]*\))?\s+)?(?:macro_rules\s*!|macro(?![A-Za-z0-9_]))\s+[A-Za-z_][A-Za-z0-9_]*\s*$/;

/** A line that starts an attribute or a doc comment (used for `headLines`). */
const HEAD_LINE_START = /^(?:#!?\[|\/\/\/|\/\/!|\/\*!|\/\*\*)/;

/**
 * Pairs outer `#[cfg(...)]` attributes with the item they gate.
 *
 * Only `cfg` (not `cfg_attr`), only outer attributes, only leading attributes
 * (the first non-whitespace token on their line, or the start of a later group
 * on the same line), and never inside a `macro_rules!`/`macro` body — the body
 * delimiter is found structurally, so it may be `(`/`[`/`{` and may sit on a
 * different line than the macro head. Consecutive attributes (including non-cfg
 * ones) between the gate and its item are merged into a single span.
 *
 * An item is only reported when its body's first depth-equal `{` (and its
 * matching `}`) are found within 300 lines — so semicolon-terminated items
 * (`use`, `type`, `static`, `const`, unit/tuple structs, `mod m;`) produce no
 * span by design. Never throws.
 *
 * Performance: a single line-indexed pass over the brackets (see
 * {@link BracketIndex}) replaces the former per-attribute rescan of the whole
 * file, so this is linear in the document size rather than O(cfgs × brackets).
 */
export function pairCfgItems(scanned: ScanResult, lines: readonly string[]): CfgItemSpan[] {
  const all = scanned.cfgs ?? [];
  if (all.length === 0) return [];

  const brackets = scanned.brackets;
  const pairs = matchBrackets(brackets);
  const index = buildBracketIndex(brackets, lines, pairs.byOpenOffset);

  const cfgs = all.filter(
    (attr) =>
      attr.name === 'cfg' &&
      !attr.inner &&
      isLeadingAttribute(attr, lines) &&
      index.macroCountBefore[lowerBound(brackets, attr.offset)] === 0
  );
  if (cfgs.length === 0) return [];

  const cfgByPos = new Map<string, CfgAttributeToken>();
  for (const attr of all) {
    if (attr.name === 'cfg' && !attr.inner) cfgByPos.set(attrKey(attr), attr);
  }

  const consumed = new Set<string>();
  const spans: CfgItemSpan[] = [];

  for (const attr of cfgs) {
    if (consumed.has(attrKey(attr))) continue;
    const span = pairOne(attr, cfgByPos, consumed, brackets, index, pairs.byOpenOffset, lines);
    if (span) spans.push(span);
  }

  spans.sort((a, b) => a.attrLine - b.attrLine);
  return spans;
}

function pairOne(
  first: CfgAttributeToken,
  cfgByPos: Map<string, CfgAttributeToken>,
  consumed: Set<string>,
  brackets: readonly BracketToken[],
  index: BracketIndex,
  byOpenOffset: Map<number, { open: BracketToken; close: BracketToken }>,
  lines: readonly string[]
): CfgItemSpan | undefined {
  const limit = Math.min(first.line + MAX_LOOKAHEAD, lines.length - 1);
  const merged: CfgAttributeToken[] = [];
  let line = first.line;
  let col = first.col;
  let itemLine = -1;
  let itemCol = 0;
  let itemHead = '';

  // Walk the attribute group one attribute at a time; each attribute's tail can
  // hold another attribute OR the item head (comment-aware).
  for (;;) {
    const attribute = cfgByPos.get(`${line}:${col}`);
    if (attribute) merged.push(attribute);

    const close = findAttributeClose(lines, line, col);
    if (!close) return undefined;

    const code = scanAfterAttribute(lines, close.line, close.col, limit);
    if (!code) return undefined;

    if (isAttributeStart(code.text)) {
      if (code.line < line || (code.line === line && code.col <= col)) return undefined;
      line = code.line;
      col = code.col;
      continue;
    }

    itemLine = code.line;
    itemCol = code.col;
    itemHead = code.text.trim();
    break;
  }

  if (itemLine < 0) return undefined;

  // Claim every attribute of the group by POSITION, so a second cfg group that
  // shares a line (`#[cfg(a)] fn f() {} #[cfg(b)] …`) is still processed and a
  // rejected semicolon item does not consume the line for its neighbour.
  for (const attribute of merged) consumed.add(attrKey(attribute));

  if (!ITEM_HEAD.test(itemHead)) return undefined;

  const depth = index.braceDepthBefore[lowerBound(brackets, first.offset)];
  const candidates = index.opensByDepth.get(depth);
  if (!candidates) return undefined;

  // First `{` at the item's own depth on/after the item's start, within the
  // window. Same-line items need the column bound too, otherwise the preceding
  // `{` of an earlier same-line item is picked.
  let low = 0;
  let high = candidates.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    const brace = brackets[candidates[mid]];
    if (brace.line < itemLine || (brace.line === itemLine && brace.col < itemCol)) low = mid + 1;
    else high = mid;
  }

  for (let k = low; k < candidates.length; k++) {
    const open = brackets[candidates[k]];
    if (open.line > limit) break;

    // A `{` inside an unclosed generic argument list (`Bar<{ N }>`) is not the
    // item body; keep looking (the semicolon guard then rejects the item).
    if (unclosedAngleDepth(lines, itemLine, itemCol, open) > 0) continue;

    // A top-level `;` before the opening brace ends a semicolon-terminated item
    // (`use a::b;`, `const X: i32 = 1;`; the depth guard keeps `[u8; N]`).
    if (hasTopLevelSemicolon(lines, itemLine, itemCol, open)) return undefined;

    const pair = byOpenOffset.get(open.offset);
    if (!pair || pair.close.line > limit) return undefined;

    const attrLines = merged.map((attribute) => attribute.line);
    const lastCfg = attrLines[attrLines.length - 1];
    const headStart = leadingHeadStart(lines, first.line);
    const headLines: number[] = [];
    for (let head = headStart; head <= lastCfg; head++) headLines.push(head);

    return {
      attrLine: first.line,
      attrLines,
      headLines,
      displays: merged.map((attribute) => attribute.display),
      endLine: pair.close.line,
    };
  }

  return undefined;
}

/**
 * True when a `;` sits at bracket depth 0 anywhere from the item's start
 * (`itemLine`/`itemCol`) up to (but not including) the opening brace `open`.
 * `(`/`[`/`{` raise the depth and their closers lower it, so `fn f(a: [u8; 4]) {}`
 * and `fn f<const N: usize>() {}` stay guarded as items while
 * `const X: i32 = 1;` does not. Starting at `itemCol` keeps a preceding
 * same-line item (`use a::b; #[cfg(x)] fn f() {}`) from rejecting its neighbour.
 */
function hasTopLevelSemicolon(
  lines: readonly string[],
  itemLine: number,
  itemCol: number,
  open: BracketToken
): boolean {
  let depth = 0;
  for (let line = itemLine; line <= open.line; line++) {
    const text = lines[line] ?? '';
    const end = line === open.line ? open.col : text.length;
    const start = line === itemLine ? itemCol : 0;
    for (let index = start; index < end; index++) {
      const ch = text[index];
      if (ch === '(' || ch === '[' || ch === '{') depth++;
      else if (ch === ')' || ch === ']' || ch === '}') {
        if (depth > 0) depth--;
      } else if (ch === ';' && depth === 0) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Position just after the `]` that closes the attribute starting at
 * `(startLine, startCol)` on its `#` (which may span several lines). Strings are
 * skipped so a `]` inside a cfg value cannot close it early.
 */
function findAttributeClose(
  lines: readonly string[],
  startLine: number,
  startCol: number
): { line: number; col: number } | undefined {
  let line = startLine;
  let col = startCol;
  let depth = 0;
  let opened = false;
  let jumped = false;

  while (line < lines.length) {
    const text = lines[line] ?? '';
    while (col < text.length) {
      const ch = text[col];
      if (ch === '"') {
        col++;
        while (col < text.length && text[col] !== '"') {
          if (text[col] === '\\') col++;
          col++;
        }
        if (col < text.length) col++; // step past the closing quote
        continue;
      }
      if (ch === '/' && text[col + 1] === '*') {
        // A bracket inside a block comment must not close the attribute early
        // (`#[cfg(/* [ */ unix)]`), so hop over the whole comment.
        const end = skipBlockComment(lines, line, col, lines.length - 1);
        if (!end) return undefined;
        line = end.line;
        col = end.col;
        jumped = true;
        break;
      }
      if (ch === '/' && text[col + 1] === '/') {
        // A `]` inside a line comment must not close the attribute either
        // (`#[cfg(all(unix, // note ] here\n    windows))]`): jump to the
        // newline and keep scanning on the next line.
        col = text.length;
        continue;
      }
      if (ch === '[') {
        depth++;
        opened = true;
        col++;
        continue;
      }
      if (ch === ']') {
        depth--;
        col++;
        if (opened && depth === 0) return { line, col };
        continue;
      }
      col++;
    }
    if (jumped) {
      jumped = false;
      continue;
    }
    line++;
    col = 0;
  }

  return undefined;
}

/**
 * The next code position after `(line, col)`, skipping whitespace, line
 * comments and (possibly multi-line, nested) block comments. Returns the line,
 * column of the first code character and the untrimmed rest of that line from
 * `col`; undefined when only comments/blanks remain within `limit`.
 *
 * This is what keeps a multi-line block comment between a `#[cfg]` and its item
 * from being mistaken for the item head — without a `*`-prefix heuristic (a
 * genuine `*p += 1;` line stays code).
 */
function scanAfterAttribute(
  lines: readonly string[],
  line: number,
  col: number,
  limit: number
): { line: number; col: number; text: string } | undefined {
  while (line <= limit) {
    const source = lines[line] ?? '';
    while (col < source.length && (source[col] === ' ' || source[col] === '\t')) col++;

    if (col >= source.length) {
      line++;
      col = 0;
      continue;
    }

    if (source[col] === '/' && source[col + 1] === '/') {
      line++;
      col = 0;
      continue;
    }

    if (source[col] === '/' && source[col + 1] === '*') {
      const end = skipBlockComment(lines, line, col, limit);
      if (!end) return undefined;
      line = end.line;
      col = end.col;
      continue;
    }

    return { line, col, text: source.slice(col) };
  }
  return undefined;
}

/**
 * Position just past the closer that ends the (nested) block comment opening at
 * `(line, col)`, searching up to `limit`; undefined when unterminated.
 */
function skipBlockComment(
  lines: readonly string[],
  line: number,
  col: number,
  limit: number
): { line: number; col: number } | undefined {
  let depth = 1;
  let current = line;
  let index = col + 2;

  while (current <= limit) {
    const text = lines[current] ?? '';
    while (index < text.length) {
      if (text[index] === '/' && text[index + 1] === '*') {
        depth++;
        index += 2;
        continue;
      }
      if (text[index] === '*' && text[index + 1] === '/') {
        depth--;
        index += 2;
        if (depth === 0) return { line: current, col: index };
        continue;
      }
      index++;
    }
    current++;
    index = 0;
  }

  return undefined;
}

/**
 * Nesting depth of `<`/`>` from the item head up to (but not including) `open`,
 * skipping strings and comments. `>` only lowers a positive depth, so `->` and
 * comparison operators stay harmless. A positive result means `open` sits inside
 * an unclosed generic argument list (e.g. `Bar<{ N }>`), not an item body.
 */
function unclosedAngleDepth(
  lines: readonly string[],
  fromLine: number,
  fromCol: number,
  open: BracketToken
): number {
  let depth = 0;
  let line = fromLine;
  let col = fromCol;

  while (line <= open.line) {
    const text = lines[line] ?? '';
    const end = line === open.line ? open.col : text.length;
    let hopped = false;

    while (col < end) {
      const ch = text[col];
      if (ch === '"') {
        col = skipStringInLine(text, col);
        continue;
      }
      if (ch === '/' && text[col + 1] === '/') {
        col = end;
        break;
      }
      if (ch === '/' && text[col + 1] === '*') {
        const stop = skipBlockComment(lines, line, col, open.line);
        if (!stop) return depth;
        line = stop.line;
        col = stop.col;
        hopped = true;
        break;
      }
      if (ch === '<') depth++;
      else if (ch === '>' && depth > 0) depth--;
      col++;
    }

    if (hopped) continue;
    line++;
    col = 0;
  }

  return depth;
}

/** End column of the `"…"` string starting at `col` (or end of line when unterminated). */
function skipStringInLine(text: string, col: number): number {
  let index = col + 1;
  while (index < text.length) {
    if (text[index] === '\\') {
      index += 2;
      continue;
    }
    if (text[index] === '"') return index + 1;
    index++;
  }
  return text.length;
}

/**
 * True when the attribute is a leading attribute: only whitespace precedes it on
 * its line, or it directly follows a complete item on the same line
 * (`#[cfg(a)] fn f() {} #[cfg(b)] fn g() {}`). An attribute nested in brackets
 * — a parameter, struct field or match arm — is not leading.
 */
function isLeadingAttribute(attr: CfgAttributeToken, lines: readonly string[]): boolean {
  const prefix = (lines[attr.line] ?? '').slice(0, attr.col);
  if (prefix.trim() === '') return true;

  let depth = 0;
  let lastCode = '';
  for (const ch of prefix) {
    if (ch === '(' || ch === '[' || ch === '{') {
      depth++;
      lastCode = ch;
    } else if (ch === ')' || ch === ']' || ch === '}') {
      if (depth > 0) depth--;
      lastCode = ch;
    } else if (ch !== ' ' && ch !== '\t') {
      lastCode = ch;
    }
  }
  return depth === 0 && (lastCode === '}' || lastCode === ';' || lastCode === ']');
}

/** True for `#[` / `#![` at the start of an already-trimmed string. */
function isAttributeStart(trimmed: string): boolean {
  return trimmed.startsWith('#[') || trimmed.startsWith('#![');
}

/** Stable key for one attribute token (line + column; line alone is not unique). */
function attrKey(attr: CfgAttributeToken): string {
  return `${attr.line}:${attr.col}`;
}

/**
 * True when the bracket token at `tokenIndex` opens a macro definition's body:
 * the code ending at the token is a `macro_rules!` / `macro` head (same line, or
 * the nearest preceding non-blank, non-comment, non-attribute line). This makes
 * the exclusion independent of where the delimiter sits.
 */
function isMacroBodyOpener(
  brackets: readonly BracketToken[],
  tokenIndex: number,
  lines: readonly string[]
): boolean {
  const token = brackets[tokenIndex];
  if (!OPENERS.has(token.char)) return false;

  const sameLine = (lines[token.line] ?? '').slice(0, token.col).trimEnd();
  if (MACRO_HEAD_TAIL.test(sameLine)) return true;

  for (let line = token.line - 1; line >= 0; line--) {
    const trimmed = (lines[line] ?? '').trim();
    if (trimmed === '') continue;
    if (
      trimmed.startsWith('//') ||
      trimmed.startsWith('*') ||
      trimmed.startsWith('/*') ||
      trimmed.startsWith('#[') ||
      trimmed.startsWith('#![')
    ) {
      continue;
    }
    return MACRO_HEAD_TAIL.test(trimmed);
  }
  return false;
}

/**
 * Start line of the item's leading attribute/doc-comment block, walking up from
 * `firstLine`. Continuation lines of a multi-line attribute or block doc comment
 * are absorbed too, but only when the walk actually reaches an attribute/doc
 * start, so unrelated code above is never pulled in.
 */
function leadingHeadStart(lines: readonly string[], firstLine: number): number {
  let start = firstLine;
  for (let line = firstLine - 1; line >= 0; line--) {
    const trimmed = (lines[line] ?? '').trim();
    if (trimmed === '') break;
    if (HEAD_LINE_START.test(trimmed)) {
      start = line;
      continue;
    }
    if (isHeadContinuation(lines, line, firstLine)) {
      start = line;
      continue;
    }
    break;
  }

  if (start !== firstLine && !HEAD_LINE_START.test((lines[start] ?? '').trim())) {
    return firstLine;
  }
  return start;
}

/**
 * True when `line` is inside a multi-line attribute or block doc comment that is
 * still open in the region `[line, firstLine)`: more attribute `]` than `[`, or
 * more block-comment `*/` than `/*`. Walking the region is cheap (leading blocks
 * are short).
 */
function isHeadContinuation(
  lines: readonly string[],
  line: number,
  firstLine: number
): boolean {
  let attr = 0;
  let block = 0;
  for (let l = firstLine - 1; l >= line; l--) {
    const text = lines[l] ?? '';
    attr += countOccurrences(text, ']') - countOccurrences(text, '[');
    block += countOccurrences(text, '*/') - countOccurrences(text, '/*');
  }
  return attr > 0 || block > 0;
}

function countOccurrences(text: string, needle: string): number {
  let count = 0;
  let from = 0;
  for (;;) {
    const at = text.indexOf(needle, from);
    if (at < 0) return count;
    count++;
    from = at + needle.length;
  }
}

/**
 * A single pass over the brackets that answers the three per-attribute queries
 * the pairing used to rescan the whole file for: brace depth before an offset,
 * whether the offset nests in a macro body, and the `{`s grouped by the depth
 * they open at.
 */
interface BracketIndex {
  /** Brace depth immediately before `brackets[i]`; `brackets.length` is the final depth. */
  readonly braceDepthBefore: Int32Array;
  /** Macro-body braces open immediately before `brackets[i]`. */
  readonly macroCountBefore: Int32Array;
  /** Bracket indices of every `{`, grouped by the depth it opens at (ascending). */
  readonly opensByDepth: Map<number, number[]>;
}

function buildBracketIndex(
  brackets: readonly BracketToken[],
  lines: readonly string[],
  byOpenOffset: Map<number, { open: BracketToken; close: BracketToken }>
): BracketIndex {
  const count = brackets.length;
  const braceDepthBefore = new Int32Array(count + 1);
  const macroCountBefore = new Int32Array(count + 1);
  const opensByDepth = new Map<number, number[]>();

  // A macro body's delimiter may be `(`, `[` or `{`, and may not share a line
  // with the `macro_rules!`/`macro` head; detect the opener structurally.
  const macroOpenerOffsets = new Set<number>();
  for (let i = 0; i < count; i++) {
    if (!isMacroBodyOpener(brackets, i, lines)) continue;
    if (byOpenOffset.has(brackets[i].offset)) macroOpenerOffsets.add(brackets[i].offset);
  }

  const macroStack: boolean[] = [];
  let depth = 0;
  let macroCount = 0;

  for (let i = 0; i < count; i++) {
    braceDepthBefore[i] = depth;
    macroCountBefore[i] = macroCount;
    const token = brackets[i];

    if (OPENERS.has(token.char)) {
      const macro = macroOpenerOffsets.has(token.offset);
      macroStack.push(macro);
      if (macro) macroCount++;
      if (token.char === '{') {
        const bucket = opensByDepth.get(depth);
        if (bucket) bucket.push(i);
        else opensByDepth.set(depth, [i]);
        depth++;
      }
    } else {
      if (token.char === '}') depth--;
      // The matched opener says whether this closer closes a macro body.
      if (macroStack.pop()) macroCount--;
    }
  }

  braceDepthBefore[count] = depth;
  macroCountBefore[count] = macroCount;
  return { braceDepthBefore, macroCountBefore, opensByDepth };
}

/** Index of the first bracket whose offset is >= `offset` (lower bound). */
function lowerBound(brackets: readonly BracketToken[], offset: number): number {
  let low = 0;
  let high = brackets.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (brackets[mid].offset < offset) low = mid + 1;
    else high = mid;
  }
  return low;
}
