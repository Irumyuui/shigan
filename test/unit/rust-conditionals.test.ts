import { describe, expect, it } from 'vitest';
import { computeHints } from '../../src/core/hints';
import { scanRust } from '../../src/core/lexer/rust';
import {
  FeatureFacts,
  hostCfg,
  parseRustCfgEntries,
  RustCfgEnvironment,
} from '../../src/core/match/rust/cfg';
import { rustConditionals } from '../../src/core/match/rust/conditionals';

const LINUX = hostCfg('linux', 'x64').predicates;

const env = (overrides: Partial<RustCfgEnvironment> = {}): RustCfgEnvironment => ({
  host: LINUX,
  ...overrides,
});

const model = (text: string, environment: RustCfgEnvironment) =>
  rustConditionals({ scanned: scanRust(text), lines: text.split('\n'), environment });

const features = (universe: string[], enabled: string[]): FeatureFacts => ({
  decidableAbsence: true,
  universe: new Set(universe),
  enabled: new Set(enabled),
});

describe('rustConditionals', () => {
  it('emits an active span hint at the close line', () => {
    const m = model('#[cfg(unix)]\nfn a() {\n}\n', env());
    expect(m.hints).toHaveLength(1);
    expect(m.hints[0]).toMatchObject({
      line: 2,
      kind: 'conditional',
      inactive: false,
      cursorFrom: 0,
      cursorTo: 2,
    });
    expect(m.hints[0].segments).toEqual([
      { marker: ' <- ', fromLine: 0, toLine: 2, display: '#[cfg(unix)]', target: { line: 0, col: 0 } },
    ]);
    expect(m.inactiveLines?.size).toBe(0);
  });

  it('marks a false predicate inactive but still emits the hint', () => {
    const m = model('#[cfg(windows)]\nfn a() {\n}\n', env());
    expect(m.hints).toHaveLength(1);
    expect(m.hints[0].inactive).toBe(true);
    expect([...(m.inactiveLines ?? [])].sort((a, b) => a - b)).toEqual([0, 1, 2]);
  });

  it('leaves an unknown feature predicate active', () => {
    const m = model('#[cfg(feature = "x")]\nfn a() {\n}\n', env());
    expect(m.hints[0].inactive).toBe(false);
    expect(m.inactiveLines?.size).toBe(0);
  });

  it('decides feature predicates against the resolved facts', () => {
    const facts = env({ features: features(['a'], ['a']) });
    expect(model('#[cfg(feature = "zz")]\nfn a() {}\n', facts).hints[0].inactive).toBe(true);
    expect(model('#[cfg(feature = "a")]\nfn a() {}\n', facts).hints[0].inactive).toBe(false);
    // Declared but not enabled is unknown, not absent.
    const declared = env({ features: features(['a', 'b'], ['a']) });
    expect(model('#[cfg(feature = "b")]\nfn a() {}\n', declared).hints[0].inactive).toBe(false);
  });

  it('merges consecutive attributes into one hint with display-only later segments', () => {
    const text = '#[cfg(unix)]\n#[cfg(feature = "a")]\nfn f() {\n}\n';
    const m = model(text, env({ features: features(['a'], ['a']) }));
    expect(m.hints).toHaveLength(1);
    expect(m.hints[0]).toMatchObject({ line: 3, cursorFrom: 0, cursorTo: 3, inactive: false });
    expect(m.hints[0].segments).toEqual([
      { marker: ' <- ', fromLine: 0, toLine: 3, display: '#[cfg(unix)]', target: { line: 0, col: 0 } },
      {
        marker: ' <- ',
        fromLine: 3,
        toLine: 3,
        display: '#[cfg(feature = "a")]',
        target: { line: 1, col: 0 },
      },
    ]);
  });

  it('ANDs a merged group: one false decides inactive', () => {
    const m = model('#[cfg(unix)]\n#[cfg(windows)]\nfn f() {}\n', env());
    expect(m.hints).toHaveLength(1);
    expect(m.hints[0].inactive).toBe(true);
  });

  it('lets explicit entries override the host', () => {
    const explicit = parseRustCfgEntries(['-unix']);
    const m = model('#[cfg(unix)]\nfn a() {\n}\n', env({ explicit }));
    expect(m.hints[0].inactive).toBe(true);
  });

  it('anchors a single-line body span', () => {
    const m = model('#[cfg(unix)]\nfn f() {}\n', env());
    expect(m.hints).toHaveLength(1);
    expect(m.hints[0]).toMatchObject({ line: 1, cursorFrom: 0, cursorTo: 1 });
  });

  it('detects an item sharing the attribute line', () => {
    const m = model('#[cfg(unix)] fn f() {}\n', env());
    expect(m.hints).toHaveLength(1);
    expect(m.hints[0]).toMatchObject({ line: 0, cursorFrom: 0, cursorTo: 0, inactive: false });
  });

  it('finds a nested span inside a mod body', () => {
    const m = model('mod m {\n    #[cfg(unix)]\n    fn f() {}\n}\n', env());
    expect(m.hints).toHaveLength(1);
    expect(m.hints[0]).toMatchObject({ line: 2, cursorFrom: 1, cursorTo: 2 });
  });

  it('returns an empty model when no item span is detected', () => {
    const m = model('#[cfg(unix)] struct S;\n', env());
    expect(m.hints).toEqual([]);
    expect(m.inactiveLines?.size).toBe(0);
  });

  it('renders through computeHints with kind conditional', () => {
    const text = '#[cfg(unix)]\nfn a() {\n}\n';
    const conditionals = model(text, env());
    const hints = computeHints(text, {
      macros: true,
      trigger: 'always',
      conditionals,
      scanned: scanRust(text),
    });
    const conditional = hints.filter((hint) => hint.kind === 'conditional');
    expect(conditional).toHaveLength(1);
    expect(conditional[0]).toMatchObject({
      line: 2,
      kind: 'conditional',
      text: ' <- :1-3 #[cfg(unix)]',
      target: { line: 0, col: 0 },
    });
  });
});
