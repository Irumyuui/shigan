import { describe, expect, it } from 'vitest';
import { ConditionalHint, ConditionalModel } from '../../src/core/conditionals';
import { scanRust } from '../../src/core/lexer/rust';
import { hostCfg, parseRustCfgEntries } from '../../src/core/match/rust/cfg';
import { explicitDecidedSpans } from '../../src/core/match/rust/conditionals';
import {
  applyMergedInactivity,
  DiagnosticCodeLike,
  DiagnosticRangeLike,
  inactiveLinesFromRanges,
  isInactiveCodeDiagnostic,
  mergeRustInactiveLines,
} from '../../src/core/match/rust/diagnostics';

const range = (startLine: number, endLine: number): DiagnosticRangeLike => ({ startLine, endLine });
const sorted = (lines: ReadonlySet<number>): number[] => [...lines].sort((a, b) => a - b);

const hint = (attrLines: readonly number[], endLine: number): ConditionalHint => ({
  line: endLine,
  cursorFrom: attrLines[0],
  cursorTo: endLine,
  segments: attrLines.map((line) => ({
    marker: ' <- ',
    fromLine: line,
    toLine: endLine,
    display: '#[cfg]',
    target: { line, col: 0 },
  })),
  inactive: false,
  isEndif: false,
  kind: 'conditional',
});

describe('isInactiveCodeDiagnostic', () => {
  it('matches only rust-analyzer inactive-code diagnostics', () => {
    const codes: Array<[DiagnosticCodeLike, boolean]> = [
      ['inactive_code', true],
      ['inactive-code', true],
      ['INACTIVE_CODE', true],
      [{ value: 'inactive_code' }, true],
      [{ value: 'inactive-code' }, true],
      [123, false],
      [{ value: 123 }, false],
      [undefined, false],
    ];

    for (const [code, matches] of codes) {
      expect(isInactiveCodeDiagnostic('rust-analyzer', code), String(JSON.stringify(code))).toBe(
        matches
      );
      expect(isInactiveCodeDiagnostic('rustc', code)).toBe(false);
      expect(isInactiveCodeDiagnostic(undefined, code)).toBe(false);
    }
  });
});

describe('inactiveLinesFromRanges', () => {
  it('unions overlapping ranges and clamps to the document', () => {
    expect(sorted(inactiveLinesFromRanges([range(1, 3), range(3, 5)], 10))).toEqual([1, 2, 3, 4, 5]);
    expect(sorted(inactiveLinesFromRanges([range(-2, 1)], 3))).toEqual([0, 1]);
    expect(sorted(inactiveLinesFromRanges([range(8, 20)], 3))).toEqual([]);
    expect(sorted(inactiveLinesFromRanges([range(2, 1)], 5))).toEqual([]);
    expect(sorted(inactiveLinesFromRanges([], 5))).toEqual([]);
    expect(sorted(inactiveLinesFromRanges([range(0, 0)], 0))).toEqual([]);
  });
});

describe('mergeRustInactiveLines', () => {
  it('authoritative: diagnostics replace lexical negatives, explicit spans win', () => {
    const result = mergeRustInactiveLines({
      lexicalLines: new Set([0, 1, 2, 3]),
      explicitAttributeLines: new Set([10]),
      explicitInactiveLines: new Set([10, 11]),
      diagnostics: [range(1, 1), range(10, 11), range(20, 21)],
      authoritative: true,
      lineCount: 30,
    });

    expect(sorted(result)).toEqual([1, 10, 11, 20, 21]);
  });

  it('authoritative: an active explicit span suppresses its diagnostic', () => {
    const result = mergeRustInactiveLines({
      lexicalLines: new Set([10, 11]),
      explicitAttributeLines: new Set([10]),
      explicitInactiveLines: new Set(),
      diagnostics: [range(10, 11)],
      authoritative: true,
      lineCount: 20,
    });

    expect(sorted(result)).toEqual([]);
  });

  it('authoritative: a nested range inside an explicit span survives', () => {
    const result = mergeRustInactiveLines({
      lexicalLines: new Set<number>(),
      explicitAttributeLines: new Set([0]),
      explicitInactiveLines: new Set<number>(),
      // The outer explicit item's diagnostic starts on the attribute line and is
      // suppressed; the nested item's range starts elsewhere and is kept.
      diagnostics: [range(0, 3), range(2, 3)],
      authoritative: true,
      lineCount: 10,
    });

    expect(sorted(result)).toEqual([2, 3]);
  });

  it('authoritative without diagnostics uses only explicit inactive spans', () => {
    const result = mergeRustInactiveLines({
      lexicalLines: new Set([0, 1, 2]),
      explicitAttributeLines: new Set([1]),
      explicitInactiveLines: new Set([2]),
      diagnostics: [],
      authoritative: true,
      lineCount: 10,
    });

    expect(sorted(result)).toEqual([2]);
  });

  it('non-authoritative: widens the lexical result with diagnostics', () => {
    const result = mergeRustInactiveLines({
      lexicalLines: new Set([0, 1]),
      explicitAttributeLines: new Set([1]),
      explicitInactiveLines: new Set([2]),
      diagnostics: [range(1, 2), range(4, 4)],
      authoritative: false,
      lineCount: 10,
    });

    expect(sorted(result)).toEqual([0, 1, 4]);
  });
});

describe('applyMergedInactivity', () => {
  it('does not let a nested inactive line flip the enclosing hint', () => {
    const model: ConditionalModel = { hints: [hint([0], 4)] };
    expect(applyMergedInactivity(model, new Set([2, 3])).hints[0].inactive).toBe(false);
  });

  it('flags a hint whose own attribute line is inactive', () => {
    const model: ConditionalModel = { hints: [hint([0], 4)] };
    expect(applyMergedInactivity(model, new Set([0])).hints[0].inactive).toBe(true);
  });

  it('flags a merged hint when either attribute line is inactive', () => {
    const model: ConditionalModel = { hints: [hint([0, 2], 4)] };
    expect(applyMergedInactivity(model, new Set([2])).hints[0].inactive).toBe(true);
    expect(applyMergedInactivity(model, new Set([5])).hints[0].inactive).toBe(false);
  });
});

describe('explicitDecidedSpans', () => {
  it('decides a span from explicit entries alone', () => {
    const text = '#[cfg(unix)]\nfn a() {\n}\n';
    const input = {
      scanned: scanRust(text),
      lines: text.split('\n'),
      environment: { explicit: parseRustCfgEntries(['-unix']) },
    };

    expect(explicitDecidedSpans(input)).toEqual([
      { attrLine: 0, attrLines: [0], endLine: 2, inactive: true },
    ]);
  });

  it('decides an explicitly-enabled span as active', () => {
    const text = '#[cfg(unix)]\nfn a() {\n}\n';
    const input = {
      scanned: scanRust(text),
      lines: text.split('\n'),
      environment: { explicit: parseRustCfgEntries(['unix']) },
    };

    expect(explicitDecidedSpans(input)).toEqual([
      { attrLine: 0, attrLines: [0], endLine: 2, inactive: false },
    ]);
  });

  it('does not decide a span that needs host or feature facts', () => {
    const text = '#[cfg(feature = "x")]\nfn a() {\n}\n';
    const input = {
      scanned: scanRust(text),
      lines: text.split('\n'),
      environment: {
        host: hostCfg('linux', 'x64').predicates,
        features: { decidableAbsence: true, universe: new Set(['x']), enabled: new Set(['x']) },
      },
    };

    expect(explicitDecidedSpans(input)).toEqual([]);
  });
});
