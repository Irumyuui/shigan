# AGENTS.md

VSCode extension for C, C++, C# and Rust: clickable bracket and conditional-pairing hints
(`#if/#else/#endif` for the C family, `#[cfg(...)]` item gating for Rust).
Hints are **inlay hints** at the end of a line; every segment is clickable and jumps to its target.

The extension is **Shigan** (`shigan.*` settings, `shigan.*` command ids), and the repo folder matches. Only the
`shigan.*` namespace exists today — don't resurrect pre-rename keys (old settings are silently ignored).

## Commands

`bun` is the package manager (`bun.lock`); the `just` recipes wrap npm scripts that call `node`.
The justfile selects PowerShell only on Windows (`[windows] set shell`); on Linux/macOS just's default `sh -cu` is used, so the same recipes also run in CI.

```sh
just                   # list recipes
just test              # tsc --noEmit + vitest (must pass)
just test-integration  # builds dist + out/integration, runs an isolated VSCode (.vscode-test/, ~1 GB extracted per cached build, cached after first run)
just package           # -> artifacts/shigan-<version>.vsix (esbuild + vsce --no-dependencies)
just package-min       # minified, no sourcemap
bunx vitest run test/unit/hints.test.ts        # one unit file
bunx vitest run test/unit/hints.test.ts -t "single-line"   # one test
```

- **Fastest way to see behaviour**: `bun run inspect <file> [always|cursor]` prints every hint with its text,
  `(inactive)` marker and per-segment jump targets. It picks the language from the file extension (`.c`/`.cpp`/`.cs`/`.rs`)
  and honours `<file>.macros.json` (C family) / `<file>.cfg.json` (Rust) seeds like the fixture harness.
- Manual check: F5 (`.vscode/launch.json`) + `test/manual/sample.{c,cpp,cs,rs}` + `CHECKLIST.md`.
- CI: `.github/workflows/ci.yml` runs `just typecheck test-unit` and `xvfb-run --auto-servernum just test-integration` on ubuntu-latest for every branch push/PR, then `just package` and uploads the VSIX artifact. CI installs pinned just 1.58.0 in BOTH jobs; bump `JUST_VERSION` and `JUST_SHA256` together when upgrading, and keep the two install steps identical. Tag pushes are excluded (`branches: ['**'] filter`) - releasing is handled by `.github/workflows/release.yml` (see Releases).

## Releases

`CHANGELOG.md` is the source of truth for what changed: every release needs a non-empty `## [<version>]` section
(Keep a Changelog format) before the tag can be pushed. The pure parsing lives in `scripts/changelog-core.ts`
(unit-tested in `test/unit/changelog.test.ts`); `scripts/changelog.ts` is the CLI that CI and tooling call.

Releasing = write the changelog entry, then either `just release <version>` (validates the entry, bumps
`package.json`, commits and creates the annotated tag locally; add `--push` to also push) or by hand: bump
`package.json` on `main`, commit, then push a matching tag:

```sh
git tag v0.0.1 && git push origin v0.0.1
```

`.github/workflows/release.yml` verifies the tagged commit (same checks as CI) plus a non-empty `CHANGELOG.md`
entry for the version, packages the VSIX and creates the GitHub Release with the `.vsix` attached, using that
changelog section as the release notes (`gh release create --notes-file`, `permissions: contents: write`).
The tag must equal `v<package.json version>`. `CHANGELOG.md` ships in the VSIX, so VS Code's extension page shows
the changelog after an update. If a release's notes are wrong, run the `Backfill release notes` workflow
(`workflow_dispatch`, input `tag`) to refresh them from `CHANGELOG.md` - it only shows up in the Actions UI once
the workflow is on the default branch. Marketplaces are not published. If the workflow failed before
creating the Release, only the tag needs deleting; if a Release exists, delete it first (`gh` must be
authenticated - otherwise delete it in the GitHub web UI):

```sh
gh release delete v0.0.1 --yes
git push --delete origin v0.0.1
git tag -d v0.0.1
```

## Architecture

- `src/core/**` is deliberately **`vscode`-free** (lexer, bracket matcher, preprocessor pairing, `#if` evaluator,
  Rust `#[cfg]` model, Cargo/csproj readers, settings mapping) so vitest can run it. Never import `vscode` there;
  the VSCode side lives in `src/render/**`, `src/config.ts`, `src/extension.ts`.
