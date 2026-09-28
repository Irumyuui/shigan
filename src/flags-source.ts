import * as fs from 'node:fs';
import * as path from 'node:path';
import type { CompileCommandEntry } from './core/compile-commands';
import { flagsForFile, parseCompileCommands } from './core/compile-commands';

/**
 * Parsed `compile_commands.json` contents keyed by the directory they apply to.
 * Only the expensive parse is cached; the flags are per file and must be looked
 * up again for every file, otherwise the first file resolved in a directory
 * would leak its flags to every sibling (and to subdirectories reached through
 * the `visited` backfill).
 */
const entriesCache = new Map<string, CompileCommandEntry[] | undefined>();

/**
 * Walks up from `filePath` looking for a `compile_commands.json` and returns
 * the flags recorded for the file, if any. The parsed entries are cached per
 * directory; the per-file lookup runs on every call.
 */
export function findCompileCommandFlags(filePath: string): string[] | undefined {
  const resolved = path.resolve(filePath);
  let dir = path.dirname(resolved);
  const visited: string[] = [];

  for (;;) {
    if (entriesCache.has(dir)) {
      const entries = entriesCache.get(dir);
      for (const seen of visited) entriesCache.set(seen, entries);
      return entries ? flagsForFile(entries, resolved) : undefined;
    }

    visited.push(dir);
    const candidate = path.join(dir, 'compile_commands.json');
    if (fs.existsSync(candidate)) {
      let entries: CompileCommandEntry[] | undefined;
      try {
        entries = parseCompileCommands(fs.readFileSync(candidate, 'utf8'));
      } catch {
        entries = undefined;
      }
      for (const seen of visited) entriesCache.set(seen, entries);
      return entries ? flagsForFile(entries, resolved) : undefined;
    }

    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  for (const seen of visited) entriesCache.set(seen, undefined);
  return undefined;
}

/** Clears the cache (call when the workspace or configuration changes). */
export function clearCompileCommandCache(): void {
  entriesCache.clear();
}
