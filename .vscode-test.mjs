import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
  files: 'out/integration/**/*.test.js',
  workspaceFolder: './test/integration/workspace',
  launchArgs: ['--disable-extensions', '--disable-gpu'],
  version: 'stable',
  // Runs in a real extension host: cold activation plus workspace-config writes
  // routinely exceed mocha's 2 s default (it made the settings suiteSetup flaky on CI).
  mocha: {
    timeout: 20000,
  },
});
