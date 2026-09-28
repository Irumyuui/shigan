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

  const cfgByLine = new Map<number, CfgAttributeToken>();
  for (const attr of cfgs) if (!cfgByLine.has(attr.line)) cfgByLine.set(attr.line, attr);

  // Every outer cfg attribute by position, so a same-line sibling can be merged.
  const cfgByPos = new Map<string, CfgAttributeToken>();
  for (const attr of scanned.cfgs ?? []) {
    if (attr.name === 'cfg' && !attr.inner) cfgByPos.set(`${attr.line}:${attr.col}`, attr);
  }

  const pairs = matchBrackets(scanned.brackets);
  const consumed = new Set<number>();
  const spans: CfgItemSpan[] = [];

  for (const attr of cfgs) {
    if (consumed.has(attr.line)) continue;
    const span = pairOne(
      attr,
      cfgByLine,
      cfgByPos,
      consumed,
      scanned.brackets,
      pairs.byOpenOffset,
      lines
    );
    if (span) spans.push(span);
  }

  spans.sort((a, b) => a.attrLine - b.attrLine);
  return spans;
}

function pairOne(
  first: CfgAttributeToken,
  cfgByLine: Map<number, CfgAttributeToken>,
  cfgByPos: Map<string, CfgAttributeToken>,
  consumed: Set<number>,
  brackets: readonly BracketToken[],
  byOpenOffset: Map<number, { open: BracketToken; close: BracketToken }>,
  lines: readonly string[]
): CfgItemSpan | undefined {
  const limit = first.line + MAX_LOOKAHEAD;
  const merged: CfgAttributeToken[] = [];
  let itemLine = -1;
  let itemHead = '';

  let current: CfgAttributeToken | undefined = first;

  while (current) {
    merged.push(current);

    const close = findAttributeClose(lines, current);
    if (!close) return undefined;
    const rest = (lines[close.line] ?? '').slice(close.col);
    const restTrim = rest.trim();

    if (restTrim !== '' && !isCommentLine(restTrim)) {
      if (isAttributeLine(restTrim)) {
        // Another attribute on the same line: merge it and re-examine its tail.
        const nextCol = close.col + rest.indexOf('#');
        const next = cfgByPos.get(`${close.line}:${nextCol}`);
        if (!next || next.offset <= current.offset || consumed.has(next.line)) return undefined;
        current = next;
        continue;
      }
      // Non-empty tail after `]` is the item head, on the same line.
      itemLine = close.line;
      itemHead = restTrim;
      break;
    }

    // No usable same-line tail: take the first non-blank/comment/attribute line.
    let line = close.line + 1;
    let attribute: CfgAttributeToken | undefined;
    while (line <= limit) {
      const trimmed = (lines[line] ?? '').trim();
      if (trimmed === '' || isCommentLine(trimmed)) {
        line++;
        continue;
      }
      if (isAttributeLine(trimmed)) {
        const candidate = cfgByLine.get(line);
        if (candidate && !consumed.has(candidate.line)) {
          attribute = candidate;
          break;
        }
        line++;
        continue;
      }
      itemLine = line;
      itemHead = trimmed;
      break;
    }

    if (itemLine >= 0) break;
    if (attribute) {
      current = attribute;
      continue;
    }
    return undefined;
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

  // A `;` before the opening brace ends a semicolon-terminated item; the raw
  // scan may stop early on a `;` inside a string/type, which is the safe way.
  let before = '';
  for (let L = itemLine; L < open.line; L++) before += (lines[L] ?? '') + '\n';
  before += (lines[open.line] ?? '').slice(0, open.col);
  if (before.includes(';')) return undefined;

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
 * Position just after the `]` that closes the attribute starting at `attr`
 * (which may span several lines). Strings are skipped so a `]` inside a cfg
 * value cannot close it early.
 */
function findAttributeClose(
  lines: readonly string[],
  attr: CfgAttributeToken
): { line: number; col: number } | undefined {
  let line = attr.line;
  let col = attr.col;
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

function isCommentLine(trimmed: string): boolean {
  return trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*');
}

function isAttributeLine(trimmed: string): boolean {
  return trimmed.startsWith('#[') || trimmed.startsWith('#![');
}
