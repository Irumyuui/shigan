/**
 * Minimal, dependency-free reader for Cargo manifests (`Cargo.toml`). It
 * extracts the feature names an editor needs to evaluate `#[cfg(feature =
 * "...")]`: the keys declared in `[features]`, the implicit features created by
 * `optional = true` dependencies, and the transitive closure of `default =
 * [...]`.
 *
 * The module is deliberately `vscode`-free and `node:fs`-free so it can run in
 * vitest. It is a focused scanner, not a general TOML parser: it understands the
 * subset Cargo manifests use (tables, dotted keys, arrays, inline tables,
 * strings, comments) and tolerates whitespace, CRLF line endings, trailing
 * commas and multi-line arrays. Anything it cannot make sense of makes
 * {@link parseCargoFeatures} return `undefined` rather than throw.
 */

/** Feature information extracted from a single `Cargo.toml`. */
export interface CargoFeatures {
  /** Keys declared in `[features]`. Includes `default` when it is declared. */
  declared: ReadonlySet<string>;
  /** Implicit features of `optional = true` dependencies (all dependency tables). */
  implicit: ReadonlySet<string>;
  /** Transitive closure of `default = [...]` over declared + implicit names. */
  defaults: ReadonlySet<string>;
  /** True when the manifest has `[workspace]` but no `[package]` (a virtual root). */
  virtual: boolean;
}

/** Dependency tables that may hold optional dependencies. */
const DEPENDENCY_TABLES = new Set(['dependencies', 'dev-dependencies', 'build-dependencies']);

/**
 * Scans a `Cargo.toml` for its feature names.
 *
 * `declared` holds every key of the `[features]` table (including `default`
 * when it is written out). `implicit` holds the name of every dependency marked
 * `optional = true`, whether it is written inline (`serde = { optional = true
 * }`), with a dotted key (`dependencies.serde = { ... }`) or as its own table
 * (`[dependencies.serde]` + `optional = true`), in `[dependencies]`,
 * `[dev-dependencies]`, `[build-dependencies]` or their `[target.….…]`
 * variants.
 *
 * **`dep:` suppression is implemented.** In real Cargo an optional dependency
 * referenced through `dep:<name>` anywhere in `[features]` loses its implicit
 * feature (the name becomes a plain alias, not a cfg feature). This parser follows
 * that rule: such a dependency is *not* added to `implicit`, while optional
 * dependencies that no feature references via `dep:` are. If a renamed
 * dependency (`foo = { package = "real", optional = true }`) is referenced as
 * `dep:foo`, the key `foo` is the one suppressed.
 *
 * `defaults` is the breadth-first closure of `default = [...]` over names that
 * are either declared or implicit. Entries that are not local feature names —
 * `dep:foo`, `bar/baz` (enable an optional dependency's feature) and
 * `baz?/feat` (same, only if already enabled) — are skipped and never
 * enqueued. The `default` key itself is not part of the result. Unknown plain
 * names are skipped too, so a manifest that references a feature it never
 * declares cannot invent one.
 *
 * `virtual` is `true` for a virtual workspace root: a manifest with a
 * `[workspace]` table and no top-level `[package]`. (`[workspace.package]` does
 * not count as a package.)
 *
 * @param toml Raw manifest contents.
 * @returns The extracted features, or `undefined` on malformed input or when the
 *   manifest contains nothing usable (no `[features]`, no dependency entries and
 *   no `[workspace]`). Never throws.
 */
