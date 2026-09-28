import { describe, expect, it } from 'vitest';
import { parseCargoFeatures } from '../../src/core/cargo';

/** Convenience: sorted arrays so assertions stay order-independent. */
function sorted(values: ReadonlySet<string> | undefined): string[] {
  return Array.from(values ?? []).sort();
}

describe('parseCargoFeatures', () => {
  it('parses declared features and expands default over plain names only', () => {
    const manifest = [
      '[package]',
      'name = "demo"',
      'version = "0.1.0"',
      '',
      '[features]',
      'default = ["std"]',
      'std = ["dep:foo", "bar/baz", "qux?/feat"]',
      'extra = ["std"]',
    ].join('\n');

    const features = parseCargoFeatures(manifest);

    expect(features).toBeDefined();
    expect(sorted(features?.declared)).toEqual(['default', 'extra', 'std']);
    // `dep:foo`, `bar/baz` and `qux?/feat` are not local feature names.
    expect(sorted(features?.defaults)).toEqual(['std']);
    expect(sorted(features?.implicit)).toEqual([]);
    expect(features?.virtual).toBe(false);
  });

  it('walks the default closure transitively across declared features', () => {
    const manifest = [
      '[features]',
      'default = ["a", "b"]',
      'a = ["c"]',
      'b = []',
      'c = ["b"]',
      'unused = []',
    ].join('\n');

    const features = parseCargoFeatures(manifest);

    expect(sorted(features?.defaults)).toEqual(['a', 'b', 'c']);
    expect(sorted(features?.declared)).toEqual(['a', 'b', 'c', 'default', 'unused']);
  });

  it('creates implicit features from inline optional dependencies', () => {
    const manifest = [
      '[package]',
      'name = "demo"',
      '',
      '[dependencies]',
      'serde = { version = "1", optional = true }',
      'rand = { version = "0.8" }',
      'log = "0.4"',
    ].join('\n');

    const features = parseCargoFeatures(manifest);

    expect(sorted(features?.implicit)).toEqual(['serde']);
    expect(sorted(features?.declared)).toEqual([]);
    expect(sorted(features?.defaults)).toEqual([]);
  });

  it('creates implicit features from dotted-table and section dependency forms', () => {
    const manifest = [
      '[package]',
      'name = "demo"',
      '',
      '[dependencies.tokio]',
      'version = "1"',
      'optional = true',
      'features = ["full"]',
      '',
      '[dev-dependencies]',
      'pretty_assertions = { version = "1", optional = true }',
      '',
      '[build-dependencies.cc]',
      'version = "1"',
      'optional = true',
    ].join('\n');

    const features = parseCargoFeatures(manifest);

    expect(sorted(features?.implicit)).toEqual(['cc', 'pretty_assertions', 'tokio']);
  });

  it('recognises target-specific dependency tables', () => {
    const manifest = [
      '[target.\'cfg(windows)\'.dependencies]',
      'winapi = { version = "0.3", optional = true }',
      '',
      '[target."cfg(unix)".dev-dependencies]',
      'libc = { version = "0.2", optional = true }',
    ].join('\n');

    const features = parseCargoFeatures(manifest);

    expect(sorted(features?.implicit)).toEqual(['libc', 'winapi']);
  });

  it('suppresses the implicit feature of a dep referenced via dep:', () => {
    // Choice: suppression IS implemented (matches real Cargo). `serde` is an
    // optional dependency referenced as `dep:serde`, so it is not implicit;
    // `other` is optional and unreferenced, so it stays implicit.
    const manifest = [
      '[features]',
      'default = []',
      'serde = ["dep:serde", "serde/derive"]',
      '',
      '[dependencies]',
      'serde = { version = "1", optional = true }',
      'other = { version = "1", optional = true }',
    ].join('\n');

    const features = parseCargoFeatures(manifest);

    expect(sorted(features?.implicit)).toEqual(['other']);
    expect(features?.implicit.has('serde')).toBe(false);
  });

  it('treats a [workspace]-only manifest as virtual with empty sets', () => {
    const manifest = ['[workspace]', 'members = ["crates/*"]', 'resolver = "2"'].join('\n');

    const features = parseCargoFeatures(manifest);

    expect(features).toEqual({
      declared: new Set(),
      implicit: new Set(),
      defaults: new Set(),
      virtual: true,
    });
  });

  it('does not treat [workspace.package] as a real package', () => {
    const manifest = [
      '[workspace]',
      'members = ["crates/*"]',
      '',
      '[workspace.package]',
      'version = "0.1.0"',
    ].join('\n');

    const features = parseCargoFeatures(manifest);

    expect(features?.virtual).toBe(true);
  });

  it('handles comments, CRLF, multi-line arrays and trailing commas', () => {
    const manifest = [
      '# top comment',
      '[package]',
      'name = "demo"  # trailing comment',
      '',
      '[features]',
      'default = [',
      '  "std",   # the standard library',
      '  "extra",',
      ']',
      'std = []',
      'extra = [ "alloc", ]',
      '',
    ].join('\r\n');

    const features = parseCargoFeatures(manifest);

    expect(sorted(features?.declared)).toEqual(['default', 'extra', 'std']);
    expect(sorted(features?.defaults)).toEqual(['extra', 'std']);
  });

  it('expands default referencing an implicit feature name', () => {
    const manifest = [
      '[features]',
      'default = ["serde"]',
      '',
      '[dependencies]',
      'serde = { version = "1", optional = true }',
    ].join('\n');

    const features = parseCargoFeatures(manifest);

    expect(sorted(features?.defaults)).toEqual(['serde']);
    expect(sorted(features?.implicit)).toEqual(['serde']);
  });

  it('supports quoted feature keys and single-quoted values', () => {
    const manifest = [
      '[features]',
      'default = [\'a\']',
      '"my-feature" = ["a"]',
      'a = []',
    ].join('\n');

    const features = parseCargoFeatures(manifest);

    expect(sorted(features?.declared)).toEqual(['a', 'default', 'my-feature']);
    expect(sorted(features?.defaults)).toEqual(['a']);
  });

  describe('malformed input', () => {
    it('returns undefined for an unterminated table header', () => {
      expect(parseCargoFeatures('[features\ndefault = ["a"]')).toBeUndefined();
    });

    it('returns undefined for an unterminated array', () => {
      expect(parseCargoFeatures('[features]\ndefault = ["a"')).toBeUndefined();
    });

    it('returns undefined for trailing junk after a value', () => {
      expect(parseCargoFeatures('[features]\ndefault = ["a"] oops')).toBeUndefined();
    });

    it('returns undefined for random non-TOML text', () => {
      expect(parseCargoFeatures('not a manifest at all')).toBeUndefined();
    });

    it('returns undefined when there is nothing usable', () => {
      expect(parseCargoFeatures('')).toBeUndefined();
      expect(parseCargoFeatures('[package]\nname = "demo"')).toBeUndefined();
    });
  });
});
