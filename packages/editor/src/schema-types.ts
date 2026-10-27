import { schema } from '@md-studio/markdown';
import type { MarkType, NodeType } from 'prosemirror-model';

function node(name: string): NodeType {
  const type = schema.nodes[name];
  if (!type) throw new Error(`Schema is missing the "${name}" node type`);
  return type;
}

function mark(name: string): MarkType {
  const type = schema.marks[name];
  if (!type) throw new Error(`Schema is missing the "${name}" mark type`);
  return type;
}

/** Resolved once, so the rest of the package is free of non-null assertions. */
export const nodes = {
  doc: node('doc'),
  paragraph: node('paragraph'),
  heading: node('heading'),
  blockquote: node('blockquote'),
  codeBlock: node('codeBlock'),
  horizontalRule: node('horizontalRule'),
  bulletList: node('bulletList'),
  orderedList: node('orderedList'),
  listItem: node('listItem'),
  table: node('table'),
  tableRow: node('tableRow'),
  tableHeader: node('tableHeader'),
  tableCell: node('tableCell'),
  image: node('image'),
  hardBreak: node('hardBreak'),
  rawBlock: node('rawBlock'),
  rawInline: node('rawInline'),
  frontmatter: node('frontmatter'),
} as const;

export const marks = {
  link: mark('link'),
  bold: mark('bold'),
  italic: mark('italic'),
  strike: mark('strike'),
  code: mark('code'),
} as const;

export { schema };
