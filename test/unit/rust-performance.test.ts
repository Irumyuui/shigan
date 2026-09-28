import { describe, expect, it } from 'vitest';
import { scanRust } from '../../src/core/lexer/rust';
import { pairCfgItems } from '../../src/core/match/rust/items';

/**
 * Scale guard for the `#[cfg]` item pairing, not a benchmark.
 *
 * `pairCfgItems` used to rescan every bracket from the start of the file per
 * cfg attribute (macro-body check, brace depth, first-`{` search), so it grew
 * quadratically with the number of items. The generator below is
 * deliberately brace-heavy: each item holds 7 brace pairs, which is what made
 * the old scan explode.
 *
 * Measured at the chosen size (12000 cfgs / ~276k lines): the quadratic scan
 * takes ~11 s (extrapolated from 5.6 s at 8600 cfgs, quadratic fit), the
 * line-indexed scan ~115 ms standalone. A concurrent full-suite run inflates
 * short tests heavily, so the 10 s budget is intentionally loose (>5x over the
 * ~1.5-2 s a contended run costs the fixed code) while still rejecting the
 * quadratic scan in any realistic environment.
 */
function generateCfgItems(count: number): string {
  const parts: string[] = [];
  for (let i = 0; i < count; i++) {
    parts.push(`#[cfg(feature = "f${i}")]`);
    parts.push(`fn f${i}(a: u32) {`);
    parts.push('    let mut r = 0;');
    parts.push('    if a > 0 {');
    parts.push('        r += 1;');
    parts.push('        if r > 1 {');
    parts.push('            r += 2;');
    parts.push('        }');
    parts.push('    }');
    parts.push('    while r < a {');
    parts.push('        r += 1;');
    parts.push('        if r % 2 == 0 {');
    parts.push('            r += 3;');
    parts.push('        }');
    parts.push('    }');
    parts.push('    for x in 0..a {');
    parts.push('        r -= x;');
    parts.push('        while x > 0 {');
    parts.push('            r += x;');
    parts.push('        }');
    parts.push('    }');
    parts.push('    r');
    parts.push('}');
  }
  return parts.join('\n') + '\n';
}

describe('rust cfg pairing performance', () => {
  it('pairs a large brace-heavy document of cfg items quickly', () => {
    const count = 12000;
    const text = generateCfgItems(count);
    const lines = text.split('\n');

    const start = performance.now();
    const spans = pairCfgItems(scanRust(text), lines);
    const elapsed = performance.now() - start;
    console.log(`pairCfgItems ${count} cfgs / ${lines.length} lines: ${elapsed.toFixed(0)} ms`);

    expect(spans).toHaveLength(count);
    // Loose guard: the quadratic scan needed ~11 s here; the indexed scan stays
    // far below, and the generous budget absorbs concurrent-full-suite contention.
    expect(elapsed).toBeLessThan(10000);
  }, 60000);
});
