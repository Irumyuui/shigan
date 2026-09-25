import { MacroDef } from '../types';

type Token =
  | { kind: 'num'; value: number }
  | { kind: 'id'; name: string }
  | { kind: 'op'; op: string };

const TWO_CHAR_OPS = ['||', '&&', '==', '!=', '<=', '>=', '<<', '>>'];
const ONE_CHAR_OPS = ['+', '-', '*', '/', '%', '!', '~', '&', '|', '^', '<', '>', '?', ':', '(', ')'];
const MAX_EXPANSION_DEPTH = 16;

// Lowest to highest precedence.
const LEVELS: string[][] = [
  ['||'],
  ['&&'],
  ['|'],
  ['^'],
  ['&'],
  ['==', '!='],
  ['<', '<=', '>', '>='],
  ['<<', '>>'],
  ['+', '-'],
  ['*', '/', '%'],
];

/**
 * Evaluates a C preprocessor constant expression.
 *
 * Undefined identifiers evaluate to `0` (matching the preprocessor). Anything
 * that cannot be resolved deterministically (function-like macros, leftover
 * tokens, division by zero) yields `undefined`, which callers must treat as
 * "unknown" and handle conservatively.
 */
export function evaluateExpression(
  text: string,
  macros: Map<string, MacroDef>
): number | undefined {
  const tokens = lex(text);
  if (!tokens || tokens.length === 0) return undefined;
  const parser = new Parser(tokens, macros, 0);
  const value = parser.parse();
  return parser.atEnd() ? value : undefined;
}

class Parser {
  private pos = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly macros: Map<string, MacroDef>,
    private readonly depth: number
  ) {}

  atEnd(): boolean {
    return this.pos >= this.tokens.length;
  }

  parse(): number | undefined {
    return this.conditional();
  }

  private conditional(): number | undefined {
    const condition = this.binary(0);
    if (!this.peekOp('?')) return condition;

    this.pos++;
    const whenTrue = this.conditional();
    if (!this.expectOp(':')) return undefined;
    const whenFalse = this.conditional();
    if (condition === undefined || whenTrue === undefined || whenFalse === undefined) {
      return undefined;
    }
    return condition ? whenTrue : whenFalse;
  }

  private binary(level: number): number | undefined {
    if (level >= LEVELS.length) return this.unary();

    let left = this.binary(level + 1);
    while (true) {
      const token = this.tokens[this.pos];
      if (!token || token.kind !== 'op' || !LEVELS[level].includes(token.op)) break;
      this.pos++;
      const right = this.binary(level + 1);
      left = applyBinary(token.op, left, right);
    }
    return left;
  }

  private unary(): number | undefined {
    const token = this.tokens[this.pos];
    if (token && token.kind === 'op' && (token.op === '!' || token.op === '~' || token.op === '+' || token.op === '-')) {
      this.pos++;
      const value = this.unary();
      if (value === undefined) return undefined;
      switch (token.op) {
        case '!':
          return value ? 0 : 1;
        case '~':
          return ~value;
        case '-':
          return -value;
        default:
          return value;
      }
    }
    return this.primary();
  }

  private primary(): number | undefined {
    const token = this.tokens[this.pos];
    if (!token) return undefined;

    if (token.kind === 'num') {
      this.pos++;
      return token.value;
    }

    if (token.kind === 'op' && token.op === '(') {
      this.pos++;
      const value = this.conditional();
      if (!this.expectOp(')')) return undefined;
      return value;
    }

    if (token.kind === 'id') {
      this.pos++;
      return token.name === 'defined' ? this.parseDefined() : this.resolve(token.name);
    }

    // Unrecognized token: consume it so parsing always makes progress.
    this.pos++;
    return undefined;
  }

  private parseDefined(): number | undefined {
    const parenthesized = this.peekOp('(');
    if (parenthesized) this.pos++;

    const token = this.tokens[this.pos];
    if (!token || token.kind !== 'id') return undefined;
    this.pos++;

    if (parenthesized && !this.expectOp(')')) return undefined;
    return this.macros.has(token.name) ? 1 : 0;
  }

  private resolve(name: string): number | undefined {
    const def = this.macros.get(name);
    if (!def) return 0;
    if (def.functionLike) return undefined;
    if (this.depth >= MAX_EXPANSION_DEPTH) return undefined;

    const value = def.value.trim();
    if (!value) return undefined;

    const tokens = lex(value);
    if (!tokens || tokens.length === 0) return undefined;

    const parser = new Parser(tokens, this.macros, this.depth + 1);
    const result = parser.parse();
    return parser.atEnd() ? result : undefined;
  }

  private peekOp(op: string): boolean {
    const token = this.tokens[this.pos];
    return token !== undefined && token.kind === 'op' && token.op === op;
  }

  private expectOp(op: string): boolean {
    if (!this.peekOp(op)) return false;
    this.pos++;
    return true;
  }
}

