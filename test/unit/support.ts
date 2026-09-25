import { scan } from '../../src/core/lexer/tokenizer';
import { evaluateConditionals } from '../../src/core/match/evaluate';
import { MacroDef } from '../../src/core/types';

export interface Predicates {
  inactive: (line: number) => boolean;
  branchActive: (line: number) => boolean | undefined;
  blockActive: (line: number) => boolean | undefined;
}

/** The same condition evaluation the extension wires into `computeHints`. */
export function predicates(text: string, seed: Record<string, string> = {}): Predicates {
  const macros = new Map<string, MacroDef>();
  for (const [name, value] of Object.entries(seed)) {
    macros.set(name, { value, functionLike: false });
  }

  const result = evaluateConditionals(scan(text).directives, {
    macros,
    trackFileDefines: true,
  });

  return {
    inactive: (line) => result.inactiveLines.has(line),
    branchActive: (line) => result.branchActive.get(line),
    blockActive: (line) => result.blockActive.get(line),
  };
}
