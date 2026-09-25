export interface CompileCommandEntry {
  directory?: string;
  file: string;
  command?: string;
  arguments?: string[];
}

/** Parses the content of a `compile_commands.json` file. */
export function parseCompileCommands(content: string): CompileCommandEntry[] {
  try {
    const data = JSON.parse(content);
    return Array.isArray(data) ? (data as CompileCommandEntry[]) : [];
  } catch {
    return [];
  }
}

/**
 * Finds the flags for `targetFile`. Paths are compared after resolving
 * `directory`/`file` and normalizing separators and case (Windows).
 */
export function flagsForFile(
  entries: CompileCommandEntry[],
  targetFile: string
): string[] | undefined {
  const target = normalizePath(targetFile);
  const entry =
    entries.find((e) => normalizePath(resolvePath(e.directory, e.file)) === target) ??
    entries.find((e) => normalizePath(e.file) === target);
  return entry ? extractFlags(entry) : undefined;
}

/** Extracts the argument list from an entry, dropping the compiler itself. */
export function extractFlags(entry: CompileCommandEntry): string[] | undefined {
  if (Array.isArray(entry.arguments)) return entry.arguments.slice(1);
  if (typeof entry.command === 'string') return splitCommand(entry.command).slice(1);
  return undefined;
}

function resolvePath(directory: string | undefined, file: string): string {
  if (!directory || isAbsolute(file)) return file;
  const sep = directory.endsWith('/') || directory.endsWith('\\') ? '' : '/';
  return `${directory}${sep}${file}`;
}

function isAbsolute(file: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(file) || file.startsWith('/') || file.startsWith('\\\\');
}

function normalizePath(value: string): string {
  const replaced = value.replace(/\\/g, '/').replace(/\/+/g, '/');
  const isWindows = /^[A-Za-z]:/.test(replaced);
  return (isWindows ? replaced.toLowerCase() : replaced).replace(/\/$/, '');
}

/** Minimal POSIX-ish command splitter that honours single and double quotes. */
export function splitCommand(command: string): string[] {
  const result: string[] = [];
  let current = '';
  let quote: '"' | "'" | undefined;
  let hasToken = false;

  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (quote) {
      if (c === quote) {
        quote = undefined;
      } else if (c === '\\' && quote === '"' && i + 1 < command.length) {
        current += command[++i];
      } else {
        current += c;
      }
      hasToken = true;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      hasToken = true;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      if (hasToken) {
        result.push(current);
        current = '';
        hasToken = false;
      }
      continue;
    }
    current += c;
    hasToken = true;
  }

  if (hasToken) result.push(current);
  return result;
}
