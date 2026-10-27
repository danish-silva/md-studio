/**
 * Clipboard HTML is converted rather than parsed into the document directly, so these
 * assert the thing that matters: what comes out is markdown we would have written, with
 * everything markdown has no form for discarded rather than smuggled through.
 */
import { describe, expect, it } from 'vitest';
import { htmlToMarkdown, normalizeMarkdown } from '../src/index.ts';

describe('htmlToMarkdown', () => {
  it('converts basic structure', () => {
    expect(htmlToMarkdown('<h2>Title</h2><p>Some <strong>bold</strong> text.</p>')).toBe(
      '## Title\n\nSome **bold** text.\n',
    );
  });

  it('converts lists', () => {
    expect(htmlToMarkdown('<ul><li>one</li><li>two</li></ul>')).toBe('- one\n- two\n');
    expect(htmlToMarkdown('<ol><li>one</li><li>two</li></ol>')).toBe('1. one\n2. two\n');
  });

  it('converts tables', () => {
    const html = '<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>';
    expect(htmlToMarkdown(html)).toBe('| A | B |\n| - | - |\n| 1 | 2 |\n');
  });

  it('converts links and images', () => {
    expect(htmlToMarkdown('<p><a href="https://example.com">site</a></p>')).toBe(
      '[site](https://example.com)\n',
    );
    expect(htmlToMarkdown('<p><img src="a.png" alt="alt"></p>')).toBe('![alt](a.png)\n');
  });

  it('converts strikethrough and inline code', () => {
    expect(htmlToMarkdown('<p><del>gone</del> and <code>kept</code></p>')).toBe(
      '~~gone~~ and `kept`\n',
    );
  });

  it('throws away Word styling that markdown cannot express', () => {
    const word = [
      '<p class="MsoNormal" style="margin:0cm;line-height:107%">',
      '<span style="font-size:11.0pt;font-family:Calibri;color:#C00000">Red </span>',
      '<b><span style="font-size:11.0pt">bold</span></b>',
      '<span style="font-size:11.0pt"> tail</span>',
      '</p>',
    ].join('');

    const markdown = htmlToMarkdown(word);
    expect(markdown).toBe('Red **bold** tail\n');
    expect(markdown).not.toContain('span');
    expect(markdown).not.toContain('color');
  });

  it('flattens a styled div soup into paragraphs', () => {
    const html = '<div><div>first</div><div>second</div></div>';
    expect(htmlToMarkdown(html)).toBe('first\n\nsecond\n');
  });

  it('produces markdown that is already canonical', () => {
    const markdown = htmlToMarkdown('<h1>T</h1><ul><li>a</li></ul><p><em>x</em></p>');
    expect(normalizeMarkdown(markdown)).toBe(markdown);
  });
});
