/**
 * The tree the explorer actually draws.
 *
 * flattenTree is pure, so the ordering, the toggles and the filter can be asserted
 * without a filesystem, a watcher or a DOM.
 */
import { describe, expect, it } from 'vitest';
import type { DirEntry } from '../src/fs/types';
import { flattenTree, type TreeInput } from '../src/state/explorer';

const ROOT = 'D:/notes';

function entry(name: string, kind: DirEntry['kind'], parent = ROOT): DirEntry {
  return { name, path: `${parent}/${name}`, kind, size: 0, mtimeMs: 0 };
}

function input(overrides: Partial<TreeInput> = {}): TreeInput {
  return {
    roots: [ROOT],
    directories: {
      [ROOT]: {
        entries: [
          entry('archive', 'directory'),
          entry('.hidden.md', 'file'),
          entry('notes.md', 'file'),
          entry('todo.txt', 'file'),
        ],
        loading: false,
        error: null,
      },
      [`${ROOT}/archive`]: {
        entries: [entry('old.md', 'file', `${ROOT}/archive`)],
        loading: false,
        error: null,
      },
    },
    expanded: [ROOT],
    filter: '',
    markdownOnly: false,
    showHidden: false,
    ...overrides,
  };
}

function names(rows: ReturnType<typeof flattenTree>): string[] {
  return rows.map((row) => `${'  '.repeat(row.depth)}${row.name}`);
}

describe('flattenTree', () => {
  it('shows only the root when it is collapsed', () => {
    expect(names(flattenTree(input({ expanded: [] })))).toEqual(['notes']);
  });

  it('lists the children of an expanded root, directories first', () => {
    expect(names(flattenTree(input()))).toEqual([
      'notes',
      '  archive',
      '  notes.md',
      '  todo.txt',
    ]);
  });

  it('descends into expanded subdirectories', () => {
    const rows = flattenTree(input({ expanded: [ROOT, `${ROOT}/archive`] }));
    expect(names(rows)).toEqual([
      'notes',
      '  archive',
      '    old.md',
      '  notes.md',
      '  todo.txt',
    ]);
  });

  it('hides dotfiles unless asked', () => {
    expect(names(flattenTree(input({ showHidden: true })))).toContain('  .hidden.md');
  });

  it('hides non-markdown files but keeps folders when filtering to markdown', () => {
    const rows = names(flattenTree(input({ markdownOnly: true })));
    expect(rows).toEqual(['notes', '  archive', '  notes.md']);
  });

  it('keeps the ancestors of a filter match', () => {
    const rows = flattenTree(input({ expanded: [ROOT, `${ROOT}/archive`], filter: 'old' }));
    expect(names(rows)).toEqual(['notes', '  archive', '    old.md']);
  });

  it('drops branches with nothing matching', () => {
    const rows = flattenTree(input({ expanded: [ROOT, `${ROOT}/archive`], filter: 'nothing' }));
    expect(rows).toEqual([]);
  });

  it('cannot see into a collapsed folder, since the filter only narrows what is loaded', () => {
    const rows = flattenTree(input({ expanded: [ROOT], filter: 'old' }));
    expect(rows).toEqual([]);
  });

  it('marks a directory that is still loading', () => {
    const base = input();
    const rows = flattenTree({
      ...base,
      directories: { ...base.directories, [ROOT]: { entries: [], loading: true, error: null } },
    });
    expect(rows[0]).toMatchObject({ name: 'notes', loading: true, isRoot: true, depth: 0 });
  });

  it('keeps each row tagged with the root it came from', () => {
    const rows = flattenTree(input({ roots: [ROOT, 'D:/other'] }));
    expect(rows.every((row) => row.root === ROOT || row.root === 'D:/other')).toBe(true);
    expect(rows.at(-1)?.name).toBe('other');
  });
});
