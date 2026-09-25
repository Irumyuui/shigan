# Shigan

Clickable bracket and preprocessor (`#if` / `#else` / `#endif`) pairing hints for C.

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

Hints are **inlay hints**, the only decoration-like UI that supports a click
action. Their colour comes from the theme (`editorInlayHint.foreground`) and
they follow `editor.inlayHints.enabled` — there is no colour/opacity setting.

## Settings

| Key | Default | Description |
| --- | --- | --- |
| `shigan.enable` | `true` | Master switch |
| `shigan.languages` | `["c"]` | Active language ids |
| `shigan.trigger` | `"cursor"` | `cursor` / `always` / `hover` / `off`, for both kinds |
| `shigan.show` | `["brackets","macros"]` | Which kinds to hint |
| `shigan.compileFlags` | `[]` | Compiler-style flags, e.g. `["-DDEBUG=1","-Iinclude","-std=c11"]` |
| `shigan.inheritCompileCommands` | `false` | Also read `-D`/`-I`/`-std` from `compile_commands.json` |
| `shigan.preprocessor.trackFileDefines` | `true` | Evaluate `#define`/`#undef` found in the file |
| `shigan.preprocessor.skipInactiveBrackets` | `true` | Do not match brackets in inactive branches |
| `shigan.preprocessor.skipInactiveDirectives` | `false` | Hide directive hints that refer to an inactive branch/block |
| `shigan.preprocessor.markInactive` | `true` | Append `(inactive)` to hints that refer to an inactive branch/block |
| `shigan.showRange` | `true` | Include the `:start-end` range |
| `shigan.showRangeThreshold` | `0` | Hide the range when the pair is at most N lines apart (`0` = always show) |
| `shigan.showLabel` | `true` | Include the opening statement / directive text |

`${workspaceFolder}`, `${fileDirname}` and `${env:NAME}` are expanded inside
`shigan.compileFlags`.

## Known limitations

- Brackets produced by macro expansion (`#define OPEN {` then `OPEN`) cannot be
  paired from source.
- Macros defined in included headers are unknown unless supplied via
  `shigan.compileFlags`.
- Hints are inlay hints: the theme and `editor.inlayHints.enabled` control
  their appearance.
- Only the lexical tier exists; there is no clangd-backed tier
  (`textDocument/inactiveRegions`).

## Development

With [just](https://github.com/casey/just) (run `just` to list everything):

```sh
just setup             # bun install
just build             # bundle dist/extension.js  (just watch to rebuild)
just test              # typecheck + unit tests    (just ci adds integration)
just package           # -> artifacts/shigan-<version>.vsix
just package-min       # -> artifacts/shigan-<version>-min.vsix
just install           # package, then `code --install-extension`
just clean             # remove dist/, out/, artifacts/
```

Without `just`: `bun run build`, `bun run test:unit`, `bun run package`,
`bun run package:min`, `bun run install:vsix`.

`bun run inspect [file] [always|cursor]` prints the hints Shigan would render.
Press `F5` (Run Extension) for manual testing; see `test/manual/CHECKLIST.md`
and `test/manual/sample.c`.

Installing or updating shows a one-time **Reload Window** prompt, and open
editors are refreshed on activation, so a reload is usually not needed. See
`AGENTS.md` for architecture and localization rules.
