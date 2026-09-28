import * as fs from 'node:fs';
import * as path from 'node:path';
import { extractTargetFramework, frameworkSymbols, parseDefineConstants } from './core/csproj';

/**
 * Node-only filesystem layer around {@link parseDefineConstants}. It locates
 * the project files that apply to a C# source file and merges their symbols.
 * No `vscode` dependency, so it can be exercised from vitest.
 */

/** Evaluation overrides forwarded to {@link parseDefineConstants}. */
export interface CsprojSymbolOptions {
  /** Value for `$(Configuration)`; defaults to `'Debug'`. */
  configuration?: string;
  /** Value for `$(Platform)`; defaults to `'AnyCPU'`. */
  platform?: string;
  /** Explicit target framework; wins over any value found in the files. */
  targetFramework?: string;
}

/** Symbols and target framework resolved for a source file. */
export interface CsprojSymbols {
  /** Every defined C# symbol, including framework-derived ones. */
  symbols: Set<string>;
  /** Resolved target framework moniker, when one could be determined. */
  targetFramework?: string;
}

const PROPS_FILE = 'Directory.Build.props';

/**
 * Cache keyed by starting directory plus the resolved options (results depend
 * on both). Negative results are cached too.
 */
const cache = new Map<string, CsprojSymbols | undefined>();

interface Candidate {
  kind: 'props' | 'csproj';
  filePath: string;
}

/**
 * Walks up from `filePath` collecting the nearest `*.csproj` and every
 * `Directory.Build.props`, then evaluates them in MSBuild import order
 * (root-most props first, csproj last) and unions in the target framework's
 * implicit symbols. Returns `undefined` when no project file applies. Results
 * are cached per starting directory; see {@link clearCsprojCache}.
 */
export function findCsprojSymbols(
  filePath: string,
  options: CsprojSymbolOptions = {}
): CsprojSymbols | undefined {
  const resolved = path.resolve(filePath);
  const startDir = path.dirname(resolved);
  const key = cacheKey(startDir, options);
  if (cache.has(key)) return cache.get(key);

  const result = computeCsprojSymbols(startDir, options);
  cache.set(key, result);
  return result;
}

/** Clears the cache (call when the workspace or configuration changes). */
export function clearCsprojCache(): void {
  cache.clear();
}

function computeCsprojSymbols(
  startDir: string,
  options: CsprojSymbolOptions
): CsprojSymbols | undefined {
  const { csprojPath, propsPaths } = collectCandidates(startDir);
  if (!csprojPath && propsPaths.length === 0) return undefined;

  // `propsPaths` is nearest-first; MSBuild imports root-most first, then the
  // owning project file last.
  const ordered: Candidate[] = [
    ...propsPaths
      .slice()
      .reverse()
      .map((filePath): Candidate => ({ kind: 'props', filePath })),
    ...(csprojPath ? [{ kind: 'csproj', filePath: csprojPath } satisfies Candidate] : []),
  ];

  const files: Array<{ candidate: Candidate; text: string }> = [];
  for (const candidate of ordered) {
    const text = readFile(candidate.filePath);
    if (text !== undefined) files.push({ candidate, text });
  }
  if (files.length === 0) return undefined;

  const targetFramework = resolveTargetFramework(files, propsPaths[0], options);

  let symbols = new Set<string>();
  for (const file of files) {
    symbols = parseDefineConstants(file.text, {
      configuration: options.configuration,
      platform: options.platform,
      targetFramework,
      initialSymbols: symbols,
    }).symbols;
  }
  if (targetFramework !== undefined) {
    for (const symbol of frameworkSymbols(targetFramework)) symbols.add(symbol);
  }

  return targetFramework === undefined ? { symbols } : { symbols, targetFramework };
}

/**
 * Walks up from `startDir` to the filesystem root. Records the nearest
 * `*.csproj` (within a directory, the alphabetically first when several exist)
 * and every `Directory.Build.props` (nearest-first).
 */
function collectCandidates(startDir: string): { csprojPath?: string; propsPaths: string[] } {
  let csprojPath: string | undefined;
  const propsPaths: string[] = [];
  let dir = startDir;

  for (;;) {
    if (!csprojPath) csprojPath = findNearestCsproj(dir);
    const propsPath = path.join(dir, PROPS_FILE);
    if (isFile(propsPath)) propsPaths.push(propsPath);

    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return { csprojPath, propsPaths };
}

/** Returns the alphabetically first `*.csproj` file in `dir`, if any. */
function findNearestCsproj(dir: string): string | undefined {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return undefined;
  }

  const matches = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.csproj'))
    .map((entry) => entry.name)
    .sort();

  return matches.length > 0 ? path.join(dir, matches[0]) : undefined;
}

/**
 * Explicit `options.targetFramework` wins; otherwise the csproj value, then the
 * nearest `Directory.Build.props` value.
 */
function resolveTargetFramework(
  files: Array<{ candidate: Candidate; text: string }>,
  nearestPropsPath: string | undefined,
  options: CsprojSymbolOptions
): string | undefined {
  if (options.targetFramework) return options.targetFramework;

  let csprojFramework: string | undefined;
  let propsFramework: string | undefined;
  for (const file of files) {
    const targetFramework = extractTargetFramework(file.text);
    if (file.candidate.kind === 'csproj') csprojFramework = targetFramework;
    else if (file.candidate.filePath === nearestPropsPath) propsFramework = targetFramework;
  }

  return csprojFramework ?? propsFramework;
}

function isFile(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function readFile(filePath: string): string | undefined {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return undefined;
  }
}

function cacheKey(startDir: string, options: CsprojSymbolOptions): string {
  return [
    startDir,
    options.configuration ?? '',
    options.platform ?? '',
    options.targetFramework ?? '',
  ].join('\u0000');
}
