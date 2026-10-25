import type { Attrs, Node as PmNode, NodeType } from 'prosemirror-model';
import {
  chainCommands,
  exitCode,
  lift,
  setBlockType,
  toggleMark,
  wrapIn,
} from 'prosemirror-commands';
import { redo, undo } from 'prosemirror-history';
import { liftListItem, sinkListItem, splitListItem, wrapInList } from 'prosemirror-schema-list';
import { NodeSelection, type Command, type EditorState, type Transaction } from 'prosemirror-state';
import { findAncestor, isBlockActive, isTaskList, listItemPositions, markRangeAt } from './queries.ts';
import { marks, nodes, schema } from './schema-types.ts';

/**
 * Every command the toolbar and the shortcut map can run.
 *
 * Each is a plain ProseMirror Command, so calling it without a dispatch answers "would
 * this work here?" — which is how the toolbar decides what to disable rather than letting
 * a button produce something markdown cannot express.
 */
export type CommandName =
  | 'bold'
  | 'italic'
  | 'strike'
  | 'code'
  | 'paragraph'
  | 'heading1'
  | 'heading2'
  | 'heading3'
  | 'heading4'
  | 'heading5'
  | 'heading6'
  | 'blockquote'
  | 'codeBlock'
  | 'bulletList'
  | 'orderedList'
  | 'taskList'
  | 'indent'
  | 'outdent'
  | 'horizontalRule'
  | 'hardBreak'
  | 'table'
  | 'clearFormatting'
  | 'removeLink'
  | 'undo'
  | 'redo';

const VERBATIM_BLOCKS = new Set(['rawBlock', 'frontmatter']);

/**
 * True when the selection is a verbatim block — raw HTML, frontmatter, a footnote
 * definition. Those are passed through byte-for-byte, so wrapping one in a list or a
 * quote would corrupt text the editor has promised not to touch.
 */
function selectionIsVerbatim(state: EditorState): boolean {
  const { selection } = state;
  return selection instanceof NodeSelection && VERBATIM_BLOCKS.has(selection.node.type.name);
}

/** Toggling a block type off returns to a paragraph, the way Word's style list behaves. */
function toggleBlock(type: NodeType, attrs?: Attrs): Command {
  return (state, dispatch, view) => {
    if (selectionIsVerbatim(state)) return false;
    if (isBlockActive(state, type, attrs)) {
      return setBlockType(nodes.paragraph)(state, dispatch, view);
    }
    return setBlockType(type, attrs ?? null)(state, dispatch, view);
  };
}

const toggleBlockquote: Command = (state, dispatch, view) => {
  if (selectionIsVerbatim(state)) return false;
  if (findAncestor(state, nodes.blockquote)) {
    return lift(state, dispatch);
  }
  return wrapIn(nodes.blockquote)(state, dispatch, view);
};

function setTaskState(tr: Transaction, positions: readonly number[], checked: boolean | null): void {
  for (const pos of positions) {
    tr.setNodeAttribute(pos, 'checked', checked);
  }
}

/**
 * One command covers bullets, numbers and tasks, because in markdown they are the same
 * construct: a task list is a bullet list whose items carry checkbox state.
 */
function toggleList(listType: NodeType, task: boolean): Command {
  return (state, dispatch) => {
    if (selectionIsVerbatim(state)) return false;
    const checked = task ? false : null;
    const sameList = findAncestor(state, listType);

    if (sameList) {
      // Already this kind of list: either flip its task-ness, or leave the list entirely.
      if (isTaskList(sameList.node) === task) {
        return liftListItem(nodes.listItem)(state, dispatch);
      }
      if (dispatch) {
        const tr = state.tr;
        setTaskState(tr, listItemPositions(state), checked);
        dispatch(tr.scrollIntoView());
      }
      return true;
    }

    const otherType = listType === nodes.bulletList ? nodes.orderedList : nodes.bulletList;
    const otherList = findAncestor(state, otherType);
    if (otherList) {
      // Convert between bullets and numbers in place, rather than nesting one in the other.
      if (dispatch) {
        const attrs = listType === nodes.orderedList ? { start: 1 } : {};
        const tr = state.tr.setNodeMarkup(otherList.pos, listType, attrs);
        setTaskState(tr, listItemPositions(state), checked);
        dispatch(tr.scrollIntoView());
      }
      return true;
    }

    // Wrapping and setting checkbox state must land in one transaction, or undo would
    // need two presses to get back to a paragraph.
    let captured: Transaction | null = null;
    if (!wrapInList(listType)(state, (tr) => void (captured = tr))) {
      return false;
    }
    const tr = captured as Transaction | null;
    if (!tr) return false;
    if (!dispatch) return true;

    if (task) {
      const from = tr.mapping.map(state.selection.from);
      const to = tr.mapping.map(state.selection.to);
      const positions: number[] = [];
      tr.doc.nodesBetween(from, to, (node, pos) => {
        if (node.type === nodes.listItem) positions.push(pos);
      });
      setTaskState(tr, positions, false);
    }
    dispatch(tr.scrollIntoView());
    return true;
  };
}

