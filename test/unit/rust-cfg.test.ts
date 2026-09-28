import { describe, expect, it } from 'vitest';
import {
  evaluateCfgPredicate,
  hostCfg,
  parseRustCfgEntries,
  type FeatureFacts,
  type RustCfgEnvironment,
} from '../../src/core/match/rust/cfg';

const label = (value: boolean | undefined): string =>
  value === undefined ? 'unknown' : String(value);

/**
 * `unix` is true, `windows` false and `unknown` (a bare ident outside every
 * namespace) is unknown against a real Linux host.
 */
const HOST_ENV: RustCfgEnvironment = { host: hostCfg('linux', 'x64').predicates };

describe('evaluateCfgPredicate - Kleene logic', () => {
  const ALL: Array<[string, string, boolean | undefined]> = [
    ['unix', 'unix', true],
    ['unix', 'windows', false],
    ['unix', 'unknown', undefined],
    ['windows', 'unix', false],
    ['windows', 'windows', false],
    ['windows', 'unknown', false],
    ['unknown', 'unix', undefined],
    ['unknown', 'windows', false],
    ['unknown', 'unknown', undefined],
  ];

  for (const [a, b, expected] of ALL) {
    it(`all(${a}, ${b}) -> ${label(expected)}`, () => {
      expect(evaluateCfgPredicate(`all(${a}, ${b})`, HOST_ENV)).toBe(expected);
    });
  }

  const ANY: Array<[string, string, boolean | undefined]> = [
    ['unix', 'unix', true],
    ['unix', 'windows', true],
    ['unix', 'unknown', true],
    ['windows', 'unix', true],
    ['windows', 'windows', false],
    ['windows', 'unknown', undefined],
    ['unknown', 'unix', true],
    ['unknown', 'windows', undefined],
    ['unknown', 'unknown', undefined],
  ];

  for (const [a, b, expected] of ANY) {
    it(`any(${a}, ${b}) -> ${label(expected)}`, () => {
      expect(evaluateCfgPredicate(`any(${a}, ${b})`, HOST_ENV)).toBe(expected);
    });
  }

  it('all() is true and any() is false', () => {
    expect(evaluateCfgPredicate('all()', HOST_ENV)).toBe(true);
    expect(evaluateCfgPredicate('any()', HOST_ENV)).toBe(false);
  });

  it('not flips true/false and keeps unknown', () => {
    expect(evaluateCfgPredicate('not(unix)', HOST_ENV)).toBe(false);
    expect(evaluateCfgPredicate('not(windows)', HOST_ENV)).toBe(true);
    expect(evaluateCfgPredicate('not(unknown)', HOST_ENV)).toBeUndefined();
  });
});

describe('evaluateCfgPredicate - leaf resolution', () => {
  const FEATURES: FeatureFacts = {
    decidableAbsence: true,
    universe: new Set(['a', 'b', 'serde']),
    enabled: new Set(['a']),
  };
  const ENVIRONMENT: RustCfgEnvironment = { host: HOST_ENV.host, features: FEATURES };

  const CASES: Array<[string, boolean | undefined]> = [
    ['unix', true],
    ['windows', false],
    ['target_os="linux"', true],
    ['target_arch="x86_64"', true],
    ['feature="a"', true],
    ['feature="b"', undefined],
    ['feature="zz"', false],
    ['feature="serde"', undefined],
    ['test', undefined],
    ['debug_assertions', undefined],
  ];

  for (const [expression, expected] of CASES) {
    it(`${expression} -> ${label(expected)}`, () => {
      expect(evaluateCfgPredicate(expression, ENVIRONMENT)).toBe(expected);
    });
  }

  it('feature="zz" stays unknown when absence is undecidable', () => {
    const environment: RustCfgEnvironment = {
      host: HOST_ENV.host,
      features: { ...FEATURES, decidableAbsence: false },
    };
    expect(evaluateCfgPredicate('feature="zz"', environment)).toBeUndefined();
  });

  it('has no feature facts at all -> feature is unknown', () => {
    expect(evaluateCfgPredicate('feature="a"', { host: HOST_ENV.host })).toBeUndefined();
  });
});

