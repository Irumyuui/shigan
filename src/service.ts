import * as vscode from 'vscode';
import { createVariableResolver, ShiganConfig } from './config';
import { isRealFileScheme } from './core/document-paths';
import { mergeCSharpMacros } from './core/csharp';
import { parseCompileFlags } from './core/flags';
import { computeHints, HintOptions } from './core/hints';
import { ConditionalModel } from './core/conditionals';
import { languageKind, LanguageKind, LanguageSyntax, syntaxFor } from './core/language';
import { scanRust } from './core/lexer/rust';
import { scan } from './core/lexer/tokenizer';
import { cConditionals, evaluateConditionals } from './core/match/c-preprocessor';
import { BracketMatchResult, matchBrackets } from './core/match/brackets';
import { featureFacts, hostCfg, parseRustCfgEntries, RustCfgEnvironment } from './core/match/rust/cfg';
import { explicitDecidedSpans, rustConditionals } from './core/match/rust/conditionals';
import { applyMergedInactivity, mergeRustInactiveLines } from './core/match/rust/diagnostics';
import { pairCfgItems } from './core/match/rust/items';
import { languageSettingsFor, LanguageSettings } from './core/settings';
import { BracketToken, Hint, MacroDef, ScanResult } from './core/types';
import { clearCargoCache, findCargoFeatures, hasAncestorManifest } from './cargo-source';
import { clearCsprojCache, findCsprojSymbols } from './csproj-source';
import { clearCompileCommandCache, findCompileCommandFlags } from './flags-source';
import { readRustDiagnostics } from './rust-diagnostics';

export type DecorationTrigger = 'cursor' | 'always';

let generation = 0;

const macroCache = new Map<
  string,
  { version: number; generation: number; languageId: string; macros: Map<string, MacroDef> }
>();
const hintCache = new Map<
  string,
  {
    version: number;
    generation: number;
    languageId: string;
    trigger: DecorationTrigger;
    cursorOffset: number;
    diagnosticsRevision: number;
    hints: Hint[];
  }
>();

/**
 * The cursor-independent artifacts of a document: the scan, the conditional
 * model (C-family or Rust), the inactivity predicate and the bracket matching.
 * Only the final hint selection depends on the trigger/caret, so caching these
 * here means moving the caret or hovering never re-scans the document. Keyed by
 * `{ version, generation, languageId, diagnosticsRevision }` — the same
 * identity the hint cache uses minus the trigger/caret tail.
 */
interface DocumentStage {
  version: number;
  generation: number;
  languageId: string;
  diagnosticsRevision: number;
  /** Document text the scan was derived from (fed to `computeHints`). */
  text: string;
  scanned: ScanResult;
  conditionals?: ConditionalModel;
  inactive: (line: number) => boolean;
  matches?: BracketMatchResult;
}

const stageCache = new Map<string, DocumentStage>();

/**
 * Per-URI counter bumped whenever rust-analyzer's diagnostics for that document
 * may have changed. It is part of the hint cache key so hover and the diagnostic
 * command (which call `computeDocumentHints` without a refresh) never serve a
 * stale activity answer.
 */
const diagnosticsRevisions = new Map<string, number>();

/**
 * The document's lines, split once per document version. The tooltip renderer
 * only needs a handful of lines around a jump target, but it needs them indexed
 * by absolute line number, so the whole split is cached here next to the hint
 * cache instead of being redone on every inlay-hint request.
 */
const sourceLinesCache = new Map<string, { version: number; lines: string[] }>();

function revisionOf(uri: string): number {
  return diagnosticsRevisions.get(uri) ?? 0;
}

/**
 * Registers the URI in `diagnosticsRevisions` if it is not there yet, so a
 * later "diagnostics cleared" event (an empty URI list) reaches it. A document
 * cached at revision 0 would otherwise never be bumped and could keep a stale
 * activity answer.
 */
function ensureDiagnosticsRevision(uri: string): number {
  const revision = revisionOf(uri);
  if (!diagnosticsRevisions.has(uri)) diagnosticsRevisions.set(uri, revision);
  return revision;
}

/**
 * Records that diagnostics changed for `uris`. An empty list is a blanket
 * bump: the API can fire with no URIs when diagnostics are cleared.
 */
