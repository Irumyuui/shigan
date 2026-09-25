import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * VSCode dictates where localization files live:
 *  - `package.nls*.json` must sit next to `package.json` (root),
 *  - the runtime bundles live in the directory named by `package.json#l10n`
 *    and must be called `bundle.l10n[.<locale>].json`.
 *
 * Those files are easy to drift out of sync, so this test locks them together.
 */
const root = process.cwd();
const LOCALES = ['zh-cn', 'ja'];

const readJson = (file: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(root, file), 'utf8'));

const sortedKeys = (file: string): string[] => Object.keys(readJson(file)).sort();

/** `%key%` placeholders referenced from package.json. */
function packagePlaceholders(): string[] {
  const text = readFileSync(join(root, 'package.json'), 'utf8');
  return [...new Set([...text.matchAll(/%([^%]+)%/g)].map((match) => match[1]))].sort();
}

/** Literal strings passed to `vscode.l10n.t(...)` in src/**; must be literals. */
function runtimeKeys(): string[] {
  const keys = new Set<string>();

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith('.ts')) {
        const text = readFileSync(full, 'utf8');
        for (const match of text.matchAll(/vscode\.l10n\.t\(\s*'([^']+)'/g)) {
          keys.add(match[1]);
        }
      }
    }
  };

  walk(join(root, 'src'));
  return [...keys].sort();
}

function difference(a: string[], b: string[]): string[] {
  return a.filter((value) => !b.includes(value));
}

describe('localization files', () => {
  it('keeps every package.nls locale in sync with the English source', () => {
    const reference = sortedKeys('package.nls.json');
    for (const locale of LOCALES) {
      const keys = sortedKeys(`package.nls.${locale}.json`);
      expect(difference(reference, keys), `package.nls.${locale}.json is missing keys`).toEqual([]);
      expect(difference(keys, reference), `package.nls.${locale}.json has extra keys`).toEqual([]);
    }
  });

  it('resolves every %placeholder% used by package.json', () => {
    const reference = sortedKeys('package.nls.json');
    expect(difference(packagePlaceholders(), reference), 'unresolved %key% in package.json').toEqual(
      []
    );
    expect(difference(reference, packagePlaceholders()), 'unused key in package.nls.json').toEqual(
      []
    );
  });

  it('keeps every runtime bundle in sync with the strings used in src', () => {
    const used = runtimeKeys();
    expect(used.length, 'no vscode.l10n.t literals found — did the extraction break?').toBeGreaterThan(
      0
    );

    for (const locale of LOCALES) {
      const keys = sortedKeys(`l10n/bundle.l10n.${locale}.json`);
      expect(difference(used, keys), `bundle.l10n.${locale}.json is missing keys`).toEqual([]);
      expect(difference(keys, used), `bundle.l10n.${locale}.json has unused keys`).toEqual([]);
    }
  });

  it('uses the locale files VSCode expects', () => {
    const bundles = readdirSync(join(root, 'l10n')).sort();
    expect(bundles).toEqual(LOCALES.map((locale) => `bundle.l10n.${locale}.json`).sort());
  });
});
