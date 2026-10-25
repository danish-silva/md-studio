import type { RootContent } from 'mdast';
import { parseMarkdown, serializeMarkdown } from './pipeline.ts';

interface Span {
  start: number;
  end: number;
}

/**
 * A heading owns everything up to the next heading at the same level or higher, which is
 * what makes "move this section" mean what a reader expects: the heading and its contents
 * travel together, nested subsections included.
 */
function spanOf(children: readonly RootContent[], headingIndex: number): Span | null {
  const heading = children[headingIndex];
  if (!heading || heading.type !== 'heading') return null;

  let end = headingIndex + 1;
  while (end < children.length) {
    const node = children[end];
    if (node?.type === 'heading' && node.depth <= heading.depth) break;
    end += 1;
  }
  return { start: headingIndex, end };
}

/**
 * Moves the section headed at `from` to where the section headed at `to` begins, the way
 * dragging a row in a list behaves. Indices are positions among the document's top-level
 * children, as reported by `outlineOf`.
 */
export function moveSection(source: string, from: number, to: number): string {
  if (from === to) return source;

  const tree = parseMarkdown(source);
  const children = tree.children;

  const moving = spanOf(children, from);
  const target = spanOf(children, to);
  if (!moving || !target) return source;

  // Moving a section inside itself would duplicate it.
  if (to > moving.start && to < moving.end) return source;

  const moved = children.slice(moving.start, moving.end);
  const rest = [...children.slice(0, moving.start), ...children.slice(moving.end)];

  // Dragging down lands after the target section; dragging up lands before it.
  const insertAt =
    from < to ? Math.max(0, target.end - moved.length) : Math.min(rest.length, target.start);

  tree.children = [...rest.slice(0, insertAt), ...moved, ...rest.slice(insertAt)];
  return serializeMarkdown(tree);
}
