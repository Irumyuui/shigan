/**
 * Three-valued (Kleene) evaluator for Rust `#[cfg(...)]` predicates.
 *
 * `true` and `false` are decided facts; `undefined` means "unknown", which
 * callers must handle conservatively (never mark code inactive on an unknown).
 * The module is deliberately `vscode`-free and dependency-free so it can run in
 * vitest.
 *
 * Platform predicates are decided only when the host was actually observed
 * (see {@link hostCfg}); feature predicates are decided only against a resolved
 * manifest (see {@link FeatureFacts}). Deliberate divergence from rust-analyzer:
 * `test` and `debug_assertions` are never guessed, because a wrong guess would
 * hide live code.
 */

/** Facts about the crate's feature universe, when a manifest was actually resolved. */
export interface FeatureFacts {
  /** True only when a non-virtual, non-workspace-member manifest was resolved. */
  decidableAbsence: boolean;
  /** Every declared + implicitly-defined feature name. */
  universe: ReadonlySet<string>;
  /** Features enabled by `default`. */
  enabled: ReadonlySet<string>;
}

export interface RustCfgEnvironment {
  /** Explicit `shigan.rust.cfg` entries (already parsed): canonical predicate → value. */
  explicit?: ReadonlyMap<string, boolean>;
  /** Host-observed platform predicates (see {@link hostCfg}). */
  host?: ReadonlySet<string>;
  /** Feature facts; absent => every `feature = "x"` is unknown unless explicitly set. */
  features?: FeatureFacts;
}

/** Canonical form of a key-value predicate, e.g. `feature="serde"`. */
const FEATURE_PREFIX = 'feature="';

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*/;

const RECOGNIZED_PLATFORMS = new Set([
  'linux',
  'darwin',
  'win32',
  'freebsd',
  'openbsd',
  'android',
  'sunos',
  'haiku',
]);

/** Node platform ids whose target triple is observable, mapped to the Rust name. */
const PLATFORM_ALIASES: Record<string, string> = {
  win32: 'windows',
  darwin: 'macos',
  sunos: 'solaris',
};

/** Node `process.arch` values that map to a Rust target arch. */
const ARCH_ALIASES: Record<string, string> = {
  x64: 'x86_64',
  arm64: 'aarch64',
  ia32: 'x86',
  ppc: 'powerpc',
  ppc64: 'powerpc64',
  ppc64le: 'powerpc64le',
  loong64: 'loongarch64',
  s390: 's390x',
};

/**
 * Facts derivable from a normalized Rust target arch. `undefined` (an arch not
 * in this table) means the dimension is NOT observed and must stay unknown —
 * never guessed false.
 */
const ARCH_FACTS: Record<string, { width: '32' | '64'; endian: 'little' | 'big' }> = {
  x86: { width: '32', endian: 'little' },
  i386: { width: '32', endian: 'little' },
  i586: { width: '32', endian: 'little' },
  i686: { width: '32', endian: 'little' },
  x86_64: { width: '64', endian: 'little' },
  arm: { width: '32', endian: 'little' },
  aarch64: { width: '64', endian: 'little' },
  mips: { width: '32', endian: 'big' },
  mipsel: { width: '32', endian: 'little' },
  mips64: { width: '64', endian: 'big' },
  mips64el: { width: '64', endian: 'little' },
  powerpc: { width: '32', endian: 'big' },
  powerpc64: { width: '64', endian: 'big' },
  powerpc64le: { width: '64', endian: 'little' },
  riscv32: { width: '32', endian: 'little' },
  riscv64: { width: '64', endian: 'little' },
  s390x: { width: '64', endian: 'big' },
  sparc64: { width: '64', endian: 'big' },
  loongarch64: { width: '64', endian: 'little' },
  wasm32: { width: '32', endian: 'little' },
};

/** Key-value predicates that live in the platform namespace. */
const PLATFORM_PREFIXES = [
  'target_os="',
  'target_arch="',
  'target_family="',
  'target_env="',
  'target_endian="',
  'target_pointer_width="',
  'pointer_width="',
];

/** Parses a raw `shigan.rust.cfg` string list into canonical predicate → value. */
export function parseRustCfgEntries(entries: readonly string[]): Map<string, boolean> {
  const result = new Map<string, boolean>();
  for (const entry of entries) {
    const parsed = parseCfgEntry(entry);
    if (parsed) result.set(parsed.key, parsed.value);
  }
  return result;
}

/**
 * Parses one `shigan.rust.cfg` entry: `unix`, `-unix`, `feature="a"`,
 * `feature='a'` or `feature=a` (all the feature spellings normalize to
 * `feature="a"`). Empty entries, a lone `-` and anything else malformed are
 * ignored — the settings list is user input, so it must never throw.
 */
