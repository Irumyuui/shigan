import { C_SYNTAX, LanguageSyntax } from '../language';
import { BracketToken, DirectiveToken, ScanResult } from '../types';

const BRACKETS = new Set(['(', ')', '[', ']', '{', '}']);

/**
 * Recursion cap for nested C# literals.
 *
 * A hole inside an interpolated string can contain another interpolated
 * literal, which recurses through `skipInterpolated` ↔
 * `skipInterpolationHole` ↔ `skipNestedLiteral` ↔ `skipCSharpLiteral`. Without
 * a cap a pathologically nested document (`$"{ $"{ … }" }"`) overflows the
 * stack and the `RangeError` escapes every caller. Mirrors
 * `MAX_EXPANSION_DEPTH` in `match/expression.ts`; beyond the cap the scanner
 * consumes the rest conservatively instead of recursing further.
 */
const MAX_LITERAL_DEPTH = 256;

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
 * `syntax` selects the lexical profile. The only differences today are raw
 * string literals (C++, when `syntax.rawStrings` is true) and C# literals
 * (when `syntax.csharpLiterals` is true); when a flag is false the construct is
 * handled like an ordinary C string, so C output is byte-identical.
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
   * Index of the first unescaped newline at or after `k`, or `n` when the rest
   * of the document has none. Mirrors the non-verbatim literal rule: a
   * `\`+newline splice is not a line break, so it is skipped.
   */
  const lineLimit = (k: number): number => {
    let j = k;
    while (j < n) {
      if (text[j] === '\\') {
        const cont = skipSplice(j);
        j = cont >= 0 ? cont : j + 1;
        continue;
      }
      if (text[j] === '\n') return j;
      j++;
    }
    return n;
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
    void syntax; // Profile-specific literal forms are handled before this helper.
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

  /**
   * End index (exclusive) of the string or char literal starting at `k` inside
   * an interpolation hole. Char literals reuse `skipQuoted`; C# `@`/`$` forms
   * recurse through `skipCSharpLiteral`, so a literal nested in a hole cannot
   * end the enclosing literal early. Returns `k` when `k` does not start a
   * literal (e.g. a verbatim identifier `@class`). `depth` is the hole nesting
   * level, checked by `skipInterpolationHole` against `MAX_LITERAL_DEPTH`.
   */
  const skipNestedLiteral = (k: number, depth: number): number => {
    const c = text[k];
    if (c === "'") return skipQuoted(k, "'", syntax);
    const cs = skipCSharpLiteral(k, depth);
    if (cs >= 0) return cs;
    return c === '"' ? skipQuoted(k, '"', syntax) : k;
  };

  /**
   * End index (exclusive) of the interpolation hole whose `{` is at `k`.
   * Consumes balanced `{`/`}` while skipping nested literals and comments, so
   * brackets inside the hole never leak as ordinary code.
   *
   * A non-verbatim literal cannot span lines, so an unterminated hole stops at
   * the first unescaped newline (`\`+newline splices do not count) and later
   * code keeps its brackets. A verbatim literal may span lines, so its
   * unterminated hole consumes the rest of the document. `depth` bounds the
   * mutual recursion with `skipInterpolated`/`skipNestedLiteral`; at the cap the
   * hole is consumed conservatively (line-scoped for non-verbatim, EOF for
   * verbatim) instead of recursing further, so `scan` never throws.
   */
  const skipInterpolationHole = (k: number, verbatim: boolean, depth: number): number => {
    if (depth >= MAX_LITERAL_DEPTH) {
      return verbatim ? n : lineLimit(k);
    }
    let j = k + 1;
    let braces = 1;
    while (j < n) {
      const ch = text[j];
      if (ch === '\\') {
        const cont = skipSplice(j);
        j = cont >= 0 ? cont : j + 1;
        continue;
      }
      if (ch === '\n') {
        if (!verbatim) return j;
        j++;
        continue;
      }
      if (ch === '{') {
        braces++;
        j++;
        continue;
      }
      if (ch === '}') {
        braces--;
        j++;
        if (braces === 0) return j;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === '@' || ch === '$') {
        const end = skipNestedLiteral(j, depth + 1);
        j = end > j ? end : j + 1;
        continue;
      }
      if (ch === '/' && text[j + 1] === '/') {
        j = skipLineComment(j, syntax);
        continue;
      }
      if (ch === '/' && text[j + 1] === '*') {
        j = skipBlockComment(j, syntax);
        continue;
      }
      j++;
    }
    return n;
  };

  /**
   * End index (exclusive) of the interpolated string whose opening quote is at
   * `quotePos` (the prefix is already consumed). `verbatim` selects `""`
   * doubling over backslash escapes. A `{` that is not `{{` opens an
   * interpolation hole consumed by `skipInterpolationHole`; `{{` and `}}` are
   * literal escapes. An unterminated non-verbatim literal stops at the next
   * unescaped newline (including when the unterminated part is a hole), a
   * verbatim one consumes the rest of the document. `depth` bounds the hole
   * recursion.
   */
  const skipInterpolated = (quotePos: number, verbatim: boolean, depth: number): number => {
    let j = quotePos + 1;
    while (j < n) {
      const ch = text[j];
      if (verbatim) {
        if (ch === '"') {
          if (text[j + 1] === '"') {
            j += 2;
            continue;
          }
          return j + 1;
        }
      } else {
        if (ch === '\\') {
          const cont = skipSplice(j);
          j = cont >= 0 ? cont : j + 2;
          continue;
        }
        if (ch === '\n') return j;
        if (ch === '"') return j + 1;
      }
      if (ch === '{') {
        if (text[j + 1] === '{') {
          j += 2;
          continue;
        }
        j = skipInterpolationHole(j, verbatim, depth);
        continue;
      }
      if (ch === '}' && text[j + 1] === '}') {
        j += 2;
        continue;
      }
      j++;
    }
    return n;
  };

  /**
   * End index (exclusive) of a C# literal starting at `k`, or -1 when `k` does
   * not start one. Recognized forms:
   *  - verbatim `@"..."`, where `""` is a doubled (escaped) quote;
   *  - interpolated `$"..."`, `$@"..."` and `@$"..."`, whose `{...}` holes are
   *    consumed by the hole-aware `skipInterpolated`, so a quote or brace
   *    inside a hole stays opaque;
   *  - raw `"""..."""` (three or more opening quotes, optionally prefixed with
   *    any number of `$` for interpolation), ending at the first run of at
   *    least as many quotes as the opener.
   * A plain `"..."` (no prefix, single quote) returns -1 so the generic string
   * handling, which behaves identically, keeps owning it.
   */
  const skipCSharpLiteral = (k: number, depth = 0): number => {
    let p = k;
    let dollars = 0;
    let verbatim = false;
    if (text[p] === '@') {
      verbatim = true;
      p++;
      while (text[p] === '$') {
        dollars++;
        p++;
      }
    } else {
      while (text[p] === '$') {
        dollars++;
        p++;
      }
      if (text[p] === '@') {
        verbatim = true;
        p++;
      }
    }
    if (text[p] !== '"') return -1;

    let quotes = 0;
    while (text[p + quotes] === '"') quotes++;

    if (quotes >= 3) {
      // Raw string: close on a run of at least `quotes` double quotes.
      let j = p + quotes;
      while (j < n) {
        if (text[j] !== '"') {
          j++;
          continue;
        }
        let run = 0;
        while (text[j + run] === '"') run++;
        if (run >= quotes) return j + run;
        j += run;
      }
      return n; // Unterminated: consume the rest of the document.
    }

    if (dollars > 0) {
      // Interpolated string: hole-aware so a `"`/brace inside `{...}` does not
      // end the literal early.
      return skipInterpolated(p, verbatim, depth);
    }

    if (verbatim) {
      // `""` is an escaped quote; a lone `"` closes the literal.
      let j = p + 1;
      while (j < n) {
        if (text[j] === '"') {
          if (text[j + 1] === '"') {
            j += 2;
            continue;
          }
          return j + 1;
        }
        j++;
      }
      return n;
    }

    return -1;
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

    // Comments are whitespace in C, so they neither terminate the "only
    // whitespace so far" state nor prevent a following `#` from being a
    // directive on the same line.
    if (c === '/' && text[i + 1] === '/') {
      advanceTo(skipLineComment(i, syntax));
      continue;
    }

    if (c === '/' && text[i + 1] === '*') {
      advanceTo(skipBlockComment(i, syntax));
      continue;
    }

    onlyWs = false;

    if (syntax.rawStrings) {
      const rawEnd = skipRawString(i);
      if (rawEnd >= 0) {
        advanceTo(rawEnd);
        continue;
      }
    }

    if (syntax.csharpLiterals) {
      const csEnd = skipCSharpLiteral(i);
      if (csEnd >= 0) {
        advanceTo(csEnd);
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
  const spliced = raw.replace(/\\\r?\n/g, ' ');
  const stripped = stripComments(spliced);
  // An unterminated block comment spills past this logical line, so keep the
  // text as-is: evaluation then stays conservative instead of deciding a value
  // from a truncated expression.
  const cleaned = stripped === undefined ? spliced : stripped;
  return cleaned.replace(/\s+/g, ' ').trim();
}

/**
 * Removes line and block comments that sit outside string and character
 * literals. Returns `undefined` when a block comment is not closed within
 * `text`, because the real comment may continue on lines outside this slice.
 */
function stripComments(text: string): string | undefined {
  let out = '';
  let i = 0;
  const n = text.length;

  while (i < n) {
    const c = text[i];

    if (c === '"' || c === "'") {
      const quote = c;
      out += c;
      i++;
      while (i < n) {
        const ch = text[i];
        out += ch;
        i++;
        if (ch === '\\') {
          if (i < n) {
            out += text[i];
            i++;
          }
          continue;
        }
        if (ch === quote || ch === '\n') break;
      }
      continue;
    }

    if (c === '/' && text[i + 1] === '/') {
      i += 2;
      while (i < n && text[i] !== '\n') i++;
      continue;
    }

    if (c === '/' && text[i + 1] === '*') {
      const close = text.indexOf('*' + '/', i + 2);
      if (close < 0) return undefined;
      out += ' ';
      i = close + 2;
      continue;
    }

    out += c;
    i++;
  }

  return out;
}

function directiveName(display: string): string {
  const m = /^#\s*([A-Za-z_][A-Za-z0-9_]*)/.exec(display);
  return m ? m[1].toLowerCase() : '';
}
