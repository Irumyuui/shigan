# AGENTS.md

VSCode extension for C: clickable bracket and `#if/#else/#endif` pairing hints.
Hints are **inlay hints** at the end of a line; every segment is clickable and jumps to its target.

The extension is **Shigan** (`shigan.*` settings, `shigan.*` command ids), and the repo folder matches. Only the
`shigan.*` namespace exists today — don't resurrect pre-rename keys (old settings are silently ignored).

## Commands

`bun` is the package manager (`bun.lock`); the `just` recipes wrap npm scripts that call `node`.
The justfile selects PowerShell only on Windows (`[windows] set shell`); on Linux/macOS just's default `sh -cu` is used, so the same recipes also run in CI.

```sh
just                   # list recipes
just test              # tsc --noEmit + vitest (must pass)
just test-integration  # builds dist + out/integration, runs an isolated VSCode (.vscode-test/, ~320 MB, cached after first run)
just package           # -> artifacts/shigan-<version>.vsix (esbuild + vsce --no-dependencies)
just package-min       # minified, no sourcemap
bunx vitest run test/unit/hints.test.ts        # one unit file
bunx vitest run test/unit/hints.test.ts -t "single-line"   # one test
```

- **Fastest way to see behaviour**: `bun run inspect <file.c> [always|cursor]` prints every hint with its text,
  `(inactive)` marker and per-segment jump targets. It honours `<file>.macros.json` seeds like the fixture harness.
- Manual check: F5 (`.vscode/launch.json`) + `test/manual/sample.c` + `CHECKLIST.md`.
- CI: `.github/workflows/ci.yml` runs `just typecheck test-unit` and `xvfb-run --auto-servernum just test-integration` on ubuntu-latest for every branch push/PR, then `just package` and uploads the VSIX artifact. CI installs pinned just 1.58.0 in BOTH jobs; bump `JUST_VERSION` and `JUST_SHA256` together when upgrading, and keep the two install steps identical. Tag pushes are excluded (`branches: ['**'] filter`) - releasing is handled by `.github/workflows/release.yml` (see Releases).

## Releases

Releasing = bump `package.json` on `main`, commit, then push a matching tag:

```sh
git tag v0.0.1 && git push origin v0.0.1
```

`.github/workflows/release.yml` verifies the tagged commit (same checks as CI), packages the VSIX and creates the
GitHub Release with the `.vsix` attached (`gh release create --generate-notes`, `permissions: contents: write`).
The tag must equal `v<package.json version>`. Marketplaces are not published. If the workflow failed before
creating the Release, only the tag needs deleting; if a Release exists, delete it first (`gh` must be
authenticated - otherwise delete it in the GitHub web UI):

```sh
gh release delete v0.0.1 --yes
git push --delete origin v0.0.1
git tag -d v0.0.1
```

## Architecture

- `src/core/**` is deliberately **`vscode`-free** (lexer, bracket matcher, preprocessor pairing, `#if` evaluator,
  settings mapping) so vitest can run it. Never import `vscode` there; the VSCode side lives in `src/render/**`,
  `src/config.ts`, `src/extension.ts`.
- `src/service.ts` owns macros (`compileFlags` + optional `compile_commands.json`), conditional evaluation and the
  caches. The inlay-hint provider, hover provider and diagnostic command all go through `computeDocumentHints`;
  settings changes must call `invalidate()`.
- Rendering is inlay hints on purpose: only `InlayHintLabelPart.command` supports click-to-jump, so colours come from
  the theme (`editorInlayHint.foreground`) and there is no colour setting.
- A hint is a `HintPart[]` (`text`, `target`, `title`); `hint.text` must stay the concatenation of the part texts
  (fixtures, hover and the diagnostic command rely on it).
- `always` means *always* — nothing is hidden because of `#if` state. Inactive code is handled by
  `skipInactiveBrackets` (matching), `skipInactiveDirectives` (hiding) and `markInactive` (the `(inactive)` marker).
  The evaluator is conservative: unknown conditions never mark anything inactive.
- Range text is `:start-end` with a colon on purpose (`#1-3` collided visually with directives).

## Gotchas

- **Localization is not optional.** Runtime strings need an entry in `l10n/bundle.l10n.{zh-cn,ja}.json` used via
  `vscode.l10n.t`; settings need a key in `package.nls.json`, `package.nls.zh-cn.json` and `package.nls.ja.json`
  while `package.json` references it as `%key%`. Missing entries fall back to English silently, so
  `test/unit/localization.test.ts` fails on any drift — including `vscode.l10n.t` calls that are not string
  literals (a computed message cannot be extracted).
- **A new setting touches 6+ files**: `package.json`, the three `package.nls*.json`, `src/core/settings.ts`,
  `test/unit/config.test.ts`, `test/integration/settings.test.ts` (plus README).
- **Integration tests restore settings by writing defaults**, never `update(key, undefined)` — removal proved
  unreliable and left `shigan.enable: false` behind, silently emptying every later test. Copy the `BASELINE` pattern
  in `test/integration/settings.test.ts`.
- `settings.test.ts` generates `test/integration/workspace/fixture/compile_commands.json` at runtime (its `directory`
  must be absolute) and deletes it in `suiteTeardown`; workspace settings land in `test/integration/workspace/.vscode/`
  (both gitignored).
- `shigan.internal.computedHints` is an undocumented diagnostic command the integration tests depend on;
  `shigan.jumpToMatch` is invoked from inlay-hint parts and is intentionally not in `contributes.commands`.
- vsce rejects a non-ASCII `publisher` (identifier only) — the human name lives in `author`. Packaging passes
  `--no-dependencies`: everything is bundled into `dist/`, so vsce's `npm`-based dependency detection is skipped.

## Tests

- `test/unit/**` — vitest, pure logic. `test/unit/support.ts` exposes `predicates(text, seed)` mirroring the
  extension's evaluation; use it for anything involving `#if`.
- `test/unit/performance.test.ts` is a scale guard, not a benchmark: synthetic 20k–100k-line documents with
  deliberately generous wall-clock budgets. Keep the budgets loose (they catch superlinear regressions, not
  micro-timing) — tightening them makes the suite flaky.
- `test/fixtures/{brackets,macros}/*.c` + `.expected.json` golden files; a macro fixture may add `<case>.macros.json`
  to seed macros. Verify expectations by hand or with `bun run inspect` — never blind-snapshot.
- `test/integration/**` runs in a real VSCode; `.vscode-test.mjs` globs `out/integration/**/*.test.js`, built from
  `test/integration/*.test.ts`.
- `vscode.executeInlayHintProvider` works in the test host: `extension.test.ts` uses it to assert the real provider
  output (label parts and tooltips), which the diagnostic command alone cannot cover.
- `test/manual/**` is only for F5 self-testing.
