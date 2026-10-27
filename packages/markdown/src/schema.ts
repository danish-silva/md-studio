import { Schema, type DOMOutputSpec } from 'prosemirror-model';

/**
 * The canonical document schema.
 *
 * Three details are load-bearing:
 *
 * - Marks are declared outermost-first. ProseMirror ranks marks by declaration order and
 *   the serializer nests them in that order, so `link` first yields `[**text**](url)`
 *   rather than the less conventional `**[text](url)**`.
 * - `rawBlock` and `rawInline` are atoms holding verbatim source. Anything this schema
 *   cannot model — raw HTML, footnote definitions, link reference definitions, future
 *   syntax — lands in one and is written back byte-for-byte. That is what makes it safe
 *   to open a file nobody here wrote.
 * - `toDOM` and `parseDOM` are a pair. They render the document in the editor, and they
 *   are also what the clipboard uses, so a copy and paste inside the editor survives only
 *   because every node can make the round trip through HTML.
 *
 * `tableRole` is unused in P2 and is here so prosemirror-tables can be dropped in at P3
 * without touching the document model.
 */

function attr(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },

    paragraph: {
      group: 'block',
      content: 'inline*',
      parseDOM: [{ tag: 'p' }],
      toDOM: (): DOMOutputSpec => ['p', 0],
    },

    heading: {
      group: 'block',
      content: 'inline*',
      defining: true,
      attrs: { level: { default: 1 } },
      parseDOM: [1, 2, 3, 4, 5, 6].map((level) => ({ tag: `h${level}`, attrs: { level } })),
      toDOM: (node): DOMOutputSpec => [`h${String(node.attrs['level'])}`, 0],
    },

    blockquote: {
      group: 'block',
      content: 'block+',
      defining: true,
      parseDOM: [{ tag: 'blockquote' }],
      toDOM: (): DOMOutputSpec => ['blockquote', 0],
    },

    codeBlock: {
      group: 'block',
      content: 'text*',
      marks: '',
      code: true,
      defining: true,
      attrs: { language: { default: null }, meta: { default: null } },
      parseDOM: [
        {
          tag: 'pre',
          preserveWhitespace: 'full',
          getAttrs: (dom: HTMLElement) => ({
            language: dom.getAttribute('data-language'),
            meta: dom.getAttribute('data-meta'),
          }),
        },
      ],
      toDOM: (node): DOMOutputSpec => [
        'pre',
        { 'data-language': attr(node.attrs['language']), 'data-meta': attr(node.attrs['meta']) },
        ['code', 0],
      ],
    },

    horizontalRule: {
      group: 'block',
      parseDOM: [{ tag: 'hr' }],
      toDOM: (): DOMOutputSpec => ['hr'],
    },

    bulletList: {
      group: 'block',
      content: 'listItem+',
      attrs: { spread: { default: false } },
      parseDOM: [{ tag: 'ul' }],
      toDOM: (): DOMOutputSpec => ['ul', 0],
    },

    orderedList: {
      group: 'block',
      content: 'listItem+',
      attrs: { start: { default: 1 }, spread: { default: false } },
      parseDOM: [
        {
          tag: 'ol',
          getAttrs: (dom: HTMLElement) => ({
            start: dom.hasAttribute('start') ? Number(dom.getAttribute('start')) : 1,
          }),
        },
      ],
      toDOM: (node): DOMOutputSpec => {
        const start = node.attrs['start'];
        return ['ol', typeof start === 'number' && start !== 1 ? { start } : {}, 0];
      },
    },

    listItem: {
      content: 'block+',
      defining: true,
      // `checked` is null for a plain item, true/false for a GFM task item.
      attrs: { checked: { default: null }, spread: { default: false } },
      parseDOM: [
        {
          tag: 'li',
          getAttrs: (dom: HTMLElement) => {
            const checked = dom.getAttribute('data-checked');
            return { checked: checked === null ? null : checked === 'true' };
          },
        },
      ],
      toDOM: (node): DOMOutputSpec => {
        const checked = node.attrs['checked'];
        return [
          'li',
          typeof checked === 'boolean' ? { 'data-checked': String(checked) } : {},
          0,
        ];
      },
    },

    table: {
      group: 'block',
      content: 'tableRow+',
      isolating: true,
      tableRole: 'table',
      // One entry per column: 'left' | 'right' | 'center' | null.
      attrs: { align: { default: [] } },
      parseDOM: [{ tag: 'table' }],
      toDOM: (node): DOMOutputSpec => {
        const align = node.attrs['align'];
        return [
          'table',
          { 'data-align': Array.isArray(align) ? align.map((a: unknown) => a ?? '').join('|') : '' },
          ['tbody', 0],
        ];
      },
    },

    tableRow: {
      content: '(tableCell | tableHeader)+',
      tableRole: 'row',
      parseDOM: [{ tag: 'tr' }],
      toDOM: (): DOMOutputSpec => ['tr', 0],
    },

    tableHeader: {
      content: 'inline*',
      isolating: true,
      tableRole: 'header_cell',
      parseDOM: [{ tag: 'th' }],
      toDOM: (): DOMOutputSpec => ['th', 0],
    },

    tableCell: {
      content: 'inline*',
      isolating: true,
      tableRole: 'cell',
      parseDOM: [{ tag: 'td' }],
      toDOM: (): DOMOutputSpec => ['td', 0],
    },

    frontmatter: {
      group: 'block',
      atom: true,
      attrs: { value: { default: '' } },
      parseDOM: [
        {
          tag: 'div[data-frontmatter]',
          getAttrs: (dom: HTMLElement) => ({ value: dom.getAttribute('data-frontmatter') ?? '' }),
        },
      ],
      toDOM: (node): DOMOutputSpec => {
        const value = String(node.attrs['value'] ?? '');
        return ['div', { class: 'md-frontmatter', 'data-frontmatter': value }, value];
      },
    },

    rawBlock: {
      group: 'block',
      atom: true,
      attrs: { text: { default: '' } },
      parseDOM: [
        {
          tag: 'div[data-raw]',
          getAttrs: (dom: HTMLElement) => ({ text: dom.getAttribute('data-raw') ?? '' }),
        },
      ],
      toDOM: (node): DOMOutputSpec => {
        const text = String(node.attrs['text'] ?? '');
        return ['div', { class: 'md-raw-block', 'data-raw': text }, text];
      },
    },

    image: {
      group: 'inline',
      inline: true,
      draggable: true,
      attrs: { src: { default: '' }, alt: { default: null }, title: { default: null } },
      parseDOM: [
        {
          tag: 'img[src]',
          getAttrs: (dom: HTMLElement) => ({
            src: dom.getAttribute('src') ?? '',
            alt: dom.getAttribute('alt'),
            title: dom.getAttribute('title'),
          }),
        },
      ],
      toDOM: (node): DOMOutputSpec => [
        'img',
        {
          src: String(node.attrs['src'] ?? ''),
          alt: attr(node.attrs['alt']),
          title: attr(node.attrs['title']),
        },
      ],
    },

    hardBreak: {
      group: 'inline',
      inline: true,
      selectable: false,
      parseDOM: [{ tag: 'br' }],
      toDOM: (): DOMOutputSpec => ['br'],
    },

    rawInline: {
      group: 'inline',
      inline: true,
      atom: true,
      attrs: { text: { default: '' } },
      parseDOM: [
        {
          tag: 'span[data-raw]',
          getAttrs: (dom: HTMLElement) => ({ text: dom.getAttribute('data-raw') ?? '' }),
        },
      ],
      toDOM: (node): DOMOutputSpec => {
        const text = String(node.attrs['text'] ?? '');
        return ['span', { class: 'md-raw-inline', 'data-raw': text }, text];
      },
    },

    text: { group: 'inline' },
  },

  marks: {
    link: {
      attrs: { href: { default: '' }, title: { default: null } },
      inclusive: false,
      parseDOM: [
        {
          tag: 'a[href]',
          getAttrs: (dom: HTMLElement) => ({
            href: dom.getAttribute('href') ?? '',
            title: dom.getAttribute('title'),
          }),
        },
      ],
      toDOM: (mark): DOMOutputSpec => [
        'a',
        { href: String(mark.attrs['href'] ?? ''), title: attr(mark.attrs['title']) },
        0,
      ],
    },

    bold: {
      parseDOM: [
        { tag: 'strong' },
        { tag: 'b' },
        { style: 'font-weight=bold' },
        { style: 'font-weight=700' },
      ],
      toDOM: (): DOMOutputSpec => ['strong', 0],
    },

    italic: {
      parseDOM: [{ tag: 'em' }, { tag: 'i' }, { style: 'font-style=italic' }],
      toDOM: (): DOMOutputSpec => ['em', 0],
    },

    strike: {
      parseDOM: [{ tag: 's' }, { tag: 'del' }, { tag: 'strike' }],
      toDOM: (): DOMOutputSpec => ['s', 0],
    },

    code: {
      parseDOM: [{ tag: 'code' }],
      toDOM: (): DOMOutputSpec => ['code', 0],
    },
  },
});
