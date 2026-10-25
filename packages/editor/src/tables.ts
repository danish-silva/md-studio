import type { Node as PmNode } from 'prosemirror-model';
import { TextSelection, type Command, type EditorState } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { Plugin } from 'prosemirror-state';
import { findAncestor } from './queries.ts';
import { nodes } from './schema-types.ts';

/**
 * GFM table editing, written against our own schema rather than prosemirror-tables.
 *
 * That library needs colspan/rowspan/colwidth attributes on cells and ships merge
 * commands. GFM has none of those: a table is a plain rectangle with a mandatory header
 * row and one alignment per column. Adopting the library's model would let the editor
 * represent documents markdown cannot express, which is the failure this project exists
 * to prevent — so the rectangle is implemented directly.
 *
 * For the same reason there is no "header row" toggle. Every GFM table has a header row,
 * so the first row always is one, and it cannot be deleted.
 */

export type ColumnAlignment = 'left' | 'center' | 'right' | null;

export interface TableContext {
  table: PmNode;
  /** Position immediately before the table node. */
  pos: number;
  rowIndex: number;
  columnIndex: number;
  rowCount: number;
  columnCount: number;
  alignment: ColumnAlignment[];
}

interface CellRef {
  /** Position immediately before the cell. */
  pos: number;
  node: PmNode;
  row: number;
  column: number;
}

export function findTableContext(state: EditorState): TableContext | null {
  const found = findAncestor(state, nodes.table);
  if (!found) return null;

  const { $from } = state.selection;
  // table -> row -> cell, so a caret in a cell sits at least two levels deeper.
  if ($from.depth < found.depth + 2) return null;

  const table = found.node;
  const columnCount = table.firstChild?.childCount ?? 0;

  return {
    table,
    pos: found.pos,
    rowIndex: $from.index(found.depth),
    columnIndex: $from.index(found.depth + 1),
    rowCount: table.childCount,
    columnCount,
    alignment: readAlignment(table, columnCount),
  };
}

function readAlignment(table: PmNode, columnCount: number): ColumnAlignment[] {
  const raw: unknown = table.attrs['align'];
  const list = Array.isArray(raw) ? raw : [];
  return Array.from({ length: columnCount }, (_unused, index) => normalize(list[index]));
}

function normalize(value: unknown): ColumnAlignment {
  return value === 'left' || value === 'center' || value === 'right' ? value : null;
}

function cells(context: TableContext): CellRef[] {
  const refs: CellRef[] = [];
  let rowPos = context.pos + 1;

  context.table.forEach((row, _offset, rowIndex) => {
    let cellPos = rowPos + 1;
    row.forEach((cell, _cellOffset, columnIndex) => {
      refs.push({ pos: cellPos, node: cell, row: rowIndex, column: columnIndex });
      cellPos += cell.nodeSize;
    });
    rowPos += row.nodeSize;
  });

  return refs;
}

function rowStarts(context: TableContext): number[] {
  const starts: number[] = [];
  let pos = context.pos + 1;
  context.table.forEach((row) => {
    starts.push(pos);
    pos += row.nodeSize;
  });
  return starts;
}

function buildRow(columns: number, header = false): PmNode {
  const type = header ? nodes.tableHeader : nodes.tableCell;
  return nodes.tableRow.create(
    null,
    Array.from({ length: Math.max(1, columns) }, () => type.create()),
  );
}

export function buildTable(rows: number, columns: number, alignment?: ColumnAlignment[]): PmNode {
  const body = Array.from({ length: Math.max(0, rows - 1) }, () => buildRow(columns));
  return nodes.table.create(
    { align: alignment ?? Array.from({ length: columns }, () => null) },
    [buildRow(columns, true), ...body],
  );
}

type Dispatch = Parameters<Command>[1];

function insertRowAt(
  context: TableContext,
  index: number,
  state: EditorState,
  dispatch: Dispatch,
): boolean {
  if (dispatch) {
    const starts = rowStarts(context);
    const at =
      index >= context.rowCount
        ? context.pos + context.table.nodeSize - 1
        : (starts[index] ?? context.pos + 1);
    dispatch(state.tr.insert(at, buildRow(context.columnCount)).scrollIntoView());
  }
  return true;
}

export const addRowAbove: Command = (state, dispatch) => {
  const context = findTableContext(state);
  // Nothing may be pushed above the header row.
  if (!context || context.rowIndex === 0) return false;
  return insertRowAt(context, context.rowIndex, state, dispatch);
};

export const addRowBelow: Command = (state, dispatch) => {
  const context = findTableContext(state);
  if (!context) return false;
  return insertRowAt(context, context.rowIndex + 1, state, dispatch);
};

export const deleteRow: Command = (state, dispatch) => {
  const context = findTableContext(state);
  if (!context || context.rowIndex === 0 || context.rowCount <= 1) return false;

  if (dispatch) {
    const start = rowStarts(context)[context.rowIndex];
    if (start === undefined) return false;
    const row = context.table.child(context.rowIndex);
    dispatch(state.tr.delete(start, start + row.nodeSize).scrollIntoView());
  }
  return true;
};

function insertColumnAt(
  context: TableContext,
  index: number,
  state: EditorState,
  dispatch: Dispatch,
): boolean {
  if (dispatch) {
    const tr = state.tr;
    const refs = cells(context);

    const insertions = Array.from({ length: context.rowCount }, (_unused, row) => {
      const rowCells = refs.filter((ref) => ref.row === row);
      const last = rowCells[rowCells.length - 1];
      const target = rowCells[index];
      const pos = target ? target.pos : last ? last.pos + last.node.nodeSize : context.pos + 1;
      return { pos, header: row === 0 };
    });

    // Descending, so each insertion leaves the earlier positions valid.
    for (const insertion of insertions.reverse()) {
      tr.insert(insertion.pos, (insertion.header ? nodes.tableHeader : nodes.tableCell).create());
    }

    const alignment = [...context.alignment];
    alignment.splice(index, 0, null);
    tr.setNodeAttribute(context.pos, 'align', alignment);

    dispatch(tr.scrollIntoView());
  }
  return true;
}

