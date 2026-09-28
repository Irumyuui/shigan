import { ConditionalHint, ConditionalModel, ConditionalSegment } from '../conditionals';
import { C_SYNTAX, LanguageSyntax } from '../language';
import { DirectiveToken, MacroDef } from '../types';
import { parseDefine, parseUndef } from '../flags';
import { evaluateExpression } from './expression';

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

export interface RegionPair {
  /** The `#region` that opens the pair. */
  opener: DirectiveToken;
  /** The matching `#endregion`. */
  endregion: DirectiveToken;
}

/**
 * Pairs `#region` with `#endregion`, supporting nesting (innermost first).
 * Unmatched `#endregion` and unclosed `#region` directives produce nothing, so
 * malformed input simply yields fewer hints rather than a bogus pair.
 */
export function pairRegions(directives: DirectiveToken[]): RegionPair[] {
  const stack: DirectiveToken[] = [];
  const pairs: RegionPair[] = [];

  for (const directive of directives) {
    if (directive.name === 'region') {
      stack.push(directive);
      continue;
    }
    if (directive.name === 'endregion') {
      const opener = stack.pop();
      if (opener) pairs.push({ opener, endregion: directive });
    }
  }

  return pairs;
}

export interface EvaluationOptions {
  macros: Map<string, MacroDef>;
  trackFileDefines?: boolean;
  /**
   * Language profile whose conditional semantics apply. Defaults to C; C#
   * additionally makes value-less `#define` symbols truthy and predefines the
   * `true`/`false` literals.
   */
  syntax?: LanguageSyntax;
}

export interface EvaluationResult {
  /** Lines inside inactive branches (used to skip brackets). */
  inactiveLines: Set<number>;
  /** Whether the branch starting at each branch directive line is active. */
  branchActive: Map<number, boolean>;
  /** Whether each conditional block (keyed by its opener line) has an active branch. */
  blockActive: Map<number, boolean>;
}

interface Branch {
  directive: DirectiveToken;
  active: boolean;
}

interface Frame {
  parentActive: boolean;
  taken: boolean;
  /** Some condition could not be resolved: treat every branch as possibly active. */
  unknown: boolean;
  branches: Branch[];
  endifLine?: number;
}

/**
 * Evaluates the conditional directives of a document with a small, conservative
 * C preprocessor. `#define`/`#undef` in the file are tracked (optionally) on
 * top of the macros seeded from settings.
 *
 * Unknown conditions never mark anything inactive, so the result is always a
 * safe subset: skipping an inactive branch can never remove a live bracket.
 */
export function evaluateConditionals(
  directives: DirectiveToken[],
  options: EvaluationOptions
): EvaluationResult {
  const macros = new Map(options.macros);
  const trackFileDefines = options.trackFileDefines !== false;
  const syntax = options.syntax ?? C_SYNTAX;
  if (syntax.id === 'csharp') {
    // C# predefines the boolean literals unless the file overrides them.
    if (!macros.has('true')) macros.set('true', { value: '1', functionLike: false });
    if (!macros.has('false')) macros.set('false', { value: '0', functionLike: false });
  }
  const stack: Frame[] = [];
  const frames: Frame[] = [];

  const currentActive = (): boolean => {
    const top = stack[stack.length - 1];
    if (!top) return true;
    return top.branches.length > 0 ? top.branches[top.branches.length - 1].active : top.parentActive;
  };

  for (const directive of directives) {
    const name = directive.name;

    if (name === 'define') {
      if (trackFileDefines && currentActive()) applyDefine(macros, directive, syntax);
      continue;
    }
    if (name === 'undef') {
      if (trackFileDefines && currentActive()) applyUndef(macros, directive);
      continue;
    }

    if (OPENERS.has(name)) {
      const parentActive = currentActive();
      const condition = conditionValue(directive, macros);
      const active = parentActive && (condition.unknown ? true : condition.value === 1);
      stack.push({
        parentActive,
        taken: !condition.unknown && condition.value === 1,
        unknown: condition.unknown,
        branches: [{ directive, active }],
      });
      continue;
    }

    const top = stack[stack.length - 1];
    if (!top) continue;

    if (BRANCHES.has(name)) {
      if (name === 'else') {
        const active = top.parentActive && (top.unknown ? true : !top.taken);
        top.taken = true;
        top.branches.push({ directive, active });
      } else {
        // `elif` / `elifdef` / `elifndef` share one evaluation.
        const condition = conditionValue(directive, macros);
        const unknown = top.unknown || condition.unknown;
        const active = top.parentActive && (unknown ? true : !top.taken && condition.value === 1);
        top.unknown = unknown;
        if (!condition.unknown && !top.taken && condition.value === 1) top.taken = true;
        top.branches.push({ directive, active });
      }
      continue;
    }

    if (name === 'endif') {
      stack.pop();
      top.endifLine = directive.line;
      frames.push(top);
    }
  }

  for (const frame of stack) frames.push(frame);

  const inactiveLines = new Set<number>();
  const branchActive = new Map<number, boolean>();
  const blockActive = new Map<number, boolean>();

  for (const frame of frames) {
    const opener = frame.branches[0].directive;
    blockActive.set(
      opener.line,
      frame.branches.some((branch) => branch.active)
    );

    for (let k = 0; k < frame.branches.length; k++) {
      const branch = frame.branches[k];
      branchActive.set(branch.directive.line, branch.active);

      if (branch.active) continue;

      const nextLine =
        k + 1 < frame.branches.length ? frame.branches[k + 1].directive.line : frame.endifLine;

      // Body lines of the branch (between this directive and the next one).
      if (nextLine !== undefined) {
        for (let line = branch.directive.endLine + 1; line < nextLine; line++) {
          inactiveLines.add(line);
        }
      }
    }
  }

  return { inactiveLines, branchActive, blockActive };
}

