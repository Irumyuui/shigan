/**
 * Minimal, dependency-free reader for MSBuild project files (`.csproj`,
 * `Directory.Build.props`). It extracts the C# `DefineConstants` compiler
 * symbols a project would define and derives the implicit symbols the .NET SDK
 * adds for a given target framework (`NET8_0_OR_GREATER`, `NETCOREAPP`, ...).
 *
 * The module is deliberately `vscode`-free and `node:fs`-free so it can run in
 * vitest. It is a focused scanner, not a general XML/MSBuild parser: unknown
 * conditions are treated as true (conservative include — an extra symbol can
 * change evaluation, but a missing symbol makes hints lie).
 */

/** Overrides used while expanding `$(...)` properties in conditions/values. */
export interface CsprojOptions {
  /** Value for `$(Configuration)`; defaults to `'Debug'`. */
  configuration?: string;
  /** Value for `$(Platform)`; defaults to `'AnyCPU'`. */
  platform?: string;
  /** Overrides the target framework found in the XML. */
  targetFramework?: string;
}

/** Result of scanning a project file. */
export interface CsprojResult {
  /** Every valid C# symbol found in the applied `DefineConstants` values. */
  symbols: Set<string>;
  /** Resolved target framework moniker (e.g. `net8.0`), when one was found. */
  targetFramework?: string;
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** `<TargetFramework>` never matches `<TargetFrameworks>` because of the `\b`. */
const TARGET_FRAMEWORK_RE = /<TargetFramework\b[^>]*>([\s\S]*?)<\/TargetFramework\s*>/i;
const TARGET_FRAMEWORKS_RE = /<TargetFrameworks\b[^>]*>([\s\S]*?)<\/TargetFrameworks\s*>/i;
const DEFINE_CONSTANTS_CLOSE_RE = /<\/DefineConstants\s*>/gi;
const TAG_RE = /<(\/?)([A-Za-z_][\w.-]*)([^>]*?)(\/?)>/g;

/** Versions recognised by {@link frameworkSymbols}, ascending. */
const NETCOREAPP_VERSIONS = ['1.0', '1.1', '2.0', '2.1', '2.2', '3.0', '3.1'];
const NETSTANDARD_VERSIONS = ['1.0', '1.1', '1.2', '1.3', '1.4', '1.5', '1.6', '2.0', '2.1'];
const NETFRAMEWORK_VERSIONS = [
  '20', '35', '40', '45', '451', '452', '46', '461', '462', '47', '471', '472', '48', '481',
];

/**
 * Scans project XML for `DefineConstants` symbols.
 *
 * Every `<DefineConstants>` value is appended (document order), honouring
 * `Condition` on both the element and its enclosing `<PropertyGroup>`.
 * `$(DefineConstants)` expands to the symbols accumulated so far;
 * `$(Configuration)`, `$(Platform)` and `$(TargetFramework)` expand to the
 * matching option/XML value. Any other `$(...)` is left untouched.
 *
 * @param xml Raw project file contents.
 * @param options Property overrides; see {@link CsprojOptions}.
 */
export function parseDefineConstants(xml: string, options: CsprojOptions = {}): CsprojResult {
  const configuration = options.configuration ?? 'Debug';
  const platform = options.platform ?? 'AnyCPU';
  const targetFramework = options.targetFramework ?? findTargetFramework(xml);

  const symbols = new Set<string>();

  const resolveVariable = (name: string): string | undefined => {
    switch (name) {
      case 'configuration':
        return configuration;
      case 'platform':
        return platform;
      case 'targetframework':
        return targetFramework;
      case 'defineconstants':
        return Array.from(symbols).join(';');
      default:
        return undefined;
    }
  };

  const groupConditions: Array<string | undefined> = [];

  let match: RegExpExecArray | null;
  TAG_RE.lastIndex = 0;
  while ((match = TAG_RE.exec(xml)) !== null) {
    const closing = match[1] === '/';
    const name = match[2];
    const attributes = match[3];
    const selfClosing = match[4] === '/';

    if (name === 'PropertyGroup') {
      if (closing) groupConditions.pop();
      else if (!selfClosing) groupConditions.push(readCondition(attributes));
      continue;
    }

    if (name !== 'DefineConstants' || closing || selfClosing) continue;

    DEFINE_CONSTANTS_CLOSE_RE.lastIndex = TAG_RE.lastIndex;
    const close = DEFINE_CONSTANTS_CLOSE_RE.exec(xml);
    const rawValue = close
      ? xml.slice(TAG_RE.lastIndex, close.index)
      : xml.slice(TAG_RE.lastIndex);
    if (close) TAG_RE.lastIndex = DEFINE_CONSTANTS_CLOSE_RE.lastIndex;

    const groupOk = groupConditions.every((condition) =>
      evaluateCondition(condition, resolveVariable)
    );
    const elementOk = evaluateCondition(readCondition(attributes), resolveVariable);
    if (groupOk && elementOk) {
      appendSymbols(symbols, rawValue, resolveVariable);
    }
  }

  return targetFramework === undefined
    ? { symbols }
    : { symbols, targetFramework };
}

/**
 * Returns the implicit preprocessor symbols the .NET SDK defines for a target
 * framework moniker (normalised to lowercase). Unknown or unsupported monikers
 * yield `[]`. The result is sorted ascending for deterministic comparisons.
 *
 * @example frameworkSymbols('net8.0') // ['NET', 'NET5_0_OR_GREATER', ...]
 */
export function frameworkSymbols(targetFramework: string): string[] {
  if (!targetFramework) return [];
  const moniker = targetFramework.trim().toLowerCase();
  const symbols = new Set<string>();

  const coreApp = /^netcoreapp(\d+)\.(\d+)$/.exec(moniker);
  if (coreApp) {
    const target = `${coreApp[1]}.${coreApp[2]}`;
    symbols.add('NETCOREAPP');
    symbols.add(`NETCOREAPP${coreApp[1]}_${coreApp[2]}`);
    addVersionLadder(symbols, 'NETCOREAPP', NETCOREAPP_VERSIONS, target);
    return sorted(symbols);
  }

  const standard = /^netstandard(\d+)\.(\d+)$/.exec(moniker);
  if (standard) {
    const target = `${standard[1]}.${standard[2]}`;
    symbols.add('NETSTANDARD');
    symbols.add(`NETSTANDARD${standard[1]}_${standard[2]}`);
    addVersionLadder(symbols, 'NETSTANDARD', NETSTANDARD_VERSIONS, target);
    return sorted(symbols);
  }

  const modern = /^net(\d+)\.(\d+)$/.exec(moniker);
  if (modern) {
    const major = Number(modern[1]);
    const minor = Number(modern[2]);
    if (major < 5) return [];
    symbols.add('NET');
    symbols.add(`NET${major}_${minor}`);
    for (let version = 5; version <= major; version++) {
      symbols.add(`NET${version}_0_OR_GREATER`);
    }
    if (minor > 0) symbols.add(`NET${major}_${minor}_OR_GREATER`);
    symbols.add('NETCOREAPP');
    for (const version of NETCOREAPP_VERSIONS) {
      symbols.add(`NETCOREAPP${version.replace('.', '_')}_OR_GREATER`);
    }
    return sorted(symbols);
  }

  const framework = /^net(\d{2,3})$/.exec(moniker);
  if (framework) {
    const index = NETFRAMEWORK_VERSIONS.indexOf(framework[1]);
    if (index < 0) return [];
    symbols.add('NETFRAMEWORK');
    symbols.add(`NET${framework[1]}`);
    for (let i = 0; i <= index; i++) {
      symbols.add(`NET${NETFRAMEWORK_VERSIONS[i]}_OR_GREATER`);
    }
    return sorted(symbols);
  }

  return [];
}

/** Resolves the project's target framework, preferring `<TargetFramework>`. */
function findTargetFramework(xml: string): string | undefined {
  const single = TARGET_FRAMEWORK_RE.exec(xml);
  if (single) {
    const value = unescapeXml(single[1]).trim();
    if (value) return value;
  }

  const multiple = TARGET_FRAMEWORKS_RE.exec(xml);
  if (multiple) {
    const value = unescapeXml(multiple[1]).split(';')[0]?.trim();
    if (value) return value;
  }

  return undefined;
}

/** Expands `$(...)` within `rawValue`, splits it and appends valid symbols. */
function appendSymbols(
  symbols: Set<string>,
  rawValue: string,
  resolveVariable: (name: string) => string | undefined
): void {
  const value = unescapeXml(rawValue);
  const { text } = expandVariables(value, resolveVariable);
  for (const piece of text.split(/[;,]/)) {
    const symbol = piece.trim();
    if (IDENTIFIER.test(symbol)) symbols.add(symbol);
  }
}

/** Extracts and unescapes a `Condition="..."` attribute from a raw tag body. */
function readCondition(attributes: string): string | undefined {
  const match = /Condition\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attributes);
  if (!match) return undefined;
  return unescapeXml(match[1] ?? match[2] ?? '');
}

