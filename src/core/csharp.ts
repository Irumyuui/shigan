import { MacroDef } from './types';

/** C# conditional symbols must be plain identifiers; anything else is ignored. */
const CSHARP_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Merges the C# macro sources in precedence order (lowest first):
 * project symbols, then explicit `csharp.define` symbols, then compiler-style
 * flag macros. Invalid identifiers are ignored. Later sources win.
 *
 * Symbol sources are value-less: they become `NAME=1` object-like macros. Flag
 * macros are copied as-is, so function-like definitions and values survive.
 * File-level `#define` is applied later by `evaluateConditionals` and still
 * overrides the result of this merge.
 */
export function mergeCSharpMacros(
  projectSymbols: Iterable<string> | undefined,
  defineSymbols: Iterable<string>,
  flagMacros: ReadonlyMap<string, MacroDef>
): Map<string, MacroDef> {
  const macros = new Map<string, MacroDef>();
  if (projectSymbols) {
    for (const symbol of projectSymbols) addSymbol(macros, symbol);
  }
  for (const symbol of defineSymbols) addSymbol(macros, symbol);
  for (const [name, def] of flagMacros) macros.set(name, def);
  return macros;
}

/** Adds a symbol as `NAME`/`1`, ignoring anything that is not an identifier. */
function addSymbol(macros: Map<string, MacroDef>, symbol: string): void {
  const name = symbol.trim();
  if (!CSHARP_IDENTIFIER.test(name)) return;
  macros.set(name, { value: '1', functionLike: false });
}
