import { afterEach, describe, expect, it } from 'vitest';
import * as path from 'node:path';
import { clearCsprojCache, findCsprojSymbols } from '../../src/csproj-source';
import { cleanupTempDirs, makeTempDir, write } from './helpers';

/** Minimal SDK-style csproj with optional target framework. */
function project(defines: string, targetFramework?: string): string {
  const framework = targetFramework
    ? `    <TargetFramework>${targetFramework}</TargetFramework>\n`
    : '';
  return [
    '<Project Sdk="Microsoft.NET.Sdk">',
    '  <PropertyGroup>',
    framework + `    <DefineConstants>${defines}</DefineConstants>`,
    '  </PropertyGroup>',
    '</Project>',
  ].join('\n');
}

function props(defines: string, targetFramework?: string): string {
  const framework = targetFramework
    ? `    <TargetFramework>${targetFramework}</TargetFramework>\n`
    : '';
  return [
    '<Project>',
    '  <PropertyGroup>',
    framework + `    <DefineConstants>${defines}</DefineConstants>`,
    '  </PropertyGroup>',
    '</Project>',
  ].join('\n');
}

afterEach(() => {
  cleanupTempDirs();
  clearCsprojCache();
});

describe('findCsprojSymbols', () => {
  it('finds the nearest csproj walking up from a nested file', () => {
    const root = makeTempDir('shigan-csproj-');
    write(path.join(root, 'App.csproj'), project('ROOT_SYMBOL'));
    write(path.join(root, 'src', 'Inner.csproj'), project('INNER_SYMBOL'));
    const file = path.join(root, 'src', 'sub', 'Program.cs');
    write(file, '');

    const result = findCsprojSymbols(file);

    expect(result).toBeDefined();
    expect(result?.symbols.has('INNER_SYMBOL')).toBe(true);
    expect(result?.symbols.has('ROOT_SYMBOL')).toBe(false);
  });

  it('picks the alphabetically first csproj in a directory', () => {
    const root = makeTempDir('shigan-csproj-');
    write(path.join(root, 'Alpha.csproj'), project('ALPHA_SYMBOL'));
    write(path.join(root, 'Beta.csproj'), project('BETA_SYMBOL'));
    const file = path.join(root, 'Program.cs');
    write(file, '');

    const result = findCsprojSymbols(file);

    expect(result?.symbols.has('ALPHA_SYMBOL')).toBe(true);
    expect(result?.symbols.has('BETA_SYMBOL')).toBe(false);
  });

  it('chains Directory.Build.props root-most first and appends across files', () => {
    const root = makeTempDir('shigan-csproj-');
    write(path.join(root, 'Directory.Build.props'), props('FROM_OUTER'));
    write(path.join(root, 'src', 'Directory.Build.props'), props('$(DefineConstants);FROM_INNER'));
    write(path.join(root, 'src', 'My.csproj'), project('$(DefineConstants);FROM_CSPROJ'));
    const file = path.join(root, 'src', 'Program.cs');
    write(file, '');

    const result = findCsprojSymbols(file);

    expect(Array.from(result?.symbols ?? []).sort()).toEqual([
      'FROM_CSPROJ',
      'FROM_INNER',
      'FROM_OUTER',
    ]);
  });

  it('takes targetFramework from the csproj and honours the explicit override', () => {
    const root = makeTempDir('shigan-csproj-');
    write(path.join(root, 'App.csproj'), project('A', 'net8.0'));
    const file = path.join(root, 'Program.cs');
    write(file, '');

    expect(findCsprojSymbols(file)?.targetFramework).toBe('net8.0');
    expect(findCsprojSymbols(file, { targetFramework: 'net6.0' })?.targetFramework).toBe('net6.0');
  });

  it('falls back to the nearest Directory.Build.props target framework', () => {
    const root = makeTempDir('shigan-csproj-');
    write(path.join(root, 'Directory.Build.props'), props('PROPS_SYMBOL', 'netstandard2.0'));
    const file = path.join(root, 'src', 'Program.cs');
    write(file, '');

    const result = findCsprojSymbols(file);

    expect(result?.targetFramework).toBe('netstandard2.0');
    expect(result?.symbols.has('PROPS_SYMBOL')).toBe(true);
  });

  it('merges frameworkSymbols into the result', () => {
    const root = makeTempDir('shigan-csproj-');
    write(path.join(root, 'App.csproj'), project('APP_SYMBOL', 'net8.0'));
    const file = path.join(root, 'Program.cs');
    write(file, '');

    const result = findCsprojSymbols(file);

    expect(result?.symbols.has('APP_SYMBOL')).toBe(true);
    expect(result?.symbols.has('NET')).toBe(true);
    expect(result?.symbols.has('NET8_0_OR_GREATER')).toBe(true);
    expect(result?.symbols.has('NETCOREAPP')).toBe(true);
  });

  it('returns undefined when no project files exist', () => {
    const root = makeTempDir('shigan-csproj-');
    const file = path.join(root, 'deep', 'nested', 'Program.cs');
    write(file, '');

    expect(findCsprojSymbols(file)).toBeUndefined();
  });

  it('caches per starting directory and clearCsprojCache resets it', () => {
    const root = makeTempDir('shigan-csproj-');
    const file = path.join(root, 'Program.cs');
    write(file, '');
    write(path.join(root, 'App.csproj'), project('ALPHA'));

    const first = findCsprojSymbols(file);
    const second = findCsprojSymbols(file);

    expect(first?.symbols.has('ALPHA')).toBe(true);
    expect(second).toBe(first);

    // A stale cache must keep serving the old result until it is cleared.
    write(path.join(root, 'App.csproj'), project('BETA'));
    expect(findCsprojSymbols(file)).toBe(first);

    clearCsprojCache();
    const refreshed = findCsprojSymbols(file);

    expect(refreshed).not.toBe(first);
    expect(refreshed?.symbols.has('BETA')).toBe(true);
    expect(refreshed?.symbols.has('ALPHA')).toBe(false);
  });
});
