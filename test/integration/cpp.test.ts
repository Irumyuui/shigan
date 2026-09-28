import * as assert from 'assert';
import { bracketAt, computedHints, createFixtureSuite, openFixture } from './support';

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

createFixtureSuite('Shigan C++', { 'probe.cpp': CPP_PROBE }, (fixture) => {
  test('C++ raw strings are opaque', async () => {
    const document = await openFixture(fixture.dir, 'probe.cpp', 'cpp');
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
}, { dirName: 'cpp' });
