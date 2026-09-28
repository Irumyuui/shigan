import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { clearCompileCommandCache, findCompileCommandFlags } from '../../src/flags-source';

const tempRoots: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shigan-flags-'));
  tempRoots.push(dir);
  return dir;
}

function write(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function writeDb(dir: string, entries: Array<Record<string, unknown>>): void {
  write(path.join(dir, 'compile_commands.json'), JSON.stringify(entries));
}

afterEach(() => {
  for (const root of tempRoots) fs.rmSync(root, { recursive: true, force: true });
  tempRoots.length = 0;
  clearCompileCommandCache();
});

describe('findCompileCommandFlags', () => {
  it("returns each file's own flags in the same directory", () => {
    const root = makeTempDir();
    write(path.join(root, 'a.c'), '');
    write(path.join(root, 'b.c'), '');
    writeDb(root, [
      { directory: root, file: 'a.c', command: 'cc -DA_ONLY -c a.c' },
      { directory: root, file: 'b.c', command: 'cc -DB_ONLY -c b.c' },
    ]);

    expect(findCompileCommandFlags(path.join(root, 'a.c'))).toEqual(['-DA_ONLY', '-c', 'a.c']);
    expect(findCompileCommandFlags(path.join(root, 'b.c'))).toEqual(['-DB_ONLY', '-c', 'b.c']);
  });

  it("does not let a later file inherit an earlier file's flags", () => {
    const root = makeTempDir();
    write(path.join(root, 'a.c'), '');
    write(path.join(root, 'b.c'), '');
    writeDb(root, [
      { directory: root, file: 'b.c', command: 'cc -DB_ONLY -c b.c' },
      { directory: root, file: 'a.c', command: 'cc -DA_ONLY -c a.c' },
    ]);

    // Reverse order: b primes the directory, a must still resolve its own entry.
    expect(findCompileCommandFlags(path.join(root, 'b.c'))).toEqual(['-DB_ONLY', '-c', 'b.c']);
    expect(findCompileCommandFlags(path.join(root, 'a.c'))).toEqual(['-DA_ONLY', '-c', 'a.c']);
  });

  it("does not inherit a sibling's flags for a file absent from the database", () => {
    const first = makeTempDir();
    write(path.join(first, 'a.c'), '');
    write(path.join(first, 'missing.c'), '');
    writeDb(first, [{ directory: first, file: 'a.c', command: 'cc -DA_ONLY -c a.c' }]);
    // Present file first, then the absent sibling.
    expect(findCompileCommandFlags(path.join(first, 'a.c'))).toEqual(['-DA_ONLY', '-c', 'a.c']);
    expect(findCompileCommandFlags(path.join(first, 'missing.c'))).toBeUndefined();

    const second = makeTempDir();
    write(path.join(second, 'a.c'), '');
    write(path.join(second, 'missing.c'), '');
    writeDb(second, [{ directory: second, file: 'a.c', command: 'cc -DA_ONLY -c a.c' }]);
    // Absent file first, then the present sibling.
    expect(findCompileCommandFlags(path.join(second, 'missing.c'))).toBeUndefined();
    expect(findCompileCommandFlags(path.join(second, 'a.c'))).toEqual(['-DA_ONLY', '-c', 'a.c']);
  });

  it('finds each file through the ancestor backfill from a subdirectory', () => {
    const root = makeTempDir();
    const sub = path.join(root, 'src', 'sub');
    write(path.join(sub, 'a.c'), '');
    write(path.join(sub, 'b.c'), '');
    writeDb(root, [
      { directory: root, file: 'src/sub/a.c', command: 'cc -DA -c src/sub/a.c' },
      { directory: root, file: 'src/sub/b.c', command: 'cc -DB -c src/sub/b.c' },
    ]);

    // The first lookup caches the root entries under `sub`; the second must
    // still run the per-file lookup instead of reusing the first answer.
    expect(findCompileCommandFlags(path.join(sub, 'a.c'))).toEqual(['-DA', '-c', 'src/sub/a.c']);
    expect(findCompileCommandFlags(path.join(sub, 'b.c'))).toEqual(['-DB', '-c', 'src/sub/b.c']);
  });

  it('returns undefined when no compile_commands.json exists', () => {
    const root = makeTempDir();
    const file = path.join(root, 'deep', 'nested', 'a.c');
    write(file, '');
    expect(findCompileCommandFlags(file)).toBeUndefined();
  });

  it('serves cached entries until the cache is cleared', () => {
    const root = makeTempDir();
    const file = path.join(root, 'a.c');
    write(file, '');
    writeDb(root, [{ directory: root, file: 'a.c', command: 'cc -DA -c a.c' }]);
    expect(findCompileCommandFlags(file)).toEqual(['-DA', '-c', 'a.c']);

    writeDb(root, [{ directory: root, file: 'a.c', command: 'cc -DB -c a.c' }]);
    expect(findCompileCommandFlags(file)).toEqual(['-DA', '-c', 'a.c']);

    clearCompileCommandCache();
    expect(findCompileCommandFlags(file)).toEqual(['-DB', '-c', 'a.c']);
  });
});
