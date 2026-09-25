import { DirectiveToken, MacroDef } from '../types';
import { parseDefine, parseUndef } from '../flags';
import { evaluateExpression } from './expression';

export interface EvaluationOptions {
  macros: Map<string, MacroDef>;
  trackFileDefines?: boolean;
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
      if (trackFileDefines && currentActive()) applyDefine(macros, directive);
      continue;
    }
    if (name === 'undef') {
      if (trackFileDefines && currentActive()) applyUndef(macros, directive);
      continue;
    }

    if (name === 'if' || name === 'ifdef' || name === 'ifndef') {
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

    if (name === 'elif' || name === 'elifdef' || name === 'elifndef') {
      const condition = conditionValue(directive, macros);
      const unknown = top.unknown || condition.unknown;
      const active = top.parentActive && (unknown ? true : !top.taken && condition.value === 1);
      top.unknown = unknown;
      if (!condition.unknown && !top.taken && condition.value === 1) top.taken = true;
      top.branches.push({ directive, active });
      continue;
    }

    if (name === 'else') {
      const active = top.parentActive && (top.unknown ? true : !top.taken);
      top.taken = true;
      top.branches.push({ directive, active });
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

function applyDefine(macros: Map<string, MacroDef>, directive: DirectiveToken): void {
  const parsed = parseDefine(directive.display);
  if (parsed) macros.set(parsed.name, { value: parsed.value, functionLike: parsed.functionLike });
}

function applyUndef(macros: Map<string, MacroDef>, directive: DirectiveToken): void {
  const name = parseUndef(directive.display);
  if (name) macros.delete(name);
}
