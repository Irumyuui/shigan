import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@vscode/test-cli';

const dir = dirname(fileURLToPath(import.meta.url));
const integrationDir = join(dir, 'test', 'integration');
const secondaryDir = join(integrationDir, 'workspace-secondary');
const workspaceFile = join(integrationDir, 'shigan-test.code-workspace');

// The extension host is restarted by VS Code when the FIRST workspace folder
// changes, or when a single-folder workspace turns into a multi-root one. The
// multi-root watcher test therefore needs the host to START multi-root so it can
// add/remove a non-first folder at runtime. Folders are siblings (VS Code rejects
// a folder nested inside another) and the primary one stays FIRST, so every
// existing suite's `workspaceFolders[0]` keeps resolving to `workspace`.
//
// The `.code-workspace` file is generated: `ConfigurationTarget.Workspace` writes
// workspace-scoped settings into it, so it is gitignored and rewritten each run.
mkdirSync(secondaryDir, { recursive: true });
writeFileSync(
  workspaceFile,
  `${JSON.stringify(
    { folders: [{ path: 'workspace' }, { path: 'workspace-secondary' }], settings: {} },
    null,
    2
  )}\n`
);

export default defineConfig({
  files: 'out/integration/**/*.test.js',
  workspaceFolder: workspaceFile,
  launchArgs: ['--disable-extensions', '--disable-gpu'],
  version: 'stable',
  // Runs in a real extension host: cold activation plus workspace-config writes
  // routinely exceed mocha's 2 s default (it made the settings suiteSetup flaky on CI).
  mocha: {
    timeout: 20000,
  },
});
