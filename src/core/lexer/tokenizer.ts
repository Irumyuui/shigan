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
 */
export function scan(text: string): ScanResult {
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
      let j = i + 2;
      while (j < n) {
        const cont = skipSplice(j);
        if (cont >= 0) {
          j = cont;
          continue;
        }
        if (text[j] === '\n') break;
        j++;
      }
      advanceTo(j);
      continue;
    }

    if (c === '/' && text[i + 1] === '*') {
      const close = text.indexOf('*/', i + 2);
      advanceTo(close < 0 ? n : close + 2);
      continue;
    }

    if (c === '"' || c === "'") {
      const quote = c;
      let j = i + 1;
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
      advanceTo(j);
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
