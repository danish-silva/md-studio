import type {
  Blockquote,
  Code,
  Heading,
  List,
  ListItem,
  PhrasingContent,
  RootContent,
  Table as MdTable,
} from 'mdast';
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type IParagraphOptions,
  type ParagraphChild,
} from 'docx';
import { parseMarkdown } from './pipeline.ts';

const ORDERED = 'md-studio-ordered';
const MONOSPACE = 'Consolas';

const HEADINGS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6,
] as const;

export interface DocxExportOptions {
  title?: string;
}

/**
 * Word output, built from the same tree the editor uses.
 *
 * Images are left out: embedding them means reading each file as bytes, which this
 * package has no way to do, and a broken image in a Word document is worse than none.
 * Everything else markdown can express has a Word equivalent and is mapped to it.
 */
export async function markdownToDocx(
  source: string,
  options: DocxExportOptions = {},
): Promise<Uint8Array> {
  const tree = parseMarkdown(source);

  const document = new Document({
    title: options.title ?? 'Document',
    numbering: {
      config: [
        {
          reference: ORDERED,
          levels: [0, 1, 2, 3].map((level) => ({
            level,
            format: LevelFormat.DECIMAL,
            text: `%${String(level + 1)}.`,
            alignment: AlignmentType.START,
            style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
          })),
        },
      ],
    },
    sections: [{ children: blocks(tree.children, 0) }],
  });

  // toBlob rather than toBuffer: this runs in a webview, and Blob exists in both hosts.
  const blob = await Packer.toBlob(document);
  return new Uint8Array(await blob.arrayBuffer());
}

function blocks(nodes: readonly RootContent[], depth: number): (Paragraph | Table)[] {
  return nodes.flatMap((node) => block(node, depth));
}

function block(node: RootContent, depth: number): (Paragraph | Table)[] {
  switch (node.type) {
    case 'heading':
      return [headingOf(node)];

    case 'paragraph':
      return [new Paragraph({ children: inlines(node.children), spacing: { after: 160 } })];

    case 'blockquote':
      return quoteOf(node, depth);

    case 'code':
      return codeOf(node);

    case 'list':
      return listOf(node, depth);

    case 'table':
      return [tableOf(node)];

    case 'thematicBreak':
      return [
        new Paragraph({
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'CCCCCC', space: 1 } },
          spacing: { after: 240 },
          children: [],
        }),
      ];

    // Frontmatter is metadata, and raw HTML has no Word equivalent worth guessing at.
    case 'yaml':
    case 'html':
      return [];

    default:
      return 'children' in node && Array.isArray(node.children)
        ? [new Paragraph({ children: inlines(node.children as PhrasingContent[]) })]
        : [];
  }
}

function headingOf(node: Heading): Paragraph {
  return new Paragraph({
    heading: HEADINGS[node.depth - 1] ?? HeadingLevel.HEADING_6,
    children: inlines(node.children),
    spacing: { before: 280, after: 140 },
  });
}

function quoteOf(node: Blockquote, depth: number): (Paragraph | Table)[] {
  // Word has no block quote, so it is drawn: indented, with a rule down the left.
  return blocks(node.children, depth).map((child) =>
    child instanceof Paragraph
      ? new Paragraph({
          ...paragraphOptionsOf(child),
          indent: { left: 480 },
          border: { left: { style: BorderStyle.SINGLE, size: 12, color: 'D8D8E0', space: 12 } },
        })
      : child,
  );
}

/** docx does not expose a paragraph's options, so the children are rebuilt instead. */
function paragraphOptionsOf(paragraph: Paragraph): IParagraphOptions {
  const children = (paragraph as unknown as { root: unknown[] }).root.filter(
    (entry): entry is ParagraphChild => entry instanceof TextRun || entry instanceof ExternalHyperlink,
  );
  return { children };
}

function codeOf(node: Code): Paragraph[] {
  // One paragraph per line keeps the shading contiguous and the lines selectable.
  return node.value.split('\n').map(
    (line) =>
      new Paragraph({
        shading: { fill: 'F4F4F7' },
        spacing: { after: 0 },
        children: [new TextRun({ text: line.length > 0 ? line : ' ', font: MONOSPACE, size: 20 })],
      }),
  );
}

function listOf(node: List, depth: number): (Paragraph | Table)[] {
  const ordered = node.ordered === true;

  return node.children.flatMap((item: ListItem) =>
    item.children.flatMap((child, index) => {
      const produced = block(child, depth + 1);

      // Only the item's first block carries the bullet or number.
      return produced.map((entry) => {
        if (!(entry instanceof Paragraph) || index > 0) return entry;

        const marker = ordered
          ? { numbering: { reference: ORDERED, level: Math.min(depth, 3) } }
          : { bullet: { level: Math.min(depth, 3) } };

        return new Paragraph({
          ...paragraphOptionsOf(entry),
          ...marker,
          spacing: { after: 60 },
        });
      });
    }),
  );
}

function tableOf(node: MdTable): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: node.children.map(
      (row, rowIndex) =>
        new TableRow({
          tableHeader: rowIndex === 0,
          children: row.children.map(
            (cell, columnIndex) =>
              new TableCell({
                // exactOptionalPropertyTypes: the key is omitted rather than set undefined.
                ...(rowIndex === 0 ? { shading: { fill: 'F4F4F7' } } : {}),
                children: [
                  new Paragraph({
                    alignment: alignmentOf(node.align?.[columnIndex]),
                    children: inlines(cell.children),
                  }),
                ],
              }),
          ),
        }),
    ),
  });
}

function alignmentOf(align: string | null | undefined): (typeof AlignmentType)[keyof typeof AlignmentType] {
  if (align === 'center') return AlignmentType.CENTER;
  if (align === 'right') return AlignmentType.RIGHT;
  return AlignmentType.LEFT;
}

interface RunStyle {
  bold?: boolean;
  italics?: boolean;
  strike?: boolean;
  code?: boolean;
}

function inlines(nodes: readonly PhrasingContent[], style: RunStyle = {}): ParagraphChild[] {
  return nodes.flatMap((node) => inline(node, style));
}

function inline(node: PhrasingContent, style: RunStyle): ParagraphChild[] {
  switch (node.type) {
    case 'text':
      return [runOf(node.value, style)];

    case 'strong':
      return inlines(node.children, { ...style, bold: true });

    case 'emphasis':
      return inlines(node.children, { ...style, italics: true });

    case 'delete':
      return inlines(node.children, { ...style, strike: true });

    case 'inlineCode':
      return [runOf(node.value, { ...style, code: true })];

    case 'break':
      return [new TextRun({ break: 1 })];

    case 'link':
      return [
        new ExternalHyperlink({
          link: node.url,
          children: inlines(node.children, style).filter(
            (child): child is TextRun => child instanceof TextRun,
          ),
        }),
      ];

    // An image would need its bytes; its alt text is the honest fallback.
    case 'image':
      return node.alt !== null && node.alt !== undefined && node.alt.length > 0
        ? [runOf(node.alt, { ...style, italics: true })]
        : [];

    case 'html':
      return [];

    default:
      return 'children' in node && Array.isArray(node.children)
        ? inlines(node.children as PhrasingContent[], style)
        : [];
  }
}

function runOf(text: string, style: RunStyle): TextRun {
  return new TextRun({
    text,
    bold: style.bold ?? false,
    italics: style.italics ?? false,
    strike: style.strike ?? false,
    ...(style.code === true ? { font: MONOSPACE, size: 20 } : {}),
  });
}
