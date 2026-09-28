import * as assert from 'assert';
import { join } from 'node:path';
import * as vscode from 'vscode';

export interface ComputedHint {
  line: number;
  text: string;
  kind: string;
  inactive: boolean;
  target?: { line: number; col: number };
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
  show: ['brackets', 'macros'],
  compileFlags: [],
  inheritCompileCommands: false,
  'csharp.define': [],
  'csharp.inheritProject': true,
  'csharp.configuration': 'Debug',
  'csharp.targetFramework': '',
  'rust.cfg': [],
  'rust.inheritCargo': true,
  'preprocessor.trackFileDefines': true,
  'preprocessor.skipInactiveBrackets': true,
  'preprocessor.skipInactiveDirectives': false,
  'preprocessor.markInactive': true,
  showRange: true,
  showRangeThreshold: 0,
  showLabel: true,
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
