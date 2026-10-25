import { Schema } from 'prosemirror-model';

/**
 * The canonical document schema.
 *
 * Names follow TipTap's conventions so the P2 editor can drive this bridge without a
 * translation layer. Two details are load-bearing:
 *
 * - Marks are declared outermost-first. ProseMirror ranks marks by declaration order and
 *   the serializer nests them in that order, so `link` first yields `[**text**](url)`
 *   rather than the less conventional `**[text](url)**`.
 * - `rawBlock` and `rawInline` are atoms holding verbatim source. Anything this schema
 *   cannot model — raw HTML, footnote definitions, link reference definitions, future
 *   syntax — lands in one and is written back byte-for-byte. That is what makes it safe
 *   to open a file nobody here wrote.
 */
export const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },

    paragraph: { group: 'block', content: 'inline*' },

    heading: {
      group: 'block',
      content: 'inline*',
      defining: true,
      attrs: { level: { default: 1 } },
    },

    blockquote: { group: 'block', content: 'block+', defining: true },

    codeBlock: {
      group: 'block',
      content: 'text*',
      marks: '',
      code: true,
      defining: true,
      attrs: { language: { default: null }, meta: { default: null } },
    },

    horizontalRule: { group: 'block' },

    bulletList: {
      group: 'block',
      content: 'listItem+',
      attrs: { spread: { default: false } },
    },

    orderedList: {
      group: 'block',
      content: 'listItem+',
      attrs: { start: { default: 1 }, spread: { default: false } },
    },

    listItem: {
      content: 'block+',
      defining: true,
      // `checked` is null for a plain item, true/false for a GFM task item.
      attrs: { checked: { default: null }, spread: { default: false } },
    },

    table: {
      group: 'block',
      content: 'tableRow+',
      isolating: true,
      // One entry per column: 'left' | 'right' | 'center' | null.
      attrs: { align: { default: [] } },
    },

    tableRow: { content: '(tableCell | tableHeader)+' },
    tableHeader: { content: 'inline*', isolating: true },
    tableCell: { content: 'inline*', isolating: true },

    frontmatter: { group: 'block', atom: true, attrs: { value: { default: '' } } },
    rawBlock: { group: 'block', atom: true, attrs: { text: { default: '' } } },

    image: {
      group: 'inline',
      inline: true,
      draggable: true,
      attrs: { src: { default: '' }, alt: { default: null }, title: { default: null } },
    },

    hardBreak: { group: 'inline', inline: true, selectable: false },
    rawInline: { group: 'inline', inline: true, atom: true, attrs: { text: { default: '' } } },

    text: { group: 'inline' },
  },

  marks: {
    link: { attrs: { href: { default: '' }, title: { default: null } }, inclusive: false },
    bold: {},
    italic: {},
    strike: {},
    code: {},
  },
});
