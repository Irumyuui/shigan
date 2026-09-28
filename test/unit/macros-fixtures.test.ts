import { existsSync, readFileSync, readdirSync } from 'node:fs';
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
  inactive?: boolean;
}

/** Fixture extension -> VSCode language id. */
const LANGUAGES: Record<string, string> = { '.c': 'c', '.cpp': 'cpp', '.cs': 'csharp' };
const EXTENSIONS = Object.keys(LANGUAGES);

const macrosDir = join(process.cwd(), 'test', 'fixtures', 'macros');

describe('macro fixtures', () => {
  for (const file of readdirSync(macrosDir).filter((f) => EXTENSIONS.includes(extname(f)))) {
    it(file, () => {
      const text = readFileSync(join(macrosDir, file), 'utf8');
      const languageId = LANGUAGES[extname(file)];
      const expected: ExpectedHint[] = JSON.parse(
        readFileSync(join(macrosDir, replaceExtension(file, '.expected.json')), 'utf8')
      );
      const actual = computeHints(text, {
        brackets: false,
        macros: true,
        trigger: 'always',
        showRange: true,
        showLabel: true,
        ...predicates(text, seedFor(file), languageId),
        scanned: scan(text, syntaxFor(languageId)),
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

/** Replaces the fixture's extension, e.g. `x.cpp` -> `x.macros.json`. */
function replaceExtension(file: string, suffix: string): string {
  return file.slice(0, file.length - extname(file).length) + suffix;
}

/**
 * Optional `<case>.macros.json` next to a fixture, e.g. `{ "X": "1" }`, which
 * defines macros before the conditional evaluation runs. The fixture's own
 * extension is replaced, so it works for `.c`, `.cpp` and `.cs` alike.
 */
function seedFor(file: string): Record<string, string> {
  const seedPath = join(macrosDir, replaceExtension(file, '.macros.json'));
  return existsSync(seedPath) ? JSON.parse(readFileSync(seedPath, 'utf8')) : {};
}