export function noteRustDiagnosticsChanged(uris: readonly string[]): void {
  if (uris.length === 0) {
    for (const [key, value] of diagnosticsRevisions) diagnosticsRevisions.set(key, value + 1);
    return;
  }
  for (const uri of uris) diagnosticsRevisions.set(uri, revisionOf(uri) + 1);
}

/** Drops every cache entry for one document; called when it is closed. */
export function forgetDocument(uri: string): void {
  macroCache.delete(uri);
  hintCache.delete(uri);
  stageCache.delete(uri);
  diagnosticsRevisions.delete(uri);
  sourceLinesCache.delete(uri);
}

/**
 * The document's lines, split once per version and reused across inlay-hint
 * requests. Output is identical to `document.getText().split(/\r?\n/)`, but a
 * cache hit skips both the `getText()` copy and the split.
 */
export function documentSourceLines(document: vscode.TextDocument): string[] {
  const key = document.uri.toString();
  const cached = sourceLinesCache.get(key);
  if (cached && cached.version === document.version) return cached.lines;

  const lines = document.getText().split(/\r?\n/);
  sourceLinesCache.set(key, { version: document.version, lines });
  return lines;
}

/** Drops all caches. Call when settings or the workspace folders change. */
export function invalidate(): void {
  clearSharedCaches();
  sourceLinesCache.clear();
  clearCompileCommandCache();
}

/**
 * Drops the project-file caches (C# csproj symbols, Rust Cargo features)
 * without touching the compile_commands cache. Used when a project file
 * changes on disk.
 */
export function invalidateProjectFiles(): void {
  clearSharedCaches();
}

/**
 * The clears both invalidation paths share. Bumps the generation counter, which
 * every cache key compares against, so an entry computed before the bump can
 * never be reused afterwards.
 */
function clearSharedCaches(): void {
  generation++;
  macroCache.clear();
  hintCache.clear();
  stageCache.clear();
  clearCsprojCache();
  clearCargoCache();
  diagnosticsRevisions.clear();
}

/**
 * Hints for a document, with the macros, conditional evaluation and caches
 * wired in. Shared by the inlay hint provider, the hover provider and the
 * diagnostic command so they all agree.
 */
export function computeDocumentHints(
  document: vscode.TextDocument,
  config: ShiganConfig,
  trigger: DecorationTrigger,
  cursorOffset: number
): Hint[] {
  if (!config.enable || !config.languages.includes(document.languageId)) return [];
  if (config.show.length === 0) return [];

  const key = document.uri.toString();
  const kind = languageKind(document.languageId);
  const rust = kind === 'rust';
  const settings = languageSettingsFor(config, kind);
  // Registering a Rust key here is what lets a later "diagnostics cleared"
  // (empty-URI) event reach a document that was never part of a non-empty one.
  // Non-Rust documents never get a revision entry, so the blanket bump stays
  // scoped to Rust and does not force an unrelated hint-cache miss.
  const diagnosticsRevision = rust ? ensureDiagnosticsRevision(key) : revisionOf(key);
  // `computeHints` ignores the caret offset in always mode, so normalizing it
  // to -1 lets every always-mode request at a different caret share one entry.
  const effectiveCursorOffset = trigger === 'cursor' ? cursorOffset : -1;

  const cached = hintCache.get(key);
  if (
    cached &&
    cached.version === document.version &&
    cached.generation === generation &&
    cached.languageId === document.languageId &&
    cached.diagnosticsRevision === diagnosticsRevision &&
    cached.trigger === trigger &&
    cached.cursorOffset === effectiveCursorOffset
  ) {
    return cached.hints;
  }

  const stage = documentStage(document, config, key, kind, settings, diagnosticsRevision);
  const display: HintOptions = {
    brackets: config.show.includes('brackets'),
    macros: config.show.includes('macros'),
    conditional: config.show.includes('conditional'),
    trigger,
    cursorOffset: effectiveCursorOffset,
    showRange: config.showRange,
    rangeHideThreshold: config.rangeHideThreshold,
    showLabel: config.showLabel,
    skipInactiveBrackets: config.skipInactiveBrackets,
    skipInactiveDirectives: config.skipInactiveDirectives,
    markInactive: config.markInactive,
    lines: documentSourceLines(document),
    scanned: stage.scanned,
    conditionals: stage.conditionals,
    matches: stage.matches,
    inactive: stage.inactive,
  };

  const hints = computeHints(stage.text, display);

  hintCache.set(key, {
    version: document.version,
    generation,
    languageId: document.languageId,
    trigger,
    cursorOffset: effectiveCursorOffset,
    diagnosticsRevision,
    hints,
  });
  return hints;
}

