import { describe, expect, it } from 'vitest';
import { syntaxFor } from '../../src/core/language';
import { scan } from '../../src/core/lexer/tokenizer';
import { evaluateConditionals } from '../../src/core/match/c-preprocessor';
import { MacroDef } from '../../src/core/types';

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
