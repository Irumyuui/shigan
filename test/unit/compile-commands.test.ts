import { describe, expect, it } from 'vitest';
import {
  extractFlags,
  flagsForFile,
  parseCompileCommands,
  splitCommand,
} from '../../src/core/compile-commands';

describe('compile-commands', () => {
  it('parses entries and finds flags by resolved file', () => {
    const entries = parseCompileCommands(
      JSON.stringify([{ directory: '/proj', file: 'src/a.c', command: 'cc -DFOO -c src/a.c' }])
    );
    expect(flagsForFile(entries, '/proj/src/a.c')).toEqual(['-DFOO', '-c', 'src/a.c']);
  });

  it('supports arguments arrays', () => {
    const entries = parseCompileCommands(
      JSON.stringify([{ file: '/p/b.c', arguments: ['cc', '-DBAR=1', '-c', '/p/b.c'] }])
    );
    expect(flagsForFile(entries, '/p/b.c')).toEqual(['-DBAR=1', '-c', '/p/b.c']);
  });

  it('normalizes Windows paths case-insensitively', () => {
    const entries = parseCompileCommands(
      JSON.stringify([{ directory: 'C:\\Proj', file: 'src\\A.c', command: 'cc -DX -c src\\A.c' }])
    );
    expect(flagsForFile(entries, 'c:/proj/src/a.c')).toEqual(['-DX', '-c', 'src\\A.c']);
  });

  it('returns undefined when nothing matches', () => {
    expect(flagsForFile([], '/x.c')).toBeUndefined();
  });

  it('extracts flags from an entry', () => {
    expect(extractFlags({ file: 'a.c', command: 'cc -DA -c a.c' })).toEqual(['-DA', '-c', 'a.c']);
    expect(extractFlags({ file: 'a.c' })).toBeUndefined();
  });

  it('splits commands honouring quotes', () => {
    expect(splitCommand('cc -DMSG="hello world" -c a.c')).toEqual([
      'cc',
      '-DMSG=hello world',
      '-c',
      'a.c',
    ]);
  });

  it('returns an empty list for malformed json', () => {
    expect(parseCompileCommands('not json')).toEqual([]);
  });
});
