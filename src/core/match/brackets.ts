import { BracketToken } from '../types';

const OPEN_TO_CLOSE: Record<string, string> = { '(': ')', '[': ']', '{': '}' };
const CLOSE_TO_OPEN: Record<string, string> = { ')': '(', ']': '[', '}': '{' };

export interface BracketPair {
  open: BracketToken;
  close: BracketToken;
}

export interface BracketMatchResult {
  pairs: BracketPair[];
  byOpenOffset: Map<number, BracketPair>;
  byCloseOffset: Map<number, BracketPair>;
  unmatched: BracketToken[];
}

/**
 * Stack-based matching of `()[]{}`.
 *
 * `isInactive` lets callers exclude tokens (e.g. brackets inside a disabled
 * preprocessor branch) from participating in matching.
 */
export function matchBrackets(
  tokens: BracketToken[],
  isInactive?: (token: BracketToken) => boolean
): BracketMatchResult {
  const stack: BracketToken[] = [];
  const pairs: BracketPair[] = [];
  const unmatched: BracketToken[] = [];

  for (const token of tokens) {
    if (isInactive && isInactive(token)) continue;

    if (OPEN_TO_CLOSE[token.char] !== undefined) {
      stack.push(token);
      continue;
    }

    const want = CLOSE_TO_OPEN[token.char];
    const top = stack[stack.length - 1];
    if (top && top.char === want) {
      stack.pop();
      pairs.push({ open: top, close: token });
    } else {
      unmatched.push(token);
    }
  }

  for (const token of stack) unmatched.push(token);

  const byOpenOffset = new Map<number, BracketPair>();
  const byCloseOffset = new Map<number, BracketPair>();
  for (const pair of pairs) {
    byOpenOffset.set(pair.open.offset, pair);
    byCloseOffset.set(pair.close.offset, pair);
  }

  return { pairs, byOpenOffset, byCloseOffset, unmatched };
}
