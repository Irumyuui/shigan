import * as assert from 'assert';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as vscode from 'vscode';
import {
  applyBaseline,
  bracketAt,
  conditionalAt,
  openFixture,
  pollHints,
  restoreTouched,
  set,
} from './support';

/**
 * probe.rs pins the END line of four separately-gated items (0-based):
 *   `#[cfg(feature = "alpha")]` -> 3, `#[cfg(feature = "zz")]` -> 8,
 *   `#[cfg(unix)]` -> 13, `#[cfg(windows)]` -> 18.
 */
const PROBE = [
  '#[cfg(feature = "alpha")]',
  'fn alpha() {',
  '    let a = 1;',
  '}',
  '',
  '#[cfg(feature = "zz")]',
  'fn zz() {',
  '    let z = 1;',
  '}',
  '',
  '#[cfg(unix)]',
  'fn unix_only() {',
  '    let u = 1;',
  '}',
  '',
  '#[cfg(windows)]',
  'fn windows_only() {',
  '    let w = 1;',
  '}',
].join('\n');

const ALPHA_END = 3;
const ZZ_END = 8;
const UNIX_ATTR_LINE = 10;
const UNIX_END = 13;
const WINDOWS_ATTR_LINE = 15;
const WINDOWS_END = 18;

const CARGO_BASE = [
  '[package]',
  'name = "shigan-rust-probe"',
  'version = "0.1.0"',
  '',
  '[features]',
  'default = ["alpha"]',
  'alpha = []',
  'beta = []',
].join('\n');

/** Same manifest plus a declared-but-not-default `zz`. */
const CARGO_WITH_ZZ = [
  '[package]',
  'name = "shigan-rust-probe"',
  'version = "0.1.0"',
  '',
  '[features]',
  'default = ["alpha"]',
  'alpha = []',
  'beta = []',
  'zz = []',
].join('\n');

