import { countNewlines, isIdentPart, isIdentStart } from '../ident';
import { BracketToken, CfgAttributeToken, ScanResult } from '../types';

const BRACKETS = new Set(['(', ')', '[', ']', '{', '}']);
const WHITESPACE = new Set([' ', '\t', '\r', '\f', '\v']);

/**
 * Lexical scanner for Rust source (VSCode-free).
 *
 * It performs no parsing; it only skips everything that must not contribute
 * brackets and records `cfg` attributes. Compared with the C scanner it:
 *  - has no backslash line-splices (so `//` comments end at the newline);
 *  - nests block comments (depth-counted on `/*` openers);
 *  - understands `"…"`, `b"…"`, `c"…"`, raw `r#"…"#` / `br"…"` / `cr"…"`
 *    strings, byte chars `b'x'`, and the char-vs-lifetime `'` ambiguity;
 *  - treats `#[…]` / `#![…]` attributes as opaque (no bracket tokens, no
 *    directive) while emitting a {@link CfgAttributeToken} for `cfg`/`cfg_attr`.
 *
 * `directives` is always empty: Rust has no preprocessor directives. The
 * scanner is conservative (unterminated constructs consume to EOF) and never
 * throws.
 */
export function scanRust(text: string): ScanResult {
  const brackets: BracketToken[] = [];
  const cfgs: CfgAttributeToken[] = [];
  const n = text.length;
  let i = 0;
  let line = 0;
  let lineStart = 0;

  /** Advances `i` to `j`, tracking newlines (same contract as the C scanner). */
  const advanceTo = (j: number): void => {
    const end = Math.min(j, n);
    for (let k = i; k < end; k++) {
      if (text.charCodeAt(k) === 10 /* \n */) {
        line++;
        lineStart = k + 1;
      }
    }
    i = end;
  };

  /** `//` comment to end of line; Rust has no line-splice, so we stop at `\n`. */
  const skipLineComment = (k: number): number => {
    let j = k + 2;
    while (j < n && text[j] !== '\n') j++;
    return j;
  };

  /** Nested block comment (depth-counted); unterminated consumes to EOF. */
  const skipBlockComment = (k: number): number => {
    let depth = 1;
    let j = k + 2;
    while (j < n) {
      if (text[j] === '/' && text[j + 1] === '*') {
        depth++;
        j += 2;
        continue;
      }
      if (text[j] === '*' && text[j + 1] === '/') {
        depth--;
        j += 2;
        if (depth === 0) return j;
        continue;
      }
      j++;
    }
    return n;
  };

  /** `"…"` string with backslash escapes; unterminated consumes to EOF. */
  const skipString = (k: number): number => {
    let j = k + 1;
    while (j < n) {
      const ch = text[j];
      if (ch === '\\') {
        j += 2;
        continue;
      }
      if (ch === '"') return j + 1;
      j++;
    }
    return n;
  };

  /**
   * End index of the `'`-construct at `k`: a char literal (with escape, or a
   * single/base char) or a lifetime. Lifetimes are followed by an optional raw
   * tail (`'r#lt`). Unterminated char literals stop at the newline.
   */
  const skipQuote = (k: number): number => {
    const next = text[k + 1];

    if (next === '\\') {
      // Skip the backslash and (when present) the escaped char, then find the
      // closing quote. A newline right after the backslash is unterminated.
      let j = k + 2;
      if (j < n && text[j] !== '\n') j++;
      while (j < n && text[j] !== "'" && text[j] !== '\n') j++;
      if (text[j] === "'") j++;
      return j;
    }

    if (isIdentStart(next)) {
      let j = k + 1;
      while (j < n && isIdentPart(text[j])) j++;
      if (text[j] === "'") return j + 1; // char literal, e.g. 'a' / '_'
      // Lifetime; consume an optional raw-lifetime tail: 'r#lt.
      if (text[j] === '#' && isIdentStart(text[j + 1])) {
        j++;
        while (j < n && isIdentPart(text[j])) j++;
      }
      return j;
    }

    // Char literal such as '{', '}', ',' or '0'.
    let j = k + 1;
    while (j < n && text[j] !== "'" && text[j] !== '\n') j++;
    if (text[j] === "'") j++;
    return j;
  };

  /**
   * End index of a raw string starting at `k`, or -1 if `k` does not start one.
   * Recognizes `r"…"`, `r#"…"#`, … plus `br`/`cr` prefixes. The body ends only
   * at `"` followed by the same number of `#` as the opener; unterminated
   * consumes to EOF. An `r#ident` raw identifier returns -1 (no quote).
   */
  const tryRawString = (k: number): number => {
    let p = k;
    if (text[p] === 'b' || text[p] === 'c') p++;
    if (text[p] !== 'r') return -1;
    p++;
    let hashes = 0;
    while (text[p + hashes] === '#') hashes++;
    if (text[p + hashes] !== '"') return -1;

    let j = p + hashes + 1;
    while (j < n) {
      if (text[j] === '"') {
        let closes = true;
        for (let h = 0; h < hashes; h++) {
          if (text[j + 1 + h] !== '#') {
            closes = false;
            break;
          }
        }
        if (closes) return j + 1 + hashes;
      }
      j++;
    }
    return n;
  };

  /**
   * If `k` starts a comment or literal, returns its end index (exclusive);
   * otherwise -1. Shared by the main loop and the attribute balance scanner.
   */
  const skipOpaque = (k: number): number => {
    if (text[k] === '/' && text[k + 1] === '/') return skipLineComment(k);
    if (text[k] === '/' && text[k + 1] === '*') return skipBlockComment(k);
    const raw = tryRawString(k);
    if (raw >= 0) return raw;
    if (text[k] === '"') return skipString(k);
    if (text[k] === "'") return skipQuote(k);
    if ((text[k] === 'b' || text[k] === 'c') && text[k + 1] === '"') return skipString(k + 1);
    if ((text[k] === 'b' || text[k] === 'c') && text[k + 1] === "'") return skipQuote(k + 1);
    return -1;
  };

  /**
   * Index just past the `]` matching the `[` at `open`. Brackets inside strings
   * and comments are skipped by `skipOpaque`.
   */
  const scanAttributeEnd = (open: number): number => {
    let depth = 0;
    let j = open;
    while (j < n) {
      const opaque = skipOpaque(j);
      if (opaque >= 0) {
        j = opaque;
        continue;
      }
      if (text[j] === '[') {
        depth++;
        j++;
        continue;
      }
      if (text[j] === ']') {
        depth--;
        j++;
        if (depth === 0) return j;
        continue;
      }
      j++;
    }
    return n;
  };

  /** Skips ASCII whitespace starting at `from`. */
  const skipWhitespace = (from: number): number => {
    let j = from;
    while (j < n && WHITESPACE.has(text[j])) j++;
    return j;
  };

  /** `cfg` / `cfg_attr` when the attribute body starts with one, else undefined. */
  const cfgHead = (p: number): 'cfg' | 'cfg_attr' | undefined => {
    let j = skipWhitespace(p);
    const start = j;
    while (j < n && isIdentPart(text[j])) j++;
    const name = text.slice(start, j);
    if (name !== 'cfg' && name !== 'cfg_attr') return undefined;
    if (text[skipWhitespace(j)] !== '(') return undefined;
    return name;
  };

  while (i < n) {
    const c = text[i];

    if (c === '\n') {
      line++;
      lineStart = i + 1;
      i++;
      continue;
    }
    if (WHITESPACE.has(c)) {
      i++;
      continue;
    }

    const opaque = skipOpaque(i);
    if (opaque >= 0) {
      advanceTo(opaque);
      continue;
    }

    if (c === '#') {
      const inner = text[i + 1] === '!';
      const bracket = inner ? i + 2 : i + 1;
      if (text[bracket] === '[') {
        const start = i;
        const startLine = line;
        const startCol = i - lineStart;
        const end = scanAttributeEnd(bracket);
        const raw = text.slice(start, end);
        const head = cfgHead(bracket + 1);
        if (head) {
          cfgs.push({
            name: head,
            inner,
            display: normalizeWhitespace(raw),
            line: startLine,
            endLine: startLine + countNewlines(raw),
            offset: start,
            col: startCol,
          });
        }
        advanceTo(end);
        continue;
      }
      if (inner) {
        // `#!` that does not open an attribute (a shebang) is a line comment.
        advanceTo(skipLineComment(i));
        continue;
      }
      i++;
      continue;
    }

    if (BRACKETS.has(c)) {
      brackets.push({ char: c, offset: i, line, col: i - lineStart });
      i++;
      continue;
    }

    i++;
  }

  return { brackets, directives: [], cfgs };
}

function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}
