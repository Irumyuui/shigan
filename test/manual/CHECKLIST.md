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
- [ ] Braces of the function inside `#if 0` are **not** hinted, and the
      `#if 0 ... #endif` pair itself is not hinted either
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
