import { DirectiveToken } from '../types';

const OPENERS = new Set(['if', 'ifdef', 'ifndef']);
const BRANCHES = new Set(['elif', 'elifdef', 'elifndef', 'else']);

export interface ConditionalBlock {
  /** The `#if` / `#ifdef` / `#ifndef` that opens the block. */
  opener: DirectiveToken;
  /** All branches, the opener being the first one. */
  branches: DirectiveToken[];
  /** The `#endif`, when present (malformed input may omit it). */
  endif?: DirectiveToken;
  closed: boolean;
}

export interface ConditionalPairing {
  blocks: ConditionalBlock[];
  /** Maps any directive line of a block (branch or `#endif`) to that block. */
  byLine: Map<number, ConditionalBlock>;
}

/**
 * Pairs `#if`/`#ifdef`/`#ifndef` with their `#elif`/`#elifdef`/`#elifndef`/
 * `#else` branches and `#endif`. Purely structural: conditions are not
 * evaluated here (that is the job of the conditional evaluator).
 */
export function pairConditionals(directives: DirectiveToken[]): ConditionalPairing {
  const stack: ConditionalBlock[] = [];
  const blocks: ConditionalBlock[] = [];
  const byLine = new Map<number, ConditionalBlock>();

  for (const directive of directives) {
    if (OPENERS.has(directive.name)) {
      stack.push({ opener: directive, branches: [directive], closed: false });
      continue;
    }

    const top = stack[stack.length - 1];
    if (BRANCHES.has(directive.name)) {
      if (top) top.branches.push(directive);
      continue;
    }

    if (directive.name === 'endif' && top) {
      stack.pop();
      top.endif = directive;
      top.closed = true;
      blocks.push(top);
    }
  }

  // Unclosed blocks are reported too, so hints degrade gracefully.
  for (const block of stack) blocks.push(block);

  for (const block of blocks) {
    for (const branch of block.branches) byLine.set(branch.line, block);
    if (block.endif) byLine.set(block.endif.line, block);
  }

  blocks.sort((a, b) => a.opener.line - b.opener.line);
  return { blocks, byLine };
}
