import * as vscode from 'vscode';
import { createVariableResolver, ShiganConfig } from './config';
import { mergeCSharpMacros } from './core/csharp';
import { parseCompileFlags } from './core/flags';
import { computeHints } from './core/hints';
import { languageKind, LanguageSyntax, syntaxFor } from './core/language';
import { scanRust } from './core/lexer/rust';
import { scan } from './core/lexer/tokenizer';
import { evaluateConditionals } from './core/match/c-preprocessor';
import { hostCfg, parseRustCfgEntries, RustCfgEnvironment } from './core/match/rust/cfg';
import { explicitDecidedSpans, rustConditionals } from './core/match/rust/conditionals';
import { applyMergedInactivity, mergeRustInactiveLines } from './core/match/rust/diagnostics';
import { pairCfgItems } from './core/match/rust/items';
import { Hint, MacroDef, Trigger } from './core/types';
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
    trigger: Trigger;
    cursorOffset: number;
    diagnosticsRevision: number;
    hints: Hint[];
  }
>();

/**
 * Per-URI counter bumped whenever rust-analyzer's diagnostics for that document
 * may have changed. It is part of the hint cache key so hover and the diagnostic
 * command (which call `computeDocumentHints` without a refresh) never serve a
 * stale activity answer.
 */
const diagnosticsRevisions = new Map<string, number>();

function revisionOf(uri: string): number {
  return diagnosticsRevisions.get(uri) ?? 0;
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

/** Clears the diagnostic revisions (tests / full invalidation). */
export function resetRustDiagnosticsRevisions(): void {
  diagnosticsRevisions.clear();
}

/** Drops all caches. Call when settings or the workspace folders change. */
export function invalidate(): void {
  generation++;
  macroCache.clear();
  hintCache.clear();
  clearCompileCommandCache();
  clearCsprojCache();
  clearCargoCache();
  diagnosticsRevisions.clear();
}

/**
 * Drops the project-file caches (C# csproj symbols, Rust Cargo features)
 * without touching the compile_commands cache. Used when a project file
 * changes on disk.
 */
export function invalidateProjectFiles(): void {
  generation++;
  macroCache.clear();
  hintCache.clear();
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
  const cached = hintCache.get(key);
  if (
    cached &&
    cached.version === document.version &&
    cached.generation === generation &&
    cached.languageId === document.languageId &&
    cached.diagnosticsRevision === revisionOf(key) &&
    cached.trigger === trigger &&
    cached.cursorOffset === cursorOffset
  ) {
    return cached.hints;
  }

  const text = document.getText();

  let hints: Hint[];
  if (languageKind(document.languageId) === 'rust') {
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
    const explicitAttributeLines = new Set<number>();
    const explicitInactiveLines = new Set<number>();
    if (environment.explicit && environment.explicit.size > 0) {
      for (const span of explicitDecidedSpans({ scanned, lines, environment, spans })) {
        for (const line of span.attrLines) explicitAttributeLines.add(line);
        if (span.inactive) {
          for (let line = span.attrLine; line <= span.endLine; line++) {
            explicitInactiveLines.add(line);
          }
        }
      }
    }

    const diagnostics = readRustDiagnostics(document);
    const merged = mergeRustInactiveLines({
      lexicalLines: model.inactiveLines ?? new Set<number>(),
      explicitAttributeLines,
      explicitInactiveLines,
      diagnostics: diagnostics.ranges,
      authoritative: diagnostics.authoritative,
      lineCount: lines.length,
    });
    // Re-derive the model flags from each hint's own attribute lines, so a span
    // rust-analyzer calls inactive shows `(inactive)` even when the lexical
    // model said active (and a nested inactive item cannot flip its parent).
    const adjustedModel = applyMergedInactivity(model, merged);

    hints = computeHints(text, {
      brackets: config.show.includes('brackets'),
      macros: config.show.includes('macros'),
      trigger,
      cursorOffset,
      showRange: config.showRange,
      rangeHideThreshold: config.rangeHideThreshold,
      showLabel: config.showLabel,
      inactive: (line) => merged.has(line),
      skipInactiveBrackets: config.skipInactiveBrackets,
      skipInactiveDirectives: config.skipInactiveDirectives,
      markInactive: config.markInactive,
      scanned,
      conditionals: adjustedModel,
    });
  } else {
    const syntax = syntaxFor(document.languageId);
    const scanned = scan(text, syntax);
    const macros = documentMacros(document, config, syntax);
    const evaluation = evaluateConditionals(scanned.directives, {
      macros,
      trackFileDefines: config.trackFileDefines,
      syntax,
    });
    hints = computeHints(text, {
      brackets: config.show.includes('brackets'),
      macros: config.show.includes('macros'),
      trigger,
      cursorOffset,
      showRange: config.showRange,
      rangeHideThreshold: config.rangeHideThreshold,
      showLabel: config.showLabel,
      inactive: (line) => evaluation.inactiveLines.has(line),
      branchActive: (line) => evaluation.branchActive.get(line),
      blockActive: (line) => evaluation.blockActive.get(line),
      skipInactiveBrackets: config.skipInactiveBrackets,
      skipInactiveDirectives: config.skipInactiveDirectives,
      markInactive: config.markInactive,
      scanned,
    });
  }

  hintCache.set(key, {
    version: document.version,
    generation,
    languageId: document.languageId,
    trigger,
    cursorOffset,
    diagnosticsRevision: revisionOf(key),
    hints,
  });
  return hints;
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
    explicit: parseRustCfgEntries(config.rustCfg),
    host: hostCfg(process.platform, process.arch).predicates,
  };

  if (config.rustInheritCargo && document.uri.scheme === 'file') {
    const cargo = findCargoFeatures(document.uri.fsPath);
    if (cargo) {
      environment.features = {
        decidableAbsence: !cargo.virtual && !hasAncestorManifest(document.uri.fsPath),
        universe: new Set([...cargo.declared, ...cargo.implicit]),
        enabled: cargo.defaults,
      };
    }
  }

  return environment;
}

function documentMacros(
  document: vscode.TextDocument,
  config: ShiganConfig,
  syntax: LanguageSyntax
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

  const resolver = createVariableResolver(document.uri.fsPath);

  let macros: Map<string, MacroDef>;
  if (syntax.id === 'csharp') {
    // C# symbols, lowest precedence first: project file, then the user's
    // csharp.define, then compile flags (which win). compile_commands.json is
    // not consulted for C#.
    const project =
      config.csharpInheritProject && document.uri.scheme === 'file'
        ? findCsprojSymbols(document.uri.fsPath, {
            configuration: config.csharpConfiguration,
            targetFramework: config.csharpTargetFramework || undefined,
          })
        : undefined;
    macros = mergeCSharpMacros(
      project?.symbols,
      config.csharpDefine,
      parseCompileFlags(config.compileFlags, resolver, syntax).macros
    );
  } else {
    const fileFlags =
      config.inheritCompileCommands && document.uri.scheme === 'file'
        ? findCompileCommandFlags(document.uri.fsPath) ?? []
        : [];
    macros = parseCompileFlags([...fileFlags, ...config.compileFlags], resolver, syntax).macros;
  }

  macroCache.set(key, { version: document.version, generation, languageId, macros });
  return macros;
}
