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
 * `macro name` (the name may be a raw identifier, `r#name`), optionally behind
 * `pub`, preceded by a non-word boundary so a path like `my_macro m` cannot
 * match. The delimiter that follows (possibly on a later line) opens the macro
 * body.
 */
const MACRO_HEAD_TAIL =
  /(?:^|[^\w])(?:pub(?:\s*\([^)]*\))?\s+)?(?:macro_rules\s*!|macro(?![A-Za-z0-9_]))\s+(?:r#)?[A-Za-z_][A-Za-z0-9_]*\s*$/;

/**
 * A macro head whose name sits on a LATER line: `macro_rules!` / `macro` alone
 * at the end of a line (optionally behind `pub`). The following name line
 * continues the head, and the delimiter after that opens the body.
 */
const MACRO_KEYWORD_ONLY =
  /^(?:pub(?:\s*\([^)]*\))?\s+)?(?:macro_rules\s*!|macro(?![A-Za-z0-9_]))\s*$/;

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
 * file, and macro-body detection is a comment-masked forward pass indexed per
 * line (see {@link maskComments} / {@link nearestMacroHeadBefore}) rather than a
 * backward walk from each opener. Both are linear in the document size, so a
 * one-line-per-item file with `#[…]`-prefixed lines no longer degrades to
 * O(cfgs × lines).
 */