interface ConditionValue {
  value: number;
  unknown: boolean;
}

function conditionValue(directive: DirectiveToken, macros: Map<string, MacroDef>): ConditionValue {
  const name = directive.name;

  if (name === 'if' || name === 'elif') {
    const expression = directive.display.replace(/^#\s*(?:el)?if\b/, '').trim();
    const value = evaluateExpression(expression, macros);
    return value === undefined ? { value: 0, unknown: true } : { value: value ? 1 : 0, unknown: false };
  }

  const identifier = directive.display
    .replace(/^#\s*(?:el)?ifn?def\b/, '')
    .trim()
    .split(/[\s(]/)[0];
  const defined = macros.has(identifier) ? 1 : 0;
  const negated = name === 'ifndef' || name === 'elifndef';
  return { value: negated ? (defined ? 0 : 1) : defined, unknown: false };
}

function applyDefine(
  macros: Map<string, MacroDef>,
  directive: DirectiveToken,
  syntax: LanguageSyntax
): void {
  const parsed = parseDefine(directive.display);
  if (!parsed) return;
  // C# defines a value-less object-like `#define NAME` as `1` (its preprocessor
  // has no separate "defined but empty" state for `#if NAME`).
  const value =
    syntax.id === 'csharp' && !parsed.functionLike && parsed.value === '' ? '1' : parsed.value;
  macros.set(parsed.name, { value, functionLike: parsed.functionLike });
}

function applyUndef(macros: Map<string, MacroDef>, directive: DirectiveToken): void {
  const name = parseUndef(directive.display);
  if (name) macros.delete(name);
}

export interface CPreprocessorOptions {
  /** Activity lookups supplied by the preprocessor evaluator's maps. */
  branchActive?: (line: number) => boolean | undefined;
  blockActive?: (openerLine: number) => boolean | undefined;
}

/**
 * Builds the conditional hint model (directives + regions) for a document.
 *
 * Directive entries come first, then regions — matching the renderer's push
 * order; `computeHints` applies the final sort. Activity is only known when the
 * caller supplies the lookups (an evaluator's maps), otherwise nothing is
 * marked inactive.
 */
export function cConditionals(
  directives: DirectiveToken[],
  options: CPreprocessorOptions = {}
): ConditionalModel {
  const hints: ConditionalHint[] = [];
  const pairing = pairConditionals(directives);

  for (const block of pairing.blocks) {
    const opener = block.opener;

    for (let k = 1; k < block.branches.length; k++) {
      const previous = block.branches[k - 1];
      const current = block.branches[k];
      hints.push({
        line: current.line,
        cursorFrom: current.line,
        cursorTo: current.line,
        segments: [
          {
            marker: ' <- ',
            fromLine: previous.line,
            toLine: current.line,
            display: previous.display,
            target: { line: previous.line, col: 0 },
          },
        ],
        inactive: options.branchActive
          ? options.branchActive(previous.line) === false &&
            options.branchActive(current.line) === false
          : false,
        kind: 'macro',
      });
    }

    if (block.endif) {
      const previous = block.branches[block.branches.length - 1];
      const segments: ConditionalSegment[] = [
        {
          marker: ' <- ',
          fromLine: previous.line,
          toLine: block.endif.line,
          display: previous.display,
          target: { line: previous.line, col: 0 },
        },
      ];
      if (block.branches.length > 1) {
        segments.push({
          marker: ' <= ',
          fromLine: opener.line,
          toLine: block.endif.line,
          display: opener.display,
          target: { line: opener.line, col: 0 },
        });
      }
      hints.push({
        line: block.endif.line,
        cursorFrom: block.endif.line,
        cursorTo: opener.line,
        segments,
        inactive: options.blockActive ? options.blockActive(opener.line) === false : false,
        kind: 'macro',
      });
    }
  }

  for (const region of pairRegions(directives)) {
    hints.push({
      line: region.endregion.line,
      cursorFrom: region.endregion.line,
      cursorTo: region.opener.line,
      segments: [
        {
          marker: ' <- ',
          fromLine: region.opener.line,
          toLine: region.endregion.line,
          display: region.opener.display,
          target: { line: region.opener.line, col: 0 },
        },
      ],
      inactive: false,
      kind: 'macro',
    });
  }

  return { hints };
}