/**
 * The cursor-independent artifacts for a document, cached per
 * `{ version, generation, languageId, diagnosticsRevision }`. The final hint
 * cache sits on top of this and only distinguishes the trigger/caret tail.
 */
function documentStage(
  document: vscode.TextDocument,
  config: ShiganConfig,
  key: string,
  kind: LanguageKind,
  settings: LanguageSettings,
  diagnosticsRevision: number
): DocumentStage {
  const cached = stageCache.get(key);
  if (
    cached &&
    cached.version === document.version &&
    cached.generation === generation &&
    cached.languageId === document.languageId &&
    cached.diagnosticsRevision === diagnosticsRevision
  ) {
    return cached;
  }

  const text = document.getText();
  const body =
    kind === 'rust'
      ? rustDocumentStage(document, config, text)
      : cFamilyDocumentStage(document, config, text, kind, settings);
  const stage: DocumentStage = {
    version: document.version,
    generation,
    languageId: document.languageId,
    diagnosticsRevision,
    ...body,
  };
  stageCache.set(key, stage);
  return stage;
}

/** The pre-tail artifacts, without the per-document cache identity. */
type DocumentStageBody = Omit<
  DocumentStage,
  'version' | 'generation' | 'languageId' | 'diagnosticsRevision'
>;

/**
 * Bracket matching for a scan. Matching only depends on the scan, the
 * inactivity predicate and the `show`/`skipInactiveBrackets` settings, all part
 * of the stage identity, so the result is reused across trigger/caret changes.
 */
function bracketMatches(
  scanned: ScanResult,
  inactive: (line: number) => boolean,
  config: ShiganConfig
): BracketMatchResult | undefined {
  if (!config.show.includes('brackets')) return undefined;
  const excludeInactive = config.skipInactiveBrackets
    ? (token: BracketToken) => inactive(token.line)
    : undefined;
  return matchBrackets(scanned.brackets, excludeInactive);
}

/** Rust pipeline: `scanRust` + the `#[cfg]` model, merged with diagnostics. */
function rustDocumentStage(
  document: vscode.TextDocument,
  config: ShiganConfig,
  text: string
): DocumentStageBody {
  const scanned = scanRust(text);
  const lines = text.split(/\r?\n/);
  const environment = rustEnvironment(document, config);
  // Pair the cfg items once and share the result: both the lexical model and
  // the explicit-decided spans would otherwise scan the same document twice.
  const spans = pairCfgItems(scanned, lines);
  const model = rustConditionals({ scanned, lines, environment, spans });

  // rust-analyzer's diagnostics are authoritative when present (or when the
  // extension is active); explicit `shigan.rust.cfg`-decided spans still win.
  // With no explicit entries nothing can be explicitly decided, so skip it.
  const decided =
    environment.explicit && environment.explicit.size > 0
      ? explicitDecidedSpans({ scanned, lines, environment, spans })
      : [];
  const explicitHeadLines = new Set(decided.flatMap((span) => span.headLines));
  const explicitInactiveLines = new Set<number>();
  for (const span of decided) {
    if (!span.inactive) continue;
    for (let line = span.attrLine; line <= span.endLine; line++) {
      explicitInactiveLines.add(line);
    }
  }

  const diagnostics = readRustDiagnostics(document);
  const merged = mergeRustInactiveLines({
    lexicalLines: model.inactiveLines ?? new Set<number>(),
    explicitHeadLines,
    explicitInactiveLines,
    diagnostics: diagnostics.ranges,
    authoritative: diagnostics.authoritative,
    lineCount: lines.length,
  });
  // Re-derive the model flags from each hint's own attribute lines, so a span
  // rust-analyzer calls inactive shows `(inactive)` even when the lexical
  // model said active (and a nested inactive item cannot flip its parent).
  const adjustedModel = applyMergedInactivity(model, merged);
  const inactive = (line: number): boolean => merged.has(line);

  return {
    text,
    scanned,
    conditionals: adjustedModel,
    inactive,
    matches: bracketMatches(scanned, inactive, config),
  };
}

