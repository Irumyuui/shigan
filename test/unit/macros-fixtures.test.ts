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
  inactive?: boolean;
}

/** Fixture source extensions; the language itself comes from the directory. */
const SOURCE_EXTENSIONS = ['.c', '.cpp', '.cs', '.rs'];

/** Languages, in directory order: `test/fixtures/<lang>/macros/`. */
const LANGUAGES = ['c', 'cpp', 'csharp', 'rust'];

describe('macro fixtures', () => {
  for (const languageId of LANGUAGES) {
    const dir = join(process.cwd(), 'test', 'fixtures', languageId, 'macros');
    for (const file of readdirSync(dir).filter((f) => SOURCE_EXTENSIONS.includes(extname(f)))) {
      it(`${languageId}/macros/${file}`, () => {
        const text = readFileSync(join(dir, file), 'utf8');
        const expected: ExpectedHint[] = JSON.parse(
          readFileSync(join(dir, replaceExtension(file, '.expected.json')), 'utf8')
        );
        const actual = computeHints(text, {
          brackets: false,
          macros: true,
          trigger: 'always',
          showRange: true,
          showLabel: true,
          ...inputsFor(text, dir, file, languageId),
        }).map((hint: Hint) => ({
          line: hint.line,
          text: hint.text,
          kind: hint.kind,
          inactive: hint.inactive,
        }));
        expect(actual).toEqual(expected);
      });
    }
  }
});

/**
 * Language-appropriate inputs for `computeHints`: the C family uses the
 * tokenizer + preprocessor predicates seeded from `<case>.macros.json`; Rust
 * uses the `scanRust` + `#[cfg]` harness seeded from `<case>.cfg.json`.
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
    ...predicates(text, seedFor(dir, file), languageId),
  };
}

/** Optional `<case>.cfg.json` next to a Rust fixture; `{}` when absent. */
function cfgSeedFor(dir: string, file: string): RustCfgSeed {
  const seedPath = join(dir, replaceExtension(file, '.cfg.json'));
  return existsSync(seedPath) ? JSON.parse(readFileSync(seedPath, 'utf8')) : {};
}

/** Replaces the fixture's extension, e.g. `x.cpp` -> `x.macros.json`. */
function replaceExtension(file: string, suffix: string): string {
  return file.slice(0, file.length - extname(file).length) + suffix;
}

/**
 * Optional `<case>.macros.json` next to a fixture, e.g. `{ "X": "1" }`, which
 * defines macros before the conditional evaluation runs. The fixture's own
 * extension is replaced, so it works for `.c`, `.cpp` and `.cs` alike.
 */
function seedFor(dir: string, file: string): Record<string, string> {
  const seedPath = join(dir, replaceExtension(file, '.macros.json'));
  return existsSync(seedPath) ? JSON.parse(readFileSync(seedPath, 'utf8')) : {};
}
