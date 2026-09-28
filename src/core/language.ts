/**
 * Language profile seam for the VSCode-free core.
 *
 * `LanguageSyntax` is the place where per-language lexical and macro
 * differences live, so the core does not have to assume C unconditionally.
 *
 * This module is deliberately VSCode-free: the VSCode layer resolves a profile
 * from `document.languageId` (via {@link syntaxFor}) and passes it down.
 */
export interface LanguageSyntax {
  /** Internal identifier of the profile, e.g. `c`. */
  id: string;
  /** Lexical family the profile belongs to. */
  family: 'c';
  /** Whether C++-style raw string literals (`R"(...)"`) are recognized. */
  rawStrings: boolean;
  /**
   * Whether C# verbatim (`@"..."`) and interpolated literals are recognized.
   * Reserved for a future C# profile; inert today.
   */
  csharpLiterals: boolean;
}

/** C profile: the baseline, and the fallback for unknown language ids. */
export const C_SYNTAX: LanguageSyntax = {
  id: 'c',
  family: 'c',
  rawStrings: false,
  csharpLiterals: false,
};

/** C++ profile: C plus raw string literals (`R"delim(...)delim"`). */
export const CPP_SYNTAX: LanguageSyntax = {
  id: 'cpp',
  family: 'c',
  rawStrings: true,
  csharpLiterals: false,
};

const BY_LANGUAGE_ID: Readonly<Record<string, LanguageSyntax>> = {
  c: C_SYNTAX,
  cpp: CPP_SYNTAX,
};

/**
 * Resolves the syntax profile for a VSCode language id.
 *
 * `c` and `cpp` have dedicated profiles; every other id falls back to C. This
 * is the single mapping that changes when a language is added, so callers can
 * stay language-agnostic.
 */
export function syntaxFor(languageId: string): LanguageSyntax {
  return BY_LANGUAGE_ID[languageId] ?? C_SYNTAX;
}
