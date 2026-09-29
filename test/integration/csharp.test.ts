import * as assert from 'assert';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as vscode from 'vscode';
import type { ComputedHint } from './support';
import {
  applyBaseline,
  bracketAt,
  computedHints,
  createFixtureSuite,
  macroAt,
  openFixture,
  pollHints,
  pollUntil,
  restoreWorkspaceSettings,
  set,
  withWorkspaceWritable,
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

createFixtureSuite(
  'Shigan C#',
  {
    'LangProbe.csproj': CSPROJ,
    'probe.cs': CSHARP_PROBE,
    'probe-settings.cs': SETTINGS_PROBE,
    'probe-types.cs': TYPES_PROBE,
  },
  (fixture) => {
  test('C# project DefineConstants drive #if DEBUG', async () => {
    // Match inactive branches too, so their hints are observable (flagged
    // `inactive`) instead of being dropped from the matching.
    await set('inactive.skipBrackets', false);

    const document = await openFixture(fixture.dir, 'probe.cs', 'csharp');
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
    await openFixture(fixture.dir, 'probe.cs', 'csharp');
    const hints = await computedHints();
    const local = bracketAt(hints, 21);
    assert.ok(local, `the #if LOCALONLY body should be hinted: ${JSON.stringify(hints)}`);
    assert.strictEqual(local.inactive, false, 'value-less #define LOCALONLY should count as defined');
  });

  test('C# verbatim strings are opaque', async () => {
    await openFixture(fixture.dir, 'probe.cs', 'csharp');
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
    await set('inactive.skipBrackets', false);
    await openFixture(fixture.dir, 'probe-settings.cs', 'csharp');

    const before = bracketAt(await computedHints(), 6);
    assert.ok(before, 'the #if VIA_SETTING body should be hinted');
    assert.strictEqual(before.inactive, true, 'VIA_SETTING is not defined yet');

    await set('csharp.define', ['VIA_SETTING']);
    const after = bracketAt(await computedHints(), 6);
    assert.ok(after, 'the #if VIA_SETTING body should still be hinted');
    assert.strictEqual(after.inactive, false, 'csharp.define should make the branch live');
  });

  test('shigan.csharp.compileFlags select #if symbols for C#', async () => {
    await set('inactive.skipBrackets', false);
    await openFixture(fixture.dir, 'probe-settings.cs', 'csharp');

    const before = bracketAt(await computedHints(), 17);
    assert.ok(before, 'the #if VIACOMPILER body should be hinted');
    assert.strictEqual(before.inactive, true, 'VIACOMPILER is not defined yet');

    await set('csharp.compileFlags', ['-DVIACOMPILER']);
    const after = bracketAt(await computedHints(), 17);
    assert.ok(after, 'the #if VIACOMPILER body should still be hinted');
    assert.strictEqual(after.inactive, false, 'csharp.compileFlags should make the branch live');
  });

  test('shigan.csharp.targetFramework drives implicit framework symbols', async () => {
    await set('inactive.skipBrackets', false);
    await openFixture(fixture.dir, 'probe-settings.cs', 'csharp');

    const inherited = bracketAt(await computedHints(), 39);
    assert.ok(inherited, 'the #if NET8_0_OR_GREATER body should be hinted');
    assert.strictEqual(inherited.inactive, false, 'net8.0 from the csproj defines NET8_0_OR_GREATER');

    await set('csharp.targetFramework', 'netstandard2.0');
    const overridden = bracketAt(await computedHints(), 39);
    assert.ok(overridden, 'the #if NET8_0_OR_GREATER body should still be hinted');
    assert.strictEqual(overridden.inactive, true, 'netstandard2.0 has no NET8_0_OR_GREATER');
  });

  test('shigan.csharp.configuration selects the project PropertyGroup', async () => {
    await set('inactive.skipBrackets', false);
    await openFixture(fixture.dir, 'probe-settings.cs', 'csharp');

    const debug = bracketAt(await computedHints(), 28);
    assert.ok(debug, 'the #if RELEASE_ONLY body should be hinted');
    assert.strictEqual(debug.inactive, true, 'RELEASE_ONLY belongs to the Release group');

    await set('csharp.configuration', 'Release');
    const release = bracketAt(await computedHints(), 28);
    assert.ok(release, 'the #if RELEASE_ONLY body should still be hinted');
    assert.strictEqual(release.inactive, false, 'the Release group defines RELEASE_ONLY');
  });

  test('#region pairs with #endregion', async () => {
    await openFixture(fixture.dir, 'probe-types.cs', 'csharp');
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
    await openFixture(fixture.dir, 'probe-types.cs', 'csharp');
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
}, { dirName: 'csharp' });

/**
 * Watcher fixtures. `watch.cs` pins line 7 as the close of the `#if DEBUG`
 * method body, so its `inactive` flag tracks whether the csproj's DEBUG symbol
 * is visible.
 */
const WATCH_PROBE = [
  'class Watch',
  '{',
  '#if DEBUG',
  '    void Debug()',
  '    {',
  '        int a = 0;',
  '        a++;',
  '    }',
  '#else',
  '    void Otherwise()',
  '    {',
  '        int b = 0;',
  '        b++;',
  '    }',
  '#endif',
  '}',
].join('\n');

/** Close of the `#if DEBUG` body in {@link WATCH_PROBE}. */
const WATCH_DEBUG_BODY_CLOSE = 7;

const WATCH_CSPROJ_DEBUG = [
  '<Project Sdk="Microsoft.NET.Sdk">',
  '  <PropertyGroup>',
  '    <TargetFramework>net8.0</TargetFramework>',
  '  </PropertyGroup>',
  '  <PropertyGroup Condition=" \'$(Configuration)\' == \'Debug\' ">',
  '    <DefineConstants>DEBUG</DefineConstants>',
  '  </PropertyGroup>',
  '</Project>',
].join('\n');

/** The same project without DEBUG, so the branch flips inactive. */
const WATCH_CSPROJ_NO_DEBUG = [
  '<Project Sdk="Microsoft.NET.Sdk">',
  '  <PropertyGroup>',
  '    <TargetFramework>net8.0</TargetFramework>',
  '  </PropertyGroup>',
  '</Project>',
].join('\n');

createFixtureSuite(
  'Shigan C# project watching',
  { 'watch.cs': WATCH_PROBE },
  (fixture) => {
  test('editing Watch.csproj flips the #if DEBUG body without a reload', async () => {
    await set('inactive.skipBrackets', false);
    writeFileSync(join(fixture.dir, 'Watch.csproj'), WATCH_CSPROJ_DEBUG);
    await openFixture(fixture.dir, 'watch.cs', 'csharp');
    await waitForDebugBranch(false, 'DEBUG defined by the csproj');

    // The file stays present, only its symbols change: the watcher must notice.
    writeFileSync(join(fixture.dir, 'Watch.csproj'), WATCH_CSPROJ_NO_DEBUG);
    await waitForDebugBranch(true, 'DEBUG removed but the csproj kept');
  });

  test('deleting Watch.csproj drops the project symbols', async () => {
    await set('inactive.skipBrackets', false);
    // Force fresh watcher events regardless of what a previous test left behind.
    rmSync(join(fixture.dir, 'Watch.csproj'), { force: true });
    writeFileSync(join(fixture.dir, 'Watch.csproj'), WATCH_CSPROJ_DEBUG);
    await openFixture(fixture.dir, 'watch.cs', 'csharp');
    await waitForDebugBranch(false, 'DEBUG defined by the csproj');

    rmSync(join(fixture.dir, 'Watch.csproj'), { force: true });
    await waitForDebugBranch(true, 'the csproj was deleted');
  });

  test('creating Watch.csproj defines DEBUG without a reload', async () => {
    await set('inactive.skipBrackets', false);
    // Deterministic "no project" start: even if an earlier test failed before
    // its own delete (or left a stale project cache), writing then removing the
    // csproj guarantees the watcher fires and the cache is cleared.
    const csprojPath = join(fixture.dir, 'Watch.csproj');
    writeFileSync(csprojPath, WATCH_CSPROJ_NO_DEBUG);
    rmSync(csprojPath, { force: true });
    await openFixture(fixture.dir, 'watch.cs', 'csharp');
    await waitForDebugBranch(true, 'no csproj at all');

    writeFileSync(csprojPath, WATCH_CSPROJ_DEBUG);
    await waitForDebugBranch(false, 'the csproj was created with DEBUG');
  });
}, { dirName: 'watch' });

const MULTIROOT_NAME = 'shigan-multiroot';

/**
 * Multi-root watcher coverage. `updateWorkspaceFolders` restarts the extension
 * host when the FIRST folder changes or when a single-folder workspace turns
 * multi-root, and a restart kills this in-host run. The harness therefore starts
 * multi-root (see `.vscode-test.mjs`) and this suite only adds/removes a
 * NON-first sibling folder, which VS Code applies without a restart. Do not
 * "simplify" this into a single-folder run later.
 *
 * The point: with the folder added at runtime, the extension's
 * `onDidChangeWorkspaceFolders` handler must re-run `disposeCsprojWatchers()` +
 * `watchCsprojFiles()`; otherwise nothing watches the new root and the rewrite
 * below would never invalidate the csproj cache.
 */
suite('Shigan C# project watching (multi-root)', () => {
  let multirootDir = '';

  suiteSetup(async () => {
    const folders = vscode.workspace.workspaceFolders;
    assert.ok(folders && folders.length >= 2, 'the host must start multi-root for this suite');

    // Sibling of the primary workspace folder: VS Code refuses nested folders.
    multirootDir = join(folders[0].uri.fsPath, '..', 'workspace-multiroot');
    mkdirSync(multirootDir, { recursive: true });
    writeFileSync(join(multirootDir, 'Multi.csproj'), WATCH_CSPROJ_DEBUG);
    writeFileSync(join(multirootDir, 'multi.cs'), WATCH_PROBE);

    const extension = vscode.extensions.getExtension('miyana-tobari.shigan');
    if (extension && !extension.isActive) await extension.activate();

    const added = vscode.workspace.updateWorkspaceFolders(folders.length, 0, {
      uri: vscode.Uri.file(multirootDir),
      name: MULTIROOT_NAME,
    });
    assert.strictEqual(added, true, 'adding a non-first workspace folder should be accepted');

    await pollUntil(
      () => (vscode.workspace.workspaceFolders?.length ?? 0) === folders.length + 1,
      'the added workspace folder should appear'
    );

    await withWorkspaceWritable(async () => {
      await applyBaseline();
      await set('inactive.skipBrackets', false);
    });
  });

  suiteTeardown(async () => {
    // Must run even after a failing test: never leave the extra folder behind.
    try {
      if (multirootDir) {
        const folders = vscode.workspace.workspaceFolders ?? [];
        const index = folders.findIndex(
          (folder) => folder.name === MULTIROOT_NAME || folder.uri.fsPath === multirootDir
        );
        // Never remove index 0: that would restart the host mid-run.
        if (index > 0) {
          const before = folders.length;
          vscode.workspace.updateWorkspaceFolders(index, 1);
          await pollUntil(
            () => (vscode.workspace.workspaceFolders?.length ?? 0) === before - 1,
            'the added workspace folder should be removed'
          );
        }
      }
    } finally {
      if (multirootDir) rmSync(multirootDir, { recursive: true, force: true });
      await withWorkspaceWritable(restoreWorkspaceSettings);
    }
  });

  test('adding a workspace folder rebuilds the csproj watcher', async () => {
    await set('inactive.skipBrackets', false);
    await openFixture(multirootDir, 'multi.cs', 'csharp');
    await waitForDebugBranch(false, 'DEBUG defined by Multi.csproj');

    // Only a watcher covering the newly added root can observe this rewrite.
    writeFileSync(join(multirootDir, 'Multi.csproj'), WATCH_CSPROJ_NO_DEBUG);
    await waitForDebugBranch(true, 'DEBUG removed from Multi.csproj');
  });
});

function waitForDebugBranch(inactive: boolean, label: string): Promise<ComputedHint[]> {
  return pollHints(
    (hints) => bracketAt(hints, WATCH_DEBUG_BODY_CLOSE)?.inactive === inactive,
    `${label}: expected the #if DEBUG body to be ${inactive ? 'inactive' : 'live'}`
  );
}
