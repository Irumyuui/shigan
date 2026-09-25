import { describe, expect, it } from 'vitest';
import {
  parseCompileFlags,
  parseDefine,
  parseUndef,
  substituteVariables,
} from '../../src/core/flags';
import { evaluateExpression } from '../../src/core/match/expression';

describe('parseCompileFlags', () => {
  it('parses -D in attached and separate forms', () => {
    const { macros } = parseCompileFlags(['-DFOO', '-D BAR=2', '-DBAZ=3']);
    expect(macros.get('FOO')?.value).toBe('1');
    expect(macros.get('BAR')?.value).toBe('2');
    expect(macros.get('BAZ')?.value).toBe('3');
  });

  it('parses function-like defines', () => {
    const { macros } = parseCompileFlags(['-DMAX(a,b)=((a)>(b)?(a):(b))']);
    expect(macros.get('MAX')?.functionLike).toBe(true);
    expect(macros.get('MAX')?.value).toBe('((a)>(b)?(a):(b))');
  });

  it('honours -U, including over a previous -D', () => {
    const { macros } = parseCompileFlags(['-DFOO=1', '-UFOO']);
    expect(macros.has('FOO')).toBe(false);
  });

  it('parses -std and injects standard macros', () => {
    const { standard, macros } = parseCompileFlags(['-std=c11']);
    expect(standard).toBe('c11');
    expect(evaluateExpression('__STDC_VERSION__', macros)).toBe(201112);
    expect(evaluateExpression('__STDC__', macros)).toBe(1);
  });

  it('collects include paths and unknown flags', () => {
    const { includePaths, unknown } = parseCompileFlags(['-Iinclude', '-I', 'other', '-Wall']);
    expect(includePaths).toEqual(['include', 'other']);
    expect(unknown).toEqual(['-Wall']);
  });

  it('substitutes variables', () => {
    const { macros } = parseCompileFlags(['-DPATH=${workspaceFolder}'], (v) =>
      v === 'workspaceFolder' ? '/ws' : undefined
    );
    expect(macros.get('PATH')?.value).toBe('/ws');
  });
});

describe('substituteVariables', () => {
  it('replaces known variables and keeps unknown ones intact', () => {
    expect(substituteVariables('${a}/${b}', (v) => (v === 'a' ? 'A' : undefined))).toBe('A/${b}');
  });
});

describe('parseDefine / parseUndef', () => {
  it('parses object-like and function-like defines', () => {
    expect(parseDefine('#define FOO 1')).toEqual({ name: 'FOO', value: '1', functionLike: false });
    expect(parseDefine('#define ADD(a, b) ((a)+(b))')).toEqual({
      name: 'ADD',
      value: '((a)+(b))',
      functionLike: true,
    });
    expect(parseDefine('#define EMPTY')).toEqual({ name: 'EMPTY', value: '', functionLike: false });
  });

  it('parses undef', () => {
    expect(parseUndef('#undef FOO')).toBe('FOO');
  });
});
