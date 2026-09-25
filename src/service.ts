import * as vscode from 'vscode';
import { createVariableResolver, ShiganConfig } from './config';
import { parseCompileFlags } from './core/flags';
import { computeHints } from './core/hints';
import { scan } from './core/lexer/tokenizer';
import { evaluateConditionals } from './core/match/evaluate';
import { Hint, MacroDef, Trigger } from './core/types';
import { clearCompileCommandCache, findCompileCommandFlags } from './flags-source';

export type DecorationTrigger = 'cursor' | 'always';

let generation = 0;

const macroCache = new Map<
  string,
  { version: number; generation: number; macros: Map<string, MacroDef> }
>();
const hintCache = new Map<
  string,
  { version: number; generation: number; trigger: Trigger; cursorOffset: number; hints: Hint[] }
>();

/** Drops all caches. Call when settings or the workspace folders change. */
export function invalidate(): void {
  generation++;
  macroCache.clear();
  hintCache.clear();
  clearCompileCommandCache();
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
    cached.trigger === trigger &&
    cached.cursorOffset === cursorOffset
  ) {
    return cached.hints;
  }

  const text = document.getText();
  const scanned = scan(text);
  const macros = documentMacros(document, config);
  const evaluation = evaluateConditionals(scanned.directives, {
    macros,
    trackFileDefines: config.trackFileDefines,
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

  hintCache.set(key, { version: document.version, generation, trigger, cursorOffset, hints });
  return hints;
}

function documentMacros(
  document: vscode.TextDocument,
  config: ShiganConfig
): Map<string, MacroDef> {
  const key = document.uri.toString();
  const cached = macroCache.get(key);
  if (cached && cached.version === document.version && cached.generation === generation) {
    return cached.macros;
  }

  const resolver = createVariableResolver(document.uri.fsPath);
  const fileFlags =
    config.inheritCompileCommands && document.uri.scheme === 'file'
      ? findCompileCommandFlags(document.uri.fsPath) ?? []
      : [];

  const macros = parseCompileFlags([...fileFlags, ...config.compileFlags], resolver).macros;
  macroCache.set(key, { version: document.version, generation, macros });
  return macros;
}
