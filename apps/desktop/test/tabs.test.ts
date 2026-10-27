/**
 * The tab strip's arrangement rules.
 *
 * Grouping, reordering and archiving are pure functions over the open set, so they can be
 * asserted without a filesystem or a DOM.
 */
import { describe, expect, it } from 'vitest';
import {
  reorderPaths,
  rootFor,
  sectionTabs,
  staleTabs,
  type OpenDocument,
} from '../src/state/documents';

const NOTES = 'D:/notes';
const WORK = 'D:/work';
const DAY = 24 * 60 * 60 * 1000;

function doc(path: string, overrides: Partial<OpenDocument> = {}): OpenDocument {
  return {
    path,
    text: '',
    baseStat: { path, size: 0, mtimeMs: 0 },
    dirty: false,
    revision: 1,
    mode: 'wysiwyg',
    missing: false,
    conflict: null,
    pinned: false,
    savedText: '',
    cursor: 0,
    scrollTop: 0,
    lastActiveAt: 0,
    ...overrides,
  };
}

function index(docs: OpenDocument[]): Record<string, OpenDocument> {
  return Object.fromEntries(docs.map((entry) => [entry.path, entry]));
}

describe('rootFor', () => {
  it('picks the deepest workspace folder containing the file', () => {
    expect(rootFor(`${NOTES}/sub/a.md`, [NOTES, `${NOTES}/sub`])).toBe(`${NOTES}/sub`);
  });

  it('returns null for a file outside every folder', () => {
    expect(rootFor('D:/elsewhere/a.md', [NOTES, WORK])).toBeNull();
  });
});

describe('sectionTabs', () => {
  it('groups tabs under their folder, in the order the folders were added', () => {
    const docs = [doc(`${WORK}/w.md`), doc(`${NOTES}/n.md`)];
    const sections = sectionTabs(
      docs.map((entry) => entry.path),
      index(docs),
      [NOTES, WORK],
    );

    expect(sections.groups.map((group) => group.label)).toEqual(['notes', 'work']);
    expect(sections.groups[0]?.paths).toEqual([`${NOTES}/n.md`]);
  });

  it('lifts pinned tabs out of their groups into one zone', () => {
    const docs = [doc(`${NOTES}/a.md`, { pinned: true }), doc(`${WORK}/b.md`, { pinned: true }), doc(`${NOTES}/c.md`)];
    const sections = sectionTabs(
      docs.map((entry) => entry.path),
      index(docs),
      [NOTES, WORK],
    );

    expect(sections.pinned).toEqual([`${NOTES}/a.md`, `${WORK}/b.md`]);
    expect(sections.groups).toHaveLength(1);
    expect(sections.groups[0]?.paths).toEqual([`${NOTES}/c.md`]);
  });

  it('collects files outside every folder under Other', () => {
    const docs = [doc('D:/elsewhere/x.md')];
    const sections = sectionTabs(['D:/elsewhere/x.md'], index(docs), [NOTES]);

    expect(sections.groups).toHaveLength(1);
    expect(sections.groups[0]).toMatchObject({ root: null, label: 'Other' });
  });

  it('leaves out folders with nothing open', () => {
    const docs = [doc(`${NOTES}/a.md`)];
    const sections = sectionTabs([`${NOTES}/a.md`], index(docs), [NOTES, WORK]);
    expect(sections.groups.map((group) => group.label)).toEqual(['notes']);
  });

  it('keeps the tab order within a group', () => {
    const docs = [doc(`${NOTES}/c.md`), doc(`${NOTES}/a.md`), doc(`${NOTES}/b.md`)];
    const sections = sectionTabs(
      docs.map((entry) => entry.path),
      index(docs),
      [NOTES],
    );
    expect(sections.groups[0]?.paths).toEqual([`${NOTES}/c.md`, `${NOTES}/a.md`, `${NOTES}/b.md`]);
  });
});

describe('reorderPaths', () => {
  it('drops a tab into the slot of the one it was dragged onto, moving down', () => {
    expect(reorderPaths(['a', 'b', 'c', 'd'], 'a', 'c')).toEqual(['b', 'c', 'a', 'd']);
  });

  it('does the same moving up', () => {
    expect(reorderPaths(['a', 'b', 'c', 'd'], 'd', 'b')).toEqual(['a', 'd', 'b', 'c']);
  });

  it('leaves the order alone when the target is unknown', () => {
    expect(reorderPaths(['a', 'b'], 'a', 'zz')).toEqual(['a', 'b']);
  });
});

describe('staleTabs', () => {
  const now = 10 * DAY;

  function input(docs: OpenDocument[], overrides: Partial<Parameters<typeof staleTabs>[0]> = {}) {
    return {
      order: docs.map((entry) => entry.path),
      byPath: index(docs),
      activePath: null,
      days: 7,
      now,
      ...overrides,
    };
  }

  it('archives a tab left untouched past the threshold', () => {
    expect(staleTabs(input([doc('a.md', { lastActiveAt: now - 8 * DAY })]))).toEqual(['a.md']);
  });

  it('leaves a recently used tab alone', () => {
    expect(staleTabs(input([doc('a.md', { lastActiveAt: now - DAY })]))).toEqual([]);
  });

  it('never archives pinned, unsaved or active tabs', () => {
    const old = { lastActiveAt: now - 30 * DAY };
    const docs = [
      doc('pinned.md', { ...old, pinned: true }),
      doc('dirty.md', { ...old, dirty: true }),
      doc('active.md', old),
      doc('stale.md', old),
    ];

    expect(staleTabs(input(docs, { activePath: 'active.md' }))).toEqual(['stale.md']);
  });

  it('is disabled at zero days', () => {
    expect(staleTabs(input([doc('a.md', { lastActiveAt: 0 })], { days: 0 }))).toEqual([]);
  });
});
