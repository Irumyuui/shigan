import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { computeHints } from '../../src/core/hints';
import { Hint } from '../../src/core/types';
import { predicates } from './support';

interface ExpectedHint {
  line: number;
  text: string;
  kind: string;
  inactive?: boolean;
}

const macrosDir = join(process.cwd(), 'test', 'fixtures', 'macros');

describe('macro fixtures', () => {
  for (const file of readdirSync(macrosDir).filter((f) => f.endsWith('.c'))) {
    it(file, () => {
      const text = readFileSync(join(macrosDir, file), 'utf8');
      const expected: ExpectedHint[] = JSON.parse(
        readFileSync(join(macrosDir, file.replace(/\.c$/, '.expected.json')), 'utf8')
      );
      const actual = computeHints(text, {
        brackets: false,
        macros: true,
        trigger: 'always',
        showRange: true,
        showLabel: true,
        ...predicates(text, seedFor(file)),
      }).map((hint: Hint) => ({
        line: hint.line,
        text: hint.text,
        kind: hint.kind,
        inactive: hint.inactive,
      }));
      expect(actual).toEqual(expected);
    });
  }
});

/**
 * Optional `<case>.macros.json` next to a fixture, e.g. `{ "X": "1" }`, which
 * defines macros before the conditional evaluation runs.
 */
function seedFor(file: string): Record<string, string> {
  const seedPath = join(macrosDir, file.replace(/\.c$/, '.macros.json'));
  return existsSync(seedPath) ? JSON.parse(readFileSync(seedPath, 'utf8')) : {};
}
