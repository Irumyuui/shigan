import * as assert from 'assert';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as vscode from 'vscode';
import { applyBaseline, bracketAt, computedHints, openFixture, restoreTouched } from './support';

/**
 * Fixture body. Line numbers the assertions rely on are pinned down here:
 *
 * probe.cpp : 9 = close of the inner pair, 11 = close of `main`, 2 = raw string.
 */
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

suite('Shigan C++', () => {
  let fixtureDir = '';

  suiteSetup(async () => {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    assert.ok(root, 'the test workspace folder is missing');

    fixtureDir = join(root, 'fixture', 'cpp');
    mkdirSync(fixtureDir, { recursive: true });
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
    await restoreTouched();
  });

  test('C++ raw strings are opaque', async () => {
    const document = await openFixture(fixtureDir, 'probe.cpp', 'cpp');
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
