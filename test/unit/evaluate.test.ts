import { describe, expect, it } from 'vitest';
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
