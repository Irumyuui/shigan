# Shigan

[![CI](https://github.com/Irumyuui/shigan/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Irumyuui/shigan/actions/workflows/ci.yml)

Clickable bracket and preprocessor (`#if` / `#else` / `#endif`) pairing hints for C, C++, C# and Rust.

```
if (a == 1) {
    // somethings...
} <- :1-3 if (a == 1)
```

```
#if X

#else <- :1-3 #if X

#endif <- :3-5 #else <= :1-5 #if X
```

Every segment is clickable and jumps to its target: `}` → `{`; `#else` /
`#elif` → the preceding directive; on an `#endif`, `<-` → the preceding branch
and `<=` → the opening `#if`. Hovering shows a title and a short preview of the
target.

## How it works

The core is a VSCode-free lexer and matcher (`src/core`) that understands
line/block comments, string and character literals, backslash-newline splices
and preprocessor conditionals.

- **Brackets** (`()[]{}`): stack matching; the closing line shows
  `:<open>-<close>` and the opening line's text (for a bracket alone on its
  line, the previous line's text).
- **Preprocessor**: `#if` / `#ifdef` / `#ifndef` open a block;
  `#elif` / `#elifdef` / `#elifndef` / `#else` separate branches; `#endif`
  closes it. Each branch line references the preceding branch, and an `#endif`
  in a chain also references the opener.
- **Macros** come from `shigan.compileFlags` and, optionally, the nearest
  `compile_commands.json`; `#define` / `#undef` in the file are tracked. A
  conservative evaluator resolves `#if`, and unknown conditions never mark
  anything inactive.
- **`always`** shows every multi-line bracket pair and every directive pair,
  including directives in a fully inactive `#if 0` block. Inactive code is
  handled by settings: `skipInactiveBrackets` keeps brackets out of matching,
  `skipInactiveDirectives` hides directive hints, and `markInactive` flags
  them.

C and C++ are lexed directly, including C++ raw string literals (`R"(...)"`).
For C#, the conditional symbols come from the `DefineConstants` of the nearest
`.csproj` / `Directory.Build.props` plus the implicit target-framework symbols,
and can be overridden through the `shigan.csharp.*` settings. Editing a
`*.csproj` refreshes the hints automatically, without reloading the window.

Rust is lexed by `src/core/lexer/rust.ts`, which tells lifetimes from char
literals, understands `"…"` / `b"…"` / `c"…"` and raw `r#"…"#` strings, **nests**
block comments, and treats `#[…]` / `#![…]` attributes as opaque while recording
the `cfg` ones. Each `#[cfg(...)]`-gated item gets a clickable hint on the item's
END line — ` <- :attr-end #[cfg(...)]`, with one clickable segment per attribute
— and activity is **diagnostic-first**: rust-analyzer's `inactive_code`
diagnostics win when present, with a lexical fallback computed from the nearest
`Cargo.toml`'s default features plus a pure host-target inference. `shigan.rust.cfg`
overrides either source, and editing a `Cargo.toml` refreshes without a reload.

Hints are **inlay hints**, the only decoration-like UI that supports a click
action. Their colour comes from the theme (`editorInlayHint.foreground`) and
they follow `editor.inlayHints.enabled` — there is no colour/opacity setting.

## Settings

| Key | Default | Description |
| --- | --- | --- |
| `shigan.enable` | `true` | Master switch |
| `shigan.languages` | `["c","cpp","csharp","rust"]` | Active language ids |
| `shigan.trigger` | `"cursor"` | `cursor` / `always` / `hover` / `off`, for both kinds |
| `shigan.show` | `["brackets","macros"]` | Which kinds to hint; `macros` also gates the Rust `#[cfg]` gating hints |
| `shigan.compileFlags` | `[]` | Compiler-style flags, e.g. `["-DDEBUG=1","-Iinclude","-std=c11"]` |
| `shigan.inheritCompileCommands` | `false` | Also read `-D`/`-I`/`-std` from `compile_commands.json` |
| `shigan.csharp.define` | `[]` | Extra C# symbols for `#if`, e.g. `["TRACE","DEBUG"]` |
| `shigan.csharp.inheritProject` | `true` | Read `DefineConstants` from the nearest `.csproj`/`Directory.Build.props` |
| `shigan.csharp.configuration` | `"Debug"` | `$(Configuration)` used when evaluating the C# project file |
| `shigan.csharp.targetFramework` | `""` | Target framework (e.g. `net8.0`); empty = read from the project file |
| `shigan.rust.cfg` | `[]` | Extra Rust cfg entries for `#[cfg]`, e.g. `["unix"]`; `-name` forces false |
| `shigan.rust.inheritCargo` | `true` | Read feature facts from the nearest `Cargo.toml` |
| `shigan.preprocessor.trackFileDefines` | `true` | Evaluate `#define`/`#undef` found in the file |
| `shigan.preprocessor.skipInactiveBrackets` | `true` | Do not match brackets in inactive branches |
| `shigan.preprocessor.skipInactiveDirectives` | `false` | Hide directive hints that refer to an inactive branch/block |
| `shigan.preprocessor.markInactive` | `true` | Append `(inactive)` to hints that refer to an inactive branch/block |
| `shigan.showRange` | `true` | Include the `:start-end` range |
| `shigan.showRangeThreshold` | `0` | Hide the range when the pair is at most N lines apart (`0` = always show) |
| `shigan.showLabel` | `true` | Include the opening statement / directive text |

`${workspaceFolder}`, `${fileDirname}` and `${env:NAME}` are expanded inside
`shigan.compileFlags`.

Basic settings:

```json
{
  "shigan.trigger": "always",
  "shigan.inheritCompileCommands": true,
  "shigan.showRange": true,
  "shigan.showLabel": true,
  "shigan.showRangeThreshold": 0,
  "shigan.preprocessor.skipInactiveDirectives": false
}
```

## Known limitations

- Brackets produced by macro expansion (`#define OPEN {` then `OPEN`) cannot be
  paired from source.
- Macros defined in included headers are unknown unless supplied via
  `shigan.compileFlags`.
- Hints are inlay hints: the theme and `editor.inlayHints.enabled` control
  their appearance.
- Only the lexical tier exists; there is no clangd-backed tier
  (`textDocument/inactiveRegions`).
- MSBuild is not fully evaluated: only the common `DefineConstants`,
  `TargetFramework` and `Configuration` shapes are read.
- Multi-target `<TargetFrameworks>` uses the first entry.
- The implicit target-framework symbol table may drift from newer SDKs.
- Brackets inside C# interpolated-string holes are not matched; the literal is
  treated as opaque.
- `#region`/`#endregion` are paired under the same `shigan.show` `macros`
  switch as `#if`/`#else`/`#endif` (there is no separate toggle) and are never
  flagged `(inactive)`, even inside an `#if 0`.
- The label on a lone `{` only walks past a wrapped base list / `where` clause
  when it ends on a type declaration (`class`/`struct`/`interface`/`enum`/
  `namespace`/`record`/`union`); other wrapped statements keep the plain
  previous-line label.
- Only `*.csproj` is watched: editing `Directory.Build.props` or
  `compile_commands.json` still needs a settings change (or a window reload) to
  take effect, and any `*.csproj` change clears the project caches of every
  workspace folder.
- Rust `#[cfg]` gating only pairs whole **items** with a brace body:
  semicolon-terminated items (`mod m;`, `use …;`, tuple structs,
  `type`/`static`/`const` without a brace body) get NO hint, and `#[cfg]` inside
  macro bodies, match arms, struct fields or statements is not paired (items
  nested in `mod`/`impl`/`trait` ARE).
- The Cargo reader parses only the nearest `Cargo.toml` (`[features]` plus the
  implicit features of `optional = true` dependencies), so workspace feature
  unification, `--features` / `--no-default-features`, resolver-v2 effects and
  build-script (`cargo:rustc-cfg`) cfgs are not modeled; rust-analyzer covers
  those when it is active.
- `feature = "x"` is only decided **false** for a non-virtual manifest with no
  ancestor manifest where `x` is absent from the feature universe;
  declared-but-not-default stays active. Without a manifest every feature
  predicate is unknown.
- Platform cfg (`unix`/`windows`, `target_os`, `target_arch`, …) comes from the
  detected host, so cross-compiling needs `shigan.rust.cfg`.
- `test` and `debug_assertions` are never guessed — they show as active unless
  `shigan.rust.cfg` decides them. This is a deliberate divergence from
  rust-analyzer's defaults: a wrong guess would hide live code.
- rust-analyzer's inactive code is read from open, local documents only, can be
  disabled by the user (then the fallback disagrees), and briefly lags after an
  edit. While a matching diagnostic exists it is authoritative and *replaces*
  the lexical negatives.
- Rust hints ride the existing `shigan.show` `macros` switch; there is no
  separate Rust toggle.

## Development

With [just](https://github.com/casey/just) (run `just` to list everything):

```sh
just setup             # bun install
just build             # bundle dist/extension.js  (just watch to rebuild)
just test              # typecheck + unit tests    (just ci adds integration)
just package           # -> artifacts/shigan-<version>.vsix
just package-min       # -> artifacts/shigan-<version>-min.vsix
just install           # package, then `code --install-extension`
just release 0.1.0     # changelog entry -> bump, commit, tag
just clean             # remove dist/, out/, artifacts/
```

CI (`.github/workflows/ci.yml`) runs the same recipes on every branch push and pull request: typecheck + unit tests, integration tests under `xvfb-run` on a clean Ubuntu runner, then `just package` and attaches the VSIX to the run.

Releases are tag-driven and changelog-driven: add a `## [<version>]` section to `CHANGELOG.md` first, then run `just release <version>` (or bump `package.json` by hand) and push the tag. `.github/workflows/release.yml` verifies that the tag matches the package version and that `CHANGELOG.md` has a non-empty entry for it - it fails otherwise - packages the VSIX and creates a GitHub Release whose notes are that changelog section. `.github/workflows/backfill-release-notes.yml` (manual `workflow_dispatch`, input `tag`) refreshes an existing release's notes from the changelog. `CHANGELOG.md` ships inside the VSIX, so VS Code shows the changelog after an update. Nothing is published to the marketplace.

Without `just`: `bun run build`, `bun run test:unit`, `bun run package`,
`bun run package:min`, `bun run install:vsix`.

`bun run inspect [file] [always|cursor]` prints the hints Shigan would render.
Press `F5` (Run Extension) for manual testing; see `test/manual/CHECKLIST.md`
and `test/manual/sample.c`.

Installing or updating shows a one-time **Reload Window** prompt, and open
editors are refreshed on activation, so a reload is usually not needed. See
`AGENTS.md` for architecture and localization rules.
