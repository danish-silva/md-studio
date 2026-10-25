import { describe, expect, it } from 'vitest';
import { basename, isInside, isMarkdownPath, joinPath, parentDir, samePath } from '../src/lib/text';

describe('joinPath', () => {
  it('keeps the separator the host already uses', () => {
    expect(joinPath('D:\\notes', 'a.md')).toBe('D:\\notes\\a.md');
    expect(joinPath('/home/notes', 'a.md')).toBe('/home/notes/a.md');
  });

  it('does not double a trailing separator', () => {
    expect(joinPath('D:\\notes\\', 'a.md')).toBe('D:\\notes\\a.md');
  });
});

describe('samePath', () => {
  it('ignores separator and case differences, which Windows does too', () => {
    expect(samePath('D:\\Notes\\a.md', 'd:/notes/a.md')).toBe(true);
    expect(samePath('D:/notes/a.md', 'D:/notes/b.md')).toBe(false);
  });

  it('ignores a trailing separator', () => {
    expect(samePath('D:/notes/', 'D:/notes')).toBe(true);
  });
});

describe('isInside', () => {
  it('recognises descendants', () => {
    expect(isInside('D:/notes', 'D:/notes/a/b.md')).toBe(true);
    expect(isInside('D:/notes', 'D:/notes')).toBe(true);
  });

  it('is not fooled by a shared prefix', () => {
    expect(isInside('D:/notes', 'D:/notes-archive/a.md')).toBe(false);
  });
});

describe('path parts', () => {
  it('finds the parent of a file and of a folder', () => {
    expect(parentDir('D:\\notes\\a.md')).toBe('D:\\notes');
    expect(parentDir('D:\\notes\\sub')).toBe('D:\\notes');
  });

  it('stops at a drive root', () => {
    expect(parentDir('D:\\')).toBeNull();
  });

  it('reads the last segment', () => {
    expect(basename('D:\\notes\\a.md')).toBe('a.md');
    expect(basename('/home/notes/a.md')).toBe('a.md');
  });

  it('recognises markdown by extension only', () => {
    expect(isMarkdownPath('a.md')).toBe(true);
    expect(isMarkdownPath('a.markdown')).toBe(true);
    expect(isMarkdownPath('a.mdx')).toBe(false);
    expect(isMarkdownPath('a.txt')).toBe(false);
  });
});
