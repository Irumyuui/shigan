# Shigan manual self-test checklist

1. `just build`
2. Open this folder in VSCode and press `F5` (Run Extension). In the
   Extension Development Host window open `test/manual/sample.c`.

> Hints are inlay hints. If nothing shows up, check that
> `editor.inlayHints.enabled` is on. Their color comes from the theme
> (`editorInlayHint.foreground`).

## `shigan.trigger = "cursor"` (default)

- [ ] Put the caret on a `{` or `}`: only that pair's hint appears; clicking it
      jumps to the other bracket
- [ ] Put the caret on `#if` / `#else` / `#endif`: the hint for that directive
      appears; clicking jumps to the referenced directive
- [ ] Move the caret away: the hint disappears
- [ ] In an inactive branch (e.g. inside `#if 0`), the hint carries
      `(inactive)`

## `shigan.trigger = "always"`

- [ ] Every multi-line bracket pair in active code is hinted
- [ ] Single-line pairs (e.g. one-line `if (x) { y(); }`) are not hinted
- [ ] Braces of the function inside `#if 0` are **not** hinted, while the
      `#if 0 ... #endif` directive pair is still hinted and flagged
      `(inactive)`
- [ ] `#ifdef FEATURE_A` ... `#else` ... `#endif` shows `#endif` and the
      `#else` branch hint
- [ ] Braces inside `"a { } [ ] ) ("` (a string) and inside
      `/* disabled on purpose: { } ... */` are never matched

## `shigan.trigger = "hover"`

- [ ] Hovering a bracket or directive shows the hint in the tooltip; no inline
      hints are drawn

## Settings

- [ ] `shigan.enable = false` removes all hints
- [ ] `shigan.show = ["brackets"]` leaves only bracket hints (and vice versa)
- [ ] `shigan.showRange = false` drops the `:a-b` part
- [ ] `shigan.showRangeThreshold = 2` drops the `:a-b` part for pairs that are
      at most two lines apart (e.g. `if (x) {` / `}` on adjacent lines)
- [ ] `shigan.showLabel = false` drops the trailing label
- [ ] `shigan.preprocessor.skipInactiveDirectives = true` hides the
      `#if 0 ... #endif` hint entirely
- [ ] `shigan.compileFlags = ["-DFEATURE_A"]` turns the `#else` branch of
      `feature_a` inactive and the `#ifdef` branch active

## C++ (`test/manual/sample.cpp`)

Open `sample.cpp` in the Extension Development Host (language id `cpp`).

- [ ] The multi-line `R"delim( ... )delim"` raw string produces no bracket
      hints, even though its body contains `{ ( "quoted" ) } [ ]`
- [ ] The escaped `"brace ): } and \"quote\""` string produces no bracket hints
- [ ] `main() { ... }` is hinted as usual
- [ ] `#if defined(FEATURE_A) ... #else ... #endif` hints behave like the C
      sample (`#else` branch inactive only when `FEATURE_A` is defined)

## C# (`test/manual/sample.cs`)

Open `sample.cs` in the Extension Development Host (language id `csharp`).

- [ ] The value-less `#define DEBUG` counts as truthy: the `#if DEBUG` branch is
      live and the `#else` branch is the dead one
- [ ] `@"C:\temp\logs"` and `@"she said ""hi"""` (verbatim strings) produce no
      bracket hints
- [ ] The `""" ... """` raw string produces no bracket hints, even though its
      body spans lines and contains `{`, `}` and `"`
- [ ] `Main() { ... }` is hinted as usual
- [ ] `shigan.csharp.define = ["DEBUG"]` keeps the same branches active when
      the file's own `#define` is removed
- [ ] With `shigan.csharp.inheritProject = true`, symbols from the nearest
      `.csproj` / `Directory.Build.props` drive the `#if` evaluation
- [ ] Editing a `*.csproj` (e.g. adding or removing a symbol from
      `DefineConstants`) refreshes the hints without reloading the window

## Rust (`test/manual/sample.rs`)

Open `sample.rs` in the Extension Development Host (language id `rust`). Expect
` <- :a-b #[cfg(...)]` on each gated item's end line, `(inactive)` on
host-mismatched items, and no hint inside raw strings, lifetimes or attributes.

- [ ] Each `#[cfg(...)]`-gated function gets ` <- :a-b #[cfg(...)]` on its
      closing `}` line, attached to the item, not the attribute
- [ ] `#[cfg(unix)]` / `#[cfg(windows)]`: only the one that does not match the
      host carries `(inactive)`, and its braces do not pair
- [ ] `#[cfg(feature = "extra")]` shows as active/unknown (no `Cargo.toml`
      around the sample) unless `shigan.rust.cfg` or a manifest decides it
- [ ] `shigan.rust.cfg = ["-unix"]` marks the unix item `(inactive)` regardless
      of the host, and its braces stop pairing
- [ ] The `r#" ... { ( } ] ... "#` raw string produces no bracket hints
- [ ] The `<'a>` / `&'a str` lifetime produces no char-literal or bracket hint
- [ ] `borrow() { ... }` and `main() { ... }` are hinted as usual
- [ ] The `#[cfg]` hints ride the `macros` switch: `shigan.show =
      ["brackets"]` hides them