/** Decodes the five entities MSBuild relies on; `&amp;` last to avoid re-decoding. */
function unescapeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * Replaces `$(Name)` using `resolveVariable` (case-insensitive). Reports whether
 * any variable stayed unresolved so callers can fall back conservatively.
 */
function expandVariables(
  text: string,
  resolveVariable: (name: string) => string | undefined
): { text: string; unresolved: boolean } {
  let unresolved = false;
  const expanded = text.replace(/\$\(([^()]+)\)/g, (whole, rawName: string) => {
    const value = resolveVariable(rawName.trim().toLowerCase());
    if (value === undefined) {
      unresolved = true;
      return whole;
    }
    return value;
  });
  return { text: expanded, unresolved };
}

/**
 * Evaluates an MSBuild condition. Unresolved variables and unsupported syntax
 * (anything beyond quoted `==`/`!=` comparisons combined with `And`/`Or`/`!`
 * and parentheses) conservatively evaluate to `true`.
 */
function evaluateCondition(
  condition: string | undefined,
  resolveVariable: (name: string) => string | undefined
): boolean {
  if (condition === undefined) return true;
  const trimmed = condition.trim();
  if (!trimmed) return true;

  const { text, unresolved } = expandVariables(trimmed, resolveVariable);
  if (unresolved) return true;

  try {
    return new ConditionParser(text).parse();
  } catch {
    return true;
  }
}

