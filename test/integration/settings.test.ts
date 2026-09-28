import * as assert from 'assert';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as vscode from 'vscode';
import type { ComputedHint } from './support';
import {
  applyBaseline,
  computedHints,
  delay,
  restoreTouched,
  set,
} from './support';

const MAIN = 'int main(void) {\n}\n';
const MACRO_ONLY = '#if X\n\n#else\n\n#endif\n';
const DEAD_BRACKETS = 'int g(void) {\n#if 0\n}\n#endif\nint h(void) {\n}\n';
const DEAD_BLOCK = '#if 0\nint a;\n#endif\n';
const FLAG_BLOCK = '#if X\nint a;\n#endif\n';
const FILE_DEFINE = '#define X 1\n#if X\nint a;\n#elif 0\nint b;\n#endif\n';
const A_ONLY_BLOCK = '#if A_ONLY\nint a;\n#endif\n';
const B_ONLY_BLOCK = '#if B_ONLY\nint b;\n#endif\n';

/** Every setting gets one test that proves its effect on the rendered hints. */
suite('Shigan settings', () => {
  let fixtureDir = '';

  suiteSetup(async () => {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    assert.ok(root, 'the test workspace folder is missing');

    fixtureDir = join(root, 'fixture', 'settings');
    mkdirSync(fixtureDir, { recursive: true });
    writeFileSync(join(fixtureDir, 'flag-inherit.c'), '#if FEATURE\nint a;\n#endif\n');
    writeFileSync(join(fixtureDir, 'flag-a.c'), A_ONLY_BLOCK);
    writeFileSync(join(fixtureDir, 'flag-b.c'), B_ONLY_BLOCK);
    writeFileSync(
      join(fixtureDir, 'compile_commands.json'),
      JSON.stringify([
        {
          directory: fixtureDir,
          file: 'flag-inherit.c',
          command: 'cc -DFEATURE -c flag-inherit.c',
        },
        {
          directory: fixtureDir,
          file: 'flag-a.c',
          command: 'cc -DA_ONLY -c flag-a.c',
        },
        {
          directory: fixtureDir,
          file: 'flag-b.c',
          command: 'cc -DB_ONLY -c flag-b.c',
        },
      ])
    );

    // Start from a known state, even if a previous run left settings behind.
    await applyBaseline();
  });

  suiteTeardown(async () => {
    if (fixtureDir) rmSync(fixtureDir, { recursive: true, force: true });
    await applyBaseline();
  });

  teardown(async () => {
    await restoreTouched();
  });

  test('shigan.enable = false disables everything', async () => {
    await set('enable', false);
    assert.deepStrictEqual(await hintsFor(MAIN), []);
  });

  test('shigan.languages restricts the active languages', async () => {
    await set('languages', ['cpp']);
    assert.deepStrictEqual(await hintsFor(MAIN), []);
  });

  test('shigan.show selects the kinds', async () => {
    await set('show', ['macros']);
    assert.deepStrictEqual(await hintsFor(MAIN), [], 'brackets should be hidden');
    const macros = await hintsFor(MACRO_ONLY);
    assert.ok(macros.length > 0, `macros should stay: ${JSON.stringify(macros)}`);

    await set('show', ['brackets']);
    assert.deepStrictEqual(await hintsFor(MACRO_ONLY), [], 'macros should be hidden');
    const brackets = await hintsFor(MAIN);
    assert.ok(brackets.length > 0, `brackets should stay: ${JSON.stringify(brackets)}`);

    await set('show', []);
    assert.deepStrictEqual(await hintsFor(MAIN), []);
  });

  test('shigan.showRange and shigan.showRangeThreshold', async () => {
    await set('showRange', false);
    assert.strictEqual((await hintsFor(MAIN))[0]?.text.trim(), '<- int main(void)');

    await set('showRange', true);
    await set('showRangeThreshold', 1);
    // The pair spans one line, so the threshold hides the range.
    assert.strictEqual((await hintsFor(MAIN))[0]?.text.trim(), '<- int main(void)');

    await set('showRangeThreshold', 0);
    assert.strictEqual((await hintsFor(MAIN))[0]?.text.trim(), '<- :1-2 int main(void)');
  });

  test('shigan.showLabel', async () => {
    await set('showLabel', false);
    assert.strictEqual((await hintsFor(MAIN))[0]?.text.trim(), '<- :1-2');
  });

  test('shigan.preprocessor.skipInactiveBrackets', async () => {
    const withSkip = await hintsFor(DEAD_BRACKETS);
    assert.deepStrictEqual(
      withSkip.filter((hint) => hint.kind === 'bracket').map((hint) => [hint.line, hint.inactive]),
      [[5, false]],
      `the bracket in the dead branch should be dropped: ${JSON.stringify(withSkip)}`
    );

    await set('preprocessor.skipInactiveBrackets', false);
    const withoutSkip = await hintsFor(DEAD_BRACKETS);
    assert.deepStrictEqual(
      withoutSkip
        .filter((hint) => hint.kind === 'bracket')
        .map((hint) => [hint.line, hint.inactive]),
      [
        [2, true],
        [5, false],
      ],
      `the dead pair should come back, flagged inactive: ${JSON.stringify(withoutSkip)}`
    );
  });

  test('shigan.preprocessor.skipInactiveDirectives', async () => {
    const shown = await hintsFor(DEAD_BLOCK);
    assert.strictEqual(shown.length, 1, `shown by default: ${JSON.stringify(shown)}`);

    await set('preprocessor.skipInactiveDirectives', true);
    assert.deepStrictEqual(await hintsFor(DEAD_BLOCK), []);
  });

  test('shigan.preprocessor.markInactive', async () => {
    const flagged = await hintsFor(DEAD_BLOCK);
    assert.strictEqual(flagged[0]?.inactive, true, JSON.stringify(flagged));

    await set('preprocessor.markInactive', false);
    const plain = await hintsFor(DEAD_BLOCK);
    assert.strictEqual(plain.length, 1, JSON.stringify(plain));
    assert.strictEqual(plain[0].inactive, false);
  });

  test('shigan.preprocessor.trackFileDefines', async () => {
    const tracked = await hintsFor(FILE_DEFINE);
    assert.deepStrictEqual(
      tracked.map((hint) => [hint.line, hint.inactive]),
      [
        [3, false],
        [5, false],
      ],
      `the in-file #define makes the first branch live: ${JSON.stringify(tracked)}`
    );

    await set('preprocessor.trackFileDefines', false);
    const untracked = await hintsFor(FILE_DEFINE);
    assert.deepStrictEqual(
      untracked.map((hint) => [hint.line, hint.inactive]),
      [
        [3, true],
        [5, true],
      ],
      `without tracking every branch is dead: ${JSON.stringify(untracked)}`
    );
  });

  test('shigan.compileFlags', async () => {
    const without = await hintsFor(FLAG_BLOCK);
    assert.strictEqual(without[0]?.inactive, true, JSON.stringify(without));

    await set('compileFlags', ['-DX']);
    const withFlag = await hintsFor(FLAG_BLOCK);
    assert.strictEqual(withFlag.length, 1, JSON.stringify(withFlag));
    assert.strictEqual(withFlag[0].inactive, false);
  });

  test('shigan.inheritCompileCommands', async () => {
    await set('inheritCompileCommands', false);
    const without = await hintsForFile('flag-inherit.c');
    assert.strictEqual(without[0]?.inactive, true, JSON.stringify(without));

    await set('inheritCompileCommands', true);
    const withFlags = await hintsForFile('flag-inherit.c');
    assert.strictEqual(withFlags.length, 1, JSON.stringify(withFlags));
    assert.strictEqual(
      withFlags[0].inactive,
      false,
      'the flags from compile_commands.json should apply'
    );
  });

  test('shigan.inheritCompileCommands keeps per-file flags apart', async () => {
    await set('inheritCompileCommands', true);
    // Open a then b: both live in the same directory, so a per-directory cache
    // holding a per-file answer would let a's flags leak into b.
    const a = await hintsForFile('flag-a.c');
    const b = await hintsForFile('flag-b.c');
    assert.deepStrictEqual(
      { a: a.map((hint) => [hint.line, hint.inactive]), b: b.map((hint) => [hint.line, hint.inactive]) },
      { a: [[2, false]], b: [[2, false]] },
      `each file should see only its own flag: ${JSON.stringify({ a, b })}`
    );
  });
});

async function hintsFor(content: string): Promise<ComputedHint[]> {
  const document = await vscode.workspace.openTextDocument({ language: 'c', content });
  await vscode.window.showTextDocument(document);
  await delay(20);
  return computedHints();
}

async function hintsForFile(name: string): Promise<ComputedHint[]> {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  assert.ok(root, 'the test workspace folder is missing');
  const document = await vscode.workspace.openTextDocument(
    vscode.Uri.file(join(root, 'fixture', 'settings', name))
  );
  await vscode.window.showTextDocument(document);
  await delay(20);
  return computedHints();
}

