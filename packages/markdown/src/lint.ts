import type { Heading, Root, RootContent } from 'mdast';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkLint from 'remark-lint';
import remarkLintNoDuplicateDefinitions from 'remark-lint-no-duplicate-definitions';
import remarkLintNoDuplicateHeadings from 'remark-lint-no-duplicate-headings';
import remarkLintNoEmptyUrl from 'remark-lint-no-empty-url';
import remarkLintNoUndefinedReferences from 'remark-lint-no-undefined-references';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import { unified } from 'unified';
import { stringifyOptions } from './pipeline.ts';
import { parse as parseYaml } from 'yaml';

export type ProblemSeverity = 'error' | 'warning';

export interface Problem {
  severity: ProblemSeverity;
  /** Stable identifier, e.g. `frontmatter` or a lint rule name. */
  rule: string;
  message: string;
  line: number;
  column: number;
}

/**
 * Rules chosen for correctness rather than style.
 *
 * The Problems panel is advisory and never blocks a save, so it has to stay quiet enough
 * to be worth reading: nothing here fires on a formatting preference, only on something
 * that is broken or ambiguous.
 */
const linter = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkFrontmatter, ['yaml'])
  .use(remarkLint)
  .use(remarkLintNoUndefinedReferences)
  .use(remarkLintNoDuplicateDefinitions)
  .use(remarkLintNoDuplicateHeadings)
  .use(remarkLintNoEmptyUrl)
  // processSync needs a compiler even though the output is thrown away.
  .use(remarkStringify, stringifyOptions);

export function lintMarkdown(source: string): Problem[] {
  const problems: Problem[] = [];

  const file = linter.processSync(source);
  for (const message of file.messages) {
    problems.push({
      severity: message.fatal === true ? 'error' : 'warning',
      rule: message.source === null || message.source === undefined
        ? 'lint'
        : (message.ruleId ?? message.source),
      message: message.reason,
      line: message.line ?? 1,
      column: message.column ?? 1,
    });
  }

  problems.push(...frontmatterProblems(source));
  return problems.sort((a, b) => a.line - b.line || a.column - b.column);
}

/**
 * The one genuine parse failure in a markdown file.
 *
 * remark happily keeps broken YAML as an opaque block, so nothing else notices, but the
 * tools that read frontmatter will choke on it — and the editor refuses to save it.
 */
export function frontmatterProblems(source: string): Problem[] {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/.exec(source);
  if (!match) return [];

  const body = match[1];
  if (body === undefined) return [];

  try {
    parseYaml(body);
    return [];
  } catch (error) {
    const reason = error instanceof Error ? error.message.split('\n')[0] ?? 'Invalid YAML' : 'Invalid YAML';
    const offset = yamlErrorLine(error);
    return [
      {
        severity: 'error',
        rule: 'frontmatter',
        message: `Frontmatter is not valid YAML: ${reason}`,
        // +1 because the body starts on the line after the opening fence.
        line: 1 + offset,
        column: 1,
      },
    ];
  }
}

function yamlErrorLine(error: unknown): number {
  if (typeof error !== 'object' || error === null) return 1;
  const linePos = (error as { linePos?: { line: number }[] }).linePos;
  return linePos?.[0]?.line ?? 1;
}

export interface DocumentLink {
  /** The raw target as written, e.g. `./notes.md` or `assets/a.png`. */
  url: string;
  kind: 'link' | 'image';
  line: number;
  column: number;
}

/**
 * Relative links and images worth checking against the filesystem.
 *
 * Absolute URLs, protocol-relative URLs, anchors and mail links point somewhere this
 * package cannot see, so they are left to the reader.
 */
export function localLinks(source: string): DocumentLink[] {
  const tree = linter.parse(source) as Root;
  const links: DocumentLink[] = [];

  visit(tree, (node) => {
    if (node.type !== 'link' && node.type !== 'image') return;

    const url = node.url;
    if (!isLocal(url)) return;

    links.push({
      url,
      kind: node.type === 'image' ? 'image' : 'link',
      line: node.position?.start.line ?? 1,
      column: node.position?.start.column ?? 1,
    });
  });

  return links;
}

function isLocal(url: string): boolean {
  if (url.length === 0) return false;
  if (url.startsWith('#')) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return false;
  return !url.startsWith('//');
}

export interface OutlineEntry {
  /** Heading depth, 1 to 6. */
  level: number;
  text: string;
  line: number;
  /** Index of the heading among the root's children. */
  index: number;
}

export function outlineOf(source: string): OutlineEntry[] {
  const tree = linter.parse(source) as Root;

  return tree.children.flatMap((node, index) => {
    if (node.type !== 'heading') return [];
    return [
      {
        level: node.depth,
        text: headingText(node),
        line: node.position?.start.line ?? 1,
        index,
      },
    ];
  });
}

function headingText(heading: Heading): string {
  let text = '';
  visit(heading, (node) => {
    if ('value' in node && typeof node.value === 'string') text += node.value;
  });
  return text.trim();
}

function visit(node: RootContent | Root, each: (node: RootContent | Root) => void): void {
  each(node);
  if (!('children' in node) || !Array.isArray(node.children)) return;
  for (const child of node.children as RootContent[]) visit(child, each);
}
