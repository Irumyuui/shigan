/**
 * Shared lexical helpers for the VSCode-free core scanners.
 *
 * Identifier classification is identical in the C tokenizer, the Rust scanner
 * and the preprocessor expression lexer, so it lives here once. The functions
 * are deliberately ASCII-only (as in C/Rust identifiers) and accept `undefined`
 * so callers can probe one character past the end without a separate guard.
 */

/** True for `[A-Za-z_]`; `false` for `undefined`. */
export function isIdentStart(c: string | undefined): boolean {
  return c !== undefined && ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_');
}

/** True for `[A-Za-z0-9_]`; `false` for `undefined`. */
export function isIdentPart(c: string | undefined): boolean {
  return isIdentStart(c) || (c !== undefined && c >= '0' && c <= '9');
}

/** Counts `\n` characters (`\r\n` therefore counts once). */
export function countNewlines(s: string): number {
  let count = 0;
  for (let k = 0; k < s.length; k++) if (s.charCodeAt(k) === 10) count++;
  return count;
}
