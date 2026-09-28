/**
 * VSCode-free helpers for locating a document on disk and resolving the
 * `${...}` variables in compile flags against it.
 *
 * The extension is declared `extensionKind: ["workspace"]`, so it always runs
 * where the sources live. A remote window (`vscode-remote://…`, used by SSH,
 * WSL and Dev Containers) therefore has a readable `fsPath` for the
 * workspace-hosted extension even though its scheme is not `file` — which is
 * why Cargo / csproj / compile_commands lookups must accept both schemes.
 */

/** Schemes whose `fsPath` is a real file the workspace-hosted extension can read. */
const REAL_FILE_SCHEMES: ReadonlySet<string> = new Set(['file', 'vscode-remote']);

/**
 * True for a URI scheme whose `fsPath` names a real on-disk file. Kept
 * deliberately small: `untitled`, `output`, `git` and `vscode-vfs` all have an
 * `fsPath` that does not resolve through the workspace host's filesystem.
 */
export function isRealFileScheme(scheme: string): boolean {
  return REAL_FILE_SCHEMES.has(scheme);
}

/** Everything `${...}` resolution needs; supplied by the VSCode layer. */
export interface VariableContext {
  /** `shigan`-visible workspace folder path of the document, if any. */
  workspaceFolder?: string;
  /** Directory of the document itself, `''` when it has no directory. */
  fileDirname?: string;
  /** Environment lookup for `${env:NAME}`. */
  env: (name: string) => string | undefined;
}

/** Directory portion of a file path (handles both separators); `''` when there is none. */
export function dirnameOf(filePath: string): string {
  const index = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  return index < 0 ? '' : filePath.slice(0, index);
}

/**
 * The value of one `${...}` variable, or `undefined` when unsupported.
 * Supported: `${workspaceFolder}`, `${fileDirname}`, `${env:NAME}`.
 */
export function resolveVariable(variable: string, context: VariableContext): string | undefined {
  if (variable === 'workspaceFolder') return context.workspaceFolder;
  if (variable === 'fileDirname') return context.fileDirname;
  if (variable.startsWith('env:')) return context.env(variable.slice(4));
  return undefined;
}
