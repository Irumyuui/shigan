import * as vscode from 'vscode';
import { readConfig, ShiganConfig } from './config';
import { languageKind } from './core/language';
import { JUMP_COMMAND, ShiganInlayHintsProvider } from './render/inlayHints';
import { registerHoverProvider } from './render/hover';
import {
  computeDocumentHints,
  DecorationTrigger,
  forgetDocument,
  invalidate,
  invalidateProjectFiles,
  noteRustDiagnosticsChanged,
} from './service';
import { versionChange } from './version';

const REFRESH_DELAY_MS = 60;
const VERSION_STATE_KEY = 'shigan.activatedVersion';
/** Project files whose changes can alter conditional evaluation. */
const PROJECT_GLOBS = ['**/*.csproj', '**/Cargo.toml'];

let config: ShiganConfig;
let refreshDebounced: Debounced | undefined;
let projectDebounced: Debounced | undefined;
let projectWatchers: vscode.FileSystemWatcher[] = [];
let inlayHints: ShiganInlayHintsProvider | undefined;

interface Debounced {
  schedule(): void;
  cancel(): void;
}

/**
 * One debounced task. `schedule` resets the timer, so a burst of events runs
 * the task once after the last one; `cancel` drops a pending run and is safe to
 * call when nothing is scheduled. Each task owns its own timer, so a
 * project-file change never swallows a caret refresh.
 */
function debounced(run: () => void, delay = REFRESH_DELAY_MS): Debounced {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    schedule(): void {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        run();
      }, delay);
    },
    cancel(): void {
      if (timer) clearTimeout(timer);
      timer = undefined;
    },
  };
}

export function activate(context: vscode.ExtensionContext): void {
  config = readConfig();

  inlayHints = new ShiganInlayHintsProvider(() => config);
  context.subscriptions.push(inlayHints);
  registerHoverProvider(context, () => config);

  context.subscriptions.push(
    vscode.commands.registerCommand(JUMP_COMMAND, jumpToMatch),
    vscode.commands.registerCommand('shigan.internal.computedHints', computedHintsForActiveEditor)
  );

  const refresh = (): void => inlayHints?.refresh();

  const refreshTask = debounced(refresh);
  const projectTask = debounced(() => {
    invalidateProjectFiles();
    refresh();
  });
  refreshDebounced = refreshTask;
  projectDebounced = projectTask;

  const watchProjectFiles = (): void => {
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      for (const glob of PROJECT_GLOBS) {
        const watcher = vscode.workspace.createFileSystemWatcher(
          new vscode.RelativePattern(folder, glob)
        );
        watcher.onDidCreate(projectTask.schedule);
        watcher.onDidChange(projectTask.schedule);
        watcher.onDidDelete(projectTask.schedule);
        projectWatchers.push(watcher);
      }
    }
  };

  context.subscriptions.push(
    vscode.window.onDidChangeTextEditorSelection(() => {
      if (config.trigger === 'cursor') refreshTask.schedule();
    }),
    vscode.workspace.onDidChangeTextDocument(() => {
      if (config.trigger === 'cursor' || config.trigger === 'always') refreshTask.schedule();
    }),
    vscode.window.onDidChangeActiveTextEditor(() => refreshTask.schedule()),
    vscode.workspace.onDidCloseTextDocument((document) =>
      forgetDocument(document.uri.toString())
    ),
    vscode.languages.onDidChangeDiagnostics((event) => {
      if (event.uris.length === 0) {
        // The API can fire with no URIs when diagnostics are cleared; bump
        // every known document and refresh.
        noteRustDiagnosticsChanged([]);
        refreshTask.schedule();
        return;
      }

      const documentsByUri = new Map<string, vscode.TextDocument>();
      for (const document of vscode.workspace.textDocuments) {
        documentsByUri.set(document.uri.toString(), document);
      }

      const rustUris = event.uris
        .filter((uri) => {
          const document = documentsByUri.get(uri.toString());
          return document !== undefined && languageKind(document.languageId) === 'rust';
        })
        .map((uri) => uri.toString());

      if (rustUris.length === 0) return;
      noteRustDiagnosticsChanged(rustUris);
      refreshTask.schedule();
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration('shigan')) return;
      config = readConfig();
      invalidate();
      refresh();
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      disposeProjectWatchers();
      watchProjectFiles();
      invalidate();
      refresh();
    }),
    new vscode.Disposable(disposeProjectWatchers),
    new vscode.Disposable(() => {
      refreshTask.cancel();
      projectTask.cancel();
    })
  );

  watchProjectFiles();

  // Ask for hints right away, so editors that were already open when the
  // extension was installed get their hints without a window reload.
  refresh();
  void announceVersionChange(context);
}

