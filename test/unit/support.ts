import { ConditionalModel } from '../../src/core/conditionals';
import { syntaxFor } from '../../src/core/language';
import { scanRust } from '../../src/core/lexer/rust';
import { scan } from '../../src/core/lexer/tokenizer';
import { cConditionals, evaluateConditionals } from '../../src/core/match/c-preprocessor';
import { hostCfg, parseRustCfgEntries, RustCfgEnvironment } from '../../src/core/match/rust/cfg';
import { rustConditionals } from '../../src/core/match/rust/conditionals';
import { MacroDef, ScanResult } from '../../src/core/types';

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

/**
 * Environment seed for a Rust fixture. Everything is explicit so Linux CI and a
 * Windows dev box agree: the host is whatever the seed says, not `process`.
 */
export interface RustCfgSeed {
  host?: { platform: string; arch: string };
  features?: { default?: string[]; declared?: string[]; implicit?: string[] };
  manifest?: { virtual?: boolean; workspaceMember?: boolean };
  cfg?: string[];
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
    environment: rustEnvironment(seed),
  });

  return {
    scanned,
    conditionals,
    inactive: (line) => conditionals.inactiveLines?.has(line) === true,
  };
}

/** Builds a {@link RustCfgEnvironment} from a seed; absent fields stay absent. */
function rustEnvironment(seed: RustCfgSeed): RustCfgEnvironment {
  const environment: RustCfgEnvironment = {
    explicit: parseRustCfgEntries(seed.cfg ?? []),
  };
  if (seed.host) environment.host = hostCfg(seed.host.platform, seed.host.arch).predicates;
  if (seed.features) {
    const manifest = seed.manifest ?? {};
    environment.features = {
      decidableAbsence: !manifest.virtual && !manifest.workspaceMember,
      universe: new Set([...(seed.features.declared ?? []), ...(seed.features.implicit ?? [])]),
      enabled: new Set(seed.features.default ?? []),
    };
  }
  return environment;
}
