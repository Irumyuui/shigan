/**
 * Language profile seam for the VSCode-free core.
 *
 * The dialect data (`LanguageSyntax`) describes the C family's lexical
 * differences. Which *kind* of language an id is — and therefore which
 * pipeline handles it — is a separate decision, so callers dispatch on
 * {@link languageKind} first and only consult {@link syntaxFor} for the C
 * family (`c`/`cpp`/`csharp`). A kind without a syntax profile (Rust, today)
 * is still a first-class kind; it simply scans through its own pipeline.
 *
 * This module is deliberately VSCode-free: the VSCode layer resolves a profile
 * from `document.languageId` and passes it down.
 */

/** Identifier of a C-family lexical profile. */
export type SyntaxId = 'c' | 'cpp' | 'csharp';

export interface LanguageSyntax {
  /** Internal identifier of the profile, e.g. `c`. */
  id: SyntaxId;
  /** Whether C++-style raw string literals (`R"(...)"`) are recognized. */
  rawStrings: boolean;
  /** Whether C# verbatim (`@"..."`) and interpolated literals are recognized. */
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

/**
 * Every known language id. Typed as `Record<LanguageKind, LanguageEntry>` so a
 * new kind cannot be added without an entry here (the compiler rejects the
 * incomplete record).
 */
const BY_LANGUAGE_ID: Record<LanguageKind, LanguageEntry> = {
  c: { kind: 'c', syntax: C_SYNTAX },
  cpp: { kind: 'cpp', syntax: CPP_SYNTAX },
  csharp: { kind: 'csharp', syntax: CSHARP_SYNTAX },
  rust: { kind: 'rust' },
};

const DEFAULT_LANGUAGE: LanguageEntry = { kind: 'c', syntax: C_SYNTAX };

/**
 * Looks up an exact language id, falling back to the C entry for unknown ids.
 * Own-property checked so prototype names (`toString`, …) also fall back
 * instead of resolving to a non-entry.
 */
function entryFor(languageId: string): LanguageEntry {
  return Object.prototype.hasOwnProperty.call(BY_LANGUAGE_ID, languageId)
    ? BY_LANGUAGE_ID[languageId as LanguageKind]
    : DEFAULT_LANGUAGE;
}

/**
 * Resolves the kind of language for a VSCode language id. Unknown ids fall back
 * to `c`, mirroring the profile fallback below.
 */
export function languageKind(languageId: string): LanguageKind {
  return entryFor(languageId).kind;
}

/**
 * Resolves the C-family syntax profile for a VSCode language id.
 *
 * Only meaningful for the C family; a kind without a profile (`rust`) and every
 * unknown id get {@link C_SYNTAX}, so an absent profile scans exactly like C.
 */
export function syntaxFor(languageId: string): LanguageSyntax {
  return entryFor(languageId).syntax ?? C_SYNTAX;
}
