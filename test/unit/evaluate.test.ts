import { describe, expect, it } from 'vitest';
import { syntaxFor } from '../../src/core/language';
import { scan } from '../../src/core/lexer/tokenizer';
import { evaluateConditionals } from '../../src/core/match/evaluate';
import { MacroDef } from '../../src/core/types';

function evaluate(text: string, seed: Record<string, string> = {}, trackFileDefines = true) {
  const macros = new Map<string, MacroDef>();
  for (const [name, value] of Object.entries(seed)) {
    macros.set(name, { value, functionLike: false });
  }
  return evaluateConditionals(scan(text).directives, { macros, trackFileDefines });
}

function evaluateCSharp(text: string, seed: Record<string, string> = {}) {
  const macros = new Map<string, MacroDef>();
  for (const [name, value] of Object.entries(seed)) {
    macros.set(name, { value, functionLike: false });
  }
  return evaluateConditionals(scan(text).directives, { macros, syntax: syntaxFor('csharp') });
}

function sortedLines(lines: Set<number>): number[] {
  return [...lines].sort((a, b) => a - b);
}

describe('evaluateConditionals', () => {
  it('marks the inactive #if branch', () => {
    const { inactiveLines, branchActive, blockActive } = evaluate('#if 0\nint a;\n#else\nint b;\n#endif\n');
    expect(sortedLines(inactiveLines)).toEqual([1]);
    expect(branchActive.get(0)).toBe(false);
    expect(branchActive.get(2)).toBe(true);
    expect(blockActive.get(0)).toBe(true);
  });

  it('uses seeded macros for #ifdef', () => {
    const text = '#ifdef FEATURE\nint a;\n#else\nint b;\n#endif\n';
    const off = evaluate(text);
    expect(off.branchActive.get(0)).toBe(false);
    expect(off.branchActive.get(2)).toBe(true);
    expect(off.blockActive.get(0)).toBe(true);

    const on = evaluate(text, { FEATURE: '1' });
    expect(on.branchActive.get(0)).toBe(true);
    expect(on.branchActive.get(2)).toBe(false);
    expect(on.blockActive.get(0)).toBe(true);
  });

  it('tracks #define / #undef in the file', () => {
    const text = '#define X 1\n#if X\nint a;\n#else\nint b;\n#endif\n';
    const { branchActive } = evaluate(text);
    expect(branchActive.get(1)).toBe(true);
    expect(branchActive.get(3)).toBe(false);
  });

  it('ignores file defines when tracking is disabled', () => {
    const text = '#define X 1\n#if X\nint a;\n#else\nint b;\n#endif\n';
    const { branchActive } = evaluate(text, {}, false);
    expect(branchActive.get(1)).toBe(false);
    expect(branchActive.get(3)).toBe(true);
  });

  it('handles elif chains', () => {
    const { branchActive, inactiveLines, blockActive } = evaluate(
      '#if 0\n#elif 1\nint a;\n#else\nint b;\n#endif\n'
    );
    expect(branchActive.get(0)).toBe(false);
    expect(branchActive.get(1)).toBe(true);
    expect(branchActive.get(3)).toBe(false);
    // Only body lines are inactive; directive lines are always processed.
    expect(sortedLines(inactiveLines)).toEqual([4]);
    expect(blockActive.get(0)).toBe(true);
  });

  it('reports a fully inactive block', () => {
    const { inactiveLines, branchActive, blockActive } = evaluate('#if 0\nint a;\n#endif\n');
    expect(sortedLines(inactiveLines)).toEqual([1]);
    expect(branchActive.get(0)).toBe(false);
    expect(blockActive.get(0)).toBe(false);
  });

  it('treats unknown conditions conservatively', () => {
    const { inactiveLines, branchActive, blockActive } = evaluate(
      '#if MAX(1,2)\nint a;\n#else\nint b;\n#endif\n'
    );
    expect(sortedLines(inactiveLines)).toEqual([]);
    expect(branchActive.get(0)).toBe(true);
    expect(branchActive.get(2)).toBe(true);
    expect(blockActive.get(0)).toBe(true);
  });

  it('propagates inactivity into nested blocks', () => {
    // OUTER is undefined, so the whole nested block is dead too.
    const result = evaluate('#ifdef OUTER\n#if 1\nint a;\n#endif\n#endif\n');
    expect(result.branchActive.get(1)).toBe(false);
    expect(result.blockActive.get(1)).toBe(false);
    expect(sortedLines(result.inactiveLines)).toEqual([1, 2, 3]);
  });

  it('handles directives continued with a backslash', () => {
    const result = evaluate('#if defined(A) && \\\n    defined(B)\nint a;\n#endif\n', { A: '1', B: '1' });
    expect(result.branchActive.get(0)).toBe(true);
    expect(result.blockActive.get(0)).toBe(true);
  });
});

