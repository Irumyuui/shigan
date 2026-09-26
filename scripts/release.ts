/**
 * Bumps the version, commits and creates the release tag locally.
 *
 *   bun run scripts/release.ts <version> [--push]
 *
 * Requires a non-empty `## [<version>]` section in `CHANGELOG.md` and a clean
 * working tree apart from `package.json` / `CHANGELOG.md`. Run from the
 * repository root. `--push` also pushes the branch and the annotated tag.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractSection, normalizeVersion } from './changelog-core';

const VERSION_PATTERN = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
const ALLOWED_CHANGES = new Set(['package.json', 'CHANGELOG.md']);

const args = process.argv.slice(2);
const push = args.includes('--push');
const [rawVersion] = args.filter((arg) => arg !== '--push');

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

/** Runs git with inherited stdio (for mutating commands). */
function git(gitArgs: string[]): void {
  execFileSync('git', gitArgs, { stdio: 'inherit' });
}

/** Runs git and returns trimmed stdout (for read-only queries). */
function gitCapture(gitArgs: string[]): string {
  return execFileSync('git', gitArgs, { encoding: 'utf8' }).trim();
}

if (rawVersion === undefined) {
  fail('Usage: bun run scripts/release.ts <version> [--push]');
}

const version = normalizeVersion(rawVersion);
if (!VERSION_PATTERN.test(version)) {
  fail(`"${rawVersion}" is not a valid version (expected e.g. 0.1.0).`);
}

const root = process.cwd();
const pkgPath = join(root, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as Record<string, unknown> & {
  version: string;
};

if (pkg.version === version) {
  fail(`package.json is already at ${version}.`);
}

const offenders = gitCapture(['status', '--porcelain'])
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line !== '')
  .map((line) => line.slice(2).trim())
  .filter((path) => !ALLOWED_CHANGES.has(path));

if (offenders.length > 0) {
  fail(`Commit or stash these changes first:\n  ${offenders.join('\n  ')}`);
}

const body = extractSection(readFileSync(join(root, 'CHANGELOG.md'), 'utf8'), version);
if (body === undefined || body === '') {
  fail(`CHANGELOG.md has no entry for ${version}. Add a "## [${version}]" section first.`);
}

const tagExists = (() => {
  try {
    execFileSync('git', ['rev-parse', '-q', '--verify', `refs/tags/v${version}`], {
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
})();
if (tagExists) {
  fail(`Tag v${version} already exists.`);
}

writeFileSync(pkgPath, `${JSON.stringify({ ...pkg, version }, null, 2)}\n`);
git(['add', 'package.json', 'CHANGELOG.md']);
git(['commit', '-m', `release v${version}`]);
git(['tag', '-a', `v${version}`, '-m', `v${version}`]);

const branch = gitCapture(['rev-parse', '--abbrev-ref', 'HEAD']);
if (push) {
  git(['push', 'origin', branch, '--follow-tags']);
} else {
  process.stdout.write(`\nTagged v${version}. Push it with:\n  git push origin ${branch} --follow-tags\n`);
}
