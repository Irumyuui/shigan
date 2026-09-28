import { ConditionalHint, ConditionalModel, ConditionalSegment } from '../../conditionals';
import { ScanResult } from '../../types';
import { evaluateCfgPredicate, RustCfgEnvironment } from './cfg';
import { CfgItemSpan, pairCfgItems } from './items';

export interface RustConditionalInput {
  scanned: ScanResult;
  lines: readonly string[];
  environment: RustCfgEnvironment;
}

/** `#[cfg(EXPR)]` → `EXPR`; `undefined` when the display is not a cfg attribute. */
const CFG_ATTRIBUTE = /^#\[cfg\s*\(([\s\S]*)\)\]$/;

/**
 * Builds the `#[cfg]` gating model: one hint per detected item span
 * ({@link pairCfgItems}). Every attribute predicate of a merged group is
 * ANDed with three-valued (Kleene) logic — any `false` decides the item
 * inactive, otherwise any `undefined` leaves it unknown (and a hint without the
 * `inactive` flag is still emitted). An attribute whose display cannot be
 * parsed counts as unknown.
 *
 * `inactiveLines` covers `attrLine..endLine` for spans that are definitely
 * inactive. Never throws.
 */
export function rustConditionals(input: RustConditionalInput): ConditionalModel {
  const { scanned, lines, environment } = input;
  const hints: ConditionalHint[] = [];
  const inactiveLines = new Set<number>();

  for (const span of pairCfgItems(scanned, lines)) {
    const inactive = spanValue(span, environment) === false;

    const segments: ConditionalSegment[] = span.displays.map((display, index) => ({
      marker: ' <- ',
      fromLine: index === 0 ? span.attrLine : span.endLine,
      toLine: span.endLine,
      display,
      target: { line: span.attrLines[index], col: 0 },
    }));

    hints.push({
      line: span.endLine,
      cursorFrom: span.attrLine,
      cursorTo: span.endLine,
      segments,
      inactive,
      isEndif: false,
      kind: 'conditional',
    });

    if (inactive) {
      for (let line = span.attrLine; line <= span.endLine; line++) inactiveLines.add(line);
    }
  }

  return { hints, inactiveLines };
}

/** Kleene AND over every attribute predicate: false wins, else undefined, else true. */
function andPredicates(
  displays: readonly string[],
  environment: RustCfgEnvironment
): boolean | undefined {
  let result: boolean | undefined = true;
  for (const display of displays) {
    const match = CFG_ATTRIBUTE.exec(display.trim());
    const value = match ? evaluateCfgPredicate(match[1].trim(), environment) : undefined;
    if (value === false) return false;
    if (value === undefined) result = undefined;
  }
  return result;
}

/** The AND result for one span under `environment`. */
function spanValue(span: CfgItemSpan, environment: RustCfgEnvironment): boolean | undefined {
  return andPredicates(span.displays, environment);
}

/**
 * Spans whose predicate is fully decided by `environment.explicit` alone
 * (Kleene result `true` or `false`, never `undefined`). These are the spans a
 * user's `shigan.rust.cfg` entries determine, so rust-analyzer's diagnostics
 * must not override them.
 */
export function explicitDecidedSpans(input: RustConditionalInput): Array<{
  attrLine: number;
  attrLines: readonly number[];
  endLine: number;
  inactive: boolean;
}> {
  const explicitEnvironment: RustCfgEnvironment = { explicit: input.environment.explicit };
  const decided: Array<{
    attrLine: number;
    attrLines: readonly number[];
    endLine: number;
    inactive: boolean;
  }> = [];

  for (const span of pairCfgItems(input.scanned, input.lines)) {
    const value = spanValue(span, explicitEnvironment);
    if (value !== undefined) {
      decided.push({
        attrLine: span.attrLine,
        attrLines: span.attrLines,
        endLine: span.endLine,
        inactive: value === false,
      });
    }
  }

  return decided;
}