describe('hostCfg', () => {
  it('does not recognize an unknown platform and resolves nothing', () => {
    const cygwin = hostCfg('cygwin', 'x64');
    expect(cygwin.recognized).toBe(false);
    expect(cygwin.predicates.size).toBe(0);

    const environment: RustCfgEnvironment = { host: cygwin.predicates };
    expect(evaluateCfgPredicate('unix', environment)).toBeUndefined();
    expect(evaluateCfgPredicate('windows', environment)).toBeUndefined();
    expect(evaluateCfgPredicate('target_os="linux"', environment)).toBeUndefined();
    expect(evaluateCfgPredicate('target_arch="x86_64"', environment)).toBeUndefined();
  });

  it('maps win32 to windows, msvc and x86_64', () => {
    const environment: RustCfgEnvironment = { host: hostCfg('win32', 'x64').predicates };
    expect(evaluateCfgPredicate('windows', environment)).toBe(true);
    expect(evaluateCfgPredicate('unix', environment)).toBe(false);
    expect(evaluateCfgPredicate('target_os="windows"', environment)).toBe(true);
    expect(evaluateCfgPredicate('target_arch="x86_64"', environment)).toBe(true);
    expect(evaluateCfgPredicate('target_env="msvc"', environment)).toBe(true);
    expect(evaluateCfgPredicate('target_family="windows"', environment)).toBe(true);
    expect(evaluateCfgPredicate('target_pointer_width="64"', environment)).toBe(true);
  });

  it('maps darwin + arm64 to macos and aarch64', () => {
    const environment: RustCfgEnvironment = { host: hostCfg('darwin', 'arm64').predicates };
    expect(evaluateCfgPredicate('target_arch="aarch64"', environment)).toBe(true);
    expect(evaluateCfgPredicate('target_os="macos"', environment)).toBe(true);
    expect(evaluateCfgPredicate('unix', environment)).toBe(true);
    expect(evaluateCfgPredicate('windows', environment)).toBe(false);
    // `target_env` is not observable off Windows (gnu vs musl), so it stays
    // unknown — it must never be guessed false and hide live code.
    expect(evaluateCfgPredicate('target_env="msvc"', environment)).toBeUndefined();
  });
});

describe('hostCfg - only observed platform dimensions are decided', () => {
  const environment = (platform: string, arch: string): RustCfgEnvironment => ({
    host: hostCfg(platform, arch).predicates,
  });

  it('decides target_endian from a known arch', () => {
    const little = environment('linux', 'x64');
    expect(evaluateCfgPredicate('target_endian="little"', little)).toBe(true);
    expect(evaluateCfgPredicate('target_endian="big"', little)).toBe(false);

    const big = environment('linux', 's390x');
    expect(evaluateCfgPredicate('target_endian="big"', big)).toBe(true);
    expect(evaluateCfgPredicate('target_endian="little"', big)).toBe(false);
  });

  it('leaves target_env unknown off Windows and keeps msvc on Windows', () => {
    const linux = environment('linux', 'x64');
    expect(evaluateCfgPredicate('target_env="gnu"', linux)).toBeUndefined();
    expect(evaluateCfgPredicate('target_env="musl"', linux)).toBeUndefined();

    const windows = environment('win32', 'x64');
    expect(evaluateCfgPredicate('target_env="msvc"', windows)).toBe(true);
  });

  it('exposes the legacy pointer_width alias when the width is known', () => {
    const linux = environment('linux', 'x64');
    expect(evaluateCfgPredicate('pointer_width="64"', linux)).toBe(true);
    expect(evaluateCfgPredicate('pointer_width="32"', linux)).toBe(false);
  });

  it('aliases ppc64 to powerpc64 with its own width and endianness', () => {
    const ppc = environment('linux', 'ppc64');
    expect(evaluateCfgPredicate('target_arch="powerpc64"', ppc)).toBe(true);
    expect(evaluateCfgPredicate('target_pointer_width="64"', ppc)).toBe(true);
    expect(evaluateCfgPredicate('target_pointer_width="32"', ppc)).toBe(false);
    expect(evaluateCfgPredicate('target_endian="big"', ppc)).toBe(true);
  });

  it('aliases loong64 to loongarch64', () => {
    const loong = environment('linux', 'loong64');
    expect(evaluateCfgPredicate('target_arch="loongarch64"', loong)).toBe(true);
    expect(evaluateCfgPredicate('target_pointer_width="64"', loong)).toBe(true);
  });

  it('aliases sunos to the solaris target os', () => {
    expect(evaluateCfgPredicate('target_os="solaris"', environment('sunos', 'x64'))).toBe(true);
  });

  it('leaves every dimension of an unmapped arch unknown, never false', () => {
    const unknown = environment('linux', 'unknown-arch');
    expect(evaluateCfgPredicate('target_arch="unknown-arch"', unknown)).toBeUndefined();
    expect(evaluateCfgPredicate('target_arch="x86_64"', unknown)).toBeUndefined();
    expect(evaluateCfgPredicate('target_pointer_width="64"', unknown)).toBeUndefined();
    expect(evaluateCfgPredicate('target_pointer_width="32"', unknown)).toBeUndefined();
    expect(evaluateCfgPredicate('pointer_width="64"', unknown)).toBeUndefined();
    expect(evaluateCfgPredicate('target_endian="little"', unknown)).toBeUndefined();
    // The OS was still observed, so that dimension stays decided.
    expect(evaluateCfgPredicate('target_os="linux"', unknown)).toBe(true);
  });
});

