/**
 * Dev helper: print the hints Shigan would render for a file.
 *
 *   bun run inspect [file] [always|cursor]
 */
import { existsSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { computeHints } from '../src/core/hints';
import { syntaxFor } from '../src/core/language';
import { scan } from '../src/core/lexer/tokenizer';
import { evaluateConditionals } from '../src/core/match/evaluate';
import { MacroDef } from '../src/core/types';

const file = process.argv[2] ?? join(process.cwd(), 'test', 'manual', 'sample.c');
const trigger = (process.argv[3] as 'always' | 'cursor') ?? 'always';
const text = readFileSync(file, 'utf8');
const lines = text.split(/\r?\n/);
const syntax = syntaxFor(languageFor(file));

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

for (const kind of ['brackets', 'macros'] as const) {
  const hints = computeHints(text, {
    brackets: kind === 'brackets',
    macros: kind === 'macros',
    trigger,
    showRange: true,
    showLabel: true,
    inactive: (line) => inactiveLines.has(line),
    branchActive: (line) => branchActive.get(line),
    blockActive: (line) => blockActive.get(line),
    scanned,
  });
  console.log(`\n=== ${kind} (${trigger}) — ${hints.length} hint(s) ===`);
  for (const hint of hints) {
    const source = (lines[hint.line] ?? '').trimEnd();
    const jumps = (hint.parts ?? [])
      .map((part) => part.target)
      .filter((target): target is { line: number; col: number } => target !== undefined)
      .map((target) => `line ${target.line + 1}`);
    const jump = jumps.length > 0 ? ` -> ${jumps.join(' | ')}` : '';
    const inactive = hint.inactive ? ' (inactive)' : '';
    console.log(`${String(hint.line + 1).padStart(4)}: ${source}${hint.text}${inactive}${jump}`);
  }
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
    default:
      return 'c';
  }
}
