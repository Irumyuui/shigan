import * as vscode from 'vscode';
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
 */
export function createVariableResolver(filePath?: string): (variable: string) => string | undefined {
  const folder = vscode.workspace.getWorkspaceFolder(
    filePath
      ? vscode.Uri.file(filePath)
      : (vscode.window.activeTextEditor?.document.uri ?? vscode.Uri.file(''))
  );
  const fileDirname = filePath
    ? vscode.Uri.file(filePath).fsPath.replace(/[\\/][^\\/]*$/, '')
    : '';

  return (variable: string) => {
    if (variable === 'workspaceFolder') return folder?.uri.fsPath;
    if (variable === 'fileDirname') return fileDirname;
    if (variable.startsWith('env:')) return process.env[variable.slice(4)];
    return undefined;
  };
}
