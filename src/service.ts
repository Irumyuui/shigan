import * as vscode from 'vscode';
import { createVariableResolver, ShiganConfig } from './config';
import { parseCompileFlags } from './core/flags';
import { computeHints } from './core/hints';
import { LanguageSyntax, syntaxFor } from './core/language';
import { scan } from './core/lexer/tokenizer';
import { evaluateConditionals } from './core/match/evaluate';
import { Hint, MacroDef, Trigger } from './core/types';
import { clearCsprojCache, findCsprojSymbols } from './csproj-source';
import { clearCompileCommandCache, findCompileCommandFlags } from './flags-source';

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
    hints: Hint[];
  }
>();

/** Drops all caches. Call when settings or the workspace folders change. */
export function invalidate(): void {
  generation++;
  macroCache.clear();
  hintCache.clear();
  clearCompileCommandCache();
  clearCsprojCache();
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
    cached.trigger === trigger &&
    cached.cursorOffset === cursorOffset
  ) {
    return cached.hints;
  }

  const text = document.getText();
  const syntax = syntaxFor(document.languageId);
  const scanned = scan(text, syntax);
  const macros = documentMacros(document, config, syntax);
  const evaluation = evaluateConditionals(scanned.directives, {
    macros,
    trackFileDefines: config.trackFileDefines,
    syntax,
  });

  const hints = computeHints(text, {
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

  hintCache.set(key, {
    version: document.version,
    generation,
    languageId: document.languageId,
    trigger,
    cursorOffset,
    hints,
  });
  return hints;
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
    macros = new Map<string, MacroDef>();
    if (config.csharpInheritProject && document.uri.scheme === 'file') {
      const project = findCsprojSymbols(document.uri.fsPath, {
        configuration: config.csharpConfiguration,
        targetFramework: config.csharpTargetFramework || undefined,
      });
      if (project) for (const symbol of project.symbols) addCSharpSymbol(macros, symbol);
    }
    for (const symbol of config.csharpDefine) addCSharpSymbol(macros, symbol);
    for (const [name, def] of parseCompileFlags(config.compileFlags, resolver, syntax).macros) {
      macros.set(name, def);
    }
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

const CSHARP_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Adds a C# symbol as `NAME`/`1`, ignoring anything that is not an identifier. */
function addCSharpSymbol(macros: Map<string, MacroDef>, symbol: string): void {
  const name = symbol.trim();
  if (!CSHARP_IDENTIFIER.test(name)) return;
  macros.set(name, { value: '1', functionLike: false });
}
