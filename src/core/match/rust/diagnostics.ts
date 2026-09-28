import { ConditionalModel } from '../../conditionals';

/**
 * Pure helpers for rust-analyzer's inactive-code diagnostics.
 *
 * rust-analyzer publishes `source: 'rust-analyzer'`, `code: 'inactive_code'`
 * (snake case on the wire) with tag `Unnecessary`, one diagnostic per disabled
 * node whose range covers the attribute plus the whole item. It can be disabled
 * by the user and only exists for OPEN local documents, so absence is never
 * proof that code is active — that is why the merge below has an explicit
 * `authoritative` switch.
 */

/** `code` as it arrives over the API: string | number | { value }. */
export type DiagnosticCodeLike = string | number | { value: string | number } | undefined;

/** Tolerant to both `inactive_code` and `inactive-code`. */
const INACTIVE_CODE = /^inactive[-_]code$/i;

/** Matches ONLY rust-analyzer's inactive-code diagnostic. */
export function isInactiveCodeDiagnostic(
  source: string | undefined,
  code: DiagnosticCodeLike
): boolean {
  if (source !== 'rust-analyzer') return false;
  if (code === undefined) return false;

  const value = typeof code === 'object' ? code.value : code;
  return typeof value === 'string' && INACTIVE_CODE.test(value);
}

export interface DiagnosticRangeLike {
  startLine: number;
  endLine: number;
}

/** Inclusive line union of the ranges, clamped to `[0, lineCount - 1]`. */
export function inactiveLinesFromRanges(
  ranges: readonly DiagnosticRangeLike[],
  lineCount: number
): Set<number> {
  const lines = new Set<number>();
  for (const range of ranges) {
    const start = Math.max(0, range.startLine);
    const end = Math.min(lineCount - 1, range.endLine);
    for (let line = start; line <= end; line++) lines.add(line);
  }
  return lines;
}

/**
 * Re-derives every hint's `inactive` flag from the merged inactive-line set,
 * using the hint's OWN cfg-attribute lines (the segment targets). Scanning the
 * whole span would let a nested inactive item flip its enclosing hint.
 */
export function applyMergedInactivity(
  model: ConditionalModel,
  merged: ReadonlySet<number>
): ConditionalModel {
  return {
    ...model,
    hints: model.hints.map((hint) => ({
      ...hint,
      inactive: hint.segments.some((segment) => merged.has(segment.target.line)),
    })),
  };
}

export interface RustInactiveMergeInput {
  /** Lines the lexical model decided inactive. */
  lexicalLines: ReadonlySet<number>;
  /** The cfg-ATTRIBUTE lines of spans whose predicate is FULLY decided by explicit `shigan.rust.cfg`. */
  explicitAttributeLines: ReadonlySet<number>;
  /** Of those spans, every line the explicit model says is inactive. */
  explicitInactiveLines: ReadonlySet<number>;
  /** rust-analyzer's inactive-code ranges. */
  diagnostics: readonly DiagnosticRangeLike[];
  /** Matching diagnostics exist for this document OR the rust-analyzer extension is active. */
  authoritative: boolean;
  lineCount: number;
}

/**
 * Combines the lexical model with rust-analyzer's diagnostics.
 *
 * Diagnostic ranges are authoritative when `authoritative` is set: they
 * *replace* the lexical negatives (never union), because a missing diagnostic
 * for an unknown predicate does not mean the code is live. A diagnostic is
 * suppressed — the user's explicit `shigan.rust.cfg` intent wins — only when its
 * START line is a cfg-attribute line of an explicitly-decided span; a nested
 * range inside such a span survives. The explicitly-decided spans' own inactive
 * lines are always added back. Without an authoritative source we can only
 * widen the lexical result with whatever diagnostics we did see.
 */
export function mergeRustInactiveLines(input: RustInactiveMergeInput): Set<number> {
  const keptDiagnostics = input.diagnostics.filter(
    (range) => !input.explicitAttributeLines.has(range.startLine)
  );
  const fromDiagnostics = inactiveLinesFromRanges(keptDiagnostics, input.lineCount);

  if (input.authoritative) {
    const result = new Set(fromDiagnostics);
    for (const line of input.explicitInactiveLines) result.add(line);
    return result;
  }

  const result = new Set(input.lexicalLines);
  for (const line of fromDiagnostics) result.add(line);
  return result;
}
