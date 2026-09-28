import { C_SYNTAX, LanguageSyntax } from './language';
import { MacroDef } from './types';

export interface ParsedFlags {
  macros: Map<string, MacroDef>;
  includePaths: string[];
  standard?: string;
  /** Flags that Shigan does not interpret (kept for transparency / future use). */
  unknown: string[];
}

const STANDARD_VERSIONS: Record<string, number> = {
  c99: 199901,
  gnu99: 199901,
  c11: 201112,
  gnu11: 201112,
  c17: 201710,
  gnu17: 201710,
  c18: 201710,
  gnu18: 201710,
  c2x: 202311,
  c23: 202311,
  gnu23: 202311,
};

/** `__cplusplus` values for the C++ standards clang/gcc accept via `-std`. */
const CPP_STANDARD_VERSIONS: Record<string, number> = {
  'c++98': 199711,
  'c++03': 199711,
  'c++11': 201103,
  'c++14': 201402,
  'c++17': 201703,
  'c++20': 202002,
  'c++23': 202302,
  'gnu++98': 199711,
  'gnu++03': 199711,
  'gnu++11': 201103,
  'gnu++14': 201402,
  'gnu++17': 201703,
  'gnu++20': 202002,
  'gnu++23': 202302,
};

/**
 * Parses compiler-style flags (`-DFOO=1`, `-UBAR`, `-std=c11`, `-Iinclude`)
 * into the pieces the lexical tier understands. Unknown flags are collected
 * but ignored.
 *
 * `syntax` picks the standard macro dialect: C injects `__STDC__` (and
 * `__STDC_VERSION__` from `-std=cNN`); C++ injects `__cplusplus` from
 * `-std=c++NN`/`gnu++NN` instead.
 */
export function parseCompileFlags(
  flags: string[],
  resolve?: (variable: string) => string | undefined,
  syntax: LanguageSyntax = C_SYNTAX
): ParsedFlags {
  const macros = new Map<string, MacroDef>();
  const includePaths: string[] = [];
  const unknown: string[] = [];
  let standard: string | undefined;

  const substitute = (value: string): string =>
    resolve ? substituteVariables(value, resolve) : value;

  for (let i = 0; i < flags.length; i++) {
    const raw = substitute(flags[i]);

    if (raw === '-D' || raw.startsWith('-D')) {
      const define = raw === '-D' ? substitute(flags[++i] ?? '') : raw.slice(2);
      const parsed = parseFlagDefine(define);
      if (parsed) macros.set(parsed.name, { value: parsed.value, functionLike: parsed.functionLike });
      continue;
    }

    if (raw === '-U' || raw.startsWith('-U')) {
      const name = (raw === '-U' ? flags[++i] ?? '' : raw.slice(2)).trim();
      if (name) macros.delete(name);
      continue;
    }

    if (raw === '-std') {
      standard = flags[++i]?.trim();
      continue;
    }
    if (raw.startsWith('-std=')) {
      standard = raw.slice(5).trim();
      continue;
    }

    if (raw === '-I') {
      const path = flags[++i];
      if (path) includePaths.push(substitute(path));
      continue;
    }
    if (raw.startsWith('-I') && raw.length > 2) {
      includePaths.push(raw.slice(2));
      continue;
    }

    if (raw.startsWith('-')) unknown.push(raw);
    else unknown.push(raw);
  }

  applyStandardMacros(macros, standard, syntax);
  return { macros, includePaths, standard, unknown };
}

/** Replaces `${name}` placeholders using `resolve`. */
export function substituteVariables(
  value: string,
  resolve: (variable: string) => string | undefined
): string {
  return value.replace(/\$\{([^}]+)\}/g, (whole, variable: string) => resolve(variable) ?? whole);
}

/** Parses the argument of `-D`, e.g. `FOO`, `FOO=1`, `MAX(a,b)=((a)>(b)?(a):(b))`. */
export function parseFlagDefine(
  define: string
): { name: string; value: string; functionLike: boolean } | undefined {
  const eq = define.indexOf('=');
  const head = (eq >= 0 ? define.slice(0, eq) : define).trim();
  const value = eq >= 0 ? define.slice(eq + 1) : '1';

  const functionLike = /^([A-Za-z_][A-Za-z0-9_]*)\([^)]*\)$/.exec(head);
  if (functionLike) {
    return { name: functionLike[1], value, functionLike: true };
  }

  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(head)
    ? { name: head, value, functionLike: false }
    : undefined;
}

/** Parses a normalized `#define ...` line. */
export function parseDefine(
  display: string
): { name: string; value: string; functionLike: boolean } | undefined {
  const match = /^#\s*define\s+([A-Za-z_][A-Za-z0-9_]*)(\([^)]*\))?\s*([\s\S]*)$/.exec(display);
  if (!match) return undefined;
  return {
    name: match[1],
    functionLike: match[2] !== undefined,
    value: (match[3] ?? '').trim(),
  };
}

/** Parses a normalized `#undef NAME` line. */
export function parseUndef(display: string): string | undefined {
  const match = /^#\s*undef\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(display);
  return match?.[1];
}

function applyStandardMacros(
  macros: Map<string, MacroDef>,
  standard: string | undefined,
  syntax: LanguageSyntax
): void {
  if (syntax.id === 'cpp') {
    // C++ defines `__cplusplus` (from -std) and neither of the C macros.
    const cppVersion = standard ? CPP_STANDARD_VERSIONS[standard] : undefined;
    if (cppVersion !== undefined && !macros.has('__cplusplus')) {
      macros.set('__cplusplus', { value: String(cppVersion), functionLike: false });
    }
    return;
  }
  if (!macros.has('__STDC__')) {
    macros.set('__STDC__', { value: '1', functionLike: false });
  }
  const version = standard ? STANDARD_VERSIONS[standard] : undefined;
  if (version !== undefined && !macros.has('__STDC_VERSION__')) {
    macros.set('__STDC_VERSION__', { value: String(version), functionLike: false });
  }
}