- `src/core/language.ts` is the language seam: `languageKind(languageId)` is the single dispatch table
  (`c`/`cpp`/`csharp`/`rust`; unknown ids fall back to `c`) and `syntaxFor(languageId)` returns a `LanguageSyntax`
  profile (`c`, `cpp`, `csharp`) that `scan` and `evaluateConditionals` accept as an optional argument. Per-language
  lexical rules live in the profile flags: C++ raw strings (`rawStrings`), C# verbatim/interpolated/raw literals
  (`csharpLiterals`). Rust is a kind *without* a profile, so `syntaxFor` falls back to `C_SYNTAX` — callers must
  dispatch on `languageKind` first. C is the default and the fallback, so an absent profile scans exactly like C.
- C# conditional symbols come from `src/core/csproj.ts` (extracts `DefineConstants` and `TargetFramework`, derives
  the implicit target-framework symbols) via `src/csproj-source.ts` (nearest `.csproj` + `Directory.Build.props`,
  cached like `flags-source.ts`). A value-less `#define NAME` counts as `NAME=1`, and `true`/`false` are seeded as
  `#if` operands.
- Rust runs a separate pipeline off the same seam:
  - `src/core/lexer/rust.ts` (`scanRust`) yields `brackets` + `cfgs` (directives are always empty): lifetimes vs char
    literals, `"…"`/`b"…"`/`c"…"`/`r#"…"#`/`br`/`cr` strings, NESTED block comments, and opaque `#[…]`/`#![…]`
    attributes (only `cfg`/`cfg_attr` become tokens).
  - `src/core/match/rust/cfg.ts` is the three-valued (Kleene) evaluator (`evaluateCfgPredicate`, `hostCfg`,
    `parseRustCfgEntries`): `true`/`false` are decided, `undefined` is unknown and never marks code inactive.
  - `src/core/match/rust/items.ts` (`pairCfgItems`) finds the item span each `#[cfg]` gates; `conditionals.ts`
    (`rustConditionals`) turns spans into `kind: 'conditional'` hints and reports `inactiveLines`;
    `diagnostics.ts` normalizes rust-analyzer's inactive-code diagnostics and merges them with the lexical result.
  - `src/core/cargo.ts` (`parseCargoFeatures`, pure minimal TOML scan) + `src/cargo-source.ts` (`findCargoFeatures`,
    `hasAncestorManifest`, per-directory cache) resolve `Cargo.toml` feature facts. Both caches are cleared by
    `invalidate()` and `invalidateProjectFiles()`.
  - `src/rust-diagnostics.ts` reads `vscode.languages.getDiagnostics` for the document; `src/service.ts` keys the
    hint cache on a per-URI `diagnosticsRevision` bumped via `noteRustDiagnosticsChanged` on
    `onDidChangeDiagnostics`, so hover and the diagnostic command never serve a stale activity answer.
- `src/service.ts` owns macros, conditional evaluation and the caches. Macro sources are per language:
  C and C++ use their own `shigan.c.*` / `shigan.cpp.*` group (`trackFileDefines`, `compileFlags`,
  `inheritCompileCommands` + optional `compile_commands.json`); C# uses `shigan.csharp.*`
  (`trackFileDefines`, `compileFlags`, `define`, project symbols) and never `compile_commands.json`.
  Rust uses `shigan.rust.cfg` + `shigan.rust.inheritCargo` + a host inference + the nearest `Cargo.toml`.
  `languageSettingsFor(config, languageKind(languageId))` resolves the C-family group (C# returns
  `inheritCompileCommands: false` because it has no such setting). The inlay-hint provider, hover provider
  and diagnostic command all go through `computeDocumentHints`; settings changes
  must call `invalidate()` (which also clears the csproj and cargo caches).
- `src/extension.ts` watches `**/*.csproj` AND `**/Cargo.toml` per workspace folder (create/change/delete) with its own debounce
  (`projectTimer`, deliberately separate from the cursor-triggered `refreshTimer`) and calls
  `invalidateProjectFiles()` — the targeted counterpart of `invalidate()` that leaves the `compile_commands` cache
  alone. Watchers are rebuilt on `onDidChangeWorkspaceFolders` and disposed through a single `Disposable`.
  `package.json` declares `extensionKind: ["workspace"]`, so the extension runs where the sources (and their
  `Cargo.toml`/`.csproj`) live.
- Rendering is inlay hints on purpose: only `InlayHintLabelPart.command` supports click-to-jump, so colours come from
  the theme (`editorInlayHint.foreground`) and there is no colour setting.
- A hint is a `HintPart[]` (`text`, `target`, `title`); `hint.text` must stay the concatenation of the part texts
  (fixtures, hover and the diagnostic command rely on it).