/** Recursive-descent parser for the supported subset of MSBuild conditions. */
class ConditionParser {
  private position = 0;

  constructor(private readonly text: string) {}

  parse(): boolean {
    const value = this.parseOr();
    this.skipWhitespace();
    if (this.position < this.text.length) throw new Error('unexpected trailing input');
    return value;
  }

  private parseOr(): boolean {
    let value = this.parseAnd();
    while (this.matchKeyword('Or')) {
      const right = this.parseAnd();
      value = value || right;
    }
    return value;
  }

  private parseAnd(): boolean {
    let value = this.parseUnary();
    while (this.matchKeyword('And')) {
      const right = this.parseUnary();
      value = value && right;
    }
    return value;
  }

  private parseUnary(): boolean {
    this.skipWhitespace();
    if (this.text[this.position] === '!') {
      this.position++;
      return !this.parseUnary();
    }
    if (this.text[this.position] === '(') {
      this.position++;
      const value = this.parseOr();
      this.skipWhitespace();
      if (this.text[this.position] !== ')') throw new Error('expected )');
      this.position++;
      return value;
    }
    return this.parseComparison();
  }

  private parseComparison(): boolean {
    const left = this.readQuoted();
    this.skipWhitespace();
    const operator = this.readOperator();
    if (operator === undefined) throw new Error('unsupported condition');
    const right = this.readQuoted();
    return operator === '==' ? left === right : left !== right;
  }

  private readQuoted(): string {
    this.skipWhitespace();
    if (this.text[this.position] !== "'") throw new Error('expected quoted operand');
    const end = this.text.indexOf("'", this.position + 1);
    if (end < 0) throw new Error('unterminated operand');
    const value = this.text.slice(this.position + 1, end);
    this.position = end + 1;
    return value;
  }

  private readOperator(): string | undefined {
    this.skipWhitespace();
    if (this.text.startsWith('==', this.position)) {
      this.position += 2;
      return '==';
    }
    if (this.text.startsWith('!=', this.position)) {
      this.position += 2;
      return '!=';
    }
    return undefined;
  }

  private matchKeyword(keyword: string): boolean {
    const saved = this.position;
    this.skipWhitespace();
    const slice = this.text.slice(this.position, this.position + keyword.length);
    if (slice.toLowerCase() !== keyword.toLowerCase()) {
      this.position = saved;
      return false;
    }
    const next = this.text[this.position + keyword.length];
    if (next !== undefined && /[A-Za-z0-9_]/.test(next)) {
      this.position = saved;
      return false;
    }
    this.position += keyword.length;
    return true;
  }

  private skipWhitespace(): void {
    while (this.position < this.text.length && /\s/.test(this.text[this.position])) {
      this.position++;
    }
  }
}

/** Numeric ordering key for `major.minor` version strings. */
function versionValue(version: string): number {
  const [major, minor] = version.split('.').map(Number);
  return major * 100 + (minor ?? 0);
}

/** Adds `<prefix><version>_OR_GREATER` for every listed version <= `target`. */
function addVersionLadder(
  symbols: Set<string>,
  prefix: string,
  versions: string[],
  target: string
): void {
  const targetValue = versionValue(target);
  for (const version of versions) {
    if (versionValue(version) <= targetValue) {
      symbols.add(`${prefix}${version.replace('.', '_')}_OR_GREATER`);
    }
  }
}

/** Sorted array copy, for deterministic output. */
function sorted(symbols: Set<string>): string[] {
  return Array.from(symbols).sort();
}
