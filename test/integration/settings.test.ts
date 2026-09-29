import * as assert from 'assert';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as vscode from 'vscode';
import type { ComputedHint } from './support';
import { computedHints, createFixtureSuite, delay, openFixture, set } from './support';

const MAIN = 'int main(void) {\n}\n';
const MACRO_ONLY = '#if X\n\n#else\n\n#endif\n';
const DEAD_BRACKETS = 'int g(void) {\n#if 0\n}\n#endif\nint h(void) {\n}\n';
const DEAD_BLOCK = '#if 0\nint a;\n#endif\n';
const FLAG_BLOCK = '#if X\nint a;\n#endif\n';
const FILE_DEFINE = '#define X 1\n#if X\nint a;\n#elif 0\nint b;\n#endif\n';
const A_ONLY_BLOCK = '#if A_ONLY\nint a;\n#endif\n';
const B_ONLY_BLOCK = '#if B_ONLY\nint b;\n#endif\n';
const C_FLAG_BLOCK = '#if C_FLAG\nint a;\n#endif\n';
const CPP_FLAG_BLOCK = '#if CPP_FLAG\nint a;\n#endif\n';
const C_INHERIT_BLOCK = '#if C_INHERIT\nint a;\n#endif\n';
const CPP_INHERIT_BLOCK = '#if CPP_INHERIT\nint a;\n#endif\n';

/** Line/inactive pairs of the macro hints, in order. */
function activity(hints: ComputedHint[]): Array<[number, boolean]> {
  return hints.map((hint) => [hint.line, hint.inactive]);
}