function applyBinary(op: string, left: number | undefined, right: number | undefined): number | undefined {
  if (left === undefined || right === undefined) return undefined;
  switch (op) {
    case '||':
      return left || right ? 1 : 0;
    case '&&':
      return left && right ? 1 : 0;
    case '|':
      return left | right;
    case '^':
      return left ^ right;
    case '&':
      return left & right;
    case '==':
      return left === right ? 1 : 0;
    case '!=':
      return left !== right ? 1 : 0;
    case '<':
      return left < right ? 1 : 0;
    case '<=':
      return left <= right ? 1 : 0;
    case '>':
      return left > right ? 1 : 0;
    case '>=':
      return left >= right ? 1 : 0;
    case '<<':
      return left << (right & 31);
    case '>>':
      return left >> (right & 31);
    case '+':
      return left + right;
    case '-':
      return left - right;
    case '*':
      return left * right;
    case '/':
      return right === 0 ? undefined : Math.trunc(left / right);
    case '%':
      return right === 0 ? undefined : left % right;
    default:
      return undefined;
  }
}

function lex(text: string): Token[] | undefined {
  const tokens: Token[] = [];
  let i = 0;

  while (i < text.length) {
    const c = text[i];

    if (c === ' ' || c === '\t' || c === '\r' || c === '\n' || c === '\f' || c === '\v') {
      i++;
      continue;
    }

    if (c >= '0' && c <= '9') {
      const next = parseNumber(text, i);
      if (!next) return undefined;
      tokens.push({ kind: 'num', value: next.value });
      i = next.index;
      continue;
    }

    if (c === "'") {
      const next = parseChar(text, i);
      if (!next) return undefined;
      tokens.push({ kind: 'num', value: next.value });
      i = next.index;
      continue;
    }

    if (isIdentStart(c)) {
      let j = i + 1;
      while (j < text.length && isIdentPart(text[j])) j++;
      tokens.push({ kind: 'id', name: text.slice(i, j) });
      i = j;
      continue;
    }

    const twoChar = text.slice(i, i + 2);
    if (TWO_CHAR_OPS.includes(twoChar)) {
      tokens.push({ kind: 'op', op: twoChar });
      i += 2;
      continue;
    }

    if (ONE_CHAR_OPS.includes(c)) {
      tokens.push({ kind: 'op', op: c });
      i++;
      continue;
    }

    // Unknown character: give up on this expression.
    return undefined;
  }

  return tokens;
}

function parseNumber(text: string, start: number): { value: number; index: number } | undefined {
  let j = start;
  let value: number;

  if (text[j] === '0' && (text[j + 1] === 'x' || text[j + 1] === 'X')) {
    j += 2;
    const begin = j;
    while (j < text.length && isHexDigit(text[j])) j++;
    if (j === begin) return undefined;
    value = parseInt(text.slice(begin, j), 16);
  } else {
    while (j < text.length && text[j] >= '0' && text[j] <= '9') j++;
    const digits = text.slice(start, j);
    value = digits.length > 1 && digits[0] === '0' ? parseInt(digits, 8) : parseInt(digits, 10);
    if (Number.isNaN(value)) value = parseInt(digits, 10);
  }

  if (Number.isNaN(value)) return undefined;

  // Skip integer suffixes.
  while (j < text.length && (text[j] === 'u' || text[j] === 'U' || text[j] === 'l' || text[j] === 'L')) j++;
  return { value, index: j };
}

function parseChar(text: string, start: number): { value: number; index: number } | undefined {
  let j = start + 1;
  if (j >= text.length) return undefined;

  let value: number;
  if (text[j] === '\\') {
    const escaped = text[j + 1];
    if (escaped === undefined) return undefined;
    value = ESCAPES[escaped] ?? escaped.charCodeAt(0);
    j += 2;
  } else {
    value = text.charCodeAt(j);
    j++;
  }

  if (text[j] === "'") j++;
  else if (text[j] === undefined) return undefined;

  return { value, index: j };
}

const ESCAPES: Record<string, number> = {
  n: 10,
  t: 9,
  r: 13,
  '0': 0,
  '\\': 92,
  "'": 39,
  '"': 34,
};

function isIdentStart(c: string): boolean {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_';
}

function isIdentPart(c: string): boolean {
  return isIdentStart(c) || (c >= '0' && c <= '9');
}

function isHexDigit(c: string): boolean {
  return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F');
}
