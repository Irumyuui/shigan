import { describe, expect, it } from 'vitest';
import { computeHints } from '../../src/core/hints';

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
});
