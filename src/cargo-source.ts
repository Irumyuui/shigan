import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseCargoFeatures, type CargoFeatures } from './core/cargo';

/**
 * Node-only filesystem layer around {@link parseCargoFeatures}. It locates the
 * nearest `Cargo.toml` above a Rust source file and parses its features. No
 * `vscode` dependency, so it can be exercised from vitest.
 */

const MANIFEST = 'Cargo.toml';

/** Cache keyed by starting directory; negative results are cached too. */
const cache = new Map<string, CargoFeatures | undefined>();

/**
 * Walks up from `filePath` to the filesystem root looking for the nearest
 * `Cargo.toml` and returns its parsed features. Files are read defensively:
 * unreadable or malformed manifests yield `undefined` instead of throwing.
 * Results — including “no manifest found” and “manifest had nothing usable” —
 * are cached per starting directory; see {@link clearCargoCache}.
 */
export function findCargoFeatures(filePath: string): CargoFeatures | undefined {
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
    const candidate = path.join(dir, MANIFEST);
    if (isFile(candidate)) {
      let features: CargoFeatures | undefined;
      try {
        features = parseCargoFeatures(fs.readFileSync(candidate, 'utf8'));
      } catch {
        features = undefined;
      }
      for (const seen of visited) cache.set(seen, features);
      return features;
    }

    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  for (const seen of visited) cache.set(seen, undefined);
  return undefined;
}

/** Clears the cache (call when the workspace changes on disk). */
export function clearCargoCache(): void {
  cache.clear();
}

/**
 * True when the nearest `Cargo.toml` above `filePath` itself has a further
 * `Cargo.toml` in an ancestor directory — a conservative signal that the crate
 * may be a workspace member (or otherwise have a parent manifest), so a feature
 * declared only in the child cannot be treated as definitely absent.
 */
export function hasAncestorManifest(filePath: string): boolean {
  const nearest = nearestManifestDir(path.resolve(filePath));
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

function isFile(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}
