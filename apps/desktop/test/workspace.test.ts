/**
 * The workspace file.
 *
 * Writing it is straightforward; reading it is where care is needed, because a file that
 * is older, hand-edited or half-written must not cost someone their session.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { useDocuments, type OpenDocument } from '../src/state/documents';
import { useExplorer } from '../src/state/explorer';
import { useLayout } from '../src/state/layout';
import { draftName, parseSnapshot, snapshotOf } from '../src/state/workspace';

const ROOT = 'D:/notes';

function doc(path: string, overrides: Partial<OpenDocument> = {}): OpenDocument {
  return {
    path,
    text: 'body',
    savedText: 'body',
    baseStat: { path, size: 4, mtimeMs: 10 },
    dirty: false,
    revision: 1,
    mode: 'wysiwyg',
    missing: false,
    conflict: null,
    pinned: false,
    lastActiveAt: 1000,
    cursor: 0,
    scrollTop: 0,
    ...overrides,
  };
}

beforeEach(() => {
  useDocuments.setState({
    order: [],
    byPath: {},
    activePath: null,
    recentlyClosed: [],
    autoArchiveDays: 7,
  });
  useExplorer.setState({ roots: [], expanded: [], markdownOnly: false, showHidden: false });
  useLayout.setState({ sidebarWidth: 260, sidebarCollapsed: false });
});

describe('snapshotOf', () => {
  it('captures the folders, tabs and settings that make up a session', () => {
    const a = doc(`${ROOT}/a.md`, { pinned: true, cursor: 42, scrollTop: 120 });
    const b = doc(`${ROOT}/b.md`, { mode: 'source' });

    useExplorer.setState({ roots: [ROOT], expanded: [ROOT], markdownOnly: true });
    useLayout.setState({ sidebarWidth: 320, sidebarCollapsed: true });
    useDocuments.setState({
      order: [a.path, b.path],
      byPath: { [a.path]: a, [b.path]: b },
      activePath: b.path,
      autoArchiveDays: 30,
    });

    const snapshot = snapshotOf('ws1', 'Notes');

    expect(snapshot).toMatchObject({
      id: 'ws1',
      name: 'Notes',
      roots: [ROOT],
      expanded: [ROOT],
      activePath: b.path,
      settings: { autoArchiveDays: 30, markdownOnly: true, showHidden: false },
      layout: { sidebarWidth: 320, sidebarCollapsed: true },
    });
    expect(snapshot.tabs).toEqual([
      { path: a.path, pinned: true, mode: 'wysiwyg', cursor: 42, scrollTop: 120, lastActiveAt: 1000 },
      { path: b.path, pinned: false, mode: 'source', cursor: 0, scrollTop: 0, lastActiveAt: 1000 },
    ]);
  });

  it('does not record the document text, which belongs on disk or in a draft', () => {
    const a = doc(`${ROOT}/a.md`);
    useDocuments.setState({ order: [a.path], byPath: { [a.path]: a }, activePath: a.path });

    expect(JSON.stringify(snapshotOf('ws1', 'Notes'))).not.toContain('body');
  });

  it('survives a round trip through JSON', () => {
    const a = doc(`${ROOT}/a.md`, { cursor: 7 });
    useExplorer.setState({ roots: [ROOT] });
    useDocuments.setState({ order: [a.path], byPath: { [a.path]: a }, activePath: a.path });

    const snapshot = snapshotOf('ws1', 'Notes');
    expect(parseSnapshot(JSON.stringify(snapshot))).toEqual(snapshot);
  });
});

describe('parseSnapshot', () => {
  it('rejects anything that is not a workspace', () => {
    expect(parseSnapshot('not json')).toBeNull();
    expect(parseSnapshot('[]')).toBeNull();
    expect(parseSnapshot('{"name":"no id"}')).toBeNull();
  });

  it('fills in defaults for a file written by an older version', () => {
    const snapshot = parseSnapshot('{"id":"ws1"}');

    expect(snapshot).toMatchObject({
      id: 'ws1',
      name: 'Workspace',
      roots: [],
      tabs: [],
      activePath: null,
      settings: { autoArchiveDays: 7, markdownOnly: false, showHidden: false },
      layout: { sidebarWidth: 260, sidebarCollapsed: false },
    });
  });

  it('drops malformed tabs rather than the whole session', () => {
    const snapshot = parseSnapshot(
      JSON.stringify({
        id: 'ws1',
        tabs: [
          { path: 'a.md', mode: 'wysiwyg', pinned: false, cursor: 0, scrollTop: 0, lastActiveAt: 1 },
          { path: 42 },
          { mode: 'wysiwyg' },
          { path: 'b.md', mode: 'nonsense' },
        ],
      }),
    );

    expect(snapshot?.tabs.map((tab) => tab.path)).toEqual(['a.md']);
  });

  it('ignores non-string entries in the folder lists', () => {
    const snapshot = parseSnapshot(JSON.stringify({ id: 'ws1', roots: ['D:/ok', 7, null] }));
    expect(snapshot?.roots).toEqual(['D:/ok']);
  });
});

describe('draftName', () => {
  it('is a safe file name', () => {
    expect(draftName('D:\\notes\\a.md')).toMatch(/^draft-[0-9a-f]{8}\.json$/);
  });

  it('matches the way the rest of the app compares paths', () => {
    expect(draftName('D:\\Notes\\A.md')).toBe(draftName('d:/notes/a.md'));
  });

  it('separates different files', () => {
    expect(draftName('D:/notes/a.md')).not.toBe(draftName('D:/notes/b.md'));
  });
});