export function parseCargoFeatures(toml: string): CargoFeatures | undefined {
  if (typeof toml !== 'string') return undefined;

  const scan = new TomlScanner(stripComments(toml.replace(/^\uFEFF/, ''))).scan();
  if (scan === undefined) return undefined;

  const hasFeaturesTable = scan.tables.some(isTable(['features']));
  const hasWorkspace = scan.tables.some(isTable(['workspace']));
  const hasPackage = scan.tables.some(isTable(['package']));

  const declared = new Set<string>();
  const featureValues = new Map<string, string[]>();
  const optionalDeps = new Set<string>();
  let sawDependencyEntry = false;

  for (const assignment of scan.assignments) {
    if (isTable(['features'])(assignment.table)) {
      const entries = parseStringArray(assignment.value);
      if (entries === undefined) return undefined;
      declared.add(assignment.key);
      featureValues.set(assignment.key, entries);
      continue;
    }

    const dependency = dependencySection(assignment.table);
    if (dependency === undefined) continue;
    sawDependencyEntry = true;
    if (dependency.kind === 'inline') {
      if (inlineIsOptional(assignment.value)) optionalDeps.add(assignment.key);
    } else if (assignment.key === 'optional' && isTrue(assignment.value)) {
      optionalDeps.add(dependency.name);
    }
  }

  // Nothing to say about this manifest (e.g. a `[package]`-only stub).
  if (!hasFeaturesTable && !sawDependencyEntry && !hasWorkspace) return undefined;

  const depReferenced = new Set<string>();
  for (const entries of featureValues.values()) {
    for (const entry of entries) {
      if (entry.startsWith('dep:')) depReferenced.add(entry.slice('dep:'.length).trim());
    }
  }

  const implicit = new Set<string>();
  for (const name of optionalDeps) {
    if (!depReferenced.has(name)) implicit.add(name);
  }

  const defaults = new Set<string>();
  const queue: string[] = [];
  const enqueue = (name: string): void => {
    if (defaults.has(name)) return;
    if (!declared.has(name) && !implicit.has(name)) return;
    defaults.add(name);
    queue.push(name);
  };

  for (const name of featureValues.get('default') ?? []) enqueue(name);
  for (let index = 0; index < queue.length; index++) {
    for (const entry of featureValues.get(queue[index]) ?? []) enqueue(entry);
  }

  return { declared, implicit, defaults, virtual: hasWorkspace && !hasPackage };
}

/** Table-path predicate. */
function isTable(expected: string[]): (table: string[]) => boolean {
  return (table) =>
    table.length === expected.length && expected.every((segment, index) => table[index] === segment);
}

/**
 * Classifies a table path as a dependency table. Accepts the plain tables and
 * the `[target.<cfg>.…]` variants, where `<cfg>` itself may contain dots (it is
 * kept as a single segment by the scanner).
 */
function dependencySection(
  table: string[]
): { kind: 'inline' } | { kind: 'section'; name: string } | undefined {
  if (table.length === 0) return undefined;

  let baseIndex = -1;
  if (table[0] === 'target') {
    for (let index = 1; index < table.length; index++) {
      if (DEPENDENCY_TABLES.has(table[index])) {
        baseIndex = index;
        break;
      }
    }
    if (baseIndex < 0) return undefined;
  } else if (DEPENDENCY_TABLES.has(table[0])) {
    baseIndex = 0;
  } else {
    return undefined;
  }

  const rest = table.slice(baseIndex + 1);
  if (rest.length === 0) return { kind: 'inline' };
  return { kind: 'section', name: rest.join('.') };
}

/** Extracts the quoted strings of a feature value array; `undefined` if not one. */
function parseStringArray(raw: string): string[] | undefined {
  const text = raw.trim();
  if (!text.startsWith('[')) return undefined;

  const strings: string[] = [];
  let index = 1;
  while (index < text.length) {
    const char = text[index];
    if (char === ' ' || char === '\t' || char === '\n' || char === '\r' || char === ',') {
      index++;
      continue;
    }
    if (char === ']') return strings;
    if (char === '"' || char === "'") {
      const read = readStringAt(text, index);
      if (read === undefined) return undefined;
      strings.push(read.value);
      index = read.next;
      continue;
    }
    return undefined; // nested arrays / bare tokens are not valid feature lists
  }
  return undefined; // unterminated array
}

/** Reads a TOML string at `start`, returning its contents and the next index. */
function readStringAt(text: string, start: number): { value: string; next: number } | undefined {
  const quote = text[start];
  const triple = quote.repeat(3);
  if (text.startsWith(triple, start)) {
    const end = text.indexOf(triple, start + 3);
    if (end < 0) return undefined;
    return { value: text.slice(start + 3, end), next: end + 3 };
  }

  let index = start + 1;
  while (index < text.length) {
    const char = text[index];
    if (char === '\\' && quote === '"') {
      index += 2;
      continue;
    }
    if (char === quote) return { value: text.slice(start + 1, index), next: index + 1 };
    if (char === '\n') return undefined;
    index++;
  }
  return undefined;
}

/** Tolerant `optional = true` detection inside an inline-table dependency. */
function inlineIsOptional(raw: string): boolean {
  const text = raw.trim();
  if (!text.startsWith('{')) return false;
  return /(?:^|[,{\s])optional\s*=\s*true(?:[,}\s]|$)/.test(text);
}

