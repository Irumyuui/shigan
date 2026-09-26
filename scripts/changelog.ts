/**
 * Reads the release notes for a version out of `CHANGELOG.md`.
 *
 *   bun run scripts/changelog.ts check <version|tag>
 *   bun run scripts/changelog.ts extract <version|tag> [--out <file>]
 *
 * Run from the repository root. Both commands exit non-zero when the version
 * has no non-empty section, so a release can never ship without notes.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractSection, normalizeVersion } from './changelog-core';

const USAGE = [
  'Usage:',
  '  bun run scripts/changelog.ts check <version|tag>',
  '  bun run scripts/changelog.ts extract <version|tag> [--out <file>]',
].join('\n');

function fail(message: string, code: number): never {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

const [command, target, ...rest] = process.argv.slice(2);

if ((command !== 'check' && command !== 'extract') || target === undefined) {
  fail(USAGE, 2);
}

let changelog: string;
try {
  changelog = readFileSync(join(process.cwd(), 'CHANGELOG.md'), 'utf8');
} catch {
  fail(`Could not read CHANGELOG.md in ${process.cwd()}.`, 1);
}

const version = normalizeVersion(target);
const body = extractSection(changelog, version);

if (body === undefined || body === '') {
  fail(`CHANGELOG.md has no entry for ${version}. Add a "## [${version}]" section first.`, 1);
}

if (command === 'check') {
  process.stdout.write(`CHANGELOG.md has an entry for ${version}\n`);
} else {
  const outIndex = rest.indexOf('--out');
  const out = outIndex === -1 ? undefined : rest[outIndex + 1];
  if (outIndex !== -1 && out === undefined) {
    fail(`--out needs a file path.\n${USAGE}`, 2);
  }

  const text = `${body}\n`;
  if (out === undefined) {
    process.stdout.write(text);
  } else {
    writeFileSync(out, text);
    process.stdout.write(`Wrote ${out}\n`);
  }
}
