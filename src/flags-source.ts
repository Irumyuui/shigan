import * as fs from 'node:fs';
import * as path from 'node:path';
import { flagsForFile, parseCompileCommands } from './core/compile-commands';

const cache = new Map<string, string[] | undefined>();

/**
 * Walks up from `filePath` looking for a `compile_commands.json` and returns
 * the flags recorded for the file, if any. Results are cached per directory.
 */
export function findCompileCommandFlags(filePath: string): string[] | undefined {
  const resolved = path.resolve(filePath);
  let dir = path.dirname(resolved);
  const visited: string[] = [];

  for (;;) {
    const cached = cache.get(dir);
    if (cached !== undefined || cache.has(dir)) {
      for (const seen of visited) cache.set(seen, cached);
      return cached;
    }

    visited.push(dir);
    const candidate = path.join(dir, 'compile_commands.json');
    if (fs.existsSync(candidate)) {
      let flags: string[] | undefined;
      try {
        flags = flagsForFile(parseCompileCommands(fs.readFileSync(candidate, 'utf8')), resolved);
      } catch {
        flags = undefined;
      }
      for (const seen of visited) cache.set(seen, flags);
      return flags;
    }

    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  for (const seen of visited) cache.set(seen, undefined);
  return undefined;
}

/** Clears the cache (call when the workspace or configuration changes). */
export function clearCompileCommandCache(): void {
  cache.clear();
}
