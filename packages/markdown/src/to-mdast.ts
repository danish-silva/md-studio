import type {
  AlignType,
  Blockquote,
  List,
  ListItem,
  PhrasingContent,
  Root,
  RootContent,
  Table,
  TableCell,
  TableRow,
} from 'mdast';
import type { Mark, Node as PmNode } from 'prosemirror-model';

export function docToMdast(doc: PmNode): Root {
  return { type: 'root', children: blocksOf(doc) };
}

function blocksOf(parent: PmNode): RootContent[] {
  const out: RootContent[] = [];
  parent.forEach((child) => {
    const block = blockOf(child);
    if (block) out.push(block);
  });
  return out;
}

function blockOf(node: PmNode): RootContent | null {
  switch (node.type.name) {
    case 'paragraph': {
      const children = phrasingOf(childrenOf(node), 0);
      // A blank paragraph has no markdown form; blank lines are structure, not content.
      return children.length > 0 ? { type: 'paragraph', children } : null;
    }

    case 'heading':
      return {
        type: 'heading',
        depth: headingDepth(node.attrs['level']),
        children: phrasingOf(childrenOf(node), 0),
      };

    case 'blockquote':
      return { type: 'blockquote', children: blocksOf(node) as Blockquote['children'] };

    case 'codeBlock':
      return {
        type: 'code',
        lang: textOrNull(node.attrs['language']),
        meta: textOrNull(node.attrs['meta']),
        value: node.textContent,
      };

    case 'horizontalRule':
      return { type: 'thematicBreak' };

    case 'bulletList':
      return listOf(node, false);

    case 'orderedList':
      return listOf(node, true);

    case 'table':
      return tableOf(node);

    case 'frontmatter':
      return { type: 'yaml', value: text(node.attrs['value']) };

    case 'rawBlock':
      return { type: 'html', value: text(node.attrs['text']) };

    default:
      return null;
  }
}

function listOf(node: PmNode, ordered: boolean): List {
  const items: ListItem[] = [];
  node.forEach((child) => items.push(listItemOf(child)));

  const list: List = {
    type: 'list',
    ordered,
    spread: node.attrs['spread'] === true,
    children: items,
  };
  if (ordered) {
    list.start = typeof node.attrs['start'] === 'number' ? node.attrs['start'] : 1;
  }
  return list;
}

function listItemOf(node: PmNode): ListItem {
  const item: ListItem = {
    type: 'listItem',
    spread: node.attrs['spread'] === true,
    children: blocksOf(node) as ListItem['children'],
  };
  const checked = node.attrs['checked'];
  if (typeof checked === 'boolean') {
    item.checked = checked;
  }
  return item;
}

function tableOf(node: PmNode): Table {
  const rows: TableRow[] = [];
  node.forEach((row) => {
    const cells: TableCell[] = [];
    row.forEach((cell) => {
      cells.push({ type: 'tableCell', children: phrasingOf(childrenOf(cell), 0) });
    });
    rows.push({ type: 'tableRow', children: cells });
  });

  const align = node.attrs['align'];
  return {
    type: 'table',
    align: Array.isArray(align) ? (align as AlignType[]) : [],
    children: rows,
  };
}

/**
 * Rebuild mdast's nesting from ProseMirror's flat marks.
 *
 * At each depth, take the run of adjacent nodes carrying the same mark and wrap it once,
 * then recurse into the run. Marks are schema-ranked and therefore in the same order on
 * every node, so adjacent bold text becomes `**ab**` rather than `**a****b**`.
 */
function phrasingOf(nodes: readonly PmNode[], depth: number): PhrasingContent[] {
  const out: PhrasingContent[] = [];
  let index = 0;

  while (index < nodes.length) {
    const node = nodes[index];
    if (!node) break;

    const mark = node.marks[depth];
    if (!mark) {
      const leaf = leafOf(node);
      if (leaf) out.push(leaf);
      index += 1;
      continue;
    }

    let end = index + 1;
    while (end < nodes.length && nodes[end]?.marks[depth]?.eq(mark) === true) {
      end += 1;
    }
    out.push(wrap(mark, phrasingOf(nodes.slice(index, end), depth + 1)));
    index = end;
  }

  return out;
}

function wrap(mark: Mark, children: PhrasingContent[]): PhrasingContent {
  switch (mark.type.name) {
    case 'bold':
      return { type: 'strong', children };
    case 'italic':
      return { type: 'emphasis', children };
    case 'strike':
      return { type: 'delete', children };
    case 'link':
      return {
        type: 'link',
        url: text(mark.attrs['href']),
        title: textOrNull(mark.attrs['title']),
        children,
      };
    case 'code':
      return { type: 'inlineCode', value: flatten(children) };
    default:
      return { type: 'text', value: flatten(children) };
  }
}

function leafOf(node: PmNode): PhrasingContent | null {
  switch (node.type.name) {
    case 'text':
      return node.text !== undefined && node.text.length > 0
        ? { type: 'text', value: node.text }
        : null;

    case 'image':
      return {
        type: 'image',
        url: text(node.attrs['src']),
        alt: textOrNull(node.attrs['alt']),
        title: textOrNull(node.attrs['title']),
      };

    case 'hardBreak':
      return { type: 'break' };

    case 'rawInline':
      return { type: 'html', value: text(node.attrs['text']) };

    default:
      return null;
  }
}

function childrenOf(parent: PmNode): PmNode[] {
  const out: PmNode[] = [];
  parent.forEach((child) => out.push(child));
  return out;
}

function flatten(children: readonly PhrasingContent[]): string {
  return children
    .map((child) => {
      if (child.type === 'text' || child.type === 'inlineCode' || child.type === 'html') {
        return child.value;
      }
      return 'children' in child ? flatten(child.children) : '';
    })
    .join('');
}

function headingDepth(value: unknown): 1 | 2 | 3 | 4 | 5 | 6 {
  const level = typeof value === 'number' ? Math.round(value) : 1;
  const clamped = Math.min(6, Math.max(1, level));
  return clamped as 1 | 2 | 3 | 4 | 5 | 6;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}
