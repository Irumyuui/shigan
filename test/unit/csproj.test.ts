import { describe, expect, it } from 'vitest';
import { frameworkSymbols, parseDefineConstants } from '../../src/core/csproj';

/** Stable comparison helper: a Set has no meaningful JSON representation. */
function symbols(xml: string, options?: Parameters<typeof parseDefineConstants>[1]): string[] {
  return Array.from(parseDefineConstants(xml, options).symbols).sort();
}

describe('parseDefineConstants', () => {
  it('honours PropertyGroup conditions for Debug and Release', () => {
    const xml = `
      <Project Sdk="Microsoft.NET.Sdk">
        <PropertyGroup Condition="'$(Configuration)'=='Debug'">
          <DefineConstants>DEBUG;TRACE</DefineConstants>
        </PropertyGroup>
        <PropertyGroup Condition="'$(Configuration)'=='Release'">
          <DefineConstants>RELEASE;TRACE</DefineConstants>
        </PropertyGroup>
      </Project>`;

    expect(symbols(xml)).toEqual(['DEBUG', 'TRACE']);
    expect(symbols(xml, { configuration: 'Release' })).toEqual(['RELEASE', 'TRACE']);
  });

  it('honours an element-level Condition', () => {
    const xml = `
      <Project>
        <PropertyGroup>
          <DefineConstants Condition="'$(Configuration)'=='Debug'">DEBUG_ONLY</DefineConstants>
          <DefineConstants Condition="'$(Configuration)'=='Release'">RELEASE_ONLY</DefineConstants>
        </PropertyGroup>
      </Project>`;

    expect(symbols(xml)).toEqual(['DEBUG_ONLY']);
    expect(symbols(xml, { configuration: 'Release' })).toEqual(['RELEASE_ONLY']);
  });

  it('appends through $(DefineConstants)', () => {
    const xml = `
      <Project>
        <PropertyGroup>
          <DefineConstants>FIRST</DefineConstants>
          <DefineConstants>$(DefineConstants);SECOND</DefineConstants>
          <DefineConstants>$(DefineConstants);THIRD</DefineConstants>
        </PropertyGroup>
      </Project>`;

    expect(symbols(xml)).toEqual(['FIRST', 'SECOND', 'THIRD']);
  });

  it('seeds the accumulator with initialSymbols so files can chain', () => {
    const xml = `
      <Project>
        <PropertyGroup>
          <DefineConstants>$(DefineConstants);TRACE</DefineConstants>
        </PropertyGroup>
      </Project>`;

    const result = parseDefineConstants(xml, { initialSymbols: new Set(['DEBUG']) });

    expect(Array.from(result.symbols).sort()).toEqual(['DEBUG', 'TRACE']);
  });

  it('expands $(Configuration) and $(Platform) inside values', () => {
    const xml = `
      <Project>
        <PropertyGroup>
          <DefineConstants>CONFIG_$(Configuration);PLAT_$(Platform)</DefineConstants>
        </PropertyGroup>
      </Project>`;

    expect(symbols(xml)).toEqual(['CONFIG_Debug', 'PLAT_AnyCPU']);
    expect(symbols(xml, { configuration: 'Release', platform: 'x64' })).toEqual([
      'CONFIG_Release',
      'PLAT_x64',
    ]);
  });

  it('unescapes XML entities in conditions', () => {
    const xml = `
      <Project>
        <PropertyGroup>
          <DefineConstants Condition="&apos;$(Configuration)&apos; == &apos;Debug&apos;">ESCAPED</DefineConstants>
        </PropertyGroup>
      </Project>`;

    expect(symbols(xml)).toEqual(['ESCAPED']);
    expect(symbols(xml, { configuration: 'Release' })).toEqual([]);
  });

  it('drops values whose entities make them invalid identifiers', () => {
    const xml = `
      <Project>
        <PropertyGroup>
          <DefineConstants>KEEP;A&amp;B</DefineConstants>
        </PropertyGroup>
      </Project>`;

    expect(symbols(xml)).toEqual(['KEEP']);
  });

  it('includes DefineConstants behind unknown or unsupported conditions', () => {
    const unknown = `
      <Project>
        <PropertyGroup Condition="'$(UndefinedProjectProperty)'=='whatever'">
          <DefineConstants>UNKNOWN_CONDITION</DefineConstants>
        </PropertyGroup>
      </Project>`;
    const unsupported = `
      <Project>
        <PropertyGroup Condition="Exists('something.txt')">
          <DefineConstants>UNSUPPORTED_CONDITION</DefineConstants>
        </PropertyGroup>
      </Project>`;

    expect(symbols(unknown)).toEqual(['UNKNOWN_CONDITION']);
    expect(symbols(unsupported)).toEqual(['UNSUPPORTED_CONDITION']);
  });

  it('evaluates And, Or, ! and parentheses', () => {
    const xml = `
      <Project>
        <PropertyGroup Condition="('$(Configuration)'=='Debug' Or '$(Configuration)'=='Test') And !'$(Platform)'=='ARM'">
          <DefineConstants>COMBINED</DefineConstants>
        </PropertyGroup>
      </Project>`;

    expect(symbols(xml)).toEqual(['COMBINED']);
    expect(symbols(xml, { platform: 'ARM' })).toEqual([]);
    expect(symbols(xml, { configuration: 'Release' })).toEqual([]);
  });

  it('parses multi-line DefineConstants values', () => {
    const xml = `
      <Project>
        <PropertyGroup>
          <DefineConstants>
            FIRST;
            SECOND
          </DefineConstants>
        </PropertyGroup>
      </Project>`;

    expect(symbols(xml)).toEqual(['FIRST', 'SECOND']);
  });

  it('splits on semicolons and commas, trimming and filtering identifiers', () => {
    const xml = `
      <Project>
        <PropertyGroup>
          <DefineConstants>VALID;1INVALID;has-dash;with space;_underscore,COMMA</DefineConstants>
        </PropertyGroup>
      </Project>`;

    expect(symbols(xml)).toEqual(['COMMA', 'VALID', '_underscore']);
  });

  it('reads <TargetFramework>', () => {
    const xml = `
      <Project Sdk="Microsoft.NET.Sdk">
        <PropertyGroup>
          <TargetFramework>net8.0</TargetFramework>
        </PropertyGroup>
      </Project>`;

    expect(parseDefineConstants(xml).targetFramework).toBe('net8.0');
  });

  it('falls back to the first entry of <TargetFrameworks>', () => {
    const xml = `
      <Project Sdk="Microsoft.NET.Sdk">
        <PropertyGroup>
          <TargetFrameworks>net48;net8.0</TargetFrameworks>
        </PropertyGroup>
      </Project>`;

    expect(parseDefineConstants(xml).targetFramework).toBe('net48');
  });

  it('prefers the targetFramework option over the XML', () => {
    const xml = `
      <Project Sdk="Microsoft.NET.Sdk">
        <PropertyGroup>
          <TargetFramework>net8.0</TargetFramework>
        </PropertyGroup>
      </Project>`;

    expect(parseDefineConstants(xml, { targetFramework: 'net6.0' }).targetFramework).toBe('net6.0');
  });

  it('leaves an unresolved targetFramework undefined', () => {
    expect(parseDefineConstants('<Project />').targetFramework).toBeUndefined();
  });

  it('ignores a self-closing DefineConstants element', () => {
    const xml = `
      <Project>
        <PropertyGroup>
          <DefineConstants />
        </PropertyGroup>
      </Project>`;

    expect(symbols(xml)).toEqual([]);
  });
});

