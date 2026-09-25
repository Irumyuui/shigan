import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
  files: 'out/integration/**/*.test.js',
  workspaceFolder: './test/integration/workspace',
  launchArgs: ['--disable-extensions', '--disable-gpu'],
  version: 'stable',
});
