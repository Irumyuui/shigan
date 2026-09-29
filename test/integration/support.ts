import * as assert from 'assert';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as vscode from 'vscode';

export interface ComputedHint {
  line: number;
  text: string;
  kind: string;
  inactive: boolean;
  target?: { line: number; col: number };
  parts: { text: string; target?: { line: number; col: number }; title?: string }[];
}

/**
 * Explicit defaults, written back instead of removed: `update(key, undefined)`
 * was not reliable here and left `shigan.enable: false` behind, which silently
 * emptied every later test.
 */
export const BASELINE: Record<string, unknown> = {
  enable: true,
  languages: ['c', 'cpp', 'csharp', 'rust'],
  trigger: 'always',
  show: ['brackets', 'macros', 'conditional'],
  showRange: true,
  showRangeThreshold: 0,
  showLabel: true,
  'inactive.skipBrackets': true,
  'inactive.skipDirectives': false,
  'inactive.markInactive': true,
  'c.trackFileDefines': true,
  'c.compileFlags': [],
  'c.inheritCompileCommands': false,
  'cpp.trackFileDefines': true,
  'cpp.compileFlags': [],
  'cpp.inheritCompileCommands': false,
  'csharp.trackFileDefines': true,
  'csharp.compileFlags': [],
  'csharp.define': [],
  'csharp.inheritProject': true,
  'csharp.configuration': 'Debug',
  'csharp.targetFramework': '',
  'rust.cfg': [],
  'rust.inheritCargo': true,
};

export const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Module-level state is fine: esbuild bundles each `*.test.ts` entry separately,
// so every suite gets its own instance of this set.
const touched = new Set<string>();

export function configuration(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration('shigan');
}

export async function applyBaseline(): Promise<void> {
  const config = configuration();
  for (const [key, value] of Object.entries(BASELINE)) {
    // The extension reads the effective value, so an already-matching setting
    // needs no write. Skipping the no-ops avoids ~13 sequential disk writes
    // (each firing a config-change event) on every run and on every teardown.
    if (JSON.stringify(config.get(key)) === JSON.stringify(value)) continue;
    await config.update(key, value, vscode.ConfigurationTarget.Workspace);
  }
  await delay(150);
}

export async function set(key: string, value: unknown): Promise<void> {
  touched.add(key);
  await configuration().update(key, value, vscode.ConfigurationTarget.Workspace);
  await delay(80);
}

export async function restoreTouched(): Promise<void> {
  const config = configuration();
  for (const key of touched) {
    await config.update(key, BASELINE[key], vscode.ConfigurationTarget.Workspace);
  }
  touched.clear();
  await delay(80);
}

export async function openFixture(
  dir: string,
  name: string,
  languageId: string
): Promise<vscode.TextDocument> {
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(join(dir, name)));
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

export function bracketAt(hints: ComputedHint[], line: number): ComputedHint | undefined {
  return hints.find((hint) => hint.kind === 'bracket' && hint.line === line);
}

export function macroAt(hints: ComputedHint[], line: number): ComputedHint | undefined {
  return hints.find((hint) => hint.kind === 'macro' && hint.line === line);
}

export function conditionalAt(hints: ComputedHint[], line: number): ComputedHint | undefined {
  return hints.find((hint) => hint.kind === 'conditional' && hint.line === line);
}

export async function computedHints(): Promise<ComputedHint[]> {
  const hints = await vscode.commands.executeCommand<ComputedHint[]>(
    'shigan.internal.computedHints'
  );
  return hints ?? [];
}

/** Poll cadence shared by {@link pollHints} / {@link pollUntil}. */
export const WATCH_POLL_INTERVAL_MS = 100;
export const WATCH_POLL_TIMEOUT_MS = 5000;

/**
 * Polls `computedHints()` until `predicate` holds. File watchers are debounced
 * (60 ms) and deliver events asynchronously, so a fixed delay cannot prove a
 * refresh happened; this waits for the observable hint flip and fails with the
 * last hints when the event never arrives.
 */
export async function pollHints(
  predicate: (hints: ComputedHint[]) => boolean,
  message: string
): Promise<ComputedHint[]> {
  const deadline = Date.now() + WATCH_POLL_TIMEOUT_MS;
  let hints = await computedHints();
  for (;;) {
    if (predicate(hints)) return hints;
    if (Date.now() >= deadline) {
      assert.fail(
        `${message} (waited ${WATCH_POLL_TIMEOUT_MS} ms); last hints: ${JSON.stringify(hints)}`
      );
    }
    await delay(WATCH_POLL_INTERVAL_MS);
    hints = await computedHints();
  }
}

/**
 * Polls a non-hint predicate (e.g. the workspace folder count) on the same
 * 100 ms / 5 s cadence as {@link pollHints}: `updateWorkspaceFolders` is applied
 * asynchronously, so a fixed delay would be racy.
 */
