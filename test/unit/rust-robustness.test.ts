import { describe, expect, it } from 'vitest';
import { computeHints } from '../../src/core/hints';
import { scanRust } from '../../src/core/lexer/rust';
import { rustHarness } from './support';

/**
 * Truncated/hostile Rust tails. Each one is a document a user can be typing in:
 * the scanner and the hint pipeline must stay conservative (no throw, no
 * invented pair) rather than guess.
 */
const TRUNCATED = [
  'fn f() { let s = "unterminated',
  "fn f() { let c = 'a",
  'fn f() { /* unterminated',
  '#[cfg(unix',
  'fn f() { let s = r#"unterminated',
  'fn f() { let x = 1; \\',
];

/** Drives `computeHints` exactly like the extension wires the Rust pipeline. */
function rustHints(text: string, macros = false) {
  const harness = rustHarness(text);
  return computeHints(text, {
    brackets: true,
    macros,
    trigger: 'always',
    scanned: harness.scanned,
    inactive: harness.inactive,
    conditionals: harness.conditionals,
  });
}

describe('Rust robustness', () => {
  it('never throws on a truncated document', () => {
    for (const text of TRUNCATED) {
      expect(() => scanRust(text), text).not.toThrow();
      expect(() => rustHints(text, true), text).not.toThrow();
    }
  });

  it('invents no bracket pair from a truncated tail', () => {
    for (const text of TRUNCATED) {
      expect(rustHints(text), text).toEqual([]);
    }
  });

  it('keeps a real pair that closes before the truncated tail', () => {
    const text = 'fn f() {\n    let x = 1;\n}\nlet s = "unterminated';
    expect(rustHints(text).map((hint) => hint.line)).toEqual([2]);
  });

  it('does not turn an unterminated #[cfg( into a conditional hint', () => {
    // `#[cfg(unix` never closes, so there is no attribute and no item to gate.
    expect(rustHints('#[cfg(unix\nfn f() {\n}\n', true)).toEqual([]);
  });
});
