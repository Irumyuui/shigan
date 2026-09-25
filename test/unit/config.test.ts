import { describe, expect, it } from 'vitest';
import { readConfigFrom, ShiganConfig } from '../../src/core/settings';

/** Adapts a plain settings object to the reader `readConfigFrom` expects. */
function read(settings: Record<string, unknown> = {}): ShiganConfig {
  return readConfigFrom(<T>(key: string, fallback: T): T =>
    key in settings ? (settings[key] as T) : fallback
  );
}

describe('readConfigFrom', () => {
  it('uses the documented defaults', () => {
    expect(read()).toEqual({
      enable: true,
      languages: ['c'],
      trigger: 'cursor',
      show: ['brackets', 'macros'],
      compileFlags: [],
      inheritCompileCommands: false,
      trackFileDefines: true,
      skipInactiveBrackets: true,
      skipInactiveDirectives: false,
      markInactive: true,
      showRange: true,
      rangeHideThreshold: 0,
      showLabel: true,
    });
  });

  const cases: Array<[string, unknown, Partial<ShiganConfig>]> = [
    ['enable', false, { enable: false }],
    ['languages', ['cpp', 'cuda'], { languages: ['cpp', 'cuda'] }],
    ['trigger', 'always', { trigger: 'always' }],
    ['trigger', 'off', { trigger: 'off' }],
    ['show', ['macros'], { show: ['macros'] }],
    ['show', [], { show: [] }],
    ['compileFlags', ['-DX=1', '-Iinc'], { compileFlags: ['-DX=1', '-Iinc'] }],
    ['inheritCompileCommands', true, { inheritCompileCommands: true }],
    ['preprocessor.trackFileDefines', false, { trackFileDefines: false }],
    ['preprocessor.skipInactiveBrackets', false, { skipInactiveBrackets: false }],
    ['preprocessor.skipInactiveDirectives', true, { skipInactiveDirectives: true }],
    ['preprocessor.markInactive', false, { markInactive: false }],
    ['showRange', false, { showRange: false }],
    ['showRangeThreshold', 3, { rangeHideThreshold: 3 }],
    ['showLabel', false, { showLabel: false }],
  ];

  for (const [key, value, expected] of cases) {
    it(`maps shigan.${key} = ${JSON.stringify(value)}`, () => {
      expect(read({ [key]: value })).toMatchObject(expected);
    });
  }

  it('keeps the other settings at their defaults when one is set', () => {
    expect(read({ enable: false })).toEqual({ ...read(), enable: false });
  });

  it('falls back to the default for a missing key', () => {
    expect(read({ trigger: 'always' }).showRange).toBe(true);
  });
});
