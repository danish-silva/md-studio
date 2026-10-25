import type { Root, RootContent } from 'mdast';
import { parseMarkdown } from './pipeline.ts';

export interface DocumentStats {
  words: number;
  characters: number;
  /** Minutes, rounded up, at a conventional 200 words per minute. */
  readingMinutes: number;
}

const WORDS_PER_MINUTE = 200;

/**
 * Counts the prose a reader would actually read.
 *
 * Frontmatter, code blocks, link targets and raw HTML are excluded: they are not prose,
 * and counting them makes the number meaningless on exactly the documents where someone
 * would care about it.
 */
export function documentStats(source: string): DocumentStats {
  const prose = proseOf(parseMarkdown(source));
  const words = prose.match(/[\p{L}\p{N}'’_-]+/gu)?.length ?? 0;

  return {
    words,
    characters: prose.length,
    readingMinutes: words === 0 ? 0 : Math.max(1, Math.ceil(words / WORDS_PER_MINUTE)),
  };
}

function proseOf(root: Root): string {
  const parts: string[] = [];

  const walk = (node: Root | RootContent): void => {
    switch (node.type) {
      case 'yaml':
      case 'code':
      case 'html':
      case 'inlineCode':
      case 'definition':
      case 'footnoteDefinition':
        return;
      case 'text':
        parts.push(node.value);
        return;
      case 'image':
        // Alt text is read aloud; the URL is not.
        if (node.alt !== null && node.alt !== undefined) parts.push(node.alt);
        return;
      default:
        break;
    }

    if ('children' in node && Array.isArray(node.children)) {
      for (const child of node.children as RootContent[]) walk(child);
    }
  };

  walk(root);
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}