/** Disposes every project-file watcher and clears the list. Safe to call repeatedly. */
function disposeProjectWatchers(): void {
  for (const watcher of projectWatchers) watcher.dispose();
  projectWatchers = [];
}

export function deactivate(): void {
  refreshDebounced?.cancel();
  refreshDebounced = undefined;
  projectDebounced?.cancel();
  projectDebounced = undefined;
  disposeProjectWatchers();

  // Unregistering the provider drops its inlay hints immediately, so nothing
  // lingers when the extension is disabled or the window is reloaded.
  inlayHints?.dispose();
  inlayHints = undefined;
}

/**
 * Tells the user to reload after an install or an update.
 *
 * This is the only moment we can do it: while the extension is disabled or
 * uninstalled it is not running, so VSCode's own "Reload Window" / "Restart
 * Extensions" notification covers that side.
 */
async function announceVersionChange(context: vscode.ExtensionContext): Promise<void> {
  const current = String(context.extension.packageJSON.version ?? '');
  const change = versionChange(context.globalState.get<string>(VERSION_STATE_KEY), current);
  if (!change) return;

  await context.globalState.update(VERSION_STATE_KEY, change.version);

  const message =
    change.kind === 'updated'
      ? vscode.l10n.t(
          'Shigan was updated to {0}. Reload the window to apply the new version.',
          change.version
        )
      : vscode.l10n.t(
          'Shigan {0} is installed. If the hints do not appear, reload the window.',
          change.version
        );
  const reload = vscode.l10n.t('Reload Window');

  const choice = await vscode.window.showInformationMessage(
    message,
    reload,
    vscode.l10n.t('Later')
  );
  if (choice === reload) {
    await vscode.commands.executeCommand('workbench.action.reloadWindow');
  }
}

/** Command used by the clickable inlay hints. */
async function jumpToMatch(uriString: string, line: number, col: number): Promise<void> {
  try {
    const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(uriString));
    const editor = await vscode.window.showTextDocument(document, { preview: false });
    const position = new vscode.Position(Math.max(0, line), Math.max(0, col));
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(
      new vscode.Range(position, position),
      vscode.TextEditorRevealType.InCenterIfOutsideViewport
    );
  } catch (error) {
    void vscode.window.showWarningMessage(
      vscode.l10n.t('Shigan: could not jump to the match ({0})', String(error))
    );
  }
}

/**
 * Internal diagnostic: the hints the extension would render for the active
 * editor, as plain JSON. Used by the integration tests and handy when filing
 * a bug report.
 */
function computedHintsForActiveEditor(): unknown[] {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return [];

  const trigger: DecorationTrigger = config.trigger === 'cursor' ? 'cursor' : 'always';
  return computeDocumentHints(
    editor.document,
    config,
    trigger,
    editor.document.offsetAt(editor.selection.active)
  ).map((hint) => ({
    line: hint.line,
    text: hint.text,
    kind: hint.kind,
    inactive: hint.inactive === true,
    target: hint.target,
    parts: hint.parts.map((part) => ({
      text: part.text,
      target: part.target,
      title: part.title,
    })),
  }));
}
