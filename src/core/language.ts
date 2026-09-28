/**
 * Language profile seam for the VSCode-free core.
 *
 * The tokenizer and matcher are written for C today. `LanguageSyntax` is the
 * place where per-language lexical differences will live once a second
 * language is added, so the core no longer has to assume C unconditionally.
 *
 * This module is deliberately VSCode-free: the VSCode layer resolves a profile
 * from `document.languageId` (via {@link syntaxFor}) and passes it down.
 */
export interface LanguageSyntax {
  /** Internal identifier of the profile, e.g. `c`. */
  id: string;
  /** Lexical family the profile belongs to. */
  family: 'c';
  /**
   * Whether C++-style raw string literals (`R"(...)"`) are recognized.
   * Reserved for a future C++ profile; inert today.
   */
  rawStrings: boolean;
  /**
   * Whether C# verbatim (`@"..."`) and interpolated literals are recognized.
   * Reserved for a future C# profile; inert today.
   */
  csharpLiterals: boolean;
}

/** The only active profile today. Used for C and, for now, C++. */
export const C_SYNTAX: LanguageSyntax = {
  id: 'c',
  family: 'c',
  rawStrings: false,
  csharpLiterals: false,
};

const BY_LANGUAGE_ID: Readonly<Record<string, LanguageSyntax>> = {
  c: C_SYNTAX,
  cpp: C_SYNTAX,
};

/**
 * Resolves the syntax profile for a VSCode language id.
 *
 * `c`, `cpp` and every unknown id currently resolve to {@link C_SYNTAX}: C is
 * the only active language. This is the single mapping that changes when a real
 * language is added, so callers can stay language-agnostic.
 */
export function syntaxFor(languageId: string): LanguageSyntax {
  return BY_LANGUAGE_ID[languageId] ?? C_SYNTAX;
}