/** Bare `true` test. */
function isTrue(raw: string): boolean {
  return raw.trim() === 'true';
}

/** Removes `#` comments without touching `#` inside strings. */
function stripComments(text: string): string {
  let out = '';
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (char === '#') {
      while (index < text.length && text[index] !== '\n') index++;
      continue;
    }
    if (char === '"' || char === "'") {
      const triple = char.repeat(3);
      if (text.startsWith(triple, index)) {
        const end = text.indexOf(triple, index + 3);
        const stop = end < 0 ? text.length : end + 3;
        out += text.slice(index, stop);
        index = stop;
        continue;
      }
      let scan = index + 1;
      while (scan < text.length) {
        if (text[scan] === '\\' && char === '"') {
          scan += 2;
          continue;
        }
        if (text[scan] === char) {
          scan++;
          break;
        }
        if (text[scan] === '\n') break;
        scan++;
      }
      out += text.slice(index, scan);
      index = scan;
      continue;
    }
    out += char;
    index++;
  }
  return out;
}

interface Assignment {
  /** Fully-qualified table path the key lives in. */
  table: string[];
  /** Final (leaf) key, unquoted. */
  key: string;
  /** Raw value text. */
  value: string;
}

interface ScanResult {
  assignments: Assignment[];
  /** Every table header path encountered, in document order. */
  tables: string[][];
}

/**
 * Scans the TOML subset into table headers and assignments. Returns `undefined`
 * as soon as it sees something it cannot parse (unterminated table, array,
 * inline table or string; a line without `=`; trailing junk after a value).
 */
class TomlScanner {
  private index = 0;

  constructor(private readonly text: string) {}

  scan(): ScanResult | undefined {
    const assignments: Assignment[] = [];
    const tables: string[][] = [];
    let currentTable: string[] = [];

    for (;;) {
      this.skipTrivia();
      if (this.index >= this.text.length) break;

      if (this.text[this.index] === '[') {
        const table = this.readTableHeader();
        if (table === undefined) return undefined;
        tables.push(table);
        currentTable = table;
      } else {
        const assignment = this.readAssignment(currentTable);
        if (assignment === undefined) return undefined;
        assignments.push(assignment);
      }

      if (!this.atLineEnd()) return undefined;
    }

    return { assignments, tables };
  }

  private readTableHeader(): string[] | undefined {
    const arrayOfTables = this.text[this.index + 1] === '[';
    this.index += arrayOfTables ? 2 : 1;

    const segments: string[] = [];
    for (;;) {
      this.skipInlineWhitespace();
      const segment = this.readKeySegment();
      if (segment === undefined) return undefined;
      segments.push(segment);
      this.skipInlineWhitespace();
      if (this.text[this.index] === '.') {
        this.index++;
        continue;
      }
      break;
    }

    if (arrayOfTables) {
      if (this.text[this.index] === ']' && this.text[this.index + 1] === ']') {
        this.index += 2;
        return segments;
      }
      return undefined;
    }
    if (this.text[this.index] === ']') {
      this.index++;
      return segments;
    }
    return undefined;
  }

  private readAssignment(table: string[]): Assignment | undefined {
    const keySegments: string[] = [];
    for (;;) {
      this.skipInlineWhitespace();
      const segment = this.readKeySegment();
      if (segment === undefined) return undefined;
      keySegments.push(segment);
      this.skipInlineWhitespace();
      if (this.text[this.index] === '.') {
        this.index++;
        continue;
      }
      break;
    }

    this.skipInlineWhitespace();
    if (this.text[this.index] !== '=') return undefined;
    this.index++;
    this.skipInlineWhitespace();

    const value = this.readValue();
    if (value === undefined) return undefined;

    const path = [...table, ...keySegments];
    const key = path.pop() as string;
    return { table: path, key, value };
  }

  private readValue(): string | undefined {
    const start = this.index;
    const char = this.text[this.index];

    if (char === '"' || char === "'") {
      if (!this.readString()) return undefined;
      return this.text.slice(start, this.index);
    }
    if (char === '[') {
      if (!this.readArray()) return undefined;
      return this.text.slice(start, this.index);
    }
    if (char === '{') {
      if (!this.readInlineTable()) return undefined;
      return this.text.slice(start, this.index);
    }

    while (this.index < this.text.length) {
      const current = this.text[this.index];
      if (
        current === '\n' ||
        current === '\r' ||
        current === ',' ||
        current === ']' ||
        current === '}' ||
        current === ' ' ||
        current === '\t'
      ) {
        break;
      }
      this.index++;
    }
    if (this.index === start) return undefined;
    return this.text.slice(start, this.index);
  }

