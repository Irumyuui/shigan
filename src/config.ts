import * as vscode from 'vscode';
import { dirnameOf, resolveVariable, VariableContext } from './core/document-paths';
import { readConfigFrom, SettingReader, ShiganConfig } from './core/settings';

export type { ShiganConfig };

export function readConfig(): ShiganConfig {
  const configuration = vscode.workspace.getConfiguration('shigan');
  const get: SettingReader = (key, fallback) => configuration.get(key, fallback);
  return readConfigFrom(get);
}

/**
 * Resolves `${...}` variables in compile flags. Supported:
 * `${workspaceFolder}`, `${fileDirname}`, `${env:NAME}`.
 *
 * Resolution is anchored on the DOCUMENT's own URI: a remote window
 * (`vscode-remote://…`) has a remote `fsPath`, which `Uri.file(fsPath)` would
 * mangle on a Windows host. `getWorkspaceFolder(uri)` also matches the folder
 * the document actually belongs to rather than re-deriving one from a path.
 */
export function createVariableResolver(uri?: vscode.Uri): (variable: string) => string | undefined {
  const documentUri = uri ?? vscode.window.activeTextEditor?.document.uri;
  const folder = documentUri ? vscode.workspace.getWorkspaceFolder(documentUri) : undefined;
  const context: VariableContext = {
    workspaceFolder: folder?.uri.fsPath,
    fileDirname: documentUri ? dirnameOf(documentUri.fsPath) : '',
    env: (name) => process.env[name],
  };

  return (variable: string) => resolveVariable(variable, context);
}
