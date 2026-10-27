import { describe, expect, it } from 'vitest';
import { lintMarkdown, localLinks, moveSection, outlineOf } from '../src/index.ts';

describe('frontmatter', () => {
  it('reports YAML that will not parse', () => {
    const problems = lintMarkdown('---\ntitle: "unclosed\n---\n\n# Hi\n');
    const frontmatter = problems.find((problem) => problem.rule === 'frontmatter');

    expect(frontmatter?.severity).toBe('error');
    expect(frontmatter?.message).toContain('not valid YAML');
  });

  it('says nothing about valid frontmatter', () => {
    const problems = lintMarkdown('---\ntitle: Fine\ntags:\n  - a\n---\n\n# Hi\n');
    expect(problems.filter((problem) => problem.rule === 'frontmatter')).toEqual([]);
  });

  it('ignores a horizontal rule that is not frontmatter', () => {
    expect(lintMarkdown('# Hi\n\n---\n\nMore.\n')).toEqual([]);
  });
});

describe('lint rules', () => {
  it('flags a reference that was never defined', () => {
    const problems = lintMarkdown('See [the docs][missing].\n');
    // Asserted on the rule id: the wording of these messages is not ours to rely on.
    expect(problems.map((problem) => problem.rule)).toContain('no-undefined-references');
  });

  it('flags two headings with the same text', () => {
    const problems = lintMarkdown('# Notes\n\ntext\n\n# Notes\n\nmore\n');
    expect(problems.map((problem) => problem.rule)).toContain('no-duplicate-headings');
  });

  it('flags a link with no target', () => {
    expect(lintMarkdown('[a]()\n').map((problem) => problem.rule)).toContain('no-empty-url');
  });

  it('stays quiet on a clean document', () => {
    expect(lintMarkdown('# Title\n\nSome **text** and a [link](https://example.com).\n')).toEqual(
      [],
    );
  });

  it('does not complain about formatting choices', () => {
    // Our own canonical output must never light the panel up.
    expect(lintMarkdown('## A\n\n- one\n- two\n\n| a | b |\n| - | - |\n| 1 | 2 |\n')).toEqual([]);
  });
});

describe('localLinks', () => {
  it('finds relative links and images', () => {
    const links = localLinks('[a](./notes.md) and ![b](assets/x.png)\n');
    expect(links).toEqual([
      { url: './notes.md', kind: 'link', line: 1, column: 1 },
      { url: 'assets/x.png', kind: 'image', line: 1, column: 21 },
    ]);
  });

  it('leaves alone the targets it cannot check', () => {
    const links = localLinks(
      '[a](https://example.com) [b](#anchor) [c](mailto:x@y.z) [d](//cdn.example/x)\n',
    );
    expect(links).toEqual([]);
  });
});

describe('outlineOf', () => {
  it('lists headings with their level and position', () => {
    const outline = outlineOf('# One\n\ntext\n\n## Two\n\n### Three\n');
    expect(outline).toEqual([
      { level: 1, text: 'One', line: 1, index: 0 },
      { level: 2, text: 'Two', line: 5, index: 2 },
      { level: 3, text: 'Three', line: 7, index: 3 },
    ]);
  });

  it('reads through inline formatting', () => {
    expect(outlineOf('# A **bold** title\n')[0]?.text).toBe('A bold title');
  });
});

describe('moveSection', () => {
  const document = '# A\n\nalpha\n\n# B\n\nbravo\n\n# C\n\ncharlie\n';

  it('moves a section and its contents down', () => {
    expect(moveSection(document, 0, 2)).toBe('# B\n\nbravo\n\n# A\n\nalpha\n\n# C\n\ncharlie\n');
  });

  it('moves a section up', () => {
    expect(moveSection(document, 4, 0)).toBe('# C\n\ncharlie\n\n# A\n\nalpha\n\n# B\n\nbravo\n');
  });

  it('carries nested subsections along with their parent', () => {
    const nested = '# A\n\n## A1\n\nx\n\n# B\n\ny\n';
    expect(moveSection(nested, 0, 3)).toBe('# B\n\ny\n\n# A\n\n## A1\n\nx\n');
  });

  it('refuses to drop a section inside itself', () => {
    const nested = '# A\n\n## A1\n\nx\n\n# B\n\ny\n';
    expect(moveSection(nested, 0, 1)).toBe(nested);
  });

  it('leaves content above the first heading where it is', () => {
    const withIntro = 'intro\n\n# A\n\na\n\n# B\n\nb\n';
    expect(moveSection(withIntro, 3, 1)).toBe('intro\n\n# B\n\nb\n\n# A\n\na\n');
  });
});
