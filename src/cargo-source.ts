import * as path from 'node:path';
import { parseCargoFeatures, type CargoFeatures } from './core/cargo';
import { isFile, walkUpCached } from './fs-walk';

/**
 * Node-only filesystem layer around {@link parseCargoFeatures}. It locates the
 * nearest `Cargo.toml` above a Rust source file and parses its features. No
 * `vscode` dependency, so it can be exercised from vitest.
 */

const MANIFEST = 'Cargo.toml';

/** Cache keyed by starting directory; negative results are cached too. */
const cache = new Map<string, CargoFeatures | undefined>();

/**
 * Cache for {@link hasAncestorManifest}, keyed by the file's starting
 * directory; the boolean answer (negative included) is cached per directory.
 */
const ancestorCache = new Map<string, boolean>();

/**
 * Walks up from `filePath` to the filesystem root looking for the nearest
 * `Cargo.toml` and returns its parsed features. Files are read defensively:
 * unreadable or malformed manifests yield `undefined` instead of throwing.
 * Results — including “no manifest found” and “manifest had nothing usable” —
 * are cached per starting directory; see {@link clearCargoCache}.
 */
export function findCargoFeatures(filePath: string): CargoFeatures | undefined {
  return walkUpCached(filePath, MANIFEST, cache, parseCargoFeatures);
}

/** Clears the caches (call when the workspace changes on disk). */
export function clearCargoCache(): void {
  cache.clear();
  ancestorCache.clear();
}

/**
 * True when the nearest `Cargo.toml` above `filePath` itself has a further
 * `Cargo.toml` in an ancestor directory — a conservative signal that the crate
 * may be a workspace member (or otherwise have a parent manifest), so a feature
 * declared only in the child cannot be treated as definitely absent.
 *
 * The answer depends only on `filePath`'s directory, so it is cached there
 * (negative answers included) until {@link clearCargoCache}.
 */
export function hasAncestorManifest(filePath: string): boolean {
  const resolved = path.resolve(filePath);
  const startDir = path.dirname(resolved);
  const cached = ancestorCache.get(startDir);
  if (cached !== undefined) return cached;

  const result = computeHasAncestorManifest(resolved);
  ancestorCache.set(startDir, result);
  return result;
}

/** Uncached {@link hasAncestorManifest} body. */
function computeHasAncestorManifest(resolvedFile: string): boolean {
  const nearest = nearestManifestDir(resolvedFile);
  if (nearest === undefined) return false;

  let dir = path.dirname(nearest);
  for (;;) {
    if (isFile(path.join(dir, MANIFEST))) return true;
    const parent = path.dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

/** Nearest directory at or above the file's directory that holds a manifest. */
function nearestManifestDir(resolvedFile: string): string | undefined {
  let dir = path.dirname(resolvedFile);
  for (;;) {
    if (isFile(path.join(dir, MANIFEST))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}
