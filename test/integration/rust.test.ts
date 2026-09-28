import * as assert from 'assert';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as vscode from 'vscode';
import {
  applyBaseline,
  bracketAt,
  computedHints,
  conditionalAt,
  createFixtureSuite,
  openFixture,
  pollHints,
  pollUntil,
  restoreWorkspaceSettings,
  set,
  withWorkspaceWritable,
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
const ZZ_ATTR_LINE = 5;
const ZZ_END = 8;
const UNIX_ATTR_LINE = 10;
const UNIX_END = 13;
const WINDOWS_ATTR_LINE = 15;
const WINDOWS_END = 18;

/**
 * A single item gated by two merged cfg attributes, so its conditional hint has
 * one clickable segment per attribute line.
 */
const TWO_ATTRS = [
  '#[cfg(feature = "alpha")]',
  '#[cfg(unix)]',
  'fn alpha_unix() {',
  '    let a = 1;',
  '}',
].join('\n');

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

let diagnostics: vscode.DiagnosticCollection;

createFixtureSuite(
  'Shigan Rust',
  { 'Cargo.toml': CARGO_BASE, 'probe.rs': PROBE, 'two-attrs.rs': TWO_ATTRS },
  (fixture) => {
    // One long-lived collection: the diagnostics tests reuse it and always
    // re-read the hints instead of trusting the event payload.
    diagnostics = vscode.languages.createDiagnosticCollection('shigan-rust-test');
    const cargoPath = () => join(fixture.dir, 'Cargo.toml');

    test('routes Rust and pairs the enabled feature item', async () => {
      const document = await openFixture(fixture.dir, 'probe.rs', 'rust');
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
      await openFixture(fixture.dir, 'probe.rs', 'rust');
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
      await openFixture(fixture.dir, 'probe.rs', 'rust');

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
      writeFileSync(cargoPath(), CARGO_BASE);
      await openFixture(fixture.dir, 'probe.rs', 'rust');
      await pollHints(
        (all) => conditionalAt(all, ZZ_END)?.inactive === true,
        'zz is absent while it is undeclared'
      );

      // Change: `zz` becomes declared (but not default) -> undecidable -> live.
      writeFileSync(cargoPath(), CARGO_WITH_ZZ);
      await pollHints(
        (all) => conditionalAt(all, ZZ_END)?.inactive === false,
        'a declared-but-not-default zz becomes unknown'
      );

      // Delete: no manifest -> no feature facts -> unknown -> still live.
      rmSync(cargoPath(), { force: true });
      await pollHints(
        (all) => conditionalAt(all, ZZ_END)?.inactive === false,
        'without any manifest zz is unknown, not inactive'
      );

      // Create again: the declared universe is back and `zz` is absent.
      writeFileSync(cargoPath(), CARGO_BASE);
      await pollHints(
        (all) => conditionalAt(all, ZZ_END)?.inactive === true,
        'restoring the manifest makes zz absent again'
      );
    });

    test('shigan.show = [brackets] hides conditionals but keeps activity for matching', async () => {
      // Conditional hints ship under the `macros` switch; with brackets only
      // there must be none, yet the lexical activity must still exclude the
      // inactive item's braces from matching.
      await set('show', ['brackets']);
      await openFixture(fixture.dir, 'probe.rs', 'rust');

      const hints = await computedHints();
      assert.strictEqual(
        hints.filter((hint) => hint.kind === 'conditional').length,
        0,
        `brackets-only must not render conditional hints: ${JSON.stringify(hints)}`
      );
      assert.ok(
        bracketAt(hints, ALPHA_END),
        `the live alpha item's braces should still pair: ${JSON.stringify(hints)}`
      );
      const zzBrackets = hints.filter(
        (hint) => hint.kind === 'bracket' && hint.line > ZZ_ATTR_LINE && hint.line <= ZZ_END
      );
      assert.deepStrictEqual(
        zzBrackets,
        [],
        `no bracket should end inside the inactive zz item: ${JSON.stringify(hints)}`
      );
    });

    test('renders a two-attribute item with a jump target per attribute line', async () => {
      // Pin both predicates true so the inactive marker does not shift the last
      // label part; the parts/targets themselves do not depend on activity.
      await set('rust.cfg', ['unix']);
      const document = await openFixture(fixture.dir, 'two-attrs.rs', 'rust');

      const computed = await computedHints();
      const conditional = computed.find((hint) => hint.kind === 'conditional');
      assert.ok(conditional, `expected a conditional hint: ${JSON.stringify(computed)}`);
      assert.deepStrictEqual(
        conditional.parts.map((part) => [part.text, part.target, part.title]),
        [
          [' <- :1-5 #[cfg(feature = "alpha")]', { line: 0, col: 0 }, '#[cfg(feature = "alpha")]'],
          [' <- #[cfg(unix)]', { line: 1, col: 0 }, '#[cfg(unix)]'],
        ],
        `each attribute should be its own segment: ${JSON.stringify(conditional)}`
      );

      // The rendered inlay hint must carry the same per-segment jump payload and
      // fence its tooltip as Rust.
      const inlay = await vscode.commands.executeCommand<vscode.InlayHint[]>(
        'vscode.executeInlayHintProvider',
        document.uri,
        new vscode.Range(0, 0, document.lineCount, 0)
      );
      const hint = inlay.find((entry) => entry.position.line === conditional.line);
      assert.ok(hint, `expected an inlay hint for the item: ${JSON.stringify(inlay)}`);
      const label = hint.label;
      assert.ok(Array.isArray(label) && label.length === 2, 'expected two label parts');
      const parts = label as vscode.InlayHintLabelPart[];

      for (const [index, attributeLine] of [
        [0, 0],
        [1, 1],
      ] as const) {
        const part = parts[index];
        assert.deepStrictEqual(
          (part.command?.arguments ?? []).slice(1),
          [attributeLine, 0],
          `segment ${index} should jump to attribute line ${attributeLine}`
        );
        const tooltip = part.tooltip;
        assert.ok(tooltip, `segment ${index} should have a tooltip`);
        const markdown =
          tooltip instanceof vscode.MarkdownString ? tooltip.value : String(tooltip);
        assert.match(markdown, /```rust/);
        assert.match(markdown, /#\[cfg/);

        await vscode.commands.executeCommand('shigan.jumpToMatch', ...part.command!.arguments!);
        assert.strictEqual(vscode.window.activeTextEditor?.selection.active.line, attributeLine);
      }
    });

    test('a rust-analyzer inactive-code diagnostic overrides the lexical model', async () => {
      diagnostics.clear();
      const uri = vscode.Uri.file(join(fixture.dir, 'probe.rs'));
      await openFixture(fixture.dir, 'probe.rs', 'rust');

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
  },
  {
    dirName: 'rust',
    afterEach: () => diagnostics.clear(),
    teardown: () => diagnostics.dispose(),
  }
);

const RUST_MULTIROOT_NAME = 'shigan-rust-multiroot';

/**
 * Multi-root watcher coverage for the per-folder `Cargo.toml` watchers.
 * `updateWorkspaceFolders`
 * restarts the extension host when the FIRST folder changes or when a
 * single-folder workspace turns multi-root, and a restart kills this in-host
 * run. The harness therefore starts multi-root (see `.vscode-test.mjs`) and this
 * suite only adds/removes a NON-first sibling folder, which VS Code applies
 * without a restart. Do not "simplify" this into a single-folder run later.
 *
 * The point: with the folder added at runtime, the extension's
 * `onDidChangeWorkspaceFolders` handler must rebuild the `Cargo.toml` watchers;
 * otherwise nothing watches the new root and the rewrite below would never
 * invalidate the Cargo cache.
 */
suite('Shigan Rust (multi-root)', () => {
  let multirootDir = '';

  suiteSetup(async () => {
    const folders = vscode.workspace.workspaceFolders;
    assert.ok(folders && folders.length >= 2, 'the host must start multi-root for this suite');

    // Sibling of the primary workspace folder: VS Code refuses nested folders.
    multirootDir = join(folders[0].uri.fsPath, '..', 'workspace-rust-multiroot');
    mkdirSync(multirootDir, { recursive: true });
    writeFileSync(join(multirootDir, 'Cargo.toml'), CARGO_BASE);
    writeFileSync(join(multirootDir, 'probe.rs'), PROBE);

    const extension = vscode.extensions.getExtension('miyana-tobari.shigan');
    if (extension && !extension.isActive) await extension.activate();

    const added = vscode.workspace.updateWorkspaceFolders(folders.length, 0, {
      uri: vscode.Uri.file(multirootDir),
      name: RUST_MULTIROOT_NAME,
    });
    assert.strictEqual(added, true, 'adding a non-first workspace folder should be accepted');

    await pollUntil(
      () => (vscode.workspace.workspaceFolders?.length ?? 0) === folders.length + 1,
      'the added workspace folder should appear'
    );

    await withWorkspaceWritable(applyBaseline);
  });

  suiteTeardown(async () => {
    // Must run even after a failing test: never leave the extra folder behind.
    try {
      if (multirootDir) {
        const folders = vscode.workspace.workspaceFolders ?? [];
        const index = folders.findIndex(
          (folder) => folder.name === RUST_MULTIROOT_NAME || folder.uri.fsPath === multirootDir
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

  test('adding a workspace folder rebuilds the Cargo.toml watcher', async () => {
    await openFixture(multirootDir, 'probe.rs', 'rust');
    await pollHints(
      (all) => conditionalAt(all, ZZ_END)?.inactive === true,
      'zz is absent from the Multi Cargo.toml universe'
    );

    // Only a watcher covering the newly added root can observe this rewrite.
    writeFileSync(join(multirootDir, 'Cargo.toml'), CARGO_WITH_ZZ);
    await pollHints(
      (all) => conditionalAt(all, ZZ_END)?.inactive === false,
      'declaring zz in the added Cargo.toml makes it unknown'
    );
  });
});
