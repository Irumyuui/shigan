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

  const pairs = matchBrackets(scanned.brackets);
  const consumed = new Set<number>();
  const spans: CfgItemSpan[] = [];

  for (const attr of cfgs) {
    if (consumed.has(attr.line)) continue;
    const span = pairOne(attr, cfgByLine, consumed, scanned.brackets, pairs.byOpenOffset, lines);
    if (span) spans.push(span);
  }

  spans.sort((a, b) => a.attrLine - b.attrLine);
  return spans;
}

function pairOne(
  first: CfgAttributeToken,
  cfgByLine: Map<number, CfgAttributeToken>,
  consumed: Set<number>,
  brackets: readonly BracketToken[],
  byOpenOffset: Map<number, { open: BracketToken; close: BracketToken }>,
  lines: readonly string[]
): CfgItemSpan | undefined {
  const limit = first.line + MAX_LOOKAHEAD;
  const merged: CfgAttributeToken[] = [first];
  let line = first.endLine + 1;
  let itemLine = -1;

  while (line <= limit) {
    const text = lines[line] ?? '';
    const trimmed = text.trim();

    if (trimmed === '' || isCommentLine(trimmed)) {
      line++;
      continue;
    }
    if (isAttributeLine(trimmed)) {
      const attribute = cfgByLine.get(line);
      if (attribute && !consumed.has(line)) {
        merged.push(attribute);
        line = attribute.endLine + 1;
      } else {
        line++;
      }
      continue;
    }

    itemLine = line;
    break;
  }

  if (itemLine < 0) return undefined;

  // Claim every attribute of the group, found or not, so none is processed twice.
  for (const attribute of merged) consumed.add(attribute.line);

  if (!ITEM_HEAD.test((lines[itemLine] ?? '').trim())) return undefined;

  const depth = braceDepthBefore(brackets, first.offset);

  // First `{` at the item's own depth, on/after the item line and in the window.
  let open: BracketToken | undefined;
  let current = 0;
  for (const token of brackets) {
    if (token.char === '{') {
      if (current === depth && token.line >= itemLine && token.line <= limit) {
        open = token;
        break;
      }
      current++;
    } else if (token.char === '}') {
      current--;
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
