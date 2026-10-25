import { describe, expect, it } from 'vitest';
import { fuzzyFilter, fuzzyScore } from '../src/lib/fuzzy';
import { resolveRelative } from '../src/lib/text';

describe('fuzzyScore', () => {
  it('matches characters in order, not necessarily adjacent', () => {
    expect(fuzzyScore('welcome.md', 'wmd')).not.toBeNull();
    expect(fuzzyScore('welcome.md', 'xyz')).toBeNull();
  });

  it('rejects a needle whose characters are out of order', () => {
    expect(fuzzyScore('abc', 'cb')).toBeNull();
  });

  it('is case insensitive', () => {
    expect(fuzzyScore('Welcome.md', 'welcome')).not.toBeNull();
  });

  it('reports where it matched, for highlighting', () => {
    expect(fuzzyScore('abc', 'ac')?.indices).toEqual([0, 2]);
  });
});

describe('fuzzyFilter', () => {
  const files = [
    'D:/notes/archive/old-meeting-notes.md',
    'D:/notes/meeting.md',
    'D:/notes/misc/me-and-them.md',
  ];

  it('puts a tight match above a scattered one', () => {
    const ranked = fuzzyFilter(files, 'meeting', (file) => file);
    expect(ranked[0]?.item).toBe('D:/notes/meeting.md');
  });

  it('drops anything that does not match at all', () => {
    expect(fuzzyFilter(files, 'zzz', (file) => file)).toEqual([]);
  });

  it('returns everything, unranked, for an empty needle', () => {
    expect(fuzzyFilter(files, '', (file) => file)).toHaveLength(files.length);
  });

  it('honours the limit', () => {
    expect(fuzzyFilter(files, 'm', (file) => file, 2)).toHaveLength(2);
  });
});

describe('resolveRelative', () => {
  it('resolves a sibling file', () => {
    expect(resolveRelative('D:\\notes', './a.md')).toBe('D:\\notes\\a.md');
    expect(resolveRelative('D:\\notes', 'assets/x.png')).toBe('D:\\notes\\assets\\x.png');
  });

  it('climbs with ..', () => {
    expect(resolveRelative('D:\\notes\\sub', '../a.md')).toBe('D:\\notes\\a.md');
  });

  it('drops anchors and query strings', () => {
    expect(resolveRelative('D:\\notes', 'a.md#section')).toBe('D:\\notes\\a.md');
    expect(resolveRelative('D:\\notes', 'a.md?v=1')).toBe('D:\\notes\\a.md');
  });

  it('decodes percent escapes', () => {
    expect(resolveRelative('D:\\notes', 'my%20file.md')).toBe('D:\\notes\\my file.md');
  });

  it('refuses to climb above the drive', () => {
    expect(resolveRelative('D:\\notes', '../../../x.md')).toBeNull();
  });

  it('keeps posix separators on a posix base', () => {
    expect(resolveRelative('/home/notes', './a.md')).toBe('/home/notes/a.md');
  });

  it('returns null for an empty or anchor-only target', () => {
    expect(resolveRelative('D:\\notes', '#top')).toBeNull();
  });
});