export function pairCfgItems(scanned: ScanResult, lines: readonly string[]): CfgItemSpan[] {
  const all = scanned.cfgs ?? [];
  if (all.length === 0) return [];

  const brackets = scanned.brackets;
  const pairs = matchBrackets(brackets);
  const code = maskComments(lines);
  // `codeOnly` additionally blanks `#[…]` spans, so a leading-block continuation
  // can be recognised without counting raw brackets that belong to a prior item.
  const codeOnly = maskAttributeSpans(code);
  const index = buildBracketIndex(brackets, code, pairs.byOpenOffset);

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
    const span = pairOne(attr, cfgByPos, consumed, brackets, index, pairs.byOpenOffset, lines, codeOnly);
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
  lines: readonly string[],
  codeOnly: readonly string[]
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
    const headStart = leadingHeadStart(lines, codeOnly, first.line);
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
 * True when `token` opens a macro definition's body: the comment-masked code
 * ending at the token is a `macro_rules!` / `macro` head (same line), or the
 * nearest preceding non-transparent line is — blank, comment-only, doc-comment
 * and attribute-only lines are transparent. Backed by the forward-pass
 * {@link maskComments} / {@link nearestMacroHeadBefore} indexes, so this is O(1)
 * per opener and the whole scan stays linear even when the openers sit on lines
 * that all start with `#[`.
 */
function isMacroBodyOpener(
  token: BracketToken,
  code: readonly string[],
  nearestHead: readonly boolean[]
): boolean {
  if (!OPENERS.has(token.char)) return false;

  const sameLine = (code[token.line] ?? '').slice(0, token.col).trimEnd();
  if (MACRO_HEAD_TAIL.test(sameLine)) return true;

  return nearestHead[token.line] ?? false;
}

/**
 * Comment-masked copy of `lines`: line/block comments (and string/raw-string
 * bodies) are replaced by spaces while every line keeps its length and the line
 * count stays identical, so a bracket token's `col` still indexes the masked
 * line. This is what stops a `macro_rules!` spelling inside a comment or a
 * string from being read as a real macro head — the regression where a
 * commented-out `macro_rules! fake` inside a block comment swallowed the next
 * real item's cfg hints.
 */
function maskComments(lines: readonly string[]): string[] {
  const masked: string[] = [];
  let block = 0; // open nested block-comment depth
  let raw = -1; // open raw-string hash count, -1 when none
  let string = false; // an open normal `"…"` string (spans lines like the lexer's)

  for (const text of lines) {
    const chars = text.split('');
    let i = 0;
    while (i < text.length) {
      if (string) {
        const ch = text[i];
        if (ch === '\\') {
          // A backslash escapes the next char, including a newline, so the
          // string continues onto the next line (mirrors the lexer's skipString).
          chars[i] = ' ';
          if (i + 1 < text.length) {
            chars[i + 1] = ' ';
            i += 2;
          } else {
            i++;
          }
          continue;
        }
        chars[i] = ' ';
        i++;
        if (ch === '"') string = false;
        continue;
      }
      if (block > 0) {
        if (text[i] === '/' && text[i + 1] === '*') {
          chars[i] = ' ';
          chars[i + 1] = ' ';
          block++;
          i += 2;
          continue;
        }
        if (text[i] === '*' && text[i + 1] === '/') {
          chars[i] = ' ';
          chars[i + 1] = ' ';
          block--;
          i += 2;
          continue;
        }
        chars[i] = ' ';
        i++;
        continue;
      }
      if (raw >= 0) {
        let closes = text[i] === '"';
        for (let h = 0; closes && h < raw; h++) {
          if (text[i + 1 + h] !== '#') closes = false;
        }
        const end = i + 1 + raw;
        for (let k = i; k < (closes ? end : i + 1); k++) chars[k] = ' ';
        if (closes) raw = -1;
        i = closes ? end : i + 1;
        continue;
      }

      const ch = text[i];
      if (ch === '/' && text[i + 1] === '/') {
        for (let k = i; k < text.length; k++) chars[k] = ' ';
        break;
      }
      if (ch === '/' && text[i + 1] === '*') {
        chars[i] = ' ';
        chars[i + 1] = ' ';
        block = 1;
        i += 2;
        continue;
      }

      const rawStart = tryRawString(text, i);
      if (rawStart) {
        const { hashes, bodyStart } = rawStart;
        const close = findRawClose(text, bodyStart, hashes);
        if (close < 0) {
          for (let k = i; k < text.length; k++) chars[k] = ' ';
          raw = hashes;
          i = text.length;
        } else {
          for (let k = i; k < close; k++) chars[k] = ' ';
          i = close;
        }
        continue;
      }

      if (ch === '"') {
        chars[i] = ' ';
        string = true; // opening quote; masked until the closing one (cross-line)
        i++;
        continue;
      }
      if (ch === "'") {
        i = skipQuoteInLine(text, i);
        continue;
      }
      i++;
    }
    masked.push(chars.join(''));
  }

  return masked;
}

/**
 * Blanks `#[…]` / `#![…]` attribute spans in an already comment/string-masked
 * copy, preserving every line's length. The result holds only real code, so
 * "this line is nothing but attribute/comment content" becomes a whitespace
 * check. Counting brackets in the masked copy (rather than a raw balance)
 * keeps an attribute closer on a previous item's line (`… b))] fn f() {}`)
 * from being read as an open continuation.
 */
function maskAttributeSpans(masked: readonly string[]): string[] {
  const out: string[] = [];
  let depth = 0; // bracket depth inside an attribute

  for (const text of masked) {
    const chars = text.split('');
    let i = 0;
    while (i < text.length) {
      if (depth > 0) {
        const ch = text[i];
        if (ch === '[') depth++;
        else if (ch === ']') depth--;
        chars[i] = ' ';
        i++;
        continue;
      }
      if (text[i] === '#') {
        const bang = text[i + 1] === '!';
        const bracket = bang ? i + 2 : i + 1;
        if (text[bracket] === '[') {
          for (let k = i; k <= bracket; k++) chars[k] = ' ';
          depth = 1;
          i = bracket + 1;
          continue;
        }
      }
      i++;
    }
    out.push(chars.join(''));
  }

  return out;
}

/**
 * Per line, whether the nearest preceding non-transparent line carries a macro
 * head. One forward pass: a blank/comment-only/attribute-only line is
 * transparent and preserves the carried answer; a macro-head line sets it; any
 * other code line clears it. This replaces the former per-opener backward walk
 * that rescanned to line 0 for one-line `#[…]` items.
 *
 * A head may be split across lines (`macro_rules!` then the name, then the
 * body delimiter); {@link MACRO_KEYWORD_ONLY} starts that state and only a
 * resolved name (optional `r#` raw prefix) publishes the head. A keyword-only
 * line that never gets a name — invalid Rust, or a commented-out keyword — must
 * not flag anything, so the wait simply expires on the next code line instead
 * of swallowing that item's cfgs.
 */
function nearestMacroHeadBefore(code: readonly string[]): boolean[] {
  const result = new Array<boolean>(code.length).fill(false);
  let pending = false;
  let awaitingName = false;
  for (let line = 0; line < code.length; line++) {
    result[line] = pending;
    const trimmed = (code[line] ?? '').trim();
    if (trimmed === '') continue;
    if (isAttributeOnly(trimmed)) continue;
    if (MACRO_HEAD_TAIL.test(trimmed)) {
      pending = true;
      awaitingName = false;
      continue;
    }
    if (MACRO_KEYWORD_ONLY.test(trimmed)) {
      // The keyword alone is not a head: nothing may be flagged until the name
      // actually resolves (see the doc comment).
      pending = false;
      awaitingName = true;
      continue;
    }
    if (awaitingName) {
      const name = /^(?:r#)?[A-Za-z_][A-Za-z0-9_]*/.exec(trimmed);
      if (name) {
        const rest = trimmed.slice(name[0].length).trim();
        awaitingName = false;
        if (rest === '') {
          // A bare name keeps the head alive for a delimiter on a later line.
          pending = true;
        } else if (OPENERS.has(rest[0])) {
          // The delimiter shares the name's line, so the cross-line keyword is
          // invisible to isMacroBodyOpener's same-line check; flag this line
          // (the body delimiter itself then carries the macro count).
          pending = false;
          result[line] = true;
        } else {
          pending = false;
        }
        continue;
      }
    }
    pending = false;
    awaitingName = false;
  }
  return result;
}

/**
 * True when a comment-masked, trimmed line holds nothing but one or more
 * `#[…]` / `#![…]` attributes (an unterminated attribute counts, since it just
 * continues on the next line). Such lines are transparent for the macro-head
 * chain. A line that carries code after its attributes (`#[cfg(x)] fn f() {}`)
 * is not.
 */
function isAttributeOnly(trimmed: string): boolean {
  let i = 0;
  while (i < trimmed.length) {
    while (i < trimmed.length && (trimmed[i] === ' ' || trimmed[i] === '\t')) i++;
    if (i >= trimmed.length) return true;
    if (trimmed[i] !== '#') return false;

    let j = i + 1;
    if (trimmed[j] === '!') j++;
    if (trimmed[j] !== '[') return false;

    let depth = 0;
    while (j < trimmed.length) {
      const ch = trimmed[j];
      if (ch === '"') {
        j = skipStringInLine(trimmed, j);
        continue;
      }
      if (ch === '[') {
        depth++;
        j++;
        continue;
      }
      if (ch === ']') {
        depth--;
        j++;
        if (depth === 0) break;
        continue;
      }
      j++;
    }
    if (depth !== 0) return true; // attribute continues on a later line
    i = j;
  }
  return true;
}

/** The raw string starting at `i` (`r"…"`, `r#"…"#`, `br"…"`, `cr"…"`), if any. */
function tryRawString(
  text: string,
  i: number
): { hashes: number; bodyStart: number } | undefined {
  let p = i;
  if (text[p] === 'b' || text[p] === 'c') p++;
  if (text[p] !== 'r') return undefined;
  let hash = p + 1;
  while (text[hash] === '#') hash++;
  if (text[hash] !== '"') return undefined; // `r#ident`, not a raw string
  return { hashes: hash - (p + 1), bodyStart: hash + 1 };
}

/** Index just past the `"` + `hashes` `#` closing the raw string, or -1. */
function findRawClose(text: string, from: number, hashes: number): number {
  for (let j = from; j < text.length; j++) {
    if (text[j] !== '"') continue;
    let closes = true;
    for (let h = 0; h < hashes; h++) {
      if (text[j + 1 + h] !== '#') {
        closes = false;
        break;
      }
    }
    if (closes) return j + 1 + hashes;
  }
  return -1;
}

/**
 * End index of the `'`-construct at `col`: a char literal (with escape, or a
 * single token) or a lifetime, so a quote inside it cannot start a string. Mirrors
 * the lexer's `skipQuote`, kept line-local (neither form spans a line in Rust).
 */
function skipQuoteInLine(text: string, col: number): number {
  const next = text[col + 1];

  if (next === '\\') {
    let j = col + 2;
    if (j < text.length && text[j] !== '\n') j++;
    while (j < text.length && text[j] !== "'" && text[j] !== '\n') j++;
    return text[j] === "'" ? j + 1 : j;
  }

  if (next !== undefined && isIdentStartChar(next)) {
    let j = col + 1;
    while (j < text.length && isIdentChar(text[j])) j++;
    if (text[j] === "'") return j + 1; // char literal
    if (text[j] === '#' && isIdentStartChar(text[j + 1] ?? '')) {
      j++;
      while (j < text.length && isIdentChar(text[j])) j++;
    }
    return j; // lifetime
  }

  let j = col + 1;
  while (j < text.length && text[j] !== "'" && text[j] !== '\n') j++;
  return text[j] === "'" ? j + 1 : j;
}

function isIdentStartChar(ch: string): boolean {
  return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_';
}

function isIdentChar(ch: string): boolean {
  return isIdentStartChar(ch) || (ch >= '0' && ch <= '9');
}

/**
 * Start line of the item's leading attribute/doc-comment block, walking up from
 * `firstLine`. Continuation lines of a multi-line attribute or block doc comment
 * are absorbed too, but only when the walk actually reaches an attribute/doc
 * start, so unrelated code above is never pulled in. Blank lines between
 * contiguous attribute/doc lines are traversed (Rust attaches them across blank
 * whitespace) but only when a real head line is still reached above.
 */
function leadingHeadStart(
  lines: readonly string[],
  codeOnly: readonly string[],
  firstLine: number
): number {
  let start = firstLine;
  for (let line = firstLine - 1; line >= 0; line--) {
    const trimmed = (lines[line] ?? '').trim();
    if (trimmed === '') continue;
    if (isHeadAttributeLine(trimmed)) {
      start = line;
      continue;
    }
    if (isHeadContinuation(codeOnly, line)) {
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
 * True when `trimmed` is a leading attribute/doc-comment line to absorb into
 * `headLines`: a line doc comment, a block doc comment, or an `#[…]` / `#![…]`
 * attribute with no code after it (an unterminated attribute counts). A
 * one-line item that merely starts with `#[cfg(…)]` is NOT absorbable — treating
 * it as one made the walk above a row of one-line items rescan to line 0
 * (quadratic) and widened `headLines` to unrelated earlier items.
 */
function isHeadAttributeLine(trimmed: string): boolean {
  if (/^(?:\/\/\/|\/\/!|\/\*!|\/\*\*)/.test(trimmed)) return true;
  if (trimmed.startsWith('#[') || trimmed.startsWith('#![')) return isAttributeOnly(trimmed);
  return false;
}

/**
 * True when `line` is a continuation line of the leading block: after masking
 * comments, strings AND attribute spans, nothing but whitespace remains, so the
 * line is entirely attribute/comment content rather than code. Running the
 * check on the masked copy is what keeps an unbalanced bracket or a
 * block-comment delimiter inside
 * a comment or string (or a prior item's attribute closer followed by code) from
 * pulling that line into the next item's `headLines`. Blank lines also satisfy
 * this, but {@link leadingHeadStart} handles them before reaching here.
 */
function isHeadContinuation(codeOnly: readonly string[], line: number): boolean {
  return (codeOnly[line] ?? '').trim() === '';
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
  code: readonly string[],
  byOpenOffset: Map<number, { open: BracketToken; close: BracketToken }>
): BracketIndex {
  const count = brackets.length;
  const braceDepthBefore = new Int32Array(count + 1);
  const macroCountBefore = new Int32Array(count + 1);
  const opensByDepth = new Map<number, number[]>();

  // A macro body's delimiter may be `(`, `[` or `{`, and may not share a line
  // with the `macro_rules!`/`macro` head; detect the opener structurally via the
  // comment-masked forward-pass index (O(1) per opener).
  const nearestHead = nearestMacroHeadBefore(code);
  const macroOpenerOffsets = new Set<number>();
  for (let i = 0; i < count; i++) {
    if (!isMacroBodyOpener(brackets[i], code, nearestHead)) continue;
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