export const addColumnBefore: Command = (state, dispatch) => {
  const context = findTableContext(state);
  if (!context) return false;
  return insertColumnAt(context, context.columnIndex, state, dispatch);
};

export const addColumnAfter: Command = (state, dispatch) => {
  const context = findTableContext(state);
  if (!context) return false;
  return insertColumnAt(context, context.columnIndex + 1, state, dispatch);
};

export const deleteColumn: Command = (state, dispatch) => {
  const context = findTableContext(state);
  if (!context || context.columnCount <= 1) return false;

  if (dispatch) {
    const tr = state.tr;
    const targets = cells(context).filter((ref) => ref.column === context.columnIndex);

    for (const ref of targets.reverse()) {
      tr.delete(ref.pos, ref.pos + ref.node.nodeSize);
    }

    const alignment = [...context.alignment];
    alignment.splice(context.columnIndex, 1);
    tr.setNodeAttribute(context.pos, 'align', alignment);

    dispatch(tr.scrollIntoView());
  }
  return true;
};

export const deleteTable: Command = (state, dispatch) => {
  const context = findTableContext(state);
  if (!context) return false;
  if (dispatch) {
    dispatch(state.tr.delete(context.pos, context.pos + context.table.nodeSize).scrollIntoView());
  }
  return true;
};

export type TableCommandName =
  | 'addRowAbove'
  | 'addRowBelow'
  | 'deleteRow'
  | 'addColumnBefore'
  | 'addColumnAfter'
  | 'deleteColumn'
  | 'deleteTable';

export const tableCommands: Record<TableCommandName, Command> = {
  addRowAbove,
  addRowBelow,
  deleteRow,
  addColumnBefore,
  addColumnAfter,
  deleteColumn,
  deleteTable,
};

export interface TableStatus {
  rowIndex: number;
  columnIndex: number;
  rowCount: number;
  columnCount: number;
  /** Alignment of the column the caret is in. */
  alignment: ColumnAlignment;
  /** True when the caret is in the mandatory header row. */
  inHeaderRow: boolean;
  can: Record<TableCommandName, boolean>;
}

/** Null when the caret is not in a table, which is how the UI knows to hide its tools. */
export function readTableStatus(state: EditorState): TableStatus | null {
  const context = findTableContext(state);
  if (!context) return null;

  const can = {} as Record<TableCommandName, boolean>;
  for (const [name, command] of Object.entries(tableCommands) as [TableCommandName, Command][]) {
    can[name] = command(state);
  }

  return {
    rowIndex: context.rowIndex,
    columnIndex: context.columnIndex,
    rowCount: context.rowCount,
    columnCount: context.columnCount,
    alignment: context.alignment[context.columnIndex] ?? null,
    inHeaderRow: context.rowIndex === 0,
    can,
  };
}

/** Writes `:---`, `:--:` or `---:` for the column the caret is in. */
export function setColumnAlignment(alignment: ColumnAlignment): Command {
  return (state, dispatch) => {
    const context = findTableContext(state);
    if (!context) return false;

    if (dispatch && context.alignment[context.columnIndex] !== alignment) {
      const next = [...context.alignment];
      next[context.columnIndex] = alignment;
      dispatch(state.tr.setNodeAttribute(context.pos, 'align', next));
    }
    return true;
  };
}

/** Tab moves to the next cell, and from the last one adds a row, as a spreadsheet does. */
export function goToNextCell(direction: 1 | -1): Command {
  return (state, dispatch) => {
    const context = findTableContext(state);
    if (!context) return false;

    const refs = cells(context);
    const index = refs.findIndex(
      (ref) => ref.row === context.rowIndex && ref.column === context.columnIndex,
    );
    if (index < 0) return false;

    const target = refs[index + direction];
    if (target) {
      if (dispatch) {
        dispatch(state.tr.setSelection(TextSelection.create(state.doc, target.pos + 1)).scrollIntoView());
      }
      return true;
    }

    if (direction === -1) return false;

    if (dispatch) {
      const tr = state.tr;
      const at = context.pos + context.table.nodeSize - 1;
      tr.insert(at, buildRow(context.columnCount));
      tr.setSelection(TextSelection.create(tr.doc, at + 2));
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

/**
 * Alignment lives on the table node, because that is where GFM puts it, so the cells
 * cannot style themselves from their own attributes. A decoration bridges the gap.
 */
export function tableAlignmentDecorations(): Plugin {
  return new Plugin({
    props: {
      decorations(state) {
        const decorations: Decoration[] = [];

        state.doc.descendants((node, pos) => {
          if (node.type !== nodes.table) return true;

          const columnCount = node.firstChild?.childCount ?? 0;
          const alignment = readAlignment(node, columnCount);
          let rowPos = pos + 1;

          node.forEach((row) => {
            let cellPos = rowPos + 1;
            row.forEach((cell, _offset, columnIndex) => {
              const align = alignment[columnIndex];
              if (align) {
                decorations.push(
                  Decoration.node(cellPos, cellPos + cell.nodeSize, {
                    class: `md-align-${align}`,
                  }),
                );
              }
              cellPos += cell.nodeSize;
            });
            rowPos += row.nodeSize;
          });

          return false;
        });

        return DecorationSet.create(state.doc, decorations);
      },
    },
  });
}
