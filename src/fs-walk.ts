import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Node-only filesystem helpers shared by the ancestor-file lookups
 * ({@link file://./cargo-source.ts} and {@link file://./flags-source.ts}).
 * No `vscode` dependency, so they can be exercised from vitest.
 */

/**
 * True when `filePath` exists and is a regular file. A directory (or any
 * unreadable path) is `false`, so a directory that happens to be named like the
 * probed file never counts as a hit.
 */
export function isFile(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

/**
 * Resolves `filePath`, walks up from its directory to the filesystem root
 * looking for the nearest `fileName`, and returns the parsed result of the
 * first hit. A per-directory cache (passed in by the caller, so each feature
 * keeps its own clearing semantics) makes the walk O(1) after the first call
 * for a directory; every directory visited on the way to a hit — or to the
 * root, when there is none — is backfilled with the same result, including the
 * negative one.
 *
 * `parse` receives the raw file contents; a malformed file or a read error
 * yields `undefined` rather than throwing, matching the defensive behaviour of
 * the callers. The check is a real file ({@link isFile}), never merely an
 * existing path.
 */
export function walkUpCached<T>(
  filePath: string,
  fileName: string,
  cache: Map<string, T | undefined>,
  parse: (text: string) => T | undefined
): T | undefined {
  const resolved = path.resolve(filePath);
  let dir = path.dirname(resolved);
  const visited: string[] = [];

  for (;;) {
    if (cache.has(dir)) {
      const cached = cache.get(dir);
      for (const seen of visited) cache.set(seen, cached);
      return cached;
    }

    visited.push(dir);
    const candidate = path.join(dir, fileName);
    if (isFile(candidate)) {
      let parsed: T | undefined;
      try {
        parsed = parse(fs.readFileSync(candidate, 'utf8'));
      } catch {
        parsed = undefined;
      }
      for (const seen of visited) cache.set(seen, parsed);
      return parsed;
    }

    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  for (const seen of visited) cache.set(seen, undefined);
  return undefined;
}