describe('parseRustCfgEntries', () => {
  const entries = (list: string[]): Array<[string, boolean]> =>
    Array.from(parseRustCfgEntries(list).entries());

  it('keeps bare idents as-is', () => {
    expect(entries(['unix'])).toEqual([['unix', true]]);
    expect(entries(['-unix'])).toEqual([['unix', false]]);
  });

  it('normalizes the feature spellings to feature="a"', () => {
    expect(entries(['feature="a"'])).toEqual([['feature="a"', true]]);
    expect(entries(["feature='a'"])).toEqual([['feature="a"', true]]);
    expect(entries(['feature=a'])).toEqual([['feature="a"', true]]);
    expect(entries(['-feature="a"'])).toEqual([['feature="a"', false]]);
  });

  it('tolerates whitespace around =', () => {
    expect(entries(['target_os = "linux"'])).toEqual([['target_os="linux"', true]]);
  });

  it('ignores empty entries, a lone minus and trailing junk', () => {
    expect(entries([''])).toEqual([]);
    expect(entries(['-'])).toEqual([]);
    expect(entries(['   '])).toEqual([]);
    expect(entries(['feature=a b'])).toEqual([]);
    expect(entries(['feature="a" b'])).toEqual([]);
  });

  it('lets a later duplicate win', () => {
    expect(entries(['unix', '-unix'])).toEqual([['unix', false]]);
    expect(entries(['-unix', 'unix'])).toEqual([['unix', true]]);
    expect(entries(['unix', 'feature=a', 'unix'])).toEqual([
      ['unix', true],
      ['feature="a"', true],
    ]);
  });
});

describe('precedence', () => {
  it('an explicit -unix beats the host unix', () => {
    const environment: RustCfgEnvironment = {
      explicit: parseRustCfgEntries(['-unix']),
      host: hostCfg('linux', 'x64').predicates,
    };
    expect(evaluateCfgPredicate('unix', environment)).toBe(false);
  });

  it('an explicit feature true beats an undecidable absence', () => {
    const environment: RustCfgEnvironment = {
      explicit: parseRustCfgEntries(['feature="zz"']),
      features: { decidableAbsence: false, universe: new Set(), enabled: new Set() },
    };
    expect(evaluateCfgPredicate('feature="zz"', environment)).toBe(true);
  });

  it('an explicit true decides an otherwise unknown bare ident', () => {
    const environment: RustCfgEnvironment = {
      explicit: parseRustCfgEntries(['test']),
    };
    expect(evaluateCfgPredicate('test', environment)).toBe(true);
  });
});

describe('grammar and malformed input', () => {
  it('accepts an optional cfg(...) wrapper and trailing commas', () => {
    expect(evaluateCfgPredicate('cfg(unix)', HOST_ENV)).toBe(true);
    expect(evaluateCfgPredicate('cfg ( all(unix, not(windows)) )', HOST_ENV)).toBe(true);
    expect(evaluateCfgPredicate('all(unix,)', HOST_ENV)).toBe(true);
  });

  it('tolerates arbitrary whitespace', () => {
    const environment: RustCfgEnvironment = {
      host: HOST_ENV.host,
      features: { decidableAbsence: true, universe: new Set(['a']), enabled: new Set(['a']) },
    };
    expect(
      evaluateCfgPredicate('all(  unix ,  target_os = "linux" , feature = "a"  )', environment)
    ).toBe(true);
  });

  const MALFORMED = [
    '',
    '   ',
    'all(unix',
    'not(a, b)',
    'not()',
    'feature=1',
    'feature="a',
    'all unix',
    'unix)',
    'all(unix))',
    '@',
    'any(,)',
    'cfg(unix',
  ];

  for (const expression of MALFORMED) {
    it(`${JSON.stringify(expression)} -> undefined without throwing`, () => {
      expect(() => evaluateCfgPredicate(expression, HOST_ENV)).not.toThrow();
      expect(evaluateCfgPredicate(expression, HOST_ENV)).toBeUndefined();
    });
  }
});
