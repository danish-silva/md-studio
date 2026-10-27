import type { Node as PmNode, Schema } from 'prosemirror-model';
import { mdastToDoc } from './from-mdast.ts';
import { parseMarkdown, serializeMarkdown } from './pipeline.ts';
import { schema as canonicalSchema } from './schema.ts';
import { docToMdast } from './to-mdast.ts';

export { parseMarkdown, serializeMarkdown, stringifyOptions } from './pipeline.ts';
export { htmlToMarkdown } from './from-html.ts';
export {
  markdownToHtml,
  markdownToHtmlFragment,
  type HtmlExportOptions,
} from './export-html.ts';
export { markdownToDocx, type DocxExportOptions } from './export-docx.ts';
export { moveSection } from './sections.ts';
export { documentStats, type DocumentStats } from './stats.ts';
export {
  readFrontmatter,
  writeFrontmatter,
  type FieldValue,
  type Frontmatter,
} from './frontmatter.ts';
export {
  frontmatterProblems,
  lintMarkdown,
  localLinks,
  outlineOf,
  type DocumentLink,
  type OutlineEntry,
  type Problem,
  type ProblemSeverity,
} from './lint.ts';
export { schema } from './schema.ts';
export { mdastToDoc, type FromMdastOptions } from './from-mdast.ts';
export { docToMdast } from './to-mdast.ts';

/** Markdown source to an editable ProseMirror document. */
export function markdownToDoc(source: string, options: { schema?: Schema } = {}): PmNode {
  return mdastToDoc(parseMarkdown(source), {
    schema: options.schema ?? canonicalSchema,
    source,
  });
}

/** An edited ProseMirror document back to markdown, in the pinned canonical style. */
export function docToMarkdown(doc: PmNode): string {
  return serializeMarkdown(docToMdast(doc));
}

/**
 * Normalise markdown without going through the editor: parse, then write back in the
 * canonical style. Used by the round-trip tests to separate pipeline drift from bridge
 * drift.
 */
export function normalizeMarkdown(source: string): string {
  return serializeMarkdown(parseMarkdown(source));
}
