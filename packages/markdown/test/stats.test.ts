import { describe, expect, it } from 'vitest';
import { documentStats, readFrontmatter, writeFrontmatter } from '../src/index.ts';

describe('documentStats', () => {
  it('counts the prose a reader would read', () => {
    expect(documentStats('one two three\n').words).toBe(3);
  });

  it('ignores frontmatter, which is metadata rather than prose', () => {
    expect(documentStats('---\ntitle: a long winded title here\n---\n\nTwo words\n').words).toBe(2);
  });

  it('ignores code, where word count is meaningless', () => {
    const source = 'Intro words.\n\n```js\nconst a = 1; // many tokens here\n```\n';
    expect(documentStats(source).words).toBe(2);
  });

  it('counts link text but not the URL', () => {
    expect(documentStats('See [the docs](https://example.com/a/b/c).\n').words).toBe(3);
  });

  it('counts image alt text, which is read aloud', () => {
    expect(documentStats('![a red bicycle](bike.png)\n').words).toBe(3);
  });

  it('reads through formatting rather than counting the markers', () => {
    expect(documentStats('**bold** and *italic*\n').words).toBe(3);
  });

  it('rounds reading time up, and reports zero for an empty document', () => {
    expect(documentStats('one\n').readingMinutes).toBe(1);
    expect(documentStats('').readingMinutes).toBe(0);
    expect(documentStats(`${'word '.repeat(450)}\n`).readingMinutes).toBe(3);
  });
});

describe('frontmatter round trip', () => {
  it('reads a flat set of fields', () => {
    const parsed = readFrontmatter('---\ntitle: Hi\ndraft: false\ntags:\n  - a\n  - b\n---\n\nBody\n');
    expect(parsed.fields).toEqual({ title: 'Hi', draft: false, tags: ['a', 'b'] });
  });

  it('declines nested frontmatter rather than flattening it', () => {
    const parsed = readFrontmatter('---\nauthor:\n  name: Ada\n---\n\nBody\n');
    expect(parsed.fields).toBeNull();
    expect(parsed.reason).toContain('nested');
  });

  it('declines frontmatter that does not parse', () => {
    const parsed = readFrontmatter('---\ntitle: "unclosed\n---\n\nBody\n');
    expect(parsed.fields).toBeNull();
    expect(parsed.present).toBe(true);
  });

  it('reports no frontmatter as an empty set of fields', () => {
    expect(readFrontmatter('# Just a heading\n')).toMatchObject({ present: false, fields: {} });
  });

  it('writes fields back without touching the body', () => {
    const source = '---\ntitle: Old\n---\n\n# Body\n\nText.\n';
    const next = writeFrontmatter(source, { title: 'New', tags: ['x'] });

    expect(next).toContain('title: New');
    expect(next.endsWith('# Body\n\nText.\n')).toBe(true);
  });

  it('adds frontmatter to a document that had none', () => {
    expect(writeFrontmatter('# Body\n', { title: 'New' })).toBe('---\ntitle: New\n---\n\n# Body\n');
  });

  it('removes the block when the last field goes', () => {
    expect(writeFrontmatter('---\ntitle: Old\n---\n\n# Body\n', {})).toBe('# Body\n');
  });

  it('survives a round trip through the form', () => {
    const source = '---\ntitle: Hi\ntags:\n  - a\n---\n\nBody\n';
    const fields = readFrontmatter(source).fields;
    expect(fields).not.toBeNull();
    expect(readFrontmatter(writeFrontmatter(source, fields ?? {})).fields).toEqual(fields);
  });
});
