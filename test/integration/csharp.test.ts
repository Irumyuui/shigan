import * as assert from 'assert';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as vscode from 'vscode';
import {
  applyBaseline,
  bracketAt,
  computedHints,
  macroAt,
  openFixture,
  restoreTouched,
  set,
} from './support';

/**
 * Fixture bodies. Line numbers the assertions rely on are pinned down here:
 *
 * probe.cs  : 10 = close of the `#if DEBUG` body, 15 = close of the `#else`
 *             body, 21 = close of the `#if LOCALONLY` body, 24 = close of the
 *             class body, 3 = the `@"a } b"` verbatim string line.
 */
const CSHARP_PROBE = [
  '#define LOCALONLY',
  'class Probe',
  '{',
  '    string verbatim = @"a } b";',
  '    void Debug()',
  '    {',
  '#if DEBUG',
  '        int a = 0;',
  '        {',
  '            a++;',
  '        }',
  '#else',
  '        int b = 0;',
  '        {',
  '            b++;',
  '        }',
  '#endif',
  '#if LOCALONLY',
  '        int c = 0;',
  '        {',
  '            c++;',
  '        }',
  '#endif',
  '    }',
  '}',
].join('\n');

const CSPROJ = [
  '<Project Sdk="Microsoft.NET.Sdk">',
  '  <PropertyGroup>',
  '    <TargetFramework>net8.0</TargetFramework>',
  '  </PropertyGroup>',
  '  <PropertyGroup Condition=" \'$(Configuration)\' == \'Debug\' ">',
  '    <DefineConstants>DEBUG;TRACE</DefineConstants>',
  '  </PropertyGroup>',
  '  <PropertyGroup Condition=" \'$(Configuration)\' == \'Release\' ">',
  '    <DefineConstants>RELEASE_ONLY</DefineConstants>',
  '  </PropertyGroup>',
  '</Project>',
].join('\n');

/**
 * C# settings probe. Pinned lines: 6 = close of the `#if VIA_SETTING` body,
 * 11 = its `#else` body, 17/22 = VIACOMPILER if/else, 28/33 = RELEASE_ONLY
 * if/else, 39/44 = NET8_0_OR_GREATER if/else.
 */
const SETTINGS_PROBE = [
  'class SettingsProbe',
  '{',
  '#if VIA_SETTING',
  '    void ViaSetting()',
  '    {',
  '        int a = 0;',
  '    }',
  '#else',
  '    void ViaSettingElse()',
  '    {',
  '        int b = 0;',
  '    }',
  '#endif',
  '#if VIACOMPILER',
  '    void ViaCompiler()',
  '    {',
  '        int c = 0;',
  '    }',
  '#else',
  '    void ViaCompilerElse()',
  '    {',
  '        int d = 0;',
  '    }',
  '#endif',
  '#if RELEASE_ONLY',
  '    void ReleaseOnly()',
  '    {',
  '        int e = 0;',
  '    }',
  '#else',
  '    void ReleaseElse()',
  '    {',
  '        int f = 0;',
  '    }',
  '#endif',
  '#if NET8_0_OR_GREATER',
  '    void Net8()',
  '    {',
  '        int g = 0;',
  '    }',
  '#else',
  '    void Net8Else()',
  '    {',
  '        int h = 0;',
  '    }',
  '#endif',
  '}',
].join('\n');

/**
 * Types probe. Pinned lines: 0 = `#region`, 6 = `#endregion`; the class `{` is
 * on line 4 with a wrapped base list above it (`class Foo` on line 1).
 */
const TYPES_PROBE = [
  '#region Wrapped',
  'class Foo',
  '    : Bar,',
  '        IBaz',
  '{',
  '}',
  '#endregion',
].join('\n');

