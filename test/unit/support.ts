import { syntaxFor } from '../../src/core/language';
import { scan } from '../../src/core/lexer/tokenizer';
import { evaluateConditionals } from '../../src/core/match/c-preprocessor';
import { MacroDef } from '../../src/core/types';

export interface Predicates {
  inactive: (line: number) => boolean;
  branchActive: (line: number) => boolean | undefined;
  blockActive: (line: number) => boolean | undefined;
}

/**
 * The same condition evaluation the extension wires into `computeHints`.
 * `languageId` selects the syntax profile; the default (`c`) keeps the
 * historical behavior.
 */
export function predicates(
  text: string,
  seed: Record<string, string> = {},
  languageId = 'c'
): Predicates {
  const macros = new Map<string, MacroDef>();
  for (const [name, value] of Object.entries(seed)) {
    macros.set(name, { value, functionLike: false });
  }

  const syntax = syntaxFor(languageId);
  const result = evaluateConditionals(scan(text, syntax).directives, {
    macros,
    trackFileDefines: true,
    syntax,
  });

  return {
    inactive: (line) => result.inactiveLines.has(line),
    branchActive: (line) => result.branchActive.get(line),
    blockActive: (line) => result.blockActive.get(line),
  };
}
