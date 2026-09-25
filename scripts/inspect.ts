/**
 * Dev helper: print the hints Shigan would render for a file.
 *
 *   bun run inspect [file] [always|cursor]
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { computeHints } from '../src/core/hints';
import { scan } from '../src/core/lexer/tokenizer';
import { evaluateConditionals } from '../src/core/match/evaluate';
import { MacroDef } from '../src/core/types';

const file = process.argv[2] ?? join(process.cwd(), 'test', 'manual', 'sample.c');
const trigger = (process.argv[3] as 'always' | 'cursor') ?? 'always';
const text = readFileSync(file, 'utf8');
const lines = text.split(/\r?\n/);

// Mirror the fixture harness: an optional `<case>.macros.json` defines macros.
const seedPath = file.replace(/\.c$/, '.macros.json');
const seed: Record<string, string> = existsSync(seedPath)
  ? JSON.parse(readFileSync(seedPath, 'utf8'))
  : {};
const seedMacros = new Map<string, MacroDef>();
for (const [name, value] of Object.entries(seed)) {
  seedMacros.set(name, { value, functionLike: false });
}

const { inactiveLines, branchActive, blockActive } = evaluateConditionals(scan(text).directives, {
  macros: seedMacros,
  trackFileDefines: true,
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