suite('Shigan C#', () => {
  let fixtureDir = '';

  suiteSetup(async () => {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    assert.ok(root, 'the test workspace folder is missing');

    fixtureDir = join(root, 'fixture', 'csharp');
    mkdirSync(fixtureDir, { recursive: true });
    writeFileSync(join(fixtureDir, 'LangProbe.csproj'), CSPROJ);
    writeFileSync(join(fixtureDir, 'probe.cs'), CSHARP_PROBE);
    writeFileSync(join(fixtureDir, 'probe-settings.cs'), SETTINGS_PROBE);
    writeFileSync(join(fixtureDir, 'probe-types.cs'), TYPES_PROBE);

    // Best effort: make sure the command exists before the first query.
    const extension = vscode.extensions.getExtension('miyana-tobari.shigan');
    if (extension && !extension.isActive) await extension.activate();

    await applyBaseline();
  });

  suiteTeardown(async () => {
    if (fixtureDir) rmSync(fixtureDir, { recursive: true, force: true });
    await applyBaseline();
  });

  teardown(async () => {
    await restoreTouched();
  });

  test('C# project DefineConstants drive #if DEBUG', async () => {
    // Match inactive branches too, so their hints are observable (flagged
    // `inactive`) instead of being dropped from the matching.
    await set('preprocessor.skipInactiveBrackets', false);

    const document = await openFixture(fixtureDir, 'probe.cs', 'csharp');
    assert.strictEqual(document.languageId, 'csharp');

    const withProject = await computedHints();
    const debug = bracketAt(withProject, 10);
    const otherwise = bracketAt(withProject, 15);
    assert.ok(debug, `the #if DEBUG body should be hinted: ${JSON.stringify(withProject)}`);
    assert.strictEqual(debug.inactive, false, 'DEBUG comes from the csproj, so the branch is live');
    assert.ok(otherwise, `the #else body should be hinted: ${JSON.stringify(withProject)}`);
    assert.strictEqual(otherwise.inactive, true, 'the #else branch is inactive while DEBUG is defined');

    await set('csharp.inheritProject', false);
    const withoutProject = await computedHints();
    const debugAfter = bracketAt(withoutProject, 10);
    const otherwiseAfter = bracketAt(withoutProject, 15);
    assert.ok(
      debugAfter && otherwiseAfter,
      `both branches should still be matched: ${JSON.stringify(withoutProject)}`
    );
    assert.strictEqual(debugAfter.inactive, true, 'the DEBUG branch flips to inactive');
    assert.strictEqual(otherwiseAfter.inactive, false, 'the #else branch becomes live');
  });

  test('a value-less #define makes #if LOCALONLY live', async () => {
    await openFixture(fixtureDir, 'probe.cs', 'csharp');
    const hints = await computedHints();
    const local = bracketAt(hints, 21);
    assert.ok(local, `the #if LOCALONLY body should be hinted: ${JSON.stringify(hints)}`);
    assert.strictEqual(local.inactive, false, 'value-less #define LOCALONLY should count as defined');
  });

  test('C# verbatim strings are opaque', async () => {
    await openFixture(fixtureDir, 'probe.cs', 'csharp');
    const hints = await computedHints();

    assert.strictEqual(
      bracketAt(hints, 3),
      undefined,
      `no pair should end inside @"a } b": ${JSON.stringify(hints)}`
    );
    const realPair = bracketAt(hints, 24);
    assert.ok(realPair, `the class pair should still be hinted: ${JSON.stringify(hints)}`);
    assert.strictEqual(realPair.target?.line, 2, 'the class pair should open on line 3');
  });

  test('shigan.csharp.define selects #if symbols', async () => {
    // Match inactive branches too, so the flag is observable rather than the
    // hint being dropped (`skipInactiveBrackets` defaults to true).
    await set('preprocessor.skipInactiveBrackets', false);
    await openFixture(fixtureDir, 'probe-settings.cs', 'csharp');

    const before = bracketAt(await computedHints(), 6);
    assert.ok(before, 'the #if VIA_SETTING body should be hinted');
    assert.strictEqual(before.inactive, true, 'VIA_SETTING is not defined yet');

    await set('csharp.define', ['VIA_SETTING']);
    const after = bracketAt(await computedHints(), 6);
    assert.ok(after, 'the #if VIA_SETTING body should still be hinted');
    assert.strictEqual(after.inactive, false, 'csharp.define should make the branch live');
  });

  test('shigan.compileFlags select #if symbols for C#', async () => {
    await set('preprocessor.skipInactiveBrackets', false);
    await openFixture(fixtureDir, 'probe-settings.cs', 'csharp');

    const before = bracketAt(await computedHints(), 17);
    assert.ok(before, 'the #if VIACOMPILER body should be hinted');
    assert.strictEqual(before.inactive, true, 'VIACOMPILER is not defined yet');

    await set('compileFlags', ['-DVIACOMPILER']);
    const after = bracketAt(await computedHints(), 17);
    assert.ok(after, 'the #if VIACOMPILER body should still be hinted');
    assert.strictEqual(after.inactive, false, 'compileFlags should make the branch live');
  });

  test('shigan.csharp.targetFramework drives implicit framework symbols', async () => {
    await set('preprocessor.skipInactiveBrackets', false);
    await openFixture(fixtureDir, 'probe-settings.cs', 'csharp');

    const inherited = bracketAt(await computedHints(), 39);
    assert.ok(inherited, 'the #if NET8_0_OR_GREATER body should be hinted');
    assert.strictEqual(inherited.inactive, false, 'net8.0 from the csproj defines NET8_0_OR_GREATER');

    await set('csharp.targetFramework', 'netstandard2.0');
    const overridden = bracketAt(await computedHints(), 39);
    assert.ok(overridden, 'the #if NET8_0_OR_GREATER body should still be hinted');
    assert.strictEqual(overridden.inactive, true, 'netstandard2.0 has no NET8_0_OR_GREATER');
  });

  test('shigan.csharp.configuration selects the project PropertyGroup', async () => {
    await set('preprocessor.skipInactiveBrackets', false);
    await openFixture(fixtureDir, 'probe-settings.cs', 'csharp');

    const debug = bracketAt(await computedHints(), 28);
    assert.ok(debug, 'the #if RELEASE_ONLY body should be hinted');
    assert.strictEqual(debug.inactive, true, 'RELEASE_ONLY belongs to the Release group');

    await set('csharp.configuration', 'Release');
    const release = bracketAt(await computedHints(), 28);
    assert.ok(release, 'the #if RELEASE_ONLY body should still be hinted');
    assert.strictEqual(release.inactive, false, 'the Release group defines RELEASE_ONLY');
  });

  test('#region pairs with #endregion', async () => {
    await openFixture(fixtureDir, 'probe-types.cs', 'csharp');
    const hints = await computedHints();

    const endregion = macroAt(hints, 6);
    assert.ok(endregion, `the #endregion should be hinted: ${JSON.stringify(hints)}`);
    assert.ok(
      endregion.text.includes('#region'),
      `the hint should reference the region: ${endregion.text}`
    );
    assert.strictEqual(endregion.target?.line, 0, 'the hint should jump to the #region');
  });

  test('a wrapped declaration is labelled by its class line', async () => {
    await openFixture(fixtureDir, 'probe-types.cs', 'csharp');
    const hints = await computedHints();

    const classPair = bracketAt(hints, 5);
    assert.ok(classPair, `the class pair should be hinted: ${JSON.stringify(hints)}`);
    assert.ok(
      classPair.text.includes('class') && classPair.text.includes('Foo'),
      `the label should be the class declaration: ${classPair.text}`
    );
    assert.ok(
      !classPair.text.includes('IBaz'),
      `the base-list continuation should not be the label: ${classPair.text}`
    );
    assert.strictEqual(classPair.target?.line, 4, 'the pair should open on the lone `{`');
  });
});
