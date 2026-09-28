import { readFileSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { computeHints } from '../../src/core/hints';
import { syntaxFor } from '../../src/core/language';
import { scan } from '../../src/core/lexer/tokenizer';
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

/** Fixture extension -> VSCode language id. */
const LANGUAGES: Record<string, string> = { '.c': 'c', '.cpp': 'cpp', '.cs': 'csharp' };
const EXTENSIONS = Object.keys(LANGUAGES);

const bracketsDir = join(process.cwd(), 'test', 'fixtures', 'brackets');

describe('bracket fixtures', () => {
  for (const file of readdirSync(bracketsDir).filter((f) => EXTENSIONS.includes(extname(f)))) {
    it(file, () => {
      const text = readFileSync(join(bracketsDir, file), 'utf8');
      const languageId = LANGUAGES[extname(file)];
      const expected: ExpectedHint[] = JSON.parse(
        readFileSync(join(bracketsDir, replaceExtension(file, '.expected.json')), 'utf8')
      );
      const actual = computeHints(text, {
        brackets: true,
        macros: false,
        trigger: 'always',
        showRange: true,
        showLabel: true,
        ...predicates(text, {}, languageId),
        scanned: scan(text, syntaxFor(languageId)),
      }).map(shape);
      expect(actual).toEqual(expected);
    });
  }
});

/** Replaces the fixture's extension, e.g. `x.cpp` -> `x.expected.json`. */
function replaceExtension(file: string, suffix: string): string {
  return file.slice(0, file.length - extname(file).length) + suffix;
}

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
