import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { computeHints } from '../../src/core/hints';
import { syntaxFor } from '../../src/core/language';
import { scan } from '../../src/core/lexer/tokenizer';
import { Hint } from '../../src/core/types';
import { predicates, rustHarness, RustCfgSeed } from './support';

/** Golden shape of one fixture hint, as read back from `*.expected.json`. */
export interface ExpectedHint {
  line: number;
  text: string;
  kind: string;
  openLine?: number;
  closeLine?: number;
  inactive?: boolean;
}

/** The two golden fixture families: `test/fixtures/<lang>/{brackets,macros}/`. */
export type FixtureKind = 'brackets' | 'macros';

/** Maps a computed {@link Hint} to the golden shape for its family. */
export type ShapeHint = (hint: Hint) => ExpectedHint;

/** Fixture source extensions; the language itself comes from the directory. */
const SOURCE_EXTENSIONS = ['.c', '.cpp', '.cs', '.rs'];

/** Languages, in directory order: `test/fixtures/<lang>/<kind>/`. */
const LANGUAGES = ['c', 'cpp', 'csharp', 'rust'];

const SUITE_TITLES: Record<FixtureKind, string> = {
  brackets: 'bracket fixtures',
  macros: 'macro fixtures',
};

/** The `computeHints` switch each family turns on. */
const FAMILY_FLAGS: Record<FixtureKind, { brackets: boolean; macros: boolean }> = {
  brackets: { brackets: true, macros: false },
  macros: { brackets: false, macros: true },
};

/**
 * Runs the golden-fixture suite for one family. Both families share the runner
 * and the language-appropriate inputs; each caller supplies its own golden
 * {@link ShapeHint} (brackets keep `openLine`/`closeLine`, macros do not).
 */
export function runFixtureSuite(kind: FixtureKind, shape: ShapeHint): void {
  describe(SUITE_TITLES[kind], () => {
    for (const languageId of LANGUAGES) {
      const dir = join(process.cwd(), 'test', 'fixtures', languageId, kind);
      for (const file of readdirSync(dir).filter((f) => SOURCE_EXTENSIONS.includes(extname(f)))) {
        it(`${languageId}/${kind}/${file}`, () => {
          const text = readFileSync(join(dir, file), 'utf8');
          const expected: ExpectedHint[] = JSON.parse(
            readFileSync(join(dir, replaceExtension(file, '.expected.json')), 'utf8')
          );
          const actual = computeHints(text, {
            ...FAMILY_FLAGS[kind],
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
}

/**
 * Language-appropriate inputs for `computeHints`: the C family uses the
 * tokenizer + preprocessor predicates seeded from `<case>.macros.json` (absent
 * for bracket fixtures); Rust uses the `scanRust` + `#[cfg]` harness seeded
 * from `<case>.cfg.json`.
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

/**
 * Optional `<case>.macros.json` next to a C-family fixture, e.g. `{ "X": "1" }`,
 * which defines macros before the conditional evaluation runs.
 */
function seedFor(dir: string, file: string): Record<string, string> {
  const seedPath = join(dir, replaceExtension(file, '.macros.json'));
  return existsSync(seedPath) ? JSON.parse(readFileSync(seedPath, 'utf8')) : {};
}

/** Replaces the fixture's extension, e.g. `x.cpp` -> `x.expected.json`. */
function replaceExtension(file: string, suffix: string): string {
  return file.slice(0, file.length - extname(file).length) + suffix;
}