export async function pollUntil(predicate: () => boolean, message: string): Promise<void> {
  const deadline = Date.now() + WATCH_POLL_TIMEOUT_MS;
  for (;;) {
    if (predicate()) return;
    if (Date.now() >= deadline) {
      assert.fail(`${message} (waited ${WATCH_POLL_TIMEOUT_MS} ms)`);
    }
    await delay(WATCH_POLL_INTERVAL_MS);
  }
}

/** Absolute path to the primary workspace folder; fails if it is missing. */
export function fixtureRoot(): string {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  assert.ok(root, 'the test workspace folder is missing');
  return root;
}

/**
 * Creates `fixture/<name>` under the primary workspace folder and writes every
 * `files` entry (a relative path) into it, creating parent directories. Returns
 * the fixture dir. Only this suite's own directory is touched.
 */
export function createFixture(name: string, files: Record<string, string>): string {
  const dir = join(fixtureRoot(), 'fixture', name);
  mkdirSync(dir, { recursive: true });
  for (const [relative, content] of Object.entries(files)) {
    const target = join(dir, relative);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  return dir;
}

/** Removes a fixture dir (recursive, force) created by {@link createFixture}. */
export function removeFixture(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

/**
 * Retries a workspace-settings write until it succeeds. Adding/removing a
 * workspace folder edits the generated `.code-workspace` file, and for a short
 * window afterwards VS Code rejects further settings writes with "Unable to
 * write into workspace settings because the file has unsaved changes". Saving
 * and retrying bridges that window; without it the dirty file would poison every
 * later suite's `applyBaseline`.
 */
export async function withWorkspaceWritable(action: () => Promise<void>): Promise<void> {
  const deadline = Date.now() + WATCH_POLL_TIMEOUT_MS;
  for (;;) {
    try {
      await action();
      return;
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      console.log('[multi-root] workspace settings file was dirty; saved it and retrying');
      await vscode.workspace.saveAll();
      await delay(WATCH_POLL_INTERVAL_MS);
    }
  }
}

/** Restores touched settings, and proves the workspace file is writable again. */
export async function restoreWorkspaceSettings(): Promise<void> {
  await restoreTouched();
  // Force one real workspace-settings write even when no setting was touched,
  // so a dirty `.code-workspace` file is detected (and retried) rather than left
  // behind for the next suite.
  const config = vscode.workspace.getConfiguration('shigan');
  await config.update('enable', config.get('enable'), vscode.ConfigurationTarget.Workspace);
}

/** Best effort: make sure the extension is active before the first query. */
export async function activateShigan(): Promise<void> {
  const extension = vscode.extensions.getExtension('miyana-tobari.shigan');
  if (extension && !extension.isActive) await extension.activate();
}

/** Mutable handle for the fixture dir, assigned by {@link createFixtureSuite}. */
export interface FixtureHandle {
  /** Absolute path to `fixture/<dirName>`; valid once `suiteSetup` has run. */
  dir: string;
}

export interface FixtureSuiteOptions {
  /** Fixture subdirectory name; defaults to the suite name. */
  dirName?: string;
  /** Extra setup after `applyBaseline()`; use for content that needs `dir`. */
  setup?: (fixture: FixtureHandle) => void | Promise<void>;
  /** Per-test hook run before `restoreTouched()`. */
  afterEach?: () => void | Promise<void>;
  /** Suite teardown hook run before the fixture dir is removed. */
  teardown?: () => void | Promise<void>;
}

/**
 * Registers the shared integration-suite shape: create `fixture/<dirName>`,
 * activate the extension, apply the settings baseline, restore touched settings
 * after every test, and remove only this suite's fixture dir on teardown.
 *
 * `shell` owns the actual tests and receives the {@link FixtureHandle} so it can
 * open and rewrite fixture files; `files` are written once in `suiteSetup`.
 */
export function createFixtureSuite(
  name: string,
  files: Record<string, string>,
  shell: (fixture: FixtureHandle) => void,
  options: FixtureSuiteOptions = {}
): FixtureHandle {
  const fixture: FixtureHandle = { dir: '' };
  suite(name, () => {
    suiteSetup(async () => {
      fixture.dir = createFixture(options.dirName ?? name, files);
      await activateShigan();
      await applyBaseline();
      await options.setup?.(fixture);
    });

    suiteTeardown(async () => {
      try {
        await options.teardown?.();
      } finally {
        if (fixture.dir) removeFixture(fixture.dir);
        await applyBaseline();
      }
    });

    teardown(async () => {
      await options.afterEach?.();
      await restoreTouched();
    });

    shell(fixture);
  });
  return fixture;
}