/** Clears character formatting, like Word's Ctrl+Space. Block structure is left alone. */
const clearFormatting: Command = (state, dispatch) => {
  const { empty, from, to } = state.selection;
  if (empty) return false;

  let hasMark = false;
  for (const type of Object.values(schema.marks)) {
    if (state.doc.rangeHasMark(from, to, type)) hasMark = true;
  }
  if (!hasMark) return false;

  if (dispatch) {
    const tr = state.tr;
    for (const type of Object.values(schema.marks)) {
      tr.removeMark(from, to, type);
    }
    dispatch(tr.scrollIntoView());
  }
  return true;
};

/**
 * Insert a block at the caret, replacing the current block when it is an empty one so a
 * table dropped into a blank document does not leave a stray paragraph above it.
 */
function insertBlock(build: () => PmNode): Command {
  return (state, dispatch) => {
    if (selectionIsVerbatim(state)) return false;
    const node = build();
    if (!canInsertBlock(state, node.type)) return false;

    if (dispatch) {
      const { $from, empty } = state.selection;
      const parent = $from.parent;
      const inEmptyBlock = empty && parent.isTextblock && parent.content.size === 0;
      const tr = inEmptyBlock
        ? state.tr.replaceRangeWith($from.before(), $from.after(), node)
        : state.tr.replaceSelectionWith(node);
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

const insertHorizontalRule: Command = insertBlock(() => nodes.horizontalRule.create());

const insertHardBreak: Command = chainCommands(exitCode, (state, dispatch) => {
  if (!canInsertBlock(state, nodes.hardBreak)) return false;
  if (dispatch) {
    dispatch(state.tr.replaceSelectionWith(nodes.hardBreak.create()).scrollIntoView());
  }
  return true;
});

export function insertTable(rows = 3, columns = 3): Command {
  return insertBlock(() => buildTable(rows, columns));
}

function buildTable(rows: number, columns: number) {
  const header = nodes.tableRow.create(
    null,
    Array.from({ length: columns }, () => nodes.tableHeader.createAndFill()).filter(isNode),
  );
  const body = Array.from({ length: Math.max(0, rows - 1) }, () =>
    nodes.tableRow.create(
      null,
      Array.from({ length: columns }, () => nodes.tableCell.createAndFill()).filter(isNode),
    ),
  );
  return nodes.table.create({ align: Array.from({ length: columns }, () => null) }, [
    header,
    ...body,
  ]);
}

function isNode<T>(value: T | null): value is T {
  return value !== null;
}

/**
 * Walk outwards for a level that will accept this block — a rule typed inside a paragraph
 * belongs to the document, not to the paragraph. Isolating nodes stop the walk, which is
 * what keeps a table or a rule out of a markdown table cell: a cell holds inline content
 * only, and escaping it would silently move the block somewhere the user did not point at.
 */
function canInsertBlock(state: EditorState, type: NodeType): boolean {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth >= 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.canReplaceWith($from.index(depth), $from.index(depth), type)) return true;
    if (node.type.spec.isolating === true) break;
  }
  return false;
}

export function insertImage(attrs: { src: string; alt?: string | null; title?: string | null }): Command {
  return (state, dispatch) => {
    if (!canInsertBlock(state, nodes.image)) return false;
    if (dispatch) {
      const image = nodes.image.create({
        src: attrs.src,
        alt: attrs.alt ?? null,
        title: attrs.title ?? null,
      });
      dispatch(state.tr.replaceSelectionWith(image, false).scrollIntoView());
    }
    return true;
  };
}

export function setLink(href: string, title: string | null = null): Command {
  return (state, dispatch) => {
    const { empty, from, to } = state.selection;
    const range = empty ? markRangeAt(state, marks.link) : { from, to };
    if (!range || range.from === range.to) return false;

    if (dispatch) {
      const tr = state.tr
        .removeMark(range.from, range.to, marks.link)
        .addMark(range.from, range.to, marks.link.create({ href, title }));
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

const removeLink: Command = (state, dispatch) => {
  const { empty, from, to } = state.selection;
  const range = empty ? markRangeAt(state, marks.link) : { from, to };
  if (!range || !state.doc.rangeHasMark(range.from, range.to, marks.link)) return false;

  if (dispatch) {
    dispatch(state.tr.removeMark(range.from, range.to, marks.link));
  }
  return true;
};

export const commands: Record<CommandName, Command> = {
  bold: toggleMark(marks.bold),
  italic: toggleMark(marks.italic),
  strike: toggleMark(marks.strike),
  code: toggleMark(marks.code),

  paragraph: setBlockType(nodes.paragraph),
  heading1: toggleBlock(nodes.heading, { level: 1 }),
  heading2: toggleBlock(nodes.heading, { level: 2 }),
  heading3: toggleBlock(nodes.heading, { level: 3 }),
  heading4: toggleBlock(nodes.heading, { level: 4 }),
  heading5: toggleBlock(nodes.heading, { level: 5 }),
  heading6: toggleBlock(nodes.heading, { level: 6 }),

  blockquote: toggleBlockquote,
  codeBlock: toggleBlock(nodes.codeBlock),

  bulletList: toggleList(nodes.bulletList, false),
  orderedList: toggleList(nodes.orderedList, false),
  taskList: toggleList(nodes.bulletList, true),

  indent: sinkListItem(nodes.listItem),
  outdent: liftListItem(nodes.listItem),

  horizontalRule: insertHorizontalRule,
  hardBreak: insertHardBreak,
  table: insertTable(),

  clearFormatting,
  removeLink,

  undo,
  redo,
};

export const splitListItemCommand: Command = splitListItem(nodes.listItem);
