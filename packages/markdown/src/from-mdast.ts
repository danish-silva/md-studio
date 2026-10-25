import type { List, ListItem, PhrasingContent, Root, RootContent, Table, TableRow } from 'mdast';
import type { Mark, Node as PmNode, Schema } from 'prosemirror-model';
import { serializeMarkdown } from './pipeline.ts';

export interface FromMdastOptions {
  schema: Schema;
  /**
   * The markdown the tree was parsed from. Nodes the schema cannot model are sliced out
   * of it verbatim, which is what lets them be written back unchanged.
   */
  source: string;
}

export function mdastToDoc(root: Root, options: FromMdastOptions): PmNode {
  return new FromMdast(options.schema, options.source).doc(root);
}

class FromMdast {
  readonly #schema: Schema;
  readonly #source: string;

  constructor(schema: Schema, source: string) {
    this.#schema = schema;
    this.#source = source;
  }

  doc(root: Root): PmNode {
    const content = this.blocks(root.children);
    if (content.length === 0) {
      content.push(this.node('paragraph').create());
    }
    return this.node('doc').create(null, content);
  }

  private blocks(nodes: readonly RootContent[]): PmNode[] {
    return nodes.flatMap((node) => this.block(node));
  }

  private block(node: RootContent): PmNode[] {
    switch (node.type) {
      case 'paragraph':
        return [this.node('paragraph').create(null, this.inlines(node.children))];

      case 'heading':
        return [this.node('heading').create({ level: node.depth }, this.inlines(node.children))];

      case 'blockquote':
        return [this.node('blockquote').create(null, this.blocks(node.children))];

      case 'code':
        return [
          this.node('codeBlock').create(
            { language: node.lang ?? null, meta: node.meta ?? null },
            node.value.length > 0 ? this.#schema.text(node.value) : null,
          ),
        ];

      case 'thematicBreak':
        return [this.node('horizontalRule').create()];

      case 'list':
        return [this.list(node)];

      case 'table':
        return [this.table(node)];

      case 'yaml':
        return [this.node('frontmatter').create({ value: node.value })];

      case 'html':
        return [this.node('rawBlock').create({ text: node.value })];

      default:
        return [this.node('rawBlock').create({ text: this.verbatim(node) })];
    }
  }

  private list(node: List): PmNode {
    const ordered = node.ordered === true;
    const attrs: Record<string, unknown> = { spread: node.spread ?? false };
    if (ordered) {
      attrs['start'] = node.start ?? 1;
    }
    return this.node(ordered ? 'orderedList' : 'bulletList').create(
      attrs,
      node.children.map((item) => this.listItem(item)),
    );
  }

  private listItem(item: ListItem): PmNode {
    const content = this.blocks(item.children);
    if (content.length === 0) {
      content.push(this.node('paragraph').create());
    }
    return this.node('listItem').create(
      { checked: item.checked ?? null, spread: item.spread ?? false },
      content,
    );
  }

  private table(node: Table): PmNode {
    const align = (node.align ?? []).map((value) => value ?? null);
    return this.node('table').create(
      { align },
      node.children.map((row, index) => this.tableRow(row, index === 0)),
    );
  }

  private tableRow(row: TableRow, header: boolean): PmNode {
    const cellType = this.node(header ? 'tableHeader' : 'tableCell');
    return this.node('tableRow').create(
      null,
      row.children.map((cell) => cellType.create(null, this.inlines(cell.children))),
    );
  }

  private inlines(nodes: readonly PhrasingContent[], marks: readonly Mark[] = []): PmNode[] {
    return nodes.flatMap((node) => this.inline(node, marks));
  }

  private inline(node: PhrasingContent, marks: readonly Mark[]): PmNode[] {
    switch (node.type) {
      case 'text':
        return node.value.length > 0 ? [this.#schema.text(node.value, [...marks])] : [];

      case 'strong':
        return this.inlines(node.children, [...marks, this.mark('bold').create()]);

      case 'emphasis':
        return this.inlines(node.children, [...marks, this.mark('italic').create()]);

      case 'delete':
        return this.inlines(node.children, [...marks, this.mark('strike').create()]);

      case 'inlineCode':
        return [this.#schema.text(node.value, [...marks, this.mark('code').create()])];

      case 'link':
        return this.inlines(node.children, [
          ...marks,
          this.mark('link').create({ href: node.url, title: node.title ?? null }),
        ]);

      case 'image':
        return [
          this.node('image').create(
            { src: node.url, alt: node.alt ?? null, title: node.title ?? null },
            null,
            [...marks],
          ),
        ];

      case 'break':
        return [this.node('hardBreak').create(null, null, [...marks])];

      case 'html':
        return [this.node('rawInline').create({ text: node.value }, null, [...marks])];

      default:
        return [this.node('rawInline').create({ text: this.verbatim(node) }, null, [...marks])];
    }
  }

  /** The exact bytes this node occupied in the source. */
  private verbatim(node: RootContent): string {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (typeof start === 'number' && typeof end === 'number') {
      return this.#source.slice(start, end);
    }
    // Only reachable for synthesised trees, which carry no positions.
    return serializeMarkdown({ type: 'root', children: [node] }).trimEnd();
  }

  private node(name: string) {
    const type = this.#schema.nodes[name];
    if (!type) {
      throw new Error(`Schema is missing the "${name}" node type`);
    }
    return type;
  }

  private mark(name: string) {
    const type = this.#schema.marks[name];
    if (!type) {
      throw new Error(`Schema is missing the "${name}" mark type`);
    }
    return type;
  }
}
