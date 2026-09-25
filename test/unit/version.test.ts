import { describe, expect, it } from 'vitest';
import { versionChange } from '../../src/version';

describe('versionChange', () => {
  it('reports a fresh install', () => {
    expect(versionChange(undefined, '0.0.2')).toEqual({ kind: 'installed', version: '0.0.2' });
  });

  it('reports an update', () => {
    expect(versionChange('0.0.1', '0.0.2')).toEqual({ kind: 'updated', version: '0.0.2' });
  });

  it('stays silent for the same version', () => {
    expect(versionChange('0.0.2', '0.0.2')).toBeUndefined();
  });

  it('stays silent when the version is unknown', () => {
    expect(versionChange(undefined, '')).toBeUndefined();
    expect(versionChange('0.0.1', '')).toBeUndefined();
  });
});
