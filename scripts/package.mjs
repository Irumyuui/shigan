#!/usr/bin/env node
/**
 * Builds the extension and packages it into a VSIX.
 *
 * Usage:
 *   node scripts/package.mjs                 # dev VSIX (sourcemap, not minified)
 *   node scripts/package.mjs --minify        # production VSIX (minified, no sourcemap)
 *   node scripts/package.mjs --install       # also install into the local VS Code
 *   node scripts/package.mjs --no-sourcemap  # dev VSIX without sourcemap
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));

const minify = args.has('--minify');
const sourcemap = !minify && !args.has('--no-sourcemap');
const install = args.has('--install');

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

await esbuild.build({
  entryPoints: [join(root, 'src', 'extension.ts')],
  bundle: true,
  outfile: join(root, 'dist', 'extension.js'),
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  minify,
  sourcemap,
  logLevel: 'info',
});

const outDir = join(root, 'artifacts');
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, `${pkg.name}-${pkg.version}${minify ? '-min' : ''}.vsix`);

execFileSync(
  process.execPath,
  [
    resolveVsceMain(),
    'package',
    // Everything is bundled by esbuild; there are no runtime node_modules.
    '--no-dependencies',
    '--allow-missing-repository',
    '--out',
    outFile,
  ],
  { cwd: root, stdio: 'inherit' }
);

console.log(`\nPackaged ${outFile}`);

if (install) {
  const result = spawnSync('code', ['--install-extension', outFile, '--force'], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    console.error(
      `\nCould not run "code". Install the VSIX manually:\n  code --install-extension "${outFile}"`
    );
    process.exitCode = 1;
  }
}

/** Resolves the local @vscode/vsce CLI entry point without relying on PATH. */
function resolveVsceMain() {
  const pkgPath = require.resolve('@vscode/vsce/package.json');
  const vscePkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  const bin = typeof vscePkg.bin === 'string' ? vscePkg.bin : vscePkg.bin.vsce;
  return join(dirname(pkgPath), bin);
}
