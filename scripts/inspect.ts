/**
 * Dev helper: print the hints Shigan would render for a file.
 *
 *   bun run inspect [file] [always|cursor]
 */
import { existsSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { findCargoFeatures, hasAncestorManifest } from '../src/cargo-source';
import { computeHints } from '../src/core/hints';
import { syntaxFor } from '../src/core/language';
import { scanRust } from '../src/core/lexer/rust';
import { scan } from '../src/core/lexer/tokenizer';
import { cConditionals, evaluateConditionals } from '../src/core/match/c-preprocessor';
import { hostCfg, parseRustCfgEntries, RustCfgEnvironment } from '../src/core/match/rust/cfg';
import { rustConditionals } from '../src/core/match/rust/conditionals';
import { Hint, MacroDef } from '../src/core/types';

const file = process.argv[2] ?? join(process.cwd(), 'test', 'manual', 'sample.c');
const trigger = (process.argv[3] as 'always' | 'cursor') ?? 'always';
const text = readFileSync(file, 'utf8');
const lines = text.split(/\r?\n/);
const language = languageFor(file);

if (language === 'rust') {
  const scanned = scanRust(text);
  const model = rustConditionals({ scanned, lines, environment: rustEnvironment(file) });

  for (const kind of ['brackets', 'macros'] as const) {
    print(
      kind,
      computeHints(text, {
        brackets: kind === 'brackets',
        macros: kind === 'macros',
        trigger,
        showRange: true,
        showLabel: true,
        inactive: (line) => model.inactiveLines?.has(line) === true,
        scanned,
        conditionals: model,
      })
    );
  }
} else {
  const syntax = syntaxFor(language);

  // Mirror the fixture harness: an optional `<case>.macros.json` defines macros.
  const seedPath = file.replace(/\.[^./\\]+$/, '.macros.json');
  const seed: Record<string, string> = existsSync(seedPath)
    ? JSON.parse(readFileSync(seedPath, 'utf8'))
    : {};
  const seedMacros = new Map<string, MacroDef>();
  for (const [name, value] of Object.entries(seed)) {
    seedMacros.set(name, { value, functionLike: false });
  }

  const scanned = scan(text, syntax);
  const { inactiveLines, branchActive, blockActive } = evaluateConditionals(scanned.directives, {
    macros: seedMacros,
    trackFileDefines: true,
    syntax,
  });
  const conditionals = cConditionals(scanned.directives, {
    branchActive: (line) => branchActive.get(line),
    blockActive: (line) => blockActive.get(line),
  });

  for (const kind of ['brackets', 'macros'] as const) {
    print(
      kind,
      computeHints(text, {
        brackets: kind === 'brackets',
        macros: kind === 'macros',
        trigger,
        showRange: true,
        showLabel: true,
        inactive: (line) => inactiveLines.has(line),
        scanned,
        conditionals,
      })
    );
  }
}

function print(kind: 'brackets' | 'macros', hints: Hint[]): void {
  console.log(`\n=== ${kind} (${trigger}) — ${hints.length} hint(s) ===`);
  for (const hint of hints) {
    const source = (lines[hint.line] ?? '').trimEnd();
    const jumps = hint.parts
      .map((part) => part.target)
      .filter((target): target is { line: number; col: number } => target !== undefined)
      .map((target) => `line ${target.line + 1}`);
    const jump = jumps.length > 0 ? ` -> ${jumps.join(' | ')}` : '';
    const inactive = hint.inactive ? ' (inactive)' : '';
    console.log(`${String(hint.line + 1).padStart(4)}: ${source}${hint.text}${inactive}${jump}`);
  }
}

/**
 * Rust cfg environment: a `<file>.cfg.json` seed wins; otherwise the observed
 * host plus the nearest Cargo.toml's features.
 */
function rustEnvironment(filePath: string): RustCfgEnvironment {
  const seedPath = filePath.replace(/\.[^./\\]+$/, '.cfg.json');
  if (existsSync(seedPath)) {
    const seed = JSON.parse(readFileSync(seedPath, 'utf8'));
    const environment: RustCfgEnvironment = {};
    if (seed.host) environment.host = hostCfg(seed.host.platform, seed.host.arch).predicates;
    if (Array.isArray(seed.cfg)) environment.explicit = parseRustCfgEntries(seed.cfg);
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

  const environment: RustCfgEnvironment = {
    host: hostCfg(process.platform, process.arch).predicates,
  };
  const cargo = findCargoFeatures(filePath);
  if (cargo) {
    environment.features = {
      decidableAbsence: !cargo.virtual && !hasAncestorManifest(filePath),
      universe: new Set([...cargo.declared, ...cargo.implicit]),
      enabled: cargo.defaults,
    };
  }
  return environment;
}

/** Maps a file extension to a Shigan language id. */
function languageFor(filePath: string): string {
  switch (extname(filePath).toLowerCase()) {
    case '.cpp':
    case '.cc':
    case '.cxx':
    case '.hpp':
      return 'cpp';
    case '.cs':
      return 'csharp';
    case '.rs':
      return 'rust';
    default:
      return 'c';
  }
}
