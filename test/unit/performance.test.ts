import { describe, expect, it } from 'vitest';
import { computeHints } from '../../src/core/hints';
import { Hint } from '../../src/core/types';
import { predicates } from './support';

function generate(lineCount: number): string {
  const out: string[] = [];
  for (let i = 0; i < lineCount; i++) {
    if (i % 7 === 0) out.push(`#if FEATURE_${i}`);
    else if (i % 7 === 3) out.push('#endif');
    else if (i % 5 === 0) out.push(`void f${i}(void) {`);
    else if (i % 5 === 2) out.push('}');
    else out.push(`int v${i} = ${i};`);
  }
  return out.join('\n') + '\n';
}

/**
 * Realistic C: every function holds 5 multi-line brace pairs (function body,
 * if, for, else, while) and a 3-branch `#if` chain, so every function must
 * produce exactly 5 bracket hints + 3 directive hints (`#elif`, `#else`,
 * `#endif`).
 */
function generateRealistic(functionCount: number): string {
  const parts: string[] = ['#include <stdio.h>', ''];
  for (let f = 0; f < functionCount; f++) {
    parts.push(`static int func_${f}(int a, int b) {`);
    parts.push('    int r = 0;');
    parts.push('    if (a > b) {');
    parts.push('        for (int i = 0; i < a; i++) {');
    parts.push('            r += i * b;');
    parts.push('        }');
    parts.push('    } else {');
    parts.push('        while (b--) {');
    parts.push(`            r -= a; // comment ${f}`);
    parts.push('        }');
    parts.push('    }');
    parts.push('#if defined(DEBUG) && DEBUG > 1');
    parts.push('    printf("v=%d\\n", r);');
    parts.push('#elif DEBUG');
    parts.push('    (void)r;');
    parts.push('#else');
    parts.push('    r = r;');
    parts.push('#endif');
    parts.push('    return r;');
    parts.push('}');
    parts.push('');
  }
  return parts.join('\n');
}

/** Scale invariants: hints stay sorted and `text` stays the parts concatenation. */
function expectConsistentHints(hints: Hint[]): void {
  const sorted = hints.every((hint, index) => index === 0 || hints[index - 1].line <= hint.line);
  const textsMatch = hints.every(
    (hint) => !hint.parts || hint.parts.map((part) => part.text).join('') === hint.text
  );
  expect(sorted, 'hints are sorted by line').toBe(true);
  expect(textsMatch, 'hint.text equals the concatenation of its parts').toBe(true);
}

describe('performance', () => {
  it('computes hints for a 20k-line file quickly', () => {
    const text = generate(20000);
    const start = performance.now();
    const hints = computeHints(text, {
      brackets: true,
      macros: true,
      trigger: 'always',
    });
    const elapsed = performance.now() - start;

    expect(hints.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(500);
  });

  it('handles a 100k-line document with both triggers', () => {
    const text = generate(100_000);

    const alwaysStart = performance.now();
    const always = computeHints(text, { brackets: true, macros: true, trigger: 'always' });
    const alwaysElapsed = performance.now() - alwaysStart;

    const cursorStart = performance.now();
    computeHints(text, {
      brackets: true,
      macros: true,
      trigger: 'cursor',
      cursorOffset: text.length - 1,
    });
    const cursorElapsed = performance.now() - cursorStart;

    expect(always.length).toBeGreaterThan(0);
    expect(alwaysElapsed).toBeLessThan(3000);
    expect(cursorElapsed).toBeLessThan(3000);
    expectConsistentHints(always);
  }, 15000);

  it('computes exactly 8 hints per function in a realistic 50k-line file', () => {
    const functions = 2500;
    const text = generateRealistic(functions);

    const start = performance.now();
    const hints = computeHints(text, { brackets: true, macros: true, trigger: 'always' });
    const elapsed = performance.now() - start;

    expect(hints).toHaveLength(functions * 8);
    expect(elapsed).toBeLessThan(3000);
    expectConsistentHints(hints);
  }, 15000);

  it('finds the pair under the cursor at the end of a realistic file', () => {
    const functions = 2500;
    const text = generateRealistic(functions);

    const start = performance.now();
    const hints = computeHints(text, {
      brackets: true,
      macros: true,
      trigger: 'cursor',
      cursorOffset: text.length - 1,
    });
    const elapsed = performance.now() - start;

    const lastLine = text.split('\n').length - 2; // trailing newline -> last element is ''
    expect(hints).toEqual([
      expect.objectContaining({
        kind: 'bracket',
        openLine: lastLine - 19,
        closeLine: lastLine,
        target: { line: lastLine - 19, col: 35 },
      }),
    ]);
    expect(elapsed).toBeLessThan(3000);
  }, 15000);

  it('handles a 50k-line inactive branch', () => {
    const text = '#if 0\n' + 'int a;\n'.repeat(50_000) + '#endif\n';
    const evaluation = predicates(text);

    const start = performance.now();
    const hints = computeHints(text, {
      brackets: true,
      macros: true,
      trigger: 'always',
      ...evaluation,
    });
    const elapsed = performance.now() - start;

    expect(hints).toHaveLength(1);
    expect(hints[0].inactive).toBe(true);
    expect(elapsed).toBeLessThan(2000);
  }, 15000);

  it('pairs 10k conditional blocks', () => {
    const text = Array.from({ length: 10_000 }, (_, i) => `#if X${i}\n#endif`).join('\n') + '\n';

    const start = performance.now();
    const hints = computeHints(text, { brackets: false, macros: true, trigger: 'always' });
    const elapsed = performance.now() - start;

    expect(hints).toHaveLength(10_000);
    expect(elapsed).toBeLessThan(2000);
  });

  it('handles 20k nested brackets on a single line', () => {
    const depth = 20_000;
    const text = 'int x = ' + '('.repeat(depth) + '1' + ')'.repeat(depth) + ';\n';

    const start = performance.now();
    const hints = computeHints(text, { brackets: true, macros: false, trigger: 'always' });
    const elapsed = performance.now() - start;

    // Same-line pairs are not hinted in `always` mode.
    expect(hints).toHaveLength(0);
    expect(elapsed).toBeLessThan(2000);
  });

  it('bounds chained macro expansion inside #if', () => {
    const lines = ['#define A0 1'];
    for (let i = 1; i <= 16; i++) lines.push(`#define A${i} A${i - 1}+A${i - 1}`);
    lines.push('#if A16', '#endif');
    const text = lines.join('\n') + '\n';
    const evaluation = predicates(text);

    const start = performance.now();
    const hints = computeHints(text, {
      brackets: false,
      macros: true,
      trigger: 'always',
      ...evaluation,
    });
    const elapsed = performance.now() - start;

    expect(hints).toHaveLength(1);
    expect(hints[0].inactive).toBeUndefined();
    expect(elapsed).toBeLessThan(3000);
  }, 15000);
});
