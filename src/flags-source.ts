import * as path from 'node:path';
import type { CompileCommandEntry } from './core/compile-commands';
import { flagsForFile, parseCompileCommands } from './core/compile-commands';
import { walkUpCached } from './fs-walk';

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
 * directory; the per-file lookup runs on every call. A directory named like the
 * file never counts: the probe checks for a regular file.
 */
export function findCompileCommandFlags(filePath: string): string[] | undefined {
  const resolved = path.resolve(filePath);
  const entries = walkUpCached(resolved, 'compile_commands.json', entriesCache, parseCompileCommands);
  return entries ? flagsForFile(entries, resolved) : undefined;
}

/** Clears the cache (call when the workspace or configuration changes). */
export function clearCompileCommandCache(): void {
  entriesCache.clear();
}
