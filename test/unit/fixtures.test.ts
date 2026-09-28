import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { computeHints } from '../../src/core/hints';
import { syntaxFor } from '../../src/core/language';
import { scan } from '../../src/core/lexer/tokenizer';
import { Hint } from '../../src/core/types';
import { predicates, rustHarness, RustCfgSeed } from './support';

interface ExpectedHint {
  line: number;
  text: string;
  kind: string;
  openLine?: number;
  closeLine?: number;
  inactive?: boolean;
}

/** Fixture source extensions; the language itself comes from the directory. */
const SOURCE_EXTENSIONS = ['.c', '.cpp', '.cs', '.rs'];

/** Languages, in directory order: `test/fixtures/<lang>/brackets/`. */
const LANGUAGES = ['c', 'cpp', 'csharp', 'rust'];

describe('bracket fixtures', () => {
  for (const languageId of LANGUAGES) {
    const dir = join(process.cwd(), 'test', 'fixtures', languageId, 'brackets');
    for (const file of readdirSync(dir).filter((f) => SOURCE_EXTENSIONS.includes(extname(f)))) {
      it(`${languageId}/brackets/${file}`, () => {
        const text = readFileSync(join(dir, file), 'utf8');
        const expected: ExpectedHint[] = JSON.parse(
          readFileSync(join(dir, replaceExtension(file, '.expected.json')), 'utf8')
        );
        const actual = computeHints(text, {
          brackets: true,
          macros: false,
          trigger: 'always',
          showRange: true,
          showLabel: true,
          ...inputsFor(text, dir, file, languageId),
        }).map(shape);
        expect(actual).toEqual(expected);
      });
    }
  }
});

/**
 * Language-appropriate inputs for `computeHints`: the C family uses the
 * tokenizer + preprocessor predicates, Rust uses the `scanRust` + `#[cfg]`
 * harness (with an optional `<case>.cfg.json` seed).
 */
function inputsFor(
  text: string,
  dir: string,
  file: string,
  languageId: string
): Record<string, unknown> {
  if (languageId === 'rust') {
    const harness = rustHarness(text, cfgSeedFor(dir, file));
    return {
      scanned: harness.scanned,
      inactive: harness.inactive,
      conditionals: harness.conditionals,
    };
  }
  return {
    scanned: scan(text, syntaxFor(languageId)),
    ...predicates(text, {}, languageId),
  };
}

/** Optional `<case>.cfg.json` next to a Rust fixture; `{}` when absent. */
function cfgSeedFor(dir: string, file: string): RustCfgSeed {
  const seedPath = join(dir, replaceExtension(file, '.cfg.json'));
  return existsSync(seedPath) ? JSON.parse(readFileSync(seedPath, 'utf8')) : {};
}

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