  private readString(): boolean {
    const quote = this.text[this.index];
    const triple = quote.repeat(3);
    if (this.text.startsWith(triple, this.index)) {
      const end = this.text.indexOf(triple, this.index + 3);
      if (end < 0) return false;
      this.index = end + 3;
      return true;
    }

    this.index++;
    while (this.index < this.text.length) {
      const char = this.text[this.index];
      if (char === '\\' && quote === '"') {
        this.index += 2;
        continue;
      }
      if (char === quote) {
        this.index++;
        return true;
      }
      if (char === '\n') return false;
      this.index++;
    }
    return false;
  }

  private readArray(): boolean {
    this.index++; // [
    for (;;) {
      this.skipTrivia();
      if (this.index >= this.text.length) return false;
      if (this.text[this.index] === ']') {
        this.index++;
        return true;
      }
      if (this.readValue() === undefined) return false;
      this.skipTrivia();
      if (this.text[this.index] === ',') {
        this.index++;
        continue;
      }
      if (this.text[this.index] === ']') {
        this.index++;
        return true;
      }
      return false;
    }
  }

  private readInlineTable(): boolean {
    this.index++; // {
    for (;;) {
      this.skipTrivia();
      if (this.index >= this.text.length) return false;
      if (this.text[this.index] === '}') {
        this.index++;
        return true;
      }

      for (;;) {
        this.skipInlineWhitespace();
        if (this.readKeySegment() === undefined) return false;
        this.skipInlineWhitespace();
        if (this.text[this.index] === '.') {
          this.index++;
          continue;
        }
        break;
      }

      this.skipInlineWhitespace();
      if (this.text[this.index] !== '=') return false;
      this.index++;
      this.skipInlineWhitespace();
      if (this.readValue() === undefined) return false;

      this.skipTrivia();
      if (this.text[this.index] === ',') {
        this.index++;
        continue;
      }
      if (this.text[this.index] === '}') {
        this.index++;
        return true;
      }
      return false;
    }
  }

  /** Bare or quoted key segment; bare keys stop at TOML delimiters. */
  private readKeySegment(): string | undefined {
    const char = this.text[this.index];
    if (char === '"' || char === "'") {
      const start = this.index;
      if (!this.readString()) return undefined;
      return unquote(this.text.slice(start, this.index));
    }

    const start = this.index;
    while (this.index < this.text.length) {
      const current = this.text[this.index];
      if (
        current === '.' ||
        current === '=' ||
        current === ']' ||
        current === '}' ||
        current === ',' ||
        current === '[' ||
        current === '{' ||
        current === '\n' ||
        current === '\r' ||
        current === ' ' ||
        current === '\t'
      ) {
        break;
      }
      this.index++;
    }
    return this.index === start ? undefined : this.text.slice(start, this.index);
  }

  private skipInlineWhitespace(): void {
    while (
      this.index < this.text.length &&
      (this.text[this.index] === ' ' || this.text[this.index] === '\t')
    ) {
      this.index++;
    }
  }

  private skipTrivia(): void {
    while (
      this.index < this.text.length &&
      (this.text[this.index] === ' ' ||
        this.text[this.index] === '\t' ||
        this.text[this.index] === '\r' ||
        this.text[this.index] === '\n')
    ) {
      this.index++;
    }
  }

  private atLineEnd(): boolean {
    while (
      this.index < this.text.length &&
      (this.text[this.index] === ' ' ||
        this.text[this.index] === '\t' ||
        this.text[this.index] === '\r')
    ) {
      this.index++;
    }
    return this.index >= this.text.length || this.text[this.index] === '\n';
  }
}

/** Strips the surrounding quotes from a key/string token and unescapes basics. */
function unquote(raw: string): string {
  const quote = raw[0];
  const triple = quote.repeat(3);
  if (raw.length >= 6 && raw.startsWith(triple) && raw.endsWith(triple)) {
    return raw.slice(3, -3);
  }
  if ((quote === '"' || quote === "'") && raw.length >= 2 && raw[raw.length - 1] === quote) {
    const inner = raw.slice(1, -1);
    return quote === '"' ? inner.replace(/\\(["\\])/g, '$1') : inner;
  }
  return raw;
}
