import * as assert from 'assert';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as vscode from 'vscode';

interface ComputedHint {
  line: number;
  text: string;
  kind: string;
  inactive: boolean;
  target?: { line: number; col: number };
}

/**
 * Fixture bodies. Line numbers the assertions rely on are pinned down here:
 *
 * probe.cs  : 10 = close of the `#if DEBUG` body, 15 = close of the `#else`
 *             body, 21 = close of the `#if LOCALONLY` body, 24 = close of the
 *             class body, 3 = the `@"a } b"` verbatim string line.
 * probe.cpp : 9 = close of the inner pair, 11 = close of `main`, 2 = raw string.
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

const CPP_PROBE = [
  '#include <string>',
  '',
  'std::string raw = R"( { ( )";',
  '',
  'int main()',
  '{',
  '    int a = 0;',
  '    {',
  '        a++;',
  '    }',
  '    return a;',
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
  '</Project>',
].join('\n');

/** Same explicit defaults as settings.test.ts; written back, never removed. */
const BASELINE: Record<string, unknown> = {
  enable: true,
  languages: ['c', 'cpp', 'csharp'],
  trigger: 'always',
  show: ['brackets', 'macros'],
  compileFlags: [],
  inheritCompileCommands: false,
  'csharp.define': [],
  'csharp.inheritProject': true,
  'csharp.configuration': 'Debug',
  'csharp.targetFramework': '',
  'preprocessor.trackFileDefines': true,
  'preprocessor.skipInactiveBrackets': true,
  'preprocessor.skipInactiveDirectives': false,
  'preprocessor.markInactive': true,
  showRange: true,
  showRangeThreshold: 0,
  showLabel: true,
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const touched = new Set<string>();
let fixtureDir = '';

suite('Shigan language routing', () => {
  suiteSetup(async () => {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    assert.ok(root, 'the test workspace folder is missing');

    // A dedicated subdirectory keeps these fixtures from colliding with the
    // settings suite's `fixture/` directory (which it wipes recursively).
    fixtureDir = join(root, 'fixture', 'lang');
    mkdirSync(fixtureDir, { recursive: true });
    writeFileSync(join(fixtureDir, 'LangProbe.csproj'), CSPROJ);
    writeFileSync(join(fixtureDir, 'probe.cs'), CSHARP_PROBE);
    writeFileSync(join(fixtureDir, 'probe.cpp'), CPP_PROBE);

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
    const configuration = vscode.workspace.getConfiguration('shigan');
    for (const key of touched) {
      await configuration.update(key, BASELINE[key], vscode.ConfigurationTarget.Workspace);
    }
    touched.clear();
    await delay(80);
  });

  test('C# project DefineConstants drive #if DEBUG', async () => {
    // Match inactive branches too, so their hints are observable (flagged
    // `inactive`) instead of being dropped from the matching.
    await set('preprocessor.skipInactiveBrackets', false);

    const document = await openFixture('probe.cs', 'csharp');
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
    await openFixture('probe.cs', 'csharp');
    const hints = await computedHints();
    const local = bracketAt(hints, 21);
    assert.ok(local, `the #if LOCALONLY body should be hinted: ${JSON.stringify(hints)}`);
    assert.strictEqual(local.inactive, false, 'value-less #define LOCALONLY should count as defined');
  });

  test('C# verbatim strings are opaque', async () => {
    await openFixture('probe.cs', 'csharp');
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

  test('C++ raw strings are opaque', async () => {
    const document = await openFixture('probe.cpp', 'cpp');
    assert.strictEqual(document.languageId, 'cpp');

    const hints = await computedHints();
    const closes = hints
      .filter((hint) => hint.kind === 'bracket')
      .map((hint) => hint.line)
      .sort((a, b) => a - b);
    assert.deepStrictEqual(
      closes,
      [9, 11],
      `only the real pairs should be matched: ${JSON.stringify(hints)}`
    );

    const mainPair = bracketAt(hints, 11);
    assert.ok(mainPair, 'the real pair after the raw string should be hinted');
    assert.strictEqual(mainPair.target?.line, 5, 'the pair should open on the `{` after `int main()`');
  });
});

function configuration(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration('shigan');
}

async function applyBaseline(): Promise<void> {
  const config = configuration();
  for (const [key, value] of Object.entries(BASELINE)) {
    if (JSON.stringify(config.get(key)) === JSON.stringify(value)) continue;
    await config.update(key, value, vscode.ConfigurationTarget.Workspace);
  }
  await delay(150);
}

async function set(key: string, value: unknown): Promise<void> {
  touched.add(key);
  await configuration().update(key, value, vscode.ConfigurationTarget.Workspace);
  await delay(80);
}

async function openFixture(name: string, languageId: string): Promise<vscode.TextDocument> {
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(join(fixtureDir, name)));
  // The test host runs with `--disable-extensions`, so the built-in language
  // modes may not be registered. Setting the language explicitly keeps the
  // routing deterministic while still going through the real service path.
  if (document.languageId !== languageId) {
    await vscode.languages.setTextDocumentLanguage(document, languageId);
  }
  await vscode.window.showTextDocument(document);
  await delay(60);
  assert.strictEqual(document.languageId, languageId, 'the fixture should use the expected language');
  return document;
}

function bracketAt(hints: ComputedHint[], line: number): ComputedHint | undefined {
  return hints.find((hint) => hint.kind === 'bracket' && hint.line === line);
}

async function computedHints(): Promise<ComputedHint[]> {
  const hints = await vscode.commands.executeCommand<ComputedHint[]>(
    'shigan.internal.computedHints'
  );
  return hints ?? [];
}