describe('frameworkSymbols', () => {
  it('derives symbols for net8.0', () => {
    expect(frameworkSymbols('net8.0')).toEqual([
      'NET',
      'NET5_0_OR_GREATER',
      'NET6_0_OR_GREATER',
      'NET7_0_OR_GREATER',
      'NET8_0',
      'NET8_0_OR_GREATER',
      'NETCOREAPP',
      'NETCOREAPP1_0_OR_GREATER',
      'NETCOREAPP1_1_OR_GREATER',
      'NETCOREAPP2_0_OR_GREATER',
      'NETCOREAPP2_1_OR_GREATER',
      'NETCOREAPP2_2_OR_GREATER',
      'NETCOREAPP3_0_OR_GREATER',
      'NETCOREAPP3_1_OR_GREATER',
    ]);
  });

  it('derives symbols for netstandard2.0', () => {
    expect(frameworkSymbols('netstandard2.0')).toEqual([
      'NETSTANDARD',
      'NETSTANDARD1_0_OR_GREATER',
      'NETSTANDARD1_1_OR_GREATER',
      'NETSTANDARD1_2_OR_GREATER',
      'NETSTANDARD1_3_OR_GREATER',
      'NETSTANDARD1_4_OR_GREATER',
      'NETSTANDARD1_5_OR_GREATER',
      'NETSTANDARD1_6_OR_GREATER',
      'NETSTANDARD2_0',
      'NETSTANDARD2_0_OR_GREATER',
    ]);
  });

  it('derives symbols for netcoreapp3.1', () => {
    expect(frameworkSymbols('netcoreapp3.1')).toEqual([
      'NETCOREAPP',
      'NETCOREAPP1_0_OR_GREATER',
      'NETCOREAPP1_1_OR_GREATER',
      'NETCOREAPP2_0_OR_GREATER',
      'NETCOREAPP2_1_OR_GREATER',
      'NETCOREAPP2_2_OR_GREATER',
      'NETCOREAPP3_0_OR_GREATER',
      'NETCOREAPP3_1',
      'NETCOREAPP3_1_OR_GREATER',
    ]);
  });

  it('derives symbols for the .NET Framework net48', () => {
    expect(frameworkSymbols('net48')).toEqual([
      'NET20_OR_GREATER',
      'NET35_OR_GREATER',
      'NET40_OR_GREATER',
      'NET451_OR_GREATER',
      'NET452_OR_GREATER',
      'NET45_OR_GREATER',
      'NET461_OR_GREATER',
      'NET462_OR_GREATER',
      'NET46_OR_GREATER',
      'NET471_OR_GREATER',
      'NET472_OR_GREATER',
      'NET47_OR_GREATER',
      'NET48',
      'NET48_OR_GREATER',
      'NETFRAMEWORK',
    ]);
  });

  it('is case-insensitive and normalises the moniker', () => {
    expect(frameworkSymbols('NET48')).toEqual(frameworkSymbols('net48'));
  });

  it('returns [] for unknown monikers', () => {
    expect(frameworkSymbols('portable-net45')).toEqual([]);
    expect(frameworkSymbols('net4.8')).toEqual([]);
    expect(frameworkSymbols('net49')).toEqual([]);
    expect(frameworkSymbols('')).toEqual([]);
  });
});
