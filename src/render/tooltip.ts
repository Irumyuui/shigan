/**
 * Pure helpers for the click-to-jump tooltip. Kept free of `vscode` imports so
 * the formatting is unit-testable.
 */

const PREVIEW_LINE_COUNT = 3;
const MAX_PREVIEW_LINE_LENGTH = 160;

export interface TooltipLabels {
  /** Used when the segment has no title. */
  fallbackTitle: string;
  /** Rendered after the title, e.g. `— line 3`. */
  lineSuffix: (line: number) => string;
}

export const DEFAULT_TOOLTIP_LABELS: TooltipLabels = {
  fallbackTitle: 'jump target',
  lineSuffix: (line) => `— line ${line}`,
};

/**
 * Markdown for the tooltip of a clickable hint segment:
 *
 * ```text
 * `#else` — line 3
 *
 * ```c
 * #else
 * int b = 2;
 * ```
 * ```
 *
 * `labels` carries the localized strings; the defaults are English so the
 * formatter stays testable without `vscode`.
 */
export function buildJumpTooltip(
  title: string | undefined,
  line: number,
  sourceLines: string[],
  labels: TooltipLabels = DEFAULT_TOOLTIP_LABELS
): string {
  const label =
    title && title.length > 0 ? `\`${title.replace(/`/g, "'")}\`` : labels.fallbackTitle;
  const rows: string[] = [`${label} ${labels.lineSuffix(line + 1)}`];

  const preview = previewLines(sourceLines, line);
  if (preview.length > 0) {
    rows.push('', '```c', ...preview, '```');
  }

  return rows.join('\n');
}

/** The target line plus a couple of following lines, clipped to the document. */
export function previewLines(
  sourceLines: string[],
  startLine: number,
  count = PREVIEW_LINE_COUNT
): string[] {
  if (sourceLines.length === 0) return [];

  const start = Math.max(0, Math.min(startLine, sourceLines.length - 1));
  const end = Math.min(start + Math.max(0, count), sourceLines.length);
  const preview: string[] = [];

  for (let line = start; line < end; line++) {
    const text = (sourceLines[line] ?? '').replace(/\s+$/, '');
    preview.push(
      text.length > MAX_PREVIEW_LINE_LENGTH ? `${text.slice(0, MAX_PREVIEW_LINE_LENGTH)}…` : text
    );
  }

  return preview;
}
