import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  languageSettingsFor,
  readConfigFrom,
  ShiganConfig,
} from '../../src/core/settings';

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
      skipInactiveBrackets: true,
      skipInactiveDirectives: false,
      markInactive: true,
      showRange: true,
      rangeHideThreshold: 0,
      showLabel: true,
      c: { trackFileDefines: true, compileFlags: [], inheritCompileCommands: false },
      cpp: { trackFileDefines: true, compileFlags: [], inheritCompileCommands: false },
      csharp: {
        trackFileDefines: true,
        compileFlags: [],
        define: [],
        inheritProject: true,
        configuration: 'Debug',
        targetFramework: '',
      },
      rust: { cfg: [], inheritCargo: true },
    });
  });

  const cases: Array<[string, unknown, Record<string, unknown>]> = [
    ['enable', false, { enable: false }],
    ['languages', ['cpp', 'cuda'], { languages: ['cpp', 'cuda'] }],
    ['trigger', 'always', { trigger: 'always' }],
    ['trigger', 'off', { trigger: 'off' }],
    ['show', ['macros'], { show: ['macros'] }],
    ['show', [], { show: [] }],
    ['showRange', false, { showRange: false }],
    ['showRangeThreshold', 3, { rangeHideThreshold: 3 }],
    ['showLabel', false, { showLabel: false }],
    ['inactive.skipBrackets', false, { skipInactiveBrackets: false }],
    ['inactive.skipDirectives', true, { skipInactiveDirectives: true }],
    ['inactive.markInactive', false, { markInactive: false }],
    ['c.trackFileDefines', false, { c: { trackFileDefines: false } }],
    ['c.compileFlags', ['-DX=1', '-Iinc'], { c: { compileFlags: ['-DX=1', '-Iinc'] } }],
    ['c.inheritCompileCommands', true, { c: { inheritCompileCommands: true } }],
    ['cpp.trackFileDefines', false, { cpp: { trackFileDefines: false } }],
    ['cpp.compileFlags', ['-DY=1'], { cpp: { compileFlags: ['-DY=1'] } }],
    ['cpp.inheritCompileCommands', true, { cpp: { inheritCompileCommands: true } }],
    ['csharp.trackFileDefines', false, { csharp: { trackFileDefines: false } }],
    ['csharp.compileFlags', ['-DZ=1'], { csharp: { compileFlags: ['-DZ=1'] } }],
    ['csharp.define', ['TRACE', 'DEBUG'], { csharp: { define: ['TRACE', 'DEBUG'] } }],
    ['csharp.inheritProject', false, { csharp: { inheritProject: false } }],
    ['csharp.configuration', 'Release', { csharp: { configuration: 'Release' } }],
    ['csharp.targetFramework', 'net8.0', { csharp: { targetFramework: 'net8.0' } }],
    ['rust.cfg', ['unix'], { rust: { cfg: ['unix'] } }],
    ['rust.inheritCargo', false, { rust: { inheritCargo: false } }],
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

describe('languageSettingsFor', () => {
  it('returns the C group for the C kind', () => {
    const config = read({ 'c.compileFlags': ['-DC'], 'c.inheritCompileCommands': true });
    expect(languageSettingsFor(config, 'c')).toEqual({
      trackFileDefines: true,
      compileFlags: ['-DC'],
      inheritCompileCommands: true,
    });
  });

  it('returns the C++ group for the C++ kind', () => {
    const config = read({ 'cpp.compileFlags': ['-DCPP'], 'cpp.trackFileDefines': false });
    expect(languageSettingsFor(config, 'cpp')).toEqual({
      trackFileDefines: false,
      compileFlags: ['-DCPP'],
      inheritCompileCommands: false,
    });
  });

  it('returns C# values but never compile_commands inheritance', () => {
    const config = read({ 'csharp.compileFlags': ['-DCS'], 'csharp.trackFileDefines': false });
    expect(languageSettingsFor(config, 'csharp')).toEqual({
      trackFileDefines: false,
      compileFlags: ['-DCS'],
      // C# has no compile_commands.json support; this is always false.
      inheritCompileCommands: false,
    });
  });

  it('falls back to the C group for Rust (never consumed there)', () => {
    const config = read({ 'c.compileFlags': ['-DC'] });
    expect(languageSettingsFor(config, 'rust')).toEqual(config.c);
  });
});

/** A contributed configuration block; `id` is absent on the default one. */
interface Category {
  id?: string;
  title?: string;
  order?: number;
  properties: Record<string, unknown>;
}

interface Manifest {
  contributes: { configuration: Category[] };
}

function readManifest(): Manifest {
  return JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as Manifest;
}

/** Every configuration key, mapped to its nesting path in {@link ShiganConfig}. */
const FIELD_FOR_SETTING: Record<string, readonly string[]> = {
  'shigan.enable': ['enable'],
  'shigan.languages': ['languages'],
  'shigan.trigger': ['trigger'],
  'shigan.show': ['show'],
  'shigan.showRange': ['showRange'],
  'shigan.showRangeThreshold': ['rangeHideThreshold'],
  'shigan.showLabel': ['showLabel'],
  'shigan.inactive.skipBrackets': ['skipInactiveBrackets'],
  'shigan.inactive.skipDirectives': ['skipInactiveDirectives'],
  'shigan.inactive.markInactive': ['markInactive'],
  'shigan.c.trackFileDefines': ['c', 'trackFileDefines'],
  'shigan.c.compileFlags': ['c', 'compileFlags'],
  'shigan.c.inheritCompileCommands': ['c', 'inheritCompileCommands'],
  'shigan.cpp.trackFileDefines': ['cpp', 'trackFileDefines'],
  'shigan.cpp.compileFlags': ['cpp', 'compileFlags'],
  'shigan.cpp.inheritCompileCommands': ['cpp', 'inheritCompileCommands'],
  'shigan.csharp.trackFileDefines': ['csharp', 'trackFileDefines'],
  'shigan.csharp.compileFlags': ['csharp', 'compileFlags'],
  'shigan.csharp.define': ['csharp', 'define'],
  'shigan.csharp.inheritProject': ['csharp', 'inheritProject'],
  'shigan.csharp.configuration': ['csharp', 'configuration'],
  'shigan.csharp.targetFramework': ['csharp', 'targetFramework'],
  'shigan.rust.cfg': ['rust', 'cfg'],
  'shigan.rust.inheritCargo': ['rust', 'inheritCargo'],
};

function valueAtPath(value: unknown, path: readonly string[]): unknown {
  return path.reduce<unknown>((current, key) => {
    if (current === null || typeof current !== 'object') return undefined;
    return (current as Record<string, unknown>)[key];
  }, value);
}

const NLS_FILES = ['package.nls.json', 'package.nls.zh-cn.json', 'package.nls.ja.json'];

function nlsKeys(file: string): Set<string> {
  const json = JSON.parse(readFileSync(join(process.cwd(), file), 'utf8')) as Record<string, unknown>;
  return new Set(Object.keys(json));
}

/** The `%placeholder%` keys referenced by one manifest property (any depth). */
function placeholdersOf(property: unknown): string[] {
  const matches = JSON.stringify(property).matchAll(/%([^%]+)%/g);
  return [...matches].map((match) => match[1]);
}

describe('contributed settings', () => {
  const manifest = readManifest();
  const categories = manifest.contributes.configuration;

  it('contributes an array of titled categories with one default', () => {
    expect(Array.isArray(categories)).toBe(true);
    const defaults = categories.filter((category) => category.id === undefined);
    expect(defaults).toHaveLength(1);
    expect(defaults[0].title).toBe('%configuration.title%');
    // The default category keeps no explicit order; VS Code puts it first.
    expect(defaults[0].order).toBeUndefined();
  });

  it('gives every language category an id, title and order', () => {
    const named = categories.filter((category) => category.id !== undefined);
    expect(named.map((category) => [category.id, category.order])).toEqual([
      ['shigan.c', 1],
      ['shigan.cpp', 2],
      ['shigan.csharp', 3],
      ['shigan.rust', 4],
    ]);
    for (const category of named) {
      expect(category.title, `${category.id} needs a %title%`).toMatch(/^%.+%$/);
    }
  });

  it('places every key in exactly one category', () => {
    const keys = categories.flatMap((category) => Object.keys(category.properties));
    expect(new Set(keys).size, 'a key is contributed twice').toBe(keys.length);
    expect(keys.sort()).toEqual(Object.keys(FIELD_FOR_SETTING).sort());
  });

  it('never makes one setting id a complete dotted prefix of another', () => {
    const ids = Object.keys(FIELD_FOR_SETTING);
    for (const a of ids) {
      for (const b of ids) {
        if (a === b) continue;
        expect(b.startsWith(`${a}.`), `${a} is a dotted prefix of ${b}`).toBe(false);
      }
    }
  });

  it('removes every retired setting id from the manifest', () => {
    const raw = readFileSync(join(process.cwd(), 'package.json'), 'utf8');
    for (const retired of [
      'shigan.preprocessor.',
      'shigan.compileFlags',
      'shigan.inheritCompileCommands',
    ]) {
      expect(raw.includes(retired), `${retired} still appears in package.json`).toBe(false);
    }
  });

  it('declares show as a two-value enum with the documented default', () => {
    const show = categories.find((category) => category.properties['shigan.show'])?.properties[
      'shigan.show'
    ] as { items?: { enum?: string[] }; default?: unknown };
    expect(show.items?.enum).toEqual(['brackets', 'macros']);
    expect(show.default).toEqual(['brackets', 'macros']);
  });

  it('wires every contributed setting through the reader, defaults and nls', () => {
    const nls = NLS_FILES.map((file) => ({ file, keys: nlsKeys(file) }));
    const defaults = read();

    for (const [key, path] of Object.entries(FIELD_FOR_SETTING)) {
      const property = categories.find((category) => key in category.properties)?.properties[
        key
      ] as { type?: string; default?: unknown } | undefined;
      expect(property, `${key} is not contributed`).toBeDefined();

      // Type and default must exist and agree with the reader fallback.
      expect(typeof property!.type, `${key} needs a type`).toBe('string');
      expect(
        valueAtPath(defaults, path),
        `default for ${key} drifted from settings.ts fallback`
      ).toEqual(property!.default);

      // The reader maps the key onto the nested path (the reader drops the
      // `shigan.` section prefix).
      const readerKey = key.replace(/^shigan\./, '');
      const probe =
        property!.type === 'boolean' ? true : property!.type === 'number' ? 7 : property!.type === 'array' ? ['probe'] : 'probe';
      expect(valueAtPath(read({ [readerKey]: probe }), path), `${key} is not read`).toEqual(probe);

      // Every %placeholder% used by the property resolves in all locales.
      const placeholders = placeholdersOf(property);
      expect(placeholders.length, `${key} should reference a description`).toBeGreaterThan(0);
      for (const placeholder of placeholders) {
        for (const locale of nls) {
          expect(locale.keys.has(placeholder), `${locale.file} is missing ${placeholder}`).toBe(
            true
          );
        }
      }
    }
  });
});