- `always` means *always* — nothing is hidden because of `#if` state. Inactive code is handled by
  `skipInactiveBrackets` (matching), `skipInactiveDirectives` (hiding) and `markInactive` (the `(inactive)` marker).
  The evaluator is conservative: a condition it cannot parse stays unknown and never marks anything inactive,
  while a literal `0` — and an undefined identifier, which the preprocessor also reads as `0` — is decided
  inactive.
- Range text is `:start-end` with a colon on purpose (`#1-3` collided visually with directives).
- `#region`/`#endregion` pairing lives in `src/core/match/c-preprocessor.ts` (`pairRegions`) and ships under the `macros`
  switch — no separate setting, and it is never marked inactive. A lone `{` is labelled by a bounded continuation
  walk in `labelFor` that only returns a wrapped type declaration; other constructs keep the previous-line label.

## Gotchas

- **Localization is not optional.** Runtime strings need an entry in `l10n/bundle.l10n.{zh-cn,ja}.json` used via
  `vscode.l10n.t`; settings need a key in `package.nls.json`, `package.nls.zh-cn.json` and `package.nls.ja.json`
  while `package.json` references it as `%key%`. Missing entries fall back to English silently, so
  `test/unit/localization.test.ts` fails on any drift — including `vscode.l10n.t` calls that are not string
  literals (a computed message cannot be extracted).
- **A new setting touches 6+ files**: `package.json` (the matching
  `contributes.configuration` category), the three `package.nls*.json`, `src/core/settings.ts`,
  `test/unit/config.test.ts`, `test/integration/settings.test.ts` + `test/integration/support.ts` (plus README).
  The manifest is an ARRAY of titled per-language categories; `config.test.ts` flattens it and enforces
  "every key in exactly one category", the no-dotted-prefix rule and that retired ids never reappear.
  Settings are per language (`shigan.c.*` / `shigan.cpp.*` / `shigan.csharp.*` / `shigan.rust.*`), so a knob
  split across languages multiplies the manifest properties, the three nls files and the defaults in
  `src/core/settings.ts` — a missed one fails the drift/localization tests, which is intended.
  `shigan.show` takes three values (`brackets`/`macros`/`conditional`): `macros` gates the C-family
  `#if`/`#region` hints, `conditional` the Rust `#[cfg]` hints.
- **Language support is on by default**: `shigan.languages` defaults to `["c","cpp","csharp","rust"]` and `package.json`
  lists `onLanguage:` for each. Adding a language touches `src/core/language.ts` (the profile/kind), both of those
  places, `src/core/settings.ts` and `test/unit/config.test.ts`.
- **Rust `#[cfg]` spans are item-scoped by design.** `pairCfgItems` (`src/core/match/rust/items.ts`) only reports an
  item whose first depth-equal `{` (and its match) is within 300 lines, so semicolon-terminated items
  (`mod m;`, `use …;`, tuple structs, `type`/`static`/`const` without a brace body) and `#[cfg]` on macro bodies,
  match arms, struct fields or statements produce NO span — items nested in `mod`/`impl`/`trait` do. The hint carries
  `kind: 'conditional'` and is emitted under the `conditional` `shigan.show` value (C-family directive hints stay under
  `macros`); the two gates are independent, and hiding either never changes the models the other's activity relies on.
- **Rust activity is diagnostic-first, lexical-second.** `mergeRustInactiveLines` treats rust-analyzer's
  `inactive_code` diagnostics as authoritative when a matching diagnostic exists OR rust-analyzer is active
  (`src/rust-diagnostics.ts`); authoritative diagnostics *replace* the lexical negatives (they never union), and
  without an authoritative source they only add inactive lines. Explicit `shigan.rust.cfg`-decided spans win over
  both, and diagnostics never synthesize hints — only activity. `src/service.ts` keeps the per-URI
  `diagnosticsRevision` in the hint-cache key so hover/`computedHints` never read a stale answer.
- **Cargo facts are two files**: `src/core/cargo.ts` is the pure minimal TOML scan (`parseCargoFeatures`: `[features]`,
  implicit `optional = true` features, the `default` closure, `virtual`), and `src/cargo-source.ts` walks up to the
  nearest `Cargo.toml` with a per-directory cache (`findCargoFeatures`) plus `hasAncestorManifest`. `invalidate()`
  and `invalidateProjectFiles()` both call `clearCargoCache()`.
- **Integration tests restore settings by writing defaults**, never `update(key, undefined)` — removal proved
  unreliable and left `shigan.enable: false` behind, silently emptying every later test. Copy the `BASELINE` pattern
  in `test/integration/settings.test.ts`.
