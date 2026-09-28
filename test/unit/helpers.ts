import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { LanguageSyntax } from '../../src/core/language';
import { scan } from '../../src/core/lexer/tokenizer';

/**
 * The bracket characters the tokenizer reports for `text`, in order. Passing no
 * syntax scans with the C profile; `cpp`/`csharp` callers pass their profile.
 */
export function bracketChars(text: string, syntax?: LanguageSyntax): string {
  return scan(text, syntax)
    .brackets.map((b) => b.char)
    .join('');
}

/** Sorts a set of line numbers ascending. */
export function sortedLines(lines: Set<number>): number[] {
  return [...lines].sort((a, b) => a - b);
}

// Tracked per module instance: vitest isolates each test file, so one file's
// cleanup never removes another file's temp dirs.
const tempRoots: string[] = [];

/** Creates a temp dir under the OS temp root, removed by {@link cleanupTempDirs}. */
export function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
}

/** Writes `content` to `filePath`, creating any missing parent directories. */
export function write(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

/** Removes every dir created by {@link makeTempDir} and forgets them. */
export function cleanupTempDirs(): void {
  for (const root of tempRoots) fs.rmSync(root, { recursive: true, force: true });
  tempRoots.length = 0;
}