/** Every setting gets one test that proves its effect on the rendered hints. */
createFixtureSuite(
  'Shigan settings',
  {
    'flag-inherit.c': '#if FEATURE\nint a;\n#endif\n',
    'flag-a.c': A_ONLY_BLOCK,
    'flag-b.c': B_ONLY_BLOCK,
    'lang-c.c': C_FLAG_BLOCK,
    'lang-cpp.cpp': CPP_FLAG_BLOCK,
    'track.c': FILE_DEFINE,
    'track.cpp': FILE_DEFINE,
    'track.cs': FILE_DEFINE,
    'inherit-c.c': C_INHERIT_BLOCK,
    'inherit-cpp.cpp': CPP_INHERIT_BLOCK,
  },
  (fixture) => {
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
    assert.deepStrictEqual(
      await hintsFor(MACRO_ONLY),
      [],
      'an empty show list must hide macro hints too'
    );
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

  test('shigan.inactive.skipBrackets', async () => {
    const withSkip = await hintsFor(DEAD_BRACKETS);
    assert.deepStrictEqual(
      withSkip.filter((hint) => hint.kind === 'bracket').map((hint) => [hint.line, hint.inactive]),
      [[5, false]],
      `the bracket in the dead branch should be dropped: ${JSON.stringify(withSkip)}`
    );

    await set('inactive.skipBrackets', false);
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

  test('shigan.inactive.skipDirectives', async () => {
    const shown = await hintsFor(DEAD_BLOCK);
    assert.strictEqual(shown.length, 1, `shown by default: ${JSON.stringify(shown)}`);

    await set('inactive.skipDirectives', true);
    assert.deepStrictEqual(await hintsFor(DEAD_BLOCK), []);
  });

  test('shigan.inactive.markInactive', async () => {
    const flagged = await hintsFor(DEAD_BLOCK);
    assert.strictEqual(flagged[0]?.inactive, true, JSON.stringify(flagged));

    await set('inactive.markInactive', false);
    const plain = await hintsFor(DEAD_BLOCK);
    assert.strictEqual(plain.length, 1, JSON.stringify(plain));
    assert.strictEqual(plain[0].inactive, false);
  });

  test('shigan.c.trackFileDefines', async () => {
    const tracked = await hintsFor(FILE_DEFINE);
    assert.deepStrictEqual(
      activity(tracked),
      [
        [3, false],
        [5, false],
      ],
      `the in-file #define makes the first branch live: ${JSON.stringify(tracked)}`
    );

    await set('c.trackFileDefines', false);
    const untracked = await hintsFor(FILE_DEFINE);
    assert.deepStrictEqual(
      activity(untracked),
      [
        [3, true],
        [5, true],
      ],
      `without tracking every branch is dead: ${JSON.stringify(untracked)}`
    );
  });

  test('shigan.c.compileFlags', async () => {
    const without = await hintsFor(FLAG_BLOCK);
    assert.strictEqual(without[0]?.inactive, true, JSON.stringify(without));

    await set('c.compileFlags', ['-DX']);
    const withFlag = await hintsFor(FLAG_BLOCK);
    assert.strictEqual(withFlag.length, 1, JSON.stringify(withFlag));
    assert.strictEqual(withFlag[0].inactive, false);
  });

  test('shigan.c.inheritCompileCommands', async () => {
    await set('c.inheritCompileCommands', false);
    const without = await hintsForFile(fixture.dir, 'flag-inherit.c');
    assert.strictEqual(without[0]?.inactive, true, JSON.stringify(without));

    await set('c.inheritCompileCommands', true);
    const withFlags = await hintsForFile(fixture.dir, 'flag-inherit.c');
    assert.strictEqual(withFlags.length, 1, JSON.stringify(withFlags));
    assert.strictEqual(
      withFlags[0].inactive,
      false,
      'the flags from compile_commands.json should apply'
    );
  });

  test('shigan.c.inheritCompileCommands keeps per-file flags apart', async () => {
    await set('c.inheritCompileCommands', true);
    // Open a then b: both live in the same directory, so a per-directory cache
    // holding a per-file answer would let a's flags leak into b.
    const a = await hintsForFile(fixture.dir, 'flag-a.c');
    const b = await hintsForFile(fixture.dir, 'flag-b.c');
    assert.deepStrictEqual(
      { a: activity(a), b: activity(b) },
      { a: [[2, false]], b: [[2, false]] },
      `each file should see only its own flag: ${JSON.stringify({ a, b })}`
    );
  });

  test('per-language compileFlags stay independent between C and C++', async () => {
    await set('inactive.skipBrackets', false);
    await set('c.compileFlags', ['-DC_FLAG']);
    const c = await hintsForFile(fixture.dir, 'lang-c.c');
    assert.strictEqual(c[0]?.inactive, false, 'the C flag should make the C branch live');
    const cpp = await hintsForFile(fixture.dir, 'lang-cpp.cpp', 'cpp');
    assert.strictEqual(cpp[0]?.inactive, true, 'the C flag must not leak into C++');

    await set('c.compileFlags', []);
    await set('cpp.compileFlags', ['-DCPP_FLAG']);
    const cAfter = await hintsForFile(fixture.dir, 'lang-c.c');
    assert.strictEqual(cAfter[0]?.inactive, true, 'the C++ flag must not leak into C');
    const cppAfter = await hintsForFile(fixture.dir, 'lang-cpp.cpp', 'cpp');
    assert.strictEqual(cppAfter[0]?.inactive, false, 'the C++ flag should make the C++ branch live');
  });

  test('trackFileDefines is independent across C, C++ and C#', async () => {
    const languages = [
      ['track.c', 'c'],
      ['track.cpp', 'cpp'],
      ['track.cs', 'csharp'],
    ] as const;

    for (const [name, language] of languages) {
      assert.deepStrictEqual(
        activity(await hintsForFile(fixture.dir, name, language)),
        [
          [3, false],
          [5, false],
        ],
        `${language} should track the in-file #define by default`
      );
    }

    await set('c.trackFileDefines', false);
    assert.deepStrictEqual(activity(await hintsForFile(fixture.dir, 'track.c')), [
      [3, true],
      [5, true],
    ]);
    assert.deepStrictEqual(
      activity(await hintsForFile(fixture.dir, 'track.cpp', 'cpp')),
      [
        [3, false],
        [5, false],
      ],
      'C++ must be unaffected by shigan.c.trackFileDefines'
    );
    assert.deepStrictEqual(
      activity(await hintsForFile(fixture.dir, 'track.cs', 'csharp')),
      [
        [3, false],
        [5, false],
      ],
      'C# must be unaffected by shigan.c.trackFileDefines'
    );

    await set('c.trackFileDefines', true);
    await set('cpp.trackFileDefines', false);
    assert.deepStrictEqual(activity(await hintsForFile(fixture.dir, 'track.cpp', 'cpp')), [
      [3, true],
      [5, true],
    ]);
    assert.deepStrictEqual(
      activity(await hintsForFile(fixture.dir, 'track.c')),
      [
        [3, false],
        [5, false],
      ],
      'C must be unaffected by shigan.cpp.trackFileDefines'
    );

    await set('cpp.trackFileDefines', true);
    await set('csharp.trackFileDefines', false);
    assert.deepStrictEqual(activity(await hintsForFile(fixture.dir, 'track.cs', 'csharp')), [
      [3, true],
      [5, true],
    ]);
    assert.deepStrictEqual(
      activity(await hintsForFile(fixture.dir, 'track.cpp', 'cpp')),
      [
        [3, false],
        [5, false],
      ],
      'C++ must be unaffected by shigan.csharp.trackFileDefines'
    );
  });

  test('inheritCompileCommands enabled only for C does not inherit for C++', async () => {
    await set('inactive.skipBrackets', false);
    await set('c.inheritCompileCommands', true);

    const c = await hintsForFile(fixture.dir, 'inherit-c.c');
    assert.strictEqual(c[0]?.inactive, false, 'C should inherit its compile_commands flags');
    const cpp = await hintsForFile(fixture.dir, 'inherit-cpp.cpp', 'cpp');
    assert.strictEqual(
      cpp[0]?.inactive,
      true,
      'C++ inheritance is off, so it must not read compile_commands.json'
    );

    await set('cpp.inheritCompileCommands', true);
    const cppAfter = await hintsForFile(fixture.dir, 'inherit-cpp.cpp', 'cpp');
    assert.strictEqual(
      cppAfter[0]?.inactive,
      false,
      'enabling C++ inheritance makes the C++ branch live'
    );
  });

  test('retired setting ids are unregistered and silently ignored (no aliases)', async () => {
    const config = vscode.workspace.getConfiguration('shigan');
    // The pre-redesign ids are gone from the manifest; VS Code both reports
    // them as unknown and refuses to write them at all. The extension reads
    // only the new ids, so an old key can never change behaviour.
    assert.strictEqual(config.has('compileFlags'), false, 'shigan.compileFlags must not exist');
    assert.strictEqual(
      config.has('preprocessor.skipInactiveDirectives'),
      false,
      'shigan.preprocessor.* must not exist'
    );
    await assert.rejects(
      Promise.resolve(config.update('compileFlags', ['-DX'], vscode.ConfigurationTarget.Workspace)),
      /not a registered configuration/,
      'the retired shigan.compileFlags must be rejected'
    );

    await set('inactive.skipBrackets', false);
    const hints = await hintsFor(FLAG_BLOCK);
    assert.strictEqual(hints[0]?.inactive, true, JSON.stringify(hints));
  });
},
{
  dirName: 'settings',
  setup: (fixture) => {
    writeFileSync(
      join(fixture.dir, 'compile_commands.json'),
      JSON.stringify([
        {
          directory: fixture.dir,
          file: 'flag-inherit.c',
          command: 'cc -DFEATURE -c flag-inherit.c',
        },
        {
          directory: fixture.dir,
          file: 'flag-a.c',
          command: 'cc -DA_ONLY -c flag-a.c',
        },
        {
          directory: fixture.dir,
          file: 'flag-b.c',
          command: 'cc -DB_ONLY -c flag-b.c',
        },
        {
          directory: fixture.dir,
          file: 'inherit-c.c',
          command: 'cc -DC_INHERIT -c inherit-c.c',
        },
        {
          directory: fixture.dir,
          file: 'inherit-cpp.cpp',
          command: 'c++ -DCPP_INHERIT -c inherit-cpp.cpp',
        },
      ])
    );
  },
}
);

async function hintsFor(content: string): Promise<ComputedHint[]> {
  const document = await vscode.workspace.openTextDocument({ language: 'c', content });
  await vscode.window.showTextDocument(document);
  await delay(20);
  return computedHints();
}

async function hintsForFile(
  dir: string,
  name: string,
  languageId = 'c'
): Promise<ComputedHint[]> {
  await openFixture(dir, name, languageId);
  await delay(20);
  return computedHints();
}
