import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { computeHints } from '../../src/core/hints';
import { Hint } from '../../src/core/types';
import { predicates } from './support';

interface ExpectedHint {
  line: number;
  text: string;
  kind: string;
  openLine?: number;
  closeLine?: number;
  inactive?: boolean;
}

const bracketsDir = join(process.cwd(), 'test', 'fixtures', 'brackets');

describe('bracket fixtures', () => {
  for (const file of readdirSync(bracketsDir).filter((f) => f.endsWith('.c'))) {
    it(file, () => {
      const text = readFileSync(join(bracketsDir, file), 'utf8');
      const expected: ExpectedHint[] = JSON.parse(
        readFileSync(join(bracketsDir, file.replace(/\.c$/, '.expected.json')), 'utf8')
      );
      const actual = computeHints(text, {
        brackets: true,
        macros: false,
        trigger: 'always',
        showRange: true,
        showLabel: true,
        ...predicates(text),
      }).map(shape);
      expect(actual).toEqual(expected);
    });
  }
});

function shape(hint: Hint): ExpectedHint {
  return {
    line: hint.line,
    text: hint.text,
    kind: hint.kind,
    openLine: hint.openLine,
    closeLine: hint.closeLine,
    inactive: hint.inactive,
  };
}
