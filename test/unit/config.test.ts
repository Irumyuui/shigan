import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
      languages: ['c', 'cpp', 'csharp', 'rust'],
      trigger: 'cursor',
      show: ['brackets', 'macros'],
      compileFlags: [],
      inheritCompileCommands: false,
      csharpDefine: [],
      csharpInheritProject: true,
      csharpConfiguration: 'Debug',
      csharpTargetFramework: '',
      rustCfg: [],
      rustInheritCargo: true,
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
    ['csharp.define', ['TRACE', 'DEBUG'], { csharpDefine: ['TRACE', 'DEBUG'] }],
    ['csharp.inheritProject', false, { csharpInheritProject: false }],
    ['csharp.configuration', 'Release', { csharpConfiguration: 'Release' }],
    ['csharp.targetFramework', 'net8.0', { csharpTargetFramework: 'net8.0' }],
    ['rust.cfg', ['unix'], { rustCfg: ['unix'] }],
    ['rust.inheritCargo', false, { rustInheritCargo: false }],
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

/**
 * Setting key in `package.json` -> `ShiganConfig` field. Any contributed key not
 * listed here fails the drift check, so a newly added setting cannot silently
 * escape it.
 */
const FIELD_FOR_SETTING: Record<string, keyof ShiganConfig> = {
  'shigan.enable': 'enable',
  'shigan.languages': 'languages',
  'shigan.trigger': 'trigger',
  'shigan.show': 'show',
  'shigan.compileFlags': 'compileFlags',
  'shigan.inheritCompileCommands': 'inheritCompileCommands',
  'shigan.csharp.define': 'csharpDefine',
  'shigan.csharp.inheritProject': 'csharpInheritProject',
  'shigan.csharp.configuration': 'csharpConfiguration',
  'shigan.csharp.targetFramework': 'csharpTargetFramework',
  'shigan.rust.cfg': 'rustCfg',
  'shigan.rust.inheritCargo': 'rustInheritCargo',
  'shigan.preprocessor.trackFileDefines': 'trackFileDefines',
  'shigan.preprocessor.skipInactiveBrackets': 'skipInactiveBrackets',
  'shigan.preprocessor.skipInactiveDirectives': 'skipInactiveDirectives',
  'shigan.preprocessor.markInactive': 'markInactive',
  'shigan.showRange': 'showRange',
  'shigan.showRangeThreshold': 'rangeHideThreshold',
  'shigan.showLabel': 'showLabel',
};

describe('contributed defaults', () => {
  it('match the settings.ts fallbacks', () => {
    const manifest = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
      contributes: { configuration: { properties: Record<string, { default: unknown }> } };
    };
    const properties = manifest.contributes.configuration.properties;
    expect(Object.keys(properties).sort()).toEqual(Object.keys(FIELD_FOR_SETTING).sort());

    const defaults = read();
    for (const [key, field] of Object.entries(FIELD_FOR_SETTING)) {
      expect(properties[key].default, `package.json default for ${key} drifted from settings.ts`).toEqual(
        defaults[field]
      );
    }
  });
});
