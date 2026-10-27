import { Fragment, type Node as PmNode } from 'prosemirror-model';
import { TextSelection, type Command } from 'prosemirror-state';

interface Child {
  node: PmNode;
  from: number;
  to: number;
}

function topLevel(doc: PmNode): Child[] {
  const children: Child[] = [];
  doc.forEach((node, offset) => {
    children.push({ node, from: offset, to: offset + node.nodeSize });
  });
  return children;
}

/**
 * Our bridge maps mdast root children one-to-one onto the document's top-level nodes, so
 * the index the outline shows is the index here — no position mapping needed.
 */
function sectionSpan(children: readonly Child[], headingIndex: number): { start: number; end: number } | null {
  const heading = children[headingIndex];
  if (!heading || heading.node.type.name !== 'heading') return null;

  const level = Number(heading.node.attrs['level'] ?? 1);
  let end = headingIndex + 1;

  while (end < children.length) {
    const candidate = children[end];
    if (
      candidate?.node.type.name === 'heading' &&
      Number(candidate.node.attrs['level'] ?? 1) <= level
    ) {
      break;
    }
    end += 1;
  }
  return { start: headingIndex, end };
}

/** Puts the caret at the start of a heading, for clicking an outline entry. */
export function revealHeading(index: number): Command {
  return (state, dispatch) => {
    const child = topLevel(state.doc)[index];
    if (!child || child.node.type.name !== 'heading') return false;

    if (dispatch) {
      dispatch(
        state.tr
          .setSelection(TextSelection.create(state.doc, child.from + 1))
          .scrollIntoView(),
      );
    }
    return true;
  };
}

/**
 * Moves a heading and everything it owns, as one transaction so a single undo puts it
 * back. Dragging down lands after the target section, dragging up lands before it.
 */
export function moveSectionCommand(fromIndex: number, toIndex: number): Command {
  return (state, dispatch) => {
    if (fromIndex === toIndex) return false;

    const children = topLevel(state.doc);
    const moving = sectionSpan(children, fromIndex);
    const target = sectionSpan(children, toIndex);
    if (!moving || !target) return false;

    // Dropping a section inside itself would duplicate it.
    if (toIndex > moving.start && toIndex < moving.end) return false;

    const first = children[moving.start];
    const last = children[moving.end - 1];
    const anchor = fromIndex < toIndex ? children[target.end - 1] : children[target.start];
    if (!first || !last || !anchor) return false;

    if (dispatch) {
      const content = Fragment.fromArray(
        children.slice(moving.start, moving.end).map((child) => child.node),
      );
      const at = fromIndex < toIndex ? anchor.to : anchor.from;

      const tr = state.tr.delete(first.from, last.to);
      tr.insert(tr.mapping.map(at), content);
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}