function parseCfgEntry(entry: string): { key: string; value: boolean } | undefined {
  let text = entry.trim();
  if (!text) return undefined;

  let value = true;
  if (text.startsWith('-')) {
    value = false;
    text = text.slice(1).trim();
    if (!text) return undefined;
  }

  const nameMatch = IDENTIFIER.exec(text);
  if (!nameMatch) return undefined;
  const name = nameMatch[0];

  let rest = text.slice(name.length).trim();
  if (!rest) return { key: name, value };
  if (!rest.startsWith('=')) return undefined;

  rest = rest.slice(1).trim();
  if (!rest) return undefined;

  const rawValue = parseEntryValue(rest);
  if (rawValue === undefined) return undefined;
  return { key: `${name}="${rawValue}"`, value };
}

/** Reads `"a"` / `'a'` / `a` (bare) and rejects trailing junk. */
function parseEntryValue(text: string): string | undefined {
  const quote = text[0];
  if (quote === '"' || quote === "'") {
    if (text.length < 2 || text[text.length - 1] !== quote) return undefined;
    const inner = text.slice(1, -1);
    if (inner.includes(quote)) return undefined;
    return inner;
  }

  const space = text.search(/\s/);
  if (space < 0) return text || undefined;
  if (text.slice(space).trim()) return undefined;
  const value = text.slice(0, space);
  return value || undefined;
}

