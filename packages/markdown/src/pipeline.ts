import type { Root } from 'mdast';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkStringify, { type Options as StringifyOptions } from 'remark-stringify';
import { unified } from 'unified';

/**
 * Pinned so that writing a document is deterministic: the same tree always produces the
 * same bytes, a file only changes where the user changed it, and diffs stay readable.
 *
 * Changing any of these rewrites every file the editor touches, so treat them as a
 * format decision rather than a preference. The golden corpus in test/fixtures encodes
 * the result.
 */
export const stringifyOptions: StringifyOptions = {
  bullet: '-',
  bulletOther: '*',
  bulletOrdered: '.',
  emphasis: '*',
  strong: '*',
  fence: '`',
  fences: true,
  incrementListMarker: true,
  listItemIndent: 'one',
  resourceLink: false,
  rule: '-',
  ruleRepetition: 3,
  ruleSpaces: false,
  setext: false,
};

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkFrontmatter, ['yaml'])
  .use(remarkStringify, stringifyOptions);

export function parseMarkdown(source: string): Root {
  return processor.parse(source);
}

export function serializeMarkdown(root: Root): string {
  return String(processor.stringify(root));
}
