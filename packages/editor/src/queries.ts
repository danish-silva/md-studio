import type { Attrs, MarkType, Node as PmNode, NodeType } from 'prosemirror-model';
import type { EditorState } from 'prosemirror-state';
import { nodes } from './schema-types.ts';

export interface Ancestor {
  node: PmNode;
  /** Position *before* the node, which is what setNodeMarkup and setNodeAttribute want. */
  pos: number;
  depth: number;
}

export function findAncestor(state: EditorState, type: NodeType): Ancestor | null {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type === type) {
      return { node, pos: $from.before(depth), depth };
    }
  }
  return null;
}

export function isMarkActive(state: EditorState, type: MarkType): boolean {
  const { empty, from, to, $from } = state.selection;
  if (empty) {
    return type.isInSet(state.storedMarks ?? $from.marks()) !== undefined;
  }
  return state.doc.rangeHasMark(from, to, type);
}

export function isBlockActive(state: EditorState, type: NodeType, attrs?: Attrs): boolean {
  const found = findAncestor(state, type);
  if (!found) return false;
  if (!attrs) return true;
  return Object.entries(attrs).every(([key, value]) => found.node.attrs[key] === value);
}

/** True when the list's items carry checkbox state, i.e. it is a GFM task list. */
export function isTaskList(list: PmNode): boolean {
  let task = false;
  list.forEach((item) => {
    if (typeof item.attrs['checked'] === 'boolean') task = true;
  });
  return task;
}

export function listItemPositions(state: EditorState): number[] {
  const { from, to } = state.selection;
  const positions: number[] = [];

  state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.type === nodes.listItem) positions.push(pos);
  });

  if (positions.length === 0) {
    const item = findAncestor(state, nodes.listItem);
    if (item) positions.push(item.pos);
  }
  return positions;
}

export interface MarkRange {
  from: number;
  to: number;
}

/**
 * The span of a mark around the cursor — what Ctrl+K needs in order to retarget a link
 * the caret is merely sitting inside, with nothing selected.
 */
export function markRangeAt(state: EditorState, type: MarkType): MarkRange | null {
  const { $from } = state.selection;
  const parent = $from.parent;

  let index = $from.index();
  let child = parent.maybeChild(index);
  if (!child || !type.isInSet(child.marks)) {
    index -= 1;
    child = parent.maybeChild(index);
  }
  if (!child || index < 0) return null;

  const mark = type.isInSet(child.marks);
  if (!mark) return null;

  let start = index;
  let end = index;
  while (start > 0 && mark.isInSet(parent.child(start - 1).marks)) start -= 1;
  while (end < parent.childCount - 1 && mark.isInSet(parent.child(end + 1).marks)) end += 1;

  let from = $from.start();
  for (let i = 0; i < start; i += 1) from += parent.child(i).nodeSize;

  let to = from;
  for (let i = start; i <= end; i += 1) to += parent.child(i).nodeSize;

  return { from, to };
}
