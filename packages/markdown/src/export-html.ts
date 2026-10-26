import rehypeRaw from 'rehype-raw';
import rehypeStringify from 'rehype-stringify';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';

/**
 * Raw HTML is kept rather than sanitised: this is the user's own document being exported
 * for the user, and stripping what they deliberately wrote would be the surprising
 * behaviour. Nothing here is served to anyone else.
 */
const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkFrontmatter, ['yaml'])
  .use(remarkRehype, { allowDangerousHtml: true })
  .use(rehypeRaw)
  .use(rehypeStringify, { allowDangerousHtml: true });

export interface HtmlExportOptions {
  title?: string;
  /** False produces just the body, for embedding. */
  standalone?: boolean;
}

export function markdownToHtmlFragment(source: string): string {
  return String(processor.processSync(source));
}

export function markdownToHtml(source: string, options: HtmlExportOptions = {}): string {
  const body = markdownToHtmlFragment(source);
  if (options.standalone === false) return body;

  const title = escapeHtml(options.title ?? 'Document');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>${STYLES}</style>
</head>
<body>
${body}</body>
</html>
`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Deliberately plain and print-friendly: the same file is what gets printed to PDF, and
 * a dark editor theme would waste a cartridge.
 */
const STYLES = `
:root { color-scheme: light; }
body {
  margin: 0 auto; padding: 2.5rem 1.5rem; max-width: 46rem;
  font-family: Georgia, 'Times New Roman', serif; font-size: 12pt; line-height: 1.6;
  color: #16161a; background: #fff;
}
h1, h2, h3, h4, h5, h6 { font-family: system-ui, 'Segoe UI', sans-serif; line-height: 1.25; margin: 1.6em 0 0.5em; }
h1 { font-size: 1.9em; } h2 { font-size: 1.5em; } h3 { font-size: 1.25em; }
p, ul, ol, blockquote, table, pre { margin: 0 0 1em; }
ul, ol { padding-left: 1.5rem; }
blockquote { border-left: 3px solid #d8d8e0; margin-left: 0; padding-left: 1rem; color: #4a4a55; }
code { font-family: ui-monospace, Consolas, monospace; font-size: 0.9em; background: #f3f3f6; padding: 0.1em 0.3em; border-radius: 3px; }
pre { background: #f6f6f9; border: 1px solid #e4e4ea; border-radius: 6px; padding: 0.9em 1.1em; overflow-x: auto; }
pre code { background: none; padding: 0; }
table { border-collapse: collapse; width: 100%; font-size: 0.95em; }
th, td { border: 1px solid #d8d8e0; padding: 0.4em 0.6em; text-align: left; }
th { background: #f3f3f6; }
img { max-width: 100%; height: auto; }
hr { border: none; border-top: 1px solid #d8d8e0; margin: 2em 0; }
a { color: #2b4acb; }
@media print {
  body { padding: 0; max-width: none; }
  a { color: inherit; text-decoration: underline; }
  pre, blockquote, table, img { break-inside: avoid; }
  h1, h2, h3 { break-after: avoid; }
}
`;
