import { describe, expect, it } from 'vitest';
import {
  dirnameOf,
  isRealFileScheme,
  resolveVariable,
  VariableContext,
} from '../../src/core/document-paths';

describe('isRealFileScheme', () => {
  it('accepts the local file scheme', () => {
    expect(isRealFileScheme('file')).toBe(true);
  });

  it('accepts the remote scheme used by SSH, WSL and Dev Containers', () => {
    expect(isRealFileScheme('vscode-remote')).toBe(true);
  });

  it('rejects virtual schemes whose fsPath is not a real file', () => {
    for (const scheme of ['untitled', 'output', 'git', 'vscode-vfs', '']) {
      expect(isRealFileScheme(scheme), scheme).toBe(false);
    }
  });
});

describe('dirnameOf', () => {
  it('strips the last segment of a POSIX path', () => {
    expect(dirnameOf('/home/user/project/src/main.rs')).toBe('/home/user/project/src');
  });

  it('strips the last segment of a Windows path, keeping the drive', () => {
    expect(dirnameOf('C:\\project\\src\\main.rs')).toBe('C:\\project\\src');
  });

  it('returns an empty string when there is no separator', () => {
    expect(dirnameOf('main.rs')).toBe('');
  });

  it('handles a mixed-separator remote-ish path', () => {
    expect(dirnameOf('/home/user/project/src\\main.rs')).toBe('/home/user/project/src');
  });
});

describe('resolveVariable', () => {
  const context: VariableContext = {
    workspaceFolder: '/home/user/project',
    fileDirname: '/home/user/project/src',
    env: (name) => (name === 'INCLUDE_DIR' ? '/opt/include' : undefined),
  };

  it('resolves ${workspaceFolder}', () => {
    expect(resolveVariable('workspaceFolder', context)).toBe('/home/user/project');
  });

  it('resolves ${fileDirname}', () => {
    expect(resolveVariable('fileDirname', context)).toBe('/home/user/project/src');
  });

  it('resolves ${env:NAME} from the context environment', () => {
    expect(resolveVariable('env:INCLUDE_DIR', context)).toBe('/opt/include');
    expect(resolveVariable('env:MISSING', context)).toBeUndefined();
  });

  it('returns undefined for unsupported variables', () => {
    expect(resolveVariable('execPath', context)).toBeUndefined();
    expect(resolveVariable('workspaceFolderBasename', context)).toBeUndefined();
    expect(resolveVariable('', context)).toBeUndefined();
  });

  it('returns undefined for the folder variables when the context has none', () => {
    const empty: VariableContext = { env: () => undefined };
    expect(resolveVariable('workspaceFolder', empty)).toBeUndefined();
    expect(resolveVariable('fileDirname', empty)).toBeUndefined();
  });
});
