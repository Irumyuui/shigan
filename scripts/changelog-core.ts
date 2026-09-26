/**
 * Pure helpers for reading `CHANGELOG.md` (Keep a Changelog format).
 *
 * Deliberately free of I/O and side effects so vitest can import it; the CLI
 * wrapper lives in `scripts/changelog.ts`.
 */

/** Trims the input and strips one leading `v` / `V`. */
export function normalizeVersion(input: string): string {
  const trimmed = input.trim();
  return trimmed.startsWith('v') || trimmed.startsWith('V') ? trimmed.slice(1) : trimmed;
}

/** Escapes regular-expression metacharacters. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Returns the body of the `## [<version>]` section, heading line excluded and
 * surrounding blank lines trimmed.
 *
 * Returns `undefined` when no heading matches (or the version is not a
 * releasable version such as `Unreleased`), and `''` when the section exists
 * but is empty.
 */
export function extractSection(markdown: string, version: string): string | undefined {
  const target = normalizeVersion(version);
  if (target === '' || target.toLowerCase() === 'unreleased') {
    return undefined;
  }

  const heading = new RegExp(`^##\\s+\\[?${escapeRegExp(target)}\\]?(\\s|$)`);
  // A section ends at the next level-2 heading or at the link-reference
  // definitions at the bottom of a Keep a Changelog file (`[1.0.0]: https://…`).
  const nextSection = /^(##(\s|$)|\[[^\]]*\]:)/;
  const lines = markdown.split(/\r?\n/);

  const start = lines.findIndex((line) => heading.test(line));
  if (start === -1) {
    return undefined;
  }

  const body: string[] = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    if (nextSection.test(lines[index])) {
      break;
    }
    body.push(lines[index]);
  }

  // Trim leading/trailing blank lines only, never interior ones.
  while (body.length > 0 && body[0].trim() === '') {
    body.shift();
  }
  while (body.length > 0 && body[body.length - 1].trim() === '') {
    body.pop();
  }

  return body.join('\n');
}
