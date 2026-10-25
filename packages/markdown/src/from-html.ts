import rehypeParse from 'rehype-parse';
import rehypeRemark from 'rehype-remark';
import remarkGfm from 'remark-gfm';
import remarkStringify from 'remark-stringify';
import { unified } from 'unified';
import { stringifyOptions } from './pipeline.ts';

/**
 * HTML from the clipboard, turned into markdown in our canonical style.
 *
 * Pasting from Word or a web page would otherwise arrive as a thicket of spans, font tags
 * and mso-* styles. Routing it through hast -> mdast throws away everything markdown has
 * no form for, which is the same rule the toolbar follows: if it cannot be written as
 * markdown, it does not enter the document.
 */
const processor = unified()
  .use(rehypeParse, { fragment: true })
  .use(rehypeRemark)
  .use(remarkGfm)
  .use(remarkStringify, stringifyOptions);

export function htmlToMarkdown(html: string): string {
  return String(processor.processSync(html));
}
