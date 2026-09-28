import { describe, expect, it } from 'vitest';
import { scanRust } from '../../src/core/lexer/rust';
import { hostCfg, parseRustCfgEntries } from '../../src/core/match/rust/cfg';
import { explicitDecidedSpans } from '../../src/core/match/rust/conditionals';
import {
  DiagnosticCodeLike,
  DiagnosticRangeLike,
  inactiveLinesFromRanges,
  isInactiveCodeDiagnostic,
  mergeRustInactiveLines,
} from '../../src/core/match/rust/diagnostics';

const range = (startLine: number, endLine: number): DiagnosticRangeLike => ({ startLine, endLine });
const sorted = (lines: ReadonlySet<number>): number[] => [...lines].sort((a, b) => a - b);

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
      explicitSpanLines: new Set([10, 11]),
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
      explicitSpanLines: new Set([10, 11]),
      explicitInactiveLines: new Set(),
      diagnostics: [range(10, 11)],
      authoritative: true,
      lineCount: 20,
    });

    expect(sorted(result)).toEqual([]);
  });

  it('authoritative without diagnostics uses only explicit inactive spans', () => {
    const result = mergeRustInactiveLines({
      lexicalLines: new Set([0, 1, 2]),
      explicitSpanLines: new Set([1, 2]),
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
      explicitSpanLines: new Set([1, 2]),
      explicitInactiveLines: new Set([2]),
      diagnostics: [range(1, 2), range(4, 4)],
      authoritative: false,
      lineCount: 10,
    });

    expect(sorted(result)).toEqual([0, 1, 4]);
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

    expect(explicitDecidedSpans(input)).toEqual([{ attrLine: 0, endLine: 2, inactive: true }]);
  });

  it('decides an explicitly-enabled span as active', () => {
    const text = '#[cfg(unix)]\nfn a() {\n}\n';
    const input = {
      scanned: scanRust(text),
      lines: text.split('\n'),
      environment: { explicit: parseRustCfgEntries(['unix']) },
    };

    expect(explicitDecidedSpans(input)).toEqual([{ attrLine: 0, endLine: 2, inactive: false }]);
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
