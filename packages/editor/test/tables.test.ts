import { docToMarkdown } from '@md-studio/markdown';
import type { Node as PmNode } from 'prosemirror-model';
import { TextSelection, type Command, type EditorState } from 'prosemirror-state';
import { describe, expect, it } from 'vitest';
import {
  createEditorState,
  goToNextCell,
  readTableStatus,
  setColumnAlignment,
  tableCommands,
} from '../src/index.ts';

const GRID = '| a | b |\n| --- | --- |\n| c | d |\n';

function open(markdown: string): EditorState {
  return createEditorState(markdown);
}

function caretIn(state: EditorState, needle: string): EditorState {
  const matches: number[] = [];
  state.doc.descendants((node, pos) => {
    if (!node.isText || node.text === undefined) return;
    const index = node.text.indexOf(needle);
    if (index >= 0) matches.push(pos + index);
  });

  const at = matches[0];
  if (at === undefined) throw new Error(`"${needle}" is not in the document`);
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, at)));
}

function run(state: EditorState, command: Command): EditorState {
  let next = state;
  command(state, (tr) => {
    next = state.apply(tr);
  });
  return next;
}

function markdownOf(state: EditorState): string {
  return docToMarkdown(state.doc);
}

function tableOf(state: EditorState): PmNode {
  const table = state.doc.child(0);
  if (table.type.name !== 'table') throw new Error('First block is not a table');
  return table;
}

describe('rows', () => {
  it('adds a row below the caret', () => {
    const next = run(caretIn(open(GRID), 'c'), tableCommands.addRowBelow);
    expect(tableOf(next).childCount).toBe(3);
    expect(markdownOf(next)).toBe('| a | b |\n| - | - |\n| c | d |\n|   |   |\n');
  });

  it('adds a row above a body row', () => {
    const next = run(caretIn(open(GRID), 'c'), tableCommands.addRowAbove);
    expect(markdownOf(next)).toBe('| a | b |\n| - | - |\n|   |   |\n| c | d |\n');
  });

  it('refuses to push a row above the header', () => {
    const status = readTableStatus(caretIn(open(GRID), 'a'));
    expect(status?.inHeaderRow).toBe(true);
    expect(status?.can.addRowAbove).toBe(false);
  });

  it('refuses to delete the header row', () => {
    expect(readTableStatus(caretIn(open(GRID), 'a'))?.can.deleteRow).toBe(false);
  });

  it('deletes a body row', () => {
    const next = run(caretIn(open(GRID), 'c'), tableCommands.deleteRow);
    expect(markdownOf(next)).toBe('| a | b |\n| - | - |\n');
  });
});

describe('columns', () => {
  it('adds a column after the caret, in every row', () => {
    const next = run(caretIn(open(GRID), 'a'), tableCommands.addColumnAfter);
    expect(tableOf(next).child(0).childCount).toBe(3);
    expect(markdownOf(next)).toBe('| a |   | b |\n| - | - | - |\n| c |   | d |\n');
  });

  it('adds a column before the caret', () => {
    const next = run(caretIn(open(GRID), 'b'), tableCommands.addColumnBefore);
    expect(markdownOf(next)).toBe('| a |   | b |\n| - | - | - |\n| c |   | d |\n');
  });

  it('deletes a column from every row', () => {
    const next = run(caretIn(open(GRID), 'a'), tableCommands.deleteColumn);
    expect(markdownOf(next)).toBe('| b |\n| - |\n| d |\n');
  });

  it('refuses to delete the last column', () => {
    expect(readTableStatus(caretIn(open('| a |\n| - |\n| b |\n'), 'a'))?.can.deleteColumn).toBe(
      false,
    );
  });

  it('keeps alignment lined up with the columns it survives', () => {
    const aligned = '| a | b | c |\n| :-- | :-: | --: |\n| d | e | f |\n';
    const next = run(caretIn(open(aligned), 'b'), tableCommands.deleteColumn);
    // Dropping the centred column must leave left on the first and right on the last.
    expect(markdownOf(next)).toBe('| a  |  c |\n| :- | -: |\n| d  |  f |\n');
  });
});

describe('alignment', () => {
  it('writes the alignment markers for the column the caret is in', () => {
    // Cells are padded to the width of their delimiter, so a centred column widens.
    const centred = run(caretIn(open(GRID), 'a'), setColumnAlignment('center'));
    expect(markdownOf(centred)).toBe('|  a  | b |\n| :-: | - |\n|  c  | d |\n');

    const right = run(caretIn(centred, 'b'), setColumnAlignment('right'));
    expect(markdownOf(right)).toBe('|  a  |  b |\n| :-: | -: |\n|  c  |  d |\n');
  });

  it('clears an alignment back to none', () => {
    const aligned = run(caretIn(open(GRID), 'a'), setColumnAlignment('left'));
    const cleared = run(caretIn(aligned, 'a'), setColumnAlignment(null));
    expect(markdownOf(cleared)).toBe(GRID.replace('| --- | --- |', '| - | - |'));
  });

  it('reports the current column alignment', () => {
    const aligned = '| a | b |\n| :-: | --: |\n| c | d |\n';
    expect(readTableStatus(caretIn(open(aligned), 'a'))?.alignment).toBe('center');
    expect(readTableStatus(caretIn(open(aligned), 'b'))?.alignment).toBe('right');
  });
});

describe('navigation', () => {
  it('moves to the next cell', () => {
    const next = run(caretIn(open(GRID), 'a'), goToNextCell(1));
    expect(next.selection.$from.parent.textContent).toBe('b');
  });

  it('moves to the previous cell', () => {
    const next = run(caretIn(open(GRID), 'c'), goToNextCell(-1));
    expect(next.selection.$from.parent.textContent).toBe('b');
  });

  it('adds a row when tabbing out of the last cell', () => {
    const next = run(caretIn(open(GRID), 'd'), goToNextCell(1));
    expect(tableOf(next).childCount).toBe(3);
    expect(next.selection.$from.parent.textContent).toBe('');
    expect(markdownOf(next)).toBe('| a | b |\n| - | - |\n| c | d |\n|   |   |\n');
  });

  it('refuses to move back out of the first cell', () => {
    const state = caretIn(open(GRID), 'a');
    expect(goToNextCell(-1)(state)).toBe(false);
  });
});

describe('status', () => {
  it('is null outside a table', () => {
    expect(readTableStatus(caretIn(open('just a paragraph\n'), 'just'))).toBeNull();
  });

  it('reports the caret position within the grid', () => {
    const status = readTableStatus(caretIn(open(GRID), 'd'));
    expect(status).toMatchObject({ rowIndex: 1, columnIndex: 1, rowCount: 2, columnCount: 2 });
  });

  it('deletes the whole table', () => {
    const next = run(caretIn(open(GRID), 'a'), tableCommands.deleteTable);
    expect(markdownOf(next)).toBe('');
  });
});