suite('Shigan Rust', () => {
  let fixtureDir = '';
  let cargoPath = '';
  let diagnostics: vscode.DiagnosticCollection;

  suiteSetup(async () => {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    assert.ok(root, 'the test workspace folder is missing');

    fixtureDir = join(root, 'fixture', 'rust');
    mkdirSync(fixtureDir, { recursive: true });
    cargoPath = join(fixtureDir, 'Cargo.toml');
    writeFileSync(cargoPath, CARGO_BASE);
    writeFileSync(join(fixtureDir, 'probe.rs'), PROBE);

    // One long-lived collection: the diagnostics tests reuse it and always
    // re-read the hints instead of trusting the event payload.
    diagnostics = vscode.languages.createDiagnosticCollection('shigan-rust-test');

    // Best effort: make sure the Cargo.toml watcher is registered before use.
    const extension = vscode.extensions.getExtension('miyana-tobari.shigan');
    if (extension && !extension.isActive) await extension.activate();

    await applyBaseline();
  });

  suiteTeardown(async () => {
    diagnostics.dispose();
    if (fixtureDir) rmSync(fixtureDir, { recursive: true, force: true });
    await applyBaseline();
  });

  teardown(async () => {
    diagnostics.clear();
    await restoreTouched();
  });

  test('routes Rust and pairs the enabled feature item', async () => {
    const document = await openFixture(fixtureDir, 'probe.rs', 'rust');
    assert.strictEqual(document.languageId, 'rust');

    const hints = await pollHints(
      (all) => conditionalAt(all, ALPHA_END)?.inactive === false,
      'the Cargo default feature should make the alpha item live'
    );

    assert.ok(
      hints.some((hint) => hint.kind === 'conditional'),
      `the probe should yield conditional hints: ${JSON.stringify(hints)}`
    );
    const alpha = conditionalAt(hints, ALPHA_END);
    assert.ok(alpha, `the alpha item should be hinted: ${JSON.stringify(hints)}`);
    assert.ok(
      alpha.text.includes('#[cfg(feature = "alpha")]'),
      `the hint should carry the attribute: ${alpha.text}`
    );
    assert.ok(
      bracketAt(hints, ALPHA_END),
      `the live alpha item's braces should pair: ${JSON.stringify(hints)}`
    );
    assert.strictEqual(
      conditionalAt(hints, ZZ_END)?.inactive,
      true,
      'zz is absent from the manifest universe, so it is inactive'
    );
  });

  test('rust.inheritCargo = false makes an undeclared feature unknown', async () => {
    await openFixture(fixtureDir, 'probe.rs', 'rust');
    await pollHints(
      (all) => conditionalAt(all, ZZ_END)?.inactive === true,
      'zz is absent while the manifest is inherited'
    );

    await set('rust.inheritCargo', false);
    await pollHints(
      (all) => conditionalAt(all, ZZ_END)?.inactive === false,
      'without Cargo facts zz is unknown, so the item stays live'
    );
  });

  test('rust.cfg = [-unix] deactivates the unix item and its brackets', async () => {
    await openFixture(fixtureDir, 'probe.rs', 'rust');

    await set('rust.cfg', ['-unix']);
    const hints = await pollHints(
      (all) => conditionalAt(all, UNIX_END)?.inactive === true,
      'the explicit -unix entry should deactivate the unix item'
    );

    const inside = hints.filter(
      (hint) =>
        hint.kind === 'bracket' && hint.line >= UNIX_ATTR_LINE && hint.line <= UNIX_END
    );
    assert.deepStrictEqual(
      inside,
      [],
      `no bracket hint should end inside the inactive unix item: ${JSON.stringify(hints)}`
    );
  });

  test('the Cargo.toml watcher re-reads create/change/delete without a reload', async () => {
    writeFileSync(cargoPath, CARGO_BASE);
    await openFixture(fixtureDir, 'probe.rs', 'rust');
    await pollHints(
      (all) => conditionalAt(all, ZZ_END)?.inactive === true,
      'zz is absent while it is undeclared'
    );

    // Change: `zz` becomes declared (but not default) -> undecidable -> live.
    writeFileSync(cargoPath, CARGO_WITH_ZZ);
    await pollHints(
      (all) => conditionalAt(all, ZZ_END)?.inactive === false,
      'a declared-but-not-default zz becomes unknown'
    );

    // Delete: no manifest -> no feature facts -> unknown -> still live.
    rmSync(cargoPath, { force: true });
    await pollHints(
      (all) => conditionalAt(all, ZZ_END)?.inactive === false,
      'without any manifest zz is unknown, not inactive'
    );

    // Create again: the declared universe is back and `zz` is absent.
    writeFileSync(cargoPath, CARGO_BASE);
    await pollHints(
      (all) => conditionalAt(all, ZZ_END)?.inactive === true,
      'restoring the manifest makes zz absent again'
    );
  });

  test('a rust-analyzer inactive-code diagnostic overrides the lexical model', async () => {
    diagnostics.clear();
    const uri = vscode.Uri.file(join(fixtureDir, 'probe.rs'));
    await openFixture(fixtureDir, 'probe.rs', 'rust');

    const lexical = await pollHints(
      (all) => conditionalAt(all, ZZ_END)?.inactive === true,
      'lexical baseline: zz is absent from the universe'
    );
    // `windows` is host-dependent (active on a win32 dev box, inactive on
    // Linux CI); capture the lexical answer instead of assuming one.
    const lexicalWindows = conditionalAt(lexical, WINDOWS_END)?.inactive === true;

    const range = new vscode.Range(WINDOWS_ATTR_LINE, 0, WINDOWS_END, 1);
    const make = (source: string, code: string): vscode.Diagnostic => {
      const diagnostic = new vscode.Diagnostic(
        range,
        'this code is inactive',
        vscode.DiagnosticSeverity.Hint
      );
      diagnostic.source = source;
      diagnostic.code = code;
      return diagnostic;
    };

    // 1. snake_case `inactive_code` from rust-analyzer is authoritative: the
    // windows item flips inactive AND the lexical zz negative is suppressed.
    diagnostics.set(uri, [make('rust-analyzer', 'inactive_code')]);
    await pollHints(
      (all) =>
        conditionalAt(all, WINDOWS_END)?.inactive === true &&
        conditionalAt(all, ZZ_END)?.inactive === false,
      'the diagnostic should mark windows inactive and suppress the lexical zz negative'
    );

    // 2. Clearing reverts to the lexical answer.
    diagnostics.clear();
    await pollHints(
      (all) =>
        conditionalAt(all, WINDOWS_END)?.inactive === lexicalWindows &&
        conditionalAt(all, ZZ_END)?.inactive === true,
      'clearing the diagnostic restores the lexical result'
    );

    // 3. The kebab-case spelling still matches.
    diagnostics.set(uri, [make('rust-analyzer', 'inactive-code')]);
    await pollHints(
      (all) =>
        conditionalAt(all, WINDOWS_END)?.inactive === true &&
        conditionalAt(all, ZZ_END)?.inactive === false,
      'the kebab-case code should still match'
    );

    // 4. A non-rust-analyzer source must not match.
    diagnostics.set(uri, [make('rustc', 'inactive_code')]);
    await pollHints(
      (all) =>
        conditionalAt(all, WINDOWS_END)?.inactive === lexicalWindows &&
        conditionalAt(all, ZZ_END)?.inactive === true,
      'a rustc diagnostic must not be treated as authoritative'
    );

    // 5. Clearing again reverts.
    diagnostics.clear();
    await pollHints(
      (all) => conditionalAt(all, ZZ_END)?.inactive === true,
      'clearing the collection restores the lexical result'
    );
  });
});