- `settings.test.ts` generates `test/integration/workspace/fixture/settings/compile_commands.json` at runtime (its
  `directory` must be absolute) and deletes it in `suiteTeardown`; every integration suite cleans only its own
  `fixture/<suite>` directory, never the shared `fixture/` root.
- `.vscode-test.mjs` generates and opens `test/integration/shigan-test.code-workspace`, so the host starts as a
  multi-root workspace: adding the first extra folder to a single-folder window restarts the extension host and would
  kill the in-host test run. `ConfigurationTarget.Workspace` therefore writes into that generated, gitignored file
  instead of a folder `.vscode/settings.json`; the primary folder stays first, so `workspaceFolders[0]` is still
  `test/integration/workspace`.
- `shigan.internal.computedHints` is an undocumented diagnostic command the integration tests depend on;
  `shigan.jumpToMatch` is invoked from inlay-hint parts and is intentionally not in `contributes.commands`.
- vsce rejects a non-ASCII `publisher` (identifier only) — the human name lives in `author`. Packaging passes
  `--no-dependencies`: everything is bundled into `dist/`, so vsce's `npm`-based dependency detection is skipped.

## Tests

- `test/unit/**` — vitest, pure logic. `test/unit/support.ts` exposes `predicates(text, seed, languageId)` for the
  C-family `#if` evaluation and `rustHarness(text, seed)` / `RustCfgSeed` for the Rust `#[cfg]` model; both mirror
  what the extension wires in.
- `test/unit/performance.test.ts` is a scale guard, not a benchmark: synthetic 20k–100k-line documents with
  deliberately generous wall-clock budgets. Keep the budgets loose (they catch superlinear regressions, not
  micro-timing) — tightening them makes the suite flaky.
- `test/fixtures/{c,cpp,csharp,rust}/{brackets,macros}/` + `.expected.json` golden files; the language comes from the
  directory, never from the extension. A macro fixture may add `<case>.macros.json` (C family) or `<case>.cfg.json`
  (Rust) to seed evaluation; the Rust seed is platform-independent by design (`host`/`features`/`manifest`/`cfg` from
  the JSON, never `process`). `fixtures.test.ts`/`macros-fixtures.test.ts` pick `scan`+`predicates` vs
  `scanRust`+`rustHarness` per language. Verify expectations by hand or with `bun run inspect` — never blind-snapshot.
- Language-specific unit tests are split per language (`evaluate-csharp.test.ts`, `flags-cpp.test.ts`,
  `cpp-scan.test.ts`, `csharp-scan.test.ts`, `csproj*.test.ts`, plus the Rust `cfg`/`conditionals`/`diagnostics` and
  `cargo*` suites); `language.test.ts` covers the kind dispatch and profile mapping.
- `test/integration/support.ts` holds the shared `BASELINE` / `openFixture` / hint helpers. Every integration suite
  owns its own `test/integration/workspace/fixture/<suite>` directory and cleans only that — never the shared
  `fixture/` root, which would delete another suite's files.
- `test/integration/**` runs in a real VSCode; `.vscode-test.mjs` globs `out/integration/**/*.test.js`, built from
  `test/integration/*.test.ts`.
- `test/integration/{cpp,csharp,rust}.test.ts` cover per-language routing, C# project symbols / the csproj watcher
  (single-root create/change/delete plus a multi-root folder-add rebuild), and the Rust suite. The test host runs with
  `--disable-extensions`, so `openFixture` calls `vscode.languages.setTextDocumentLanguage` to force the language id.
- `test/integration/rust.test.ts` (suite `Shigan Rust`, 5 tests) owns `fixture/rust` and covers: routing + a Cargo
  default-feature item pairing; `rust.inheritCargo = false` turning an undeclared feature unknown; `rust.cfg = ["-unix"]`
  deactivating an item and its brackets; the `Cargo.toml` watcher (change/delete/create); and a diagnostics stub. CI has
  no rust-analyzer, so that test publishes its own `vscode.DiagnosticCollection` with `source: 'rust-analyzer'` and
  polls the hint flip — including the kebab-case code spelling, a non-matching `rustc` source, and the authority
  side effect (a lexical negative elsewhere flips active while a matching diagnostic exists).
- `vscode.executeInlayHintProvider` works in the test host: `extension.test.ts` uses it to assert the real provider
  output (label parts and tooltips), which the diagnostic command alone cannot cover.
- `test/manual/**` is only for F5 self-testing.
