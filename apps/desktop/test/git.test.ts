import { describe, expect, it } from 'vitest';
import { parseStatus } from '../src/state/git';

const ROOT = 'D:\\repo';

describe('parseStatus', () => {
  it('reads a staged change', () => {
    expect(parseStatus('M  src/a.md\n', ROOT)).toEqual([
      { path: 'D:\\repo\\src\\a.md', staged: true, status: 'modified' },
    ]);
  });

  it('reads an unstaged change', () => {
    expect(parseStatus(' M src/a.md\n', ROOT)).toEqual([
      { path: 'D:\\repo\\src\\a.md', staged: false, status: 'modified' },
    ]);
  });

  it('reports a file that is both staged and edited again', () => {
    // Staging a change then editing it is the case worth not flattening.
    expect(parseStatus('MM src/a.md\n', ROOT)).toEqual([
      { path: 'D:\\repo\\src\\a.md', staged: true, status: 'modified' },
      { path: 'D:\\repo\\src\\a.md', staged: false, status: 'modified' },
    ]);
  });

  it('treats an untracked file as one unstaged entry', () => {
    expect(parseStatus('?? notes.md\n', ROOT)).toEqual([
      { path: 'D:\\repo\\notes.md', staged: false, status: 'untracked' },
    ]);
  });

  it('maps the status codes it knows', () => {
    const entries = parseStatus('A  a.md\nD  b.md\nU  c.md\n', ROOT);
    expect(entries.map((entry) => entry.status)).toEqual(['added', 'deleted', 'conflicted']);
  });

  it('takes the new name of a rename', () => {
    expect(parseStatus('R  old.md -> new.md\n', ROOT)[0]?.path).toBe('D:\\repo\\new.md');
  });

  it('ignores blank and truncated lines', () => {
    expect(parseStatus('\n\nM\n', ROOT)).toEqual([]);
  });

  it('keeps posix separators when the root uses them', () => {
    expect(parseStatus('M  src/a.md\n', '/home/repo')[0]?.path).toBe('/home/repo/src/a.md');
  });
});