/** Evaluates a cfg predicate expression (`all(...)`, `any(...)`, `not(...)`, `ident`, `ident = "value"`). */
export function evaluateCfgPredicate(
  expression: string,
  environment: RustCfgEnvironment
): boolean | undefined {
  if (typeof expression !== 'string') return undefined;
  let text = expression.trim();
  if (!text) return undefined;

  // Accept an optional `cfg(...)` wrapper, but only when it wraps the whole input.
  const wrapper = /^cfg\s*\(/.exec(text);
  if (wrapper) {
    if (text[text.length - 1] !== ')') return undefined;
    text = text.slice(wrapper[0].length, text.length - 1);
  }

  try {
    const parser = new PredicateParser(text, environment);
    const value = parser.parseExpression();
    return parser.atEnd() ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Recursive-descent parser for the supported cfg grammar. Throws on malformed input. */
class PredicateParser {
  private pos = 0;

  constructor(
    private readonly text: string,
    private readonly environment: RustCfgEnvironment
  ) {}

  atEnd(): boolean {
    this.skipWhitespace();
    return this.pos >= this.text.length;
  }

  parseExpression(): boolean | undefined {
    this.skipWhitespace();
    const name = this.readIdentifier();
    if (name === undefined) throw new Error('expected a predicate');

    this.skipWhitespace();
    if (this.text[this.pos] === '(') {
      if (name !== 'all' && name !== 'any' && name !== 'not') {
        throw new Error('unknown combinator');
      }
      this.pos++;
      const args = this.parseArguments();
      this.skipWhitespace();
      if (this.text[this.pos] !== ')') throw new Error('expected )');
      this.pos++;
      if (name === 'not' && args.length !== 1) throw new Error('not takes one operand');
      return applyCombinator(name, args);
    }

    if (this.text[this.pos] === '=') {
      this.pos++;
      this.skipWhitespace();
      const value = this.readString();
      if (value === undefined) throw new Error('expected a quoted string');
      return resolveCanonical(`${name}="${value}"`, this.environment);
    }

    // A bare identifier; any trailing junk is rejected by `atEnd`.
    return resolveCanonical(name, this.environment);
  }

  /** Comma-separated operand list; a trailing comma and an empty list are allowed. */
  private parseArguments(): Array<boolean | undefined> {
    const args: Array<boolean | undefined> = [];
    this.skipWhitespace();
    if (this.text[this.pos] === ')') return args;

    for (;;) {
      args.push(this.parseExpression());
      this.skipWhitespace();
      if (this.text[this.pos] !== ',') return args;
      this.pos++;
      this.skipWhitespace();
      if (this.text[this.pos] === ')') return args;
    }
  }

  private readIdentifier(): string | undefined {
    if (!isIdentifierStart(this.text[this.pos])) return undefined;
    const start = this.pos;
    this.pos++;
    while (this.pos < this.text.length && isIdentifierPart(this.text[this.pos])) this.pos++;
    return this.text.slice(start, this.pos);
  }

  /** Reads a double-quoted string literal (Rust cfg values use `"`). */
  private readString(): string | undefined {
    if (this.text[this.pos] !== '"') return undefined;
    const close = this.text.indexOf('"', this.pos + 1);
    if (close < 0) return undefined;
    const value = this.text.slice(this.pos + 1, close);
    this.pos = close + 1;
    return value;
  }

  private skipWhitespace(): void {
    while (this.pos < this.text.length && /\s/.test(this.text[this.pos])) this.pos++;
  }
}

/** Kleene combination; `undefined` is the unknown truth value. */
function applyCombinator(name: string, args: Array<boolean | undefined>): boolean | undefined {
  if (name === 'all') {
    if (args.includes(false)) return false;
    if (args.includes(undefined)) return undefined;
    return true;
  }
  if (name === 'any') {
    if (args.includes(true)) return true;
    if (args.includes(undefined)) return undefined;
    return false;
  }
  const only = args[0];
  return only === undefined ? undefined : !only;
}

/**
 * Resolves one canonical predicate, first hit wins: explicit settings, the
 * platform namespace, then the feature namespace. Anything else is unknown.
 */
function resolveCanonical(
  canonical: string,
  environment: RustCfgEnvironment
): boolean | undefined {
  const explicit = environment.explicit?.get(canonical);
  if (explicit !== undefined) return explicit;

  if (isPlatformAtom(canonical)) {
    return resolvePlatformAtom(canonical, environment.host);
  }

  const feature = featureName(canonical);
  if (feature !== undefined) {
    const facts = environment.features;
    if (!facts) return undefined;
    if (facts.enabled.has(feature)) return true;
    // A feature absent from the universe cannot exist — but only when the
    // manifest was actually resolved. Declared-but-not-default stays unknown.
    if (facts.decidableAbsence && !facts.universe.has(feature)) return false;
    return undefined;
  }

  return undefined;
}

/** True for `unix`/`windows` and every `target_*= "…"` / `pointer_width="…"` key. */
function isPlatformAtom(canonical: string): boolean {
  if (canonical === 'unix' || canonical === 'windows') return true;
  return PLATFORM_PREFIXES.some((prefix) => canonical.startsWith(prefix));
}

/**
 * Resolves a platform atom against the host's observed predicates. A dimension
 * the host never observed (the set has no key for it) is unknown, never false;
 * a dimension the host DID observe is fully known, so a differing value is
 * definitely false.
 */
function resolvePlatformAtom(
  canonical: string,
  host: ReadonlySet<string> | undefined
): boolean | undefined {
  if (!host || host.size === 0) return undefined;

  if (canonical === 'unix' || canonical === 'windows') {
    const observed =
      host.has('unix') || host.has('windows') || observesPrefix(host, 'target_family="');
    return observed ? host.has(canonical) : undefined;
  }

  const prefix = PLATFORM_PREFIXES.find((candidate) => canonical.startsWith(candidate));
  if (!prefix || !observesPrefix(host, prefix)) return undefined;
  return host.has(canonical);
}

/** True when the host recorded any predicate in the given key-value dimension. */
function observesPrefix(host: ReadonlySet<string>, prefix: string): boolean {
  for (const predicate of host) {
    if (predicate.startsWith(prefix)) return true;
  }
  return false;
}

/** Extracts `x` from `feature="x"`, or `undefined` for any other predicate. */
function featureName(canonical: string): string | undefined {
  if (!canonical.startsWith(FEATURE_PREFIX) || !canonical.endsWith('"')) return undefined;
  return canonical.slice(FEATURE_PREFIX.length, -1);
}

/**
 * Host-observed platform predicates for a Node `process.platform` / `process.arch`
 * pair. Only dimensions genuinely derived from the host are emitted: an OS or
 * arch that does not map to a Rust target contributes nothing, and `target_env`
 * is only known on Windows (msvc) — on other hosts gnu vs musl is not
 * observable, so the dimension stays absent and thus unknown.
 */
export function hostCfg(
  platform: string,
  arch: string
): { predicates: ReadonlySet<string>; recognized: boolean } {
  if (!RECOGNIZED_PLATFORMS.has(platform)) {
    return { predicates: new Set(), recognized: false };
  }

  const predicates = new Set<string>();
  const windows = platform === 'win32';

  predicates.add(windows ? 'windows' : 'unix');
  predicates.add(`target_family="${windows ? 'windows' : 'unix'}"`);

  const targetOs = PLATFORM_ALIASES[platform] ?? platform;
  predicates.add(`target_os="${targetOs}"`);

  const targetArch = normalizeArch(arch);
  if (targetArch) {
    predicates.add(`target_arch="${targetArch}"`);

    const facts = ARCH_FACTS[targetArch];
    if (facts) {
      predicates.add(`target_pointer_width="${facts.width}"`);
      predicates.add(`pointer_width="${facts.width}"`);
      predicates.add(`target_endian="${facts.endian}"`);
    }
  }

  if (windows) predicates.add('target_env="msvc"');

  // `test` and `debug_assertions` are intentionally NOT emitted: guessing them
  // would mark live code inactive.
  return { predicates, recognized: true };
}

/** Maps a Node `process.arch` to a known Rust arch, or `undefined` when it does not map. */
function normalizeArch(arch: string): string | undefined {
  const mapped = ARCH_ALIASES[arch] ?? arch;
  return mapped in ARCH_FACTS ? mapped : undefined;
}

function isIdentifierStart(c: string | undefined): boolean {
  return c !== undefined && ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_');
}

function isIdentifierPart(c: string): boolean {
  return isIdentifierStart(c) || (c >= '0' && c <= '9');
}
