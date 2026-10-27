import { describe, expect, it } from 'vitest';
import { markdownToDocx, markdownToHtml, markdownToHtmlFragment } from '../src/index.ts';

describe('markdownToHtmlFragment', () => {
  it('converts the usual structure', () => {
    const html = markdownToHtmlFragment('# Title\n\nSome **bold** text.\n');
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<strong>bold</strong>');
  });

  it('converts GFM tables, task lists and strikethrough', () => {
    expect(markdownToHtmlFragment('| a |\n| - |\n| 1 |\n')).toContain('<table>');
    expect(markdownToHtmlFragment('- [x] done\n')).toContain('type="checkbox"');
    expect(markdownToHtmlFragment('~~gone~~\n')).toContain('<del>gone</del>');
  });

  it('keeps raw HTML the author wrote on purpose', () => {
    expect(markdownToHtmlFragment('<u>underlined</u>\n')).toContain('<u>underlined</u>');
  });

  it('leaves frontmatter out of the output', () => {
    const html = markdownToHtmlFragment('---\ntitle: Secret\n---\n\nBody\n');
    expect(html).not.toContain('Secret');
    expect(html).toContain('Body');
  });
});

describe('markdownToHtml', () => {
  it('produces a standalone document with the title escaped', () => {
    const html = markdownToHtml('# Hi\n', { title: 'A <script> & "friends"' });
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<title>A &lt;script&gt; &amp; &quot;friends&quot;</title>');
    expect(html).not.toContain('<title>A <script>');
  });

  it('carries print styles, since the same file becomes the PDF', () => {
    expect(markdownToHtml('# Hi\n')).toContain('@media print');
  });

  it('can produce just the body for embedding', () => {
    const body = markdownToHtml('# Hi\n', { standalone: false });
    expect(body).not.toContain('<!doctype html>');
    expect(body).toContain('<h1>Hi</h1>');
  });
});

describe('markdownToDocx', () => {
  async function build(source: string): Promise<Uint8Array> {
    return markdownToDocx(source, { title: 'Test' });
  }

  it('produces a readable .docx package', async () => {
    const bytes = await build('# Title\n\nText.\n');
    // A .docx is a zip; every one starts with the local file header magic.
    expect(bytes.length).toBeGreaterThan(1000);
    expect([bytes[0], bytes[1], bytes[2], bytes[3]]).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });

  it('handles every block markdown can express without throwing', async () => {
    const source = [
      '---',
      'title: Front',
      '---',
      '',
      '# Heading',
      '',
      'A paragraph with **bold**, *italic*, ~~strike~~, `code` and a [link](https://example.com).',
      '',
      '> A quote.',
      '',
      '- bullet',
      '- another',
      '  - nested',
      '',
      '1. first',
      '2. second',
      '',
      '```ts',
      'const x = 1;',
      '```',
      '',
      '| a | b |',
      '| :- | -: |',
      '| 1 | 2 |',
      '',
      '---',
      '',
      '![alt text](image.png)',
      '',
      '<div>raw html</div>',
      '',
    ].join('\n');

    const bytes = await build(source);
    expect(bytes.length).toBeGreaterThan(1000);
  });

  it('does not fall over on an empty document', async () => {
    expect((await build('')).length).toBeGreaterThan(0);
  });
});
