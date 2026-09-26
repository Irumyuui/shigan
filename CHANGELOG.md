# Changelog

All notable changes to Shigan are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.0.1] - 2026-09-26

### Added

- Clickable bracket pairing hints for C: a closing line shows `:<open>-<close>` plus the opening statement, and every segment jumps to its target.
- Preprocessor pairing hints for `#if` / `#ifdef` / `#ifndef` -> `#elif` / `#else` -> `#endif`, with `<-` pointing at the preceding branch and `<=` at the opening directive.
- Conservative `#if` evaluation driven by `shigan.compileFlags`, an optional `compile_commands.json`, and in-file `#define` / `#undef` tracking.
- Inactive-code handling through `shigan.preprocessor.skipInactiveBrackets`, `shigan.preprocessor.skipInactiveDirectives` and `shigan.preprocessor.markInactive`.
- Inlay-hint rendering with click-to-jump label parts and hover previews.
- Settings for the trigger mode, active languages, hint ranges, labels and macro sources.
- English, Simplified Chinese and Japanese UI localization.

[Unreleased]: https://github.com/Irumyuui/shigan/compare/v0.0.1...HEAD
[0.0.1]: https://github.com/Irumyuui/shigan/releases/tag/v0.0.1
