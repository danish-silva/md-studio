/**
 * Targeted assertions about the mdast <-> ProseMirror bridge.
 *
 * The golden corpus proves that files survive. These prove *why*: that the document model
 * actually holds the structure, rather than stashing the whole file in a raw node and
 * handing it back unchanged.
 */
import { describe, expect, it } from 'vitest';
import { docToMarkdown, markdownToDoc, schema } from '../src/index.ts';

function doc(source: string) {
  return markdownToDoc(source);
}

function roundTrip(source: string): string {
  return docToMarkdown(markdownToDoc(source));
}

describe('block structure', () => {
  it('maps headings to a level attribute', () => {
    const first = doc('### Three\n').firstChild;
    expect(first?.type.name).toBe('heading');
    expect(first?.attrs['level']).toBe(3);
  });

  it('maps fenced code with its language', () => {
    const first = doc('```ts\nconst x = 1;\n```\n').firstChild;
    expect(first?.type.name).toBe('codeBlock');
    expect(first?.attrs['language']).toBe('ts');
    expect(first?.textContent).toBe('const x = 1;');
  });

  it('keeps task state on list items', () => {
    const list = doc('- [x] done\n- [ ] todo\n').firstChild;
    expect(list?.type.name).toBe('bulletList');
    expect(list?.child(0).attrs['checked']).toBe(true);
    expect(list?.child(1).attrs['checked']).toBe(false);
  });

  it('keeps plain list items unchecked rather than false', () => {
    const list = doc('- plain\n').firstChild;
    expect(list?.child(0).attrs['checked']).toBeNull();
  });

  it('keeps the start of an ordered list', () => {
    const list = doc('5. five\n6. six\n').firstChild;
    expect(list?.attrs['start']).toBe(5);
    expect(roundTrip('5. five\n6. six\n')).toBe('5. five\n6. six\n');
  });

  it('records column alignment on the table, and the header row separately', () => {
    const table = doc('| a | b |\n| :- | -: |\n| 1 | 2 |\n').firstChild;
    expect(table?.type.name).toBe('table');
    expect(table?.attrs['align']).toEqual(['left', 'right']);
    expect(table?.child(0).child(0).type.name).toBe('tableHeader');
    expect(table?.child(1).child(0).type.name).toBe('tableCell');
  });
});

describe('inline marks', () => {
  it('nests a link outside the marks it contains', () => {
    expect(roundTrip('[**bold**](https://example.com)\n')).toBe(
      '[**bold**](https://example.com)\n',
    );
  });

  it('merges an adjacent run sharing a mark instead of reopening it', () => {
    // Two text nodes, same mark, must not become `**a****b**`.
    const paragraph = schema.nodes['paragraph']!.create(null, [
      schema.text('a', [schema.marks['bold']!.create()]),
      schema.text('b', [schema.marks['bold']!.create()]),
    ]);
    const document = schema.nodes['doc']!.create(null, [paragraph]);
    expect(docToMarkdown(document)).toBe('**ab**\n');
  });

  it('keeps inline code as a leaf, not a container', () => {
    const paragraph = doc('`code`\n').firstChild;
    const text = paragraph?.child(0);
    expect(text?.text).toBe('code');
    expect(text?.marks.map((mark) => mark.type.name)).toEqual(['code']);
  });

  it('round-trips an image with a title', () => {
    expect(roundTrip('![alt](./a.png "Title")\n')).toBe('![alt](./a.png "Title")\n');
  });
});

describe('constructs the schema cannot model', () => {
  it('holds a raw HTML block verbatim', () => {
    const source = '<div align="center">\n  <b>hi</b>\n</div>\n';
    const first = doc(source).firstChild;
    expect(first?.type.name).toBe('rawBlock');
    expect(first?.attrs['text']).toBe('<div align="center">\n  <b>hi</b>\n</div>');
    expect(roundTrip(source)).toBe(source);
  });

  it('holds a footnote definition verbatim', () => {
    const source = 'Text.[^a]\n\n[^a]: The note.\n';
    const nodes = doc(source);
    expect(nodes.child(1).type.name).toBe('rawBlock');
    expect(nodes.child(1).attrs['text']).toBe('[^a]: The note.');
    expect(roundTrip(source)).toBe(source);
  });

  it('holds a footnote reference verbatim, inline', () => {
    const paragraph = doc('Text.[^a]\n\n[^a]: The note.\n').firstChild;
    const reference = paragraph?.child(1);
    expect(reference?.type.name).toBe('rawInline');
    expect(reference?.attrs['text']).toBe('[^a]');
  });

  it('keeps frontmatter out of the prose and intact', () => {
    const source = '---\ntitle: x\n---\n\n# Heading\n';
    const first = doc(source).firstChild;
    expect(first?.type.name).toBe('frontmatter');
    expect(first?.attrs['value']).toBe('title: x');
    expect(roundTrip(source)).toBe(source);
  });
});

describe('edge cases', () => {
  it('gives an empty document an empty paragraph to hold the cursor', () => {
    const document = doc('');
    expect(document.childCount).toBe(1);
    expect(document.firstChild?.type.name).toBe('paragraph');
  });

  it('writes an empty document back as empty, not as a blank line', () => {
    expect(docToMarkdown(doc(''))).toBe('');
  });
});
