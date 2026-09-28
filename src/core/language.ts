/**
 * Language profile seam for the VSCode-free core.
 *
 * The dialect data (`LanguageSyntax`) describes the C family's lexical
 * differences. Which *kind* of language an id is — and therefore which
 * pipeline handles it — is a separate decision, so callers dispatch on
 * {@link languageKind} first and only consult {@link syntaxFor} for the C
 * family (`c`/`cpp`/`csharp`). A future non-C language (e.g. Rust) registers a
 * kind without a syntax profile.
 *
 * This module is deliberately VSCode-free: the VSCode layer resolves a profile
 * from `document.languageId` and passes it down.
 */
export interface LanguageSyntax {
  /** Internal identifier of the profile, e.g. `c`. */
  id: string;
  /** Whether C++-style raw string literals (`R"(...)"`) are recognized. */
  rawStrings: boolean;
  /**
   * Whether C# verbatim (`@"..."`) and interpolated literals are recognized.
   * Reserved for a future C# profile; inert today.
   */
  csharpLiterals: boolean;
}

/** The kind of language a document is, used for dispatch. */
export type LanguageKind = 'c' | 'cpp' | 'csharp' | 'rust';

/** C profile: the baseline, and the fallback for unknown language ids. */
export const C_SYNTAX: LanguageSyntax = {
  id: 'c',
  rawStrings: false,
  csharpLiterals: false,
};

/** C++ profile: C plus raw string literals (`R"delim(...)delim"`). */
export const CPP_SYNTAX: LanguageSyntax = {
  id: 'cpp',
  rawStrings: true,
  csharpLiterals: false,
};

/** C# profile: C plus verbatim, interpolated and raw string literals. */
export const CSHARP_SYNTAX: LanguageSyntax = {
  id: 'csharp',
  rawStrings: false,
  csharpLiterals: true,
};

interface LanguageEntry {
  kind: LanguageKind;
  /** Only the C-family entries carry a lexical profile. */
  syntax?: LanguageSyntax;
}

const BY_LANGUAGE_ID: Record<string, LanguageEntry> = {
  c: { kind: 'c', syntax: C_SYNTAX },
  cpp: { kind: 'cpp', syntax: CPP_SYNTAX },
  csharp: { kind: 'csharp', syntax: CSHARP_SYNTAX },
  rust: { kind: 'rust' },
};

const DEFAULT_LANGUAGE: LanguageEntry = { kind: 'c', syntax: C_SYNTAX };

/**
 * Resolves the kind of language for a VSCode language id. Unknown ids fall back
 * to `c`, mirroring the profile fallback below.
 */
export function languageKind(languageId: string): LanguageKind {
  return (BY_LANGUAGE_ID[languageId] ?? DEFAULT_LANGUAGE).kind;
}

/**
 * Resolves the C-family syntax profile for a VSCode language id.
 *
 * Only meaningful for the C family; a kind without a profile (`rust`) and every
 * unknown id get {@link C_SYNTAX}, so an absent profile scans exactly like C.
 */
export function syntaxFor(languageId: string): LanguageSyntax {
  return (BY_LANGUAGE_ID[languageId] ?? DEFAULT_LANGUAGE).syntax ?? C_SYNTAX;
}
