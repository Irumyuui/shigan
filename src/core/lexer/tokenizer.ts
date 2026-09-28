import { C_SYNTAX, LanguageSyntax } from '../language';
import { BracketToken, DirectiveToken, ScanResult } from '../types';

const BRACKETS = new Set(['(', ')', '[', ']', '{', '}']);

/**
 * Lexical scanner for C source.
 *
 * It performs no parsing, but it correctly skips over everything that must not
 * contribute brackets or preprocessor directives:
 *  - line comments (`//`), including backslash-newline continuations
 *  - block comments (`/* ... *​/`)
 *  - string literals and character literals with escapes
 *  - backslash-newline line splices
 *
 * Preprocessor directives are recognized only when `#` is the first
 * non-whitespace character of a logical line and is not inside a comment or a
 * string. Directive lines are treated as opaque: brackets inside them are not
 * reported (macro bodies are a documented limitation).
 *
 * `syntax` selects the lexical profile. The only difference today is raw
 * string literals: recognized when `syntax.rawStrings` is true (C++), skipped
 * like a C string otherwise, so C output is byte-identical.
 */
export function scan(text: string, syntax: LanguageSyntax = C_SYNTAX): ScanResult {
  const brackets: BracketToken[] = [];
  const directives: DirectiveToken[] = [];
  const n = text.length;
  let i = 0;
  let line = 0;
  let lineStart = 0;
  /** True while only whitespace has been seen on the current logical line. */
  let onlyWs = true;

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

  /** Skips a `\` + newline splice starting at `k`, returns the next index (or -1). */
  const skipSplice = (k: number): number => {
    if (text[k] !== '\\') return -1;
    let p = k + 1;
    if (p < n && text[p] === '\r') p++;
    return p < n && text[p] === '\n' ? p + 1 : -1;
  };

  /**
   * End index (exclusive) of the `//` comment starting at `k`. A line comment
   * runs to the end of the logical line, so backslash-newline continuations are
   * followed.
   */
  const skipLineComment = (k: number, syntax: LanguageSyntax): number => {
    void syntax; // C-only for now; reserved for future profiles.
    let j = k + 2;
    while (j < n) {
      const cont = skipSplice(j);
      if (cont >= 0) {
        j = cont;
        continue;
      }
      if (text[j] === '\n') break;
      j++;
    }
    return j;
  };

  /** End index (exclusive) of the block comment starting at `k`. */
  const skipBlockComment = (k: number, syntax: LanguageSyntax): number => {
    void syntax; // C-only for now; reserved for future profiles.
    const close = text.indexOf('*/', k + 2);
    return close < 0 ? n : close + 2;
  };

  /**
   * End index (exclusive) of the single- or double-quoted literal starting at
   * `k` whose opening delimiter is `quote`. Handles backslash escapes and
   * backslash-newline splices, and stops at an unescaped newline.
   */
  const skipQuoted = (k: number, quote: string, syntax: LanguageSyntax): number => {
    void syntax; // csharpLiterals is inert until implemented.
    let j = k + 1;
    while (j < n) {
      const ch = text[j];
      if (ch === '\\') {
        const cont = skipSplice(j);
        j = cont >= 0 ? cont : j + 2;
        continue;
      }
      if (ch === '\n') break;
      j++;
      if (ch === quote) break;
    }
    return j;
  };

  /**
   * End index (exclusive) of a C++ raw string literal starting at `k`, or -1
   * when `k` does not start one. The opening is
   * `[u8|u|U|L]R"delim(` where `delim` is 0-16 characters that must not
   * contain whitespace, `(`, `)`, `\` or control characters; the body runs to
   * `)delim"` and may span multiple lines with quotes and brackets inside.
   * An unterminated literal consumes the rest of the document.
   */
  const skipRawString = (k: number): number => {
    let p = k;
    const prefix = /^(?:u8|[uUL])/.exec(text.slice(p, p + 2));
    if (prefix) p += prefix[0].length;
    if (text[p] !== 'R' || text[p + 1] !== '"') return -1;
    const open = /^([^()\\\s\u0000-\u001f\u007f]{0,16})\(/.exec(text.slice(p + 2, p + 19));
    if (!open) return -1;
    const delim = open[1];
    const close = text.indexOf(')' + delim + '"', p + 2 + delim.length + 1);
    return close < 0 ? n : close + delim.length + 2;
  };

  while (i < n) {
    const c = text[i];

    if (c === '\n') {
      line++;
      lineStart = i + 1;
      onlyWs = true;
      i++;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r' || c === '\f' || c === '\v') {
      i++;
      continue;
    }

    const splice = skipSplice(i);
    if (splice >= 0) {
      // Logical line continues; stay in "same line" state.
      i = splice;
      line++;
      lineStart = i;
      continue;
    }

    if (onlyWs && c === '#') {
      const start = i;
      const startLine = line;
      let j = i + 1;
      while (j < n) {
        const cont = skipSplice(j);
        if (cont >= 0) {
          j = cont;
          continue;
        }
        if (text[j] === '\n') break;
        j++;
      }
      const raw = text.slice(start, j);
      const endLine = startLine + countNewlines(raw);
      const display = normalizeDirective(raw);
      directives.push({
        name: directiveName(display),
        raw,
        display,
        line: startLine,
        endLine,
        offset: start,
      });
      advanceTo(j);
      onlyWs = false;
      continue;
    }

    onlyWs = false;

    if (c === '/' && text[i + 1] === '/') {
      advanceTo(skipLineComment(i, syntax));
      continue;
    }

    if (c === '/' && text[i + 1] === '*') {
      advanceTo(skipBlockComment(i, syntax));
      continue;
    }

    if (syntax.rawStrings) {
      const rawEnd = skipRawString(i);
      if (rawEnd >= 0) {
        advanceTo(rawEnd);
        continue;
      }
    }

    if (c === '"' || c === "'") {
      advanceTo(skipQuoted(i, c, syntax));
      continue;
    }

    if (BRACKETS.has(c)) {
      brackets.push({ char: c, offset: i, line, col: i - lineStart });
      i++;
      continue;
    }

    i++;
  }

  return { brackets, directives };
}

function countNewlines(s: string): number {
  let count = 0;
  for (let k = 0; k < s.length; k++) if (s.charCodeAt(k) === 10) count++;
  return count;
}

function normalizeDirective(raw: string): string {
  return raw.replace(/\\\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
}

function directiveName(display: string): string {
  const m = /^#\s*([A-Za-z_][A-Za-z0-9_]*)/.exec(display);
  return m ? m[1].toLowerCase() : '';
}
