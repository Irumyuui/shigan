import { BracketToken, CfgAttributeToken, ScanResult } from '../../types';
import { matchBrackets } from '../brackets';

export interface CfgItemSpan {
  /** Line of the FIRST cfg attribute of the merged group. */
  attrLine: number;
  /** Every cfg attribute line of the group, source order (one clickable segment each). */
  attrLines: readonly number[];
  /** Each attribute's normalized display, source order. */
  displays: readonly string[];
  /** Inclusive end line of the gated item. */
  endLine: number;
}

/** How far past the first attribute line a gated item (and its body) may start/end. */
const MAX_LOOKAHEAD = 300;

/** A brace-opened line that is a macro body (macro_rules! / declarative macro). */
const MACRO_BODY_LINE = /^\s*(?:pub\s+)?(?:macro_rules\s*!|macro\b)/;

/** Optional item modifier chain, then one of Rust's item keywords. */
const ITEM_HEAD =
  /^(?:(?:pub(?:\s*\([^)]*\))?|async|unsafe|extern(?:\s+"[^"]*")?|const|default)\s+)*(fn|struct|enum|union|trait|impl|mod|macro_rules|macro|type|static|use|const)\b/;

/**
 * Pairs outer `#[cfg(...)]` attributes with the item they gate.
 *
 * Only `cfg` (not `cfg_attr`), only outer attributes, only attributes that are
 * the first non-whitespace token on their own line, and never inside a
 * `macro_rules!`/`macro` body. Consecutive attributes (including non-cfg ones)
 * between the gate and its item are merged into a single span.
 *
 * An item is only reported when its body's first depth-equal `{` (and its
 * matching `}`) are found within 300 lines — so semicolon-terminated items
 * (`use`, `type`, `static`, `const`, unit/tuple structs, `mod m;`) produce no
 * span by design. Never throws.
 */
export function pairCfgItems(scanned: ScanResult, lines: readonly string[]): CfgItemSpan[] {
  const cfgs = (scanned.cfgs ?? []).filter(
    (attr) =>
      attr.name === 'cfg' &&
      !attr.inner &&
      isFirstOnLine(attr, lines) &&
      !isInMacroBody(scanned.brackets, attr.offset, lines)
  );
  if (cfgs.length === 0) return [];

  const cfgByPos = new Map<string, CfgAttributeToken>();
  for (const attr of scanned.cfgs ?? []) {
    if (attr.name === 'cfg' && !attr.inner) cfgByPos.set(`${attr.line}:${attr.col}`, attr);
  }

  const pairs = matchBrackets(scanned.brackets);
  const consumed = new Set<number>();
  const spans: CfgItemSpan[] = [];

  for (const attr of cfgs) {
    if (consumed.has(attr.line)) continue;
    const span = pairOne(attr, cfgByPos, consumed, scanned.brackets, pairs.byOpenOffset, lines);
    if (span) spans.push(span);
  }

  spans.sort((a, b) => a.attrLine - b.attrLine);
  return spans;
}

function pairOne(
  first: CfgAttributeToken,
  cfgByPos: Map<string, CfgAttributeToken>,
  consumed: Set<number>,
  brackets: readonly BracketToken[],
  byOpenOffset: Map<number, { open: BracketToken; close: BracketToken }>,
  lines: readonly string[]
): CfgItemSpan | undefined {
  const limit = first.line + MAX_LOOKAHEAD;
  const merged: CfgAttributeToken[] = [];
  let line = first.line;
  let col = first.col;
  let itemLine = -1;
  let itemHead = '';

  // Walk the attribute group one attribute at a time, looking at each
  // attribute's own tail (which may hold another attribute OR the item head).
  for (;;) {
    const attribute = cfgByPos.get(`${line}:${col}`);
    if (attribute) merged.push(attribute);

    const close = findAttributeClose(lines, line, col);
    if (!close) return undefined;

    const tail = (lines[close.line] ?? '').slice(close.col);
    if (isBlankOrComment(tail)) {
      // Nothing usable on this line: take the next non-blank/non-comment line.
      let next = close.line + 1;
      while (next <= limit && isBlankOrComment(lines[next] ?? '')) next++;
      if (next > limit) return undefined;

      const text = lines[next] ?? '';
      const hash = attributeStartColumn(text);
      if (hash >= 0) {
        if (next < line || (next === line && hash <= col)) return undefined;
        line = next;
        col = hash;
        continue;
      }

      itemLine = next;
      itemHead = text.trim();
      break;
    }

    // A tail that starts another attribute is skipped/merged and re-examined.
    const hash = tail.indexOf('#');
    if (hash >= 0 && isAttributeStart(tail.trim())) {
      const nextCol = close.col + hash;
      if (nextCol <= col) return undefined;
      line = close.line;
      col = nextCol;
      continue;
    }

    itemLine = close.line;
    itemHead = tail.trim();
    break;
  }

  if (itemLine < 0) return undefined;

  // Claim every attribute of the group, found or not, so none is processed twice.
  for (const attribute of merged) consumed.add(attribute.line);

  if (!ITEM_HEAD.test(itemHead)) return undefined;

  const depth = braceDepthBefore(brackets, first.offset);

  // First `{` at the item's own depth, on/after the item line and in the window.
  let open: BracketToken | undefined;
  let currentDepth = 0;
  for (const token of brackets) {
    if (token.char === '{') {
      if (currentDepth === depth && token.line >= itemLine && token.line <= limit) {
        open = token;
        break;
      }
      currentDepth++;
    } else if (token.char === '}') {
      currentDepth--;
    }
  }
  if (!open) return undefined;

  // A top-level `;` before the opening brace ends a semicolon-terminated item
  // (`use a::b;`, `const X: i32 = 1;`). The guard is depth-aware so a `;` inside
  // `(...)`/`[...]` (e.g. `[u8; 4]`, `[u8; N]`) does not disqualify the item.
  if (hasTopLevelSemicolon(lines, itemLine, open)) return undefined;

  const pair = byOpenOffset.get(open.offset);
  if (!pair || pair.close.line > limit) return undefined;

  return {
    attrLine: first.line,
    attrLines: merged.map((attribute) => attribute.line),
    displays: merged.map((attribute) => attribute.display),
    endLine: pair.close.line,
  };
}

/**
 * True when a `;` sits at bracket depth 0 anywhere from `itemLine` up to (but not
 * including) the opening brace `open`. `(`/`[`/`{` raise the depth and their
 * closers lower it, so `fn f(a: [u8; 4]) {}` and `fn f<const N: usize>() {}`
 * stay guarded as items while `const X: i32 = 1;` does not.
 */
function hasTopLevelSemicolon(
  lines: readonly string[],
  itemLine: number,
  open: BracketToken
): boolean {
  let depth = 0;
  for (let line = itemLine; line <= open.line; line++) {
    const text = lines[line] ?? '';
    const end = line === open.line ? open.col : text.length;
    for (let index = 0; index < end; index++) {
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
    line++;
    col = 0;
  }

  return undefined;
}

/** True when only whitespace precedes the attribute on its line. */
function isFirstOnLine(attr: CfgAttributeToken, lines: readonly string[]): boolean {
  return (lines[attr.line] ?? '').slice(0, attr.col).trim() === '';
}

/** True for `#[` / `#![` at the start of an already-trimmed string. */
function isAttributeStart(trimmed: string): boolean {
  return trimmed.startsWith('#[') || trimmed.startsWith('#![');
}

/** Column of the `#` when `text` starts (after whitespace) with an attribute, else -1. */
function attributeStartColumn(text: string): number {
  const trimmed = text.trimStart();
  return isAttributeStart(trimmed) ? text.length - trimmed.length : -1;
}

/**
 * True when a line has no code: blank, a `//` comment, or a `/*` block comment.
 * A `*` prefix is deliberately NOT a comment here (`*p += 1;` is code); the
 * lexer already knows the interior of a real block comment.
 */
function isBlankOrComment(text: string): boolean {
  const trimmed = text.trim();
  return trimmed === '' || isCommentLine(trimmed);
}

function isCommentLine(trimmed: string): boolean {
  return trimmed.startsWith('//') || trimmed.startsWith('/*');
}

/** Brace depth (from the start of the file) just before `offset`. */
function braceDepthBefore(brackets: readonly BracketToken[], offset: number): number {
  let depth = 0;
  for (const token of brackets) {
    if (token.offset >= offset) break;
    if (token.char === '{') depth++;
    else if (token.char === '}') depth--;
  }
  return depth;
}

/**
 * True when ANY unmatched `{` before `offset` was opened on a
 * `macro_rules!`/`macro` body line. Checking the whole ancestor chain (not
 * just the innermost brace) matters because an arm body like `() => {` opens
 * its own brace inside the macro's.
 */
function isInMacroBody(
  brackets: readonly BracketToken[],
  offset: number,
  lines: readonly string[]
): boolean {
  const stack: BracketToken[] = [];
  for (const token of brackets) {
    if (token.offset >= offset) break;
    if (token.char === '{') stack.push(token);
    else if (token.char === '}') stack.pop();
  }

  return stack.some((brace) => MACRO_BODY_LINE.test(lines[brace.line] ?? ''));
}
