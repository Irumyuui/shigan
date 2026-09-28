import { ConditionalModel } from '../../src/core/conditionals';
import { syntaxFor } from '../../src/core/language';
import { scanRust } from '../../src/core/lexer/rust';
import { scan } from '../../src/core/lexer/tokenizer';
import { cConditionals, evaluateConditionals } from '../../src/core/match/c-preprocessor';
import { environmentFromSeed, type RustCfgSeed } from '../../src/core/match/rust/cfg';
import { rustConditionals } from '../../src/core/match/rust/conditionals';
import { MacroDef, ScanResult } from '../../src/core/types';

export type { RustCfgSeed };

export interface Predicates {
  inactive: (line: number) => boolean;
  /** The directive model with activity already resolved by the evaluator. */
  conditionals: ConditionalModel;
}

/**
 * The same condition evaluation the extension wires into `computeHints`.
 * `languageId` selects the syntax profile; the default (`c`) keeps the
 * historical behavior.
 */
export function predicates(
  text: string,
  seed: Record<string, string> = {},
  languageId = 'c'
): Predicates {
  const macros = new Map<string, MacroDef>();
  for (const [name, value] of Object.entries(seed)) {
    macros.set(name, { value, functionLike: false });
  }

  const syntax = syntaxFor(languageId);
  const scanned = scan(text, syntax);
  const result = evaluateConditionals(scanned.directives, {
    macros,
    trackFileDefines: true,
    syntax,
  });

  return {
    inactive: (line) => result.inactiveLines.has(line),
    conditionals: cConditionals(scanned.directives, {
      branchActive: (line) => result.branchActive.get(line),
      blockActive: (line) => result.blockActive.get(line),
    }),
  };
}

export interface RustHarness {
  scanned: ScanResult;
  conditionals: ConditionalModel;
  inactive: (line: number) => boolean;
}

/**
 * Rust counterpart of {@link predicates}: scans the text and builds the
 * `#[cfg]` model from a platform-independent seed (mirroring
 * `scripts/inspect.ts`). Returns the scan result and the conditional model so
 * `computeHints` can be driven exactly like the extension does.
 */
export function rustHarness(text: string, seed: RustCfgSeed = {}): RustHarness {
  const scanned = scanRust(text);
  const conditionals = rustConditionals({
    scanned,
    lines: text.split(/\r?\n/),
    environment: environmentFromSeed(seed),
  });

  return {
    scanned,
    conditionals,
    inactive: (line) => conditionals.inactiveLines?.has(line) === true,
  };
}