describe('evaluateConditionals (C#)', () => {
  it('treats a value-less #define as truthy', () => {
    const { branchActive, inactiveLines, blockActive } = evaluateCSharp(
      '#define FOO\n#if FOO\nint a;\n#else\nint b;\n#endif\n'
    );
    expect(branchActive.get(1)).toBe(true);
    expect(branchActive.get(3)).toBe(false);
    expect(sortedLines(inactiveLines)).toEqual([4]);
    expect(blockActive.get(1)).toBe(true);
  });

  it('evaluates the true/false literals', () => {
    const truthy = evaluateCSharp('#if true\nint a;\n#else\nint b;\n#endif\n');
    expect(truthy.branchActive.get(0)).toBe(true);
    expect(truthy.branchActive.get(2)).toBe(false);

    const falsy = evaluateCSharp('#if false\nint a;\n#else\nint b;\n#endif\n');
    expect(falsy.branchActive.get(0)).toBe(false);
    expect(falsy.branchActive.get(2)).toBe(true);
  });

  it('lets a file definition override the true/false literals', () => {
    const { branchActive } = evaluateCSharp('#define true 0\n#if true\nint a;\n#else\nint b;\n#endif\n');
    expect(branchActive.get(1)).toBe(false);
    expect(branchActive.get(3)).toBe(true);
  });

  it('keeps an unresolved use of an undefined symbol conservative', () => {
    // `UNKNOWN(1)` cannot be resolved deterministically, so nothing is marked
    // inactive and both branches stay live. (A bare `#if UNKNOWN` is a
    // different, known-false case: identifiers evaluate to 0.)
    const { branchActive, inactiveLines } = evaluateCSharp(
      '#if UNKNOWN(1)\nint a;\n#else\nint b;\n#endif\n'
    );
    expect(sortedLines(inactiveLines)).toEqual([]);
    expect(branchActive.get(0)).toBe(true);
    expect(branchActive.get(2)).toBe(true);
  });

  it('lets #undef cancel a value-less #define', () => {
    const { branchActive, inactiveLines } = evaluateCSharp(
      '#define FOO\n#undef FOO\n#if FOO\nint a;\n#else\nint b;\n#endif\n'
    );
    expect(branchActive.get(2)).toBe(false);
    expect(branchActive.get(4)).toBe(true);
    expect(sortedLines(inactiveLines)).toEqual([3]);
  });

  it('negates a value-less define with !', () => {
    const withDefine = evaluateCSharp(
      '#define FOO\n#if !FOO\nint a;\n#else\nint b;\n#endif\n'
    );
    expect(withDefine.branchActive.get(1)).toBe(false);
    expect(withDefine.branchActive.get(3)).toBe(true);

    const withoutDefine = evaluateCSharp('#if !FOO\nint a;\n#else\nint b;\n#endif\n');
    expect(withoutDefine.branchActive.get(0)).toBe(true);
    expect(withoutDefine.branchActive.get(2)).toBe(false);
  });

  it('handles an elif chain over the true/false literals', () => {
    const { branchActive, inactiveLines, blockActive } = evaluateCSharp(
      '#if false\nint a;\n#elif true\nint b;\n#else\nint c;\n#endif\n'
    );
    expect(branchActive.get(0)).toBe(false);
    expect(branchActive.get(2)).toBe(true);
    expect(branchActive.get(4)).toBe(false);
    // Both the `#if false` and `#else` bodies are inactive.
    expect(sortedLines(inactiveLines)).toEqual([1, 5]);
    expect(blockActive.get(0)).toBe(true);
  });

  it('treats #define FOO 0 as false', () => {
    const { branchActive, inactiveLines } = evaluateCSharp(
      '#define FOO 0\n#if FOO\nint a;\n#else\nint b;\n#endif\n'
    );
    expect(branchActive.get(1)).toBe(false);
    expect(branchActive.get(3)).toBe(true);
    expect(sortedLines(inactiveLines)).toEqual([2]);
  });

  it('pins the function-like define behavior (C#-invalid construct)', () => {
    // `#define FOO(x)` is not a valid C# preprocessor directive (C# has no
    // function-like macros). Shigan keeps the empty replacement and treats
    // `FOO` as unresolved, so nothing is marked inactive — conservative, and
    // pinned here so a future change to the C# path cannot silently make this
    // construct mark code dead.
    const { branchActive, inactiveLines } = evaluateCSharp(
      '#define FOO(x)\n#if FOO\nint a;\n#else\nint b;\n#endif\n'
    );
    expect(sortedLines(inactiveLines)).toEqual([]);
    expect(branchActive.get(1)).toBe(true);
    expect(branchActive.get(3)).toBe(true);
  });

  it('does not apply a #define that sits in an inactive branch', () => {
    const { branchActive } = evaluateCSharp(
      '#if 0\n#define FOO\n#endif\n#if FOO\nint a;\n#else\nint b;\n#endif\n'
    );
    expect(branchActive.get(3)).toBe(false);
    expect(branchActive.get(5)).toBe(true);
  });

  it('matches symbols case-sensitively', () => {
    const { branchActive } = evaluateCSharp(
      '#define DEBUG\n#if debug\nint a;\n#else\nint b;\n#endif\n'
    );
    expect(branchActive.get(1)).toBe(false);
    expect(branchActive.get(3)).toBe(true);
  });

  it('treats a bare #if UNDEFINED as known false', () => {
    // C# allows referencing an undefined symbol; it evaluates to 0, so the
    // branch is decisively false (not the conservative both-live case).
    const { branchActive, inactiveLines, blockActive } = evaluateCSharp(
      '#if UNDEFINED\nint a;\n#else\nint b;\n#endif\n'
    );
    expect(branchActive.get(0)).toBe(false);
    expect(branchActive.get(2)).toBe(true);
    expect(sortedLines(inactiveLines)).toEqual([1]);
    expect(blockActive.get(0)).toBe(true);
  });
});
