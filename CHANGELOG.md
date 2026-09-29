# Changelog

All notable changes to Shigan are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- C++ support: `.cpp` files are scanned like C plus raw string literals (`R"(...)"`), and `-std=c++NN` defines `__cplusplus`.
- C# support: `.cs` files treat verbatim (`@"..."`), interpolated (`$"..."`) and raw (`"""..."""`) string literals as opaque; a value-less `#define NAME` counts as defined, and `true`/`false` are valid `#if` operands.
- C# conditional symbols come from the nearest `.csproj` / `Directory.Build.props` `DefineConstants` plus the implicit target-framework symbols, controlled by `shigan.csharp.inheritProject`, `shigan.csharp.configuration` and `shigan.csharp.targetFramework`.
- `shigan.csharp.define` for extra C# preprocessor symbols.
- C++ and C# golden fixtures, integration coverage and manual samples.
- `#region` / `#endregion` pairing hints, shown under the same `macros` switch as `#if` (never flagged inactive).
- Creating, editing or deleting a `*.csproj` refreshes the hints automatically, without reloading the window.
- Rust support: `.rs` files are lexed separately (lifetimes vs char literals, `"…"` / `b"…"` / `c"…"` / raw `r#"…"#` strings, nested block comments, opaque `#[…]` attributes) and each `#[cfg(...)]`-gated item gets a clickable gating hint on the item's end line, with one clickable segment per attribute.
- Rust conditional activity is diagnostic-first: rust-analyzer's `inactive_code` diagnostics are authoritative when present, with a lexical fallback from the nearest `Cargo.toml`'s default features plus a host-target inference; `shigan.rust.cfg` overrides either source.
- `shigan.rust.cfg` for extra Rust cfg entries and `shigan.rust.inheritCargo` to toggle reading the nearest `Cargo.toml`.
- Creating, editing or deleting a `Cargo.toml` refreshes the hints automatically, without reloading the window.
- The extension declares `extensionKind: ["workspace"]`, so it runs alongside the workspace's `.csproj` / `Cargo.toml` files.

### Changed

- Settings are now **per language** (`shigan.c.*`, `shigan.cpp.*`, `shigan.csharp.*`, `shigan.rust.*`) and
  `contributes.configuration` is split into titled categories (C, C++, C#, Rust). Old keys are **silently
  ignored - there are no aliases**, so rename them by hand:

  | Old key | New key(s) |
  | --- | --- |
  | `shigan.preprocessor.skipInactiveBrackets` | `shigan.inactive.skipBrackets` |
  | `shigan.preprocessor.skipInactiveDirectives` | `shigan.inactive.skipDirectives` |
  | `shigan.preprocessor.markInactive` | `shigan.inactive.markInactive` |
  | `shigan.preprocessor.trackFileDefines` | `shigan.c.trackFileDefines`, `shigan.cpp.trackFileDefines`, `shigan.csharp.trackFileDefines` (one-to-many) |
  | `shigan.compileFlags` | `shigan.c.compileFlags`, `shigan.cpp.compileFlags`, `shigan.csharp.compileFlags` (one-to-many) |
  | `shigan.inheritCompileCommands` | `shigan.c.inheritCompileCommands`, `shigan.cpp.inheritCompileCommands` (one-to-many; C# never reads `compile_commands.json`) |

  Each language is configured independently: previously `shigan.compileFlags`, `shigan.inheritCompileCommands`
  and `shigan.preprocessor.trackFileDefines` were window-wide, now there is one value per language per window.
  `shigan.show` keeps exactly its two values (`brackets`, `macros`) and the same default.
- `shigan.languages` now defaults to `["c","cpp","csharp","rust"]`, with matching `onLanguage:cpp`, `onLanguage:csharp` and `onLanguage:rust` activation events.
- A lone `{` after a wrapped type declaration (base list / `where` clause) is now labelled with the declaration line (e.g. `class Foo`) instead of the last continuation line.

### Fixed

- C# project files: commented-out `<DefineConstants>` / `<TargetFramework>` in `.csproj` / `Directory.Build.props` are ignored.

### Internal

- Added a language profile seam (`src/core/language.ts`): the VSCode-free core takes a `LanguageSyntax` instead of assuming C.
- Added a language-neutral `ConditionalModel` seam and a single `languageKind()` dispatch on top of `syntaxFor()`, plus the Rust modules (`src/core/lexer/rust.ts`, `src/core/match/rust/{cfg,items,conditionals,diagnostics}.ts`, `src/core/cargo.ts`, `src/cargo-source.ts`).

## [0.0.3] - 2026-09-28

### Fixed

- README: dropped `telemetry.feedback.enabled` from the basic settings example - it is not a Shigan setting, so pasting it did nothing.

## [0.0.2] - 2026-09-26

### Changed

- README: added a ready-to-paste "Basic settings" example.

### Internal

- Releases are now changelog-driven: `CHANGELOG.md` is the source of truth, `just release <version>` bumps the version and creates the tag, and the release workflow publishes the matching section as the GitHub Release notes.

## [0.0.1] - 2026-09-26

### Added

- Clickable bracket pairing hints for C: a closing line shows `:<open>-<close>` plus the opening statement, and every segment jumps to its target.
- Preprocessor pairing hints for `#if` / `#ifdef` / `#ifndef` -> `#elif` / `#else` -> `#endif`, with `<-` pointing at the preceding branch and `<=` at the opening directive.
- Conservative `#if` evaluation driven by `shigan.compileFlags`, an optional `compile_commands.json`, and in-file `#define` / `#undef` tracking.
- Inactive-code handling through `shigan.preprocessor.skipInactiveBrackets`, `shigan.preprocessor.skipInactiveDirectives` and `shigan.preprocessor.markInactive`.
- Inlay-hint rendering with click-to-jump label parts and hover previews.
- Settings for the trigger mode, active languages, hint ranges, labels and macro sources.
- English, Simplified Chinese and Japanese UI localization.

[Unreleased]: https://github.com/Irumyuui/shigan/compare/v0.0.3...HEAD
[0.0.3]: https://github.com/Irumyuui/shigan/releases/tag/v0.0.3
[0.0.2]: https://github.com/Irumyuui/shigan/releases/tag/v0.0.2
[0.0.1]: https://github.com/Irumyuui/shigan/releases/tag/v0.0.1