/** C/C++/C# pipeline: tokenizer scan + the preprocessor conditional evaluator. */
function cFamilyDocumentStage(
  document: vscode.TextDocument,
  config: ShiganConfig,
  text: string,
  kind: LanguageKind,
  settings: LanguageSettings
): DocumentStageBody {
  const syntax = syntaxFor(document.languageId);
  const scanned = scan(text, syntax);
  const macros = documentMacros(document, config, syntax, kind, settings);
  const evaluation = evaluateConditionals(scanned.directives, {
    macros,
    trackFileDefines: settings.trackFileDefines,
    syntax,
  });
  // Activity is only known to the evaluator; build the model here so the
  // renderer receives a self-contained `conditionals` value. Every C-family
  // model hint is macro-kind, so it is only ever rendered under the `macros`
  // gate — a config without `macros` skips this evaluated activity and the
  // O(blocks) pairing (`computeHints` builds no structural model either then).
  const conditionals = config.show.includes('macros')
    ? cConditionals(scanned.directives, {
        branchActive: (line) => evaluation.branchActive.get(line),
        blockActive: (line) => evaluation.blockActive.get(line),
      })
    : undefined;
  const inactive = (line: number): boolean => evaluation.inactiveLines.has(line);

  return {
    text,
    scanned,
    conditionals,
    inactive,
    matches: bracketMatches(scanned, inactive, config),
  };
}

/**
 * The cfg environment for a Rust document: explicit `shigan.rust.cfg` entries,
 * the observed host platform, and (when inheriting) feature facts from the
 * nearest Cargo.toml. Feature absence is only decidable when the manifest is a
 * real package and no parent manifest could add features.
 */
function rustEnvironment(
  document: vscode.TextDocument,
  config: ShiganConfig
): RustCfgEnvironment {
  const environment: RustCfgEnvironment = {
    explicit: parseRustCfgEntries(config.rust.cfg),
    host: hostCfg(process.platform, process.arch).predicates,
  };

  if (config.rust.inheritCargo && isRealFileScheme(document.uri.scheme)) {
    const cargo = findCargoFeatures(document.uri.fsPath);
    if (cargo) {
      environment.features = featureFacts({
        decidableAbsence: !cargo.virtual && !hasAncestorManifest(document.uri.fsPath),
        declared: cargo.declared,
        implicit: cargo.implicit,
        enabled: cargo.defaults,
      });
    }
  }

  return environment;
}

function documentMacros(
  document: vscode.TextDocument,
  config: ShiganConfig,
  syntax: LanguageSyntax,
  kind: LanguageKind,
  settings: LanguageSettings
): Map<string, MacroDef> {
  const key = document.uri.toString();
  const languageId = document.languageId;
  const cached = macroCache.get(key);
  if (
    cached &&
    cached.version === document.version &&
    cached.generation === generation &&
    cached.languageId === languageId
  ) {
    return cached.macros;
  }

  const resolver = createVariableResolver(document.uri);

  let macros: Map<string, MacroDef>;
  if (kind === 'csharp') {
    // C# symbols, lowest precedence first: project file, then the user's
    // csharp.define, then compile flags (which win). compile_commands.json is
    // not consulted for C#.
    const project =
      config.csharp.inheritProject && isRealFileScheme(document.uri.scheme)
        ? findCsprojSymbols(document.uri.fsPath, {
            configuration: config.csharp.configuration,
            targetFramework: config.csharp.targetFramework || undefined,
          })
        : undefined;
    macros = mergeCSharpMacros(
      project?.symbols,
      config.csharp.define,
      parseCompileFlags(settings.compileFlags, resolver, syntax).macros
    );
  } else {
    const fileFlags =
      settings.inheritCompileCommands && isRealFileScheme(document.uri.scheme)
        ? findCompileCommandFlags(document.uri.fsPath) ?? []
        : [];
    macros = parseCompileFlags([...fileFlags, ...settings.compileFlags], resolver, syntax).macros;
  }

  macroCache.set(key, { version: document.version, generation, languageId, macros });
  return macros;
}
