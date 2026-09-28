import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { clearCargoCache, findCargoFeatures, hasAncestorManifest } from '../../src/cargo-source';

const tempRoots: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shigan-cargo-'));
  tempRoots.push(dir);
  return dir;
}

function write(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function manifest(feature: string): string {
  return ['[features]', `default = ["${feature}"]`, `${feature} = []`].join('\n');
}

afterEach(() => {
  for (const root of tempRoots) fs.rmSync(root, { recursive: true, force: true });
  tempRoots.length = 0;
  clearCargoCache();
});

describe('findCargoFeatures', () => {
  it('finds the nearest Cargo.toml walking up from a nested source file', () => {
    const root = makeTempDir();
    write(path.join(root, 'Cargo.toml'), manifest('root_feature'));
    write(path.join(root, 'crates', 'app', 'Cargo.toml'), manifest('app_feature'));
    const file = path.join(root, 'crates', 'app', 'src', 'main.rs');
    write(file, '');

    const features = findCargoFeatures(file);

    expect(features).toBeDefined();
    expect(features?.declared.has('app_feature')).toBe(true);
    expect(features?.declared.has('root_feature')).toBe(false);
  });

  it('uses the workspace manifest when no nearer one exists', () => {
    const root = makeTempDir();
    write(path.join(root, 'Cargo.toml'), ['[workspace]', 'members = ["crates/*"]'].join('\n'));
    const file = path.join(root, 'crates', 'app', 'src', 'main.rs');
    write(file, '');

    const features = findCargoFeatures(file);

    expect(features?.virtual).toBe(true);
    expect(features?.declared.size).toBe(0);
  });

  it('returns undefined when no manifest exists', () => {
    const root = makeTempDir();
    const file = path.join(root, 'deep', 'nested', 'main.rs');
    write(file, '');

    expect(findCargoFeatures(file)).toBeUndefined();
  });

  it('caches negative results until clearCargoCache', () => {
    const root = makeTempDir();
    const file = path.join(root, 'src', 'main.rs');
    write(file, '');

    expect(findCargoFeatures(file)).toBeUndefined();

    // A manifest appearing later must not be seen while the negative is cached.
    write(path.join(root, 'Cargo.toml'), manifest('late_feature'));
    expect(findCargoFeatures(file)).toBeUndefined();

    clearCargoCache();
    expect(findCargoFeatures(file)?.declared.has('late_feature')).toBe(true);
  });

  it('caches per starting directory and clearCargoCache re-reads a rewrite', () => {
    const root = makeTempDir();
    const file = path.join(root, 'src', 'main.rs');
    write(file, '');
    write(path.join(root, 'Cargo.toml'), manifest('alpha'));

    const first = findCargoFeatures(file);
    const second = findCargoFeatures(file);

    expect(first?.declared.has('alpha')).toBe(true);
    expect(second).toBe(first);

    write(path.join(root, 'Cargo.toml'), manifest('beta'));
    expect(findCargoFeatures(file)).toBe(first);

    clearCargoCache();
    const refreshed = findCargoFeatures(file);

    expect(refreshed).not.toBe(first);
    expect(refreshed?.declared.has('beta')).toBe(true);
    expect(refreshed?.declared.has('alpha')).toBe(false);
  });

  it('caches undefined for a malformed manifest instead of throwing', () => {
    const root = makeTempDir();
    const file = path.join(root, 'src', 'main.rs');
    write(file, '');
    write(path.join(root, 'Cargo.toml'), '[features\ndefault = ["a"]');

    expect(findCargoFeatures(file)).toBeUndefined();
    expect(findCargoFeatures(file)).toBeUndefined();
  });
});

describe('hasAncestorManifest', () => {
  it('is true when a parent directory also has a Cargo.toml', () => {
    const root = makeTempDir();
    write(path.join(root, 'Cargo.toml'), ['[workspace]', 'members = ["member"]'].join('\n'));
    write(path.join(root, 'member', 'Cargo.toml'), manifest('member_feature'));
    const file = path.join(root, 'member', 'src', 'main.rs');
    write(file, '');

    expect(hasAncestorManifest(file)).toBe(true);
  });

  it('is false when only the nearest manifest exists', () => {
    const root = makeTempDir();
    write(path.join(root, 'Cargo.toml'), manifest('only_feature'));
    const file = path.join(root, 'src', 'main.rs');
    write(file, '');

    expect(hasAncestorManifest(file)).toBe(false);
  });
});
