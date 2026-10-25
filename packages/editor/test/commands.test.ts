/**
 * Commands are asserted through markdown, not through the document tree: press the
 * button, then read the file that would be saved. That is the behaviour that matters,
 * and it keeps these tests honest about the bridge as well as the command.
 */
import { docToMarkdown } from '@md-studio/markdown';
import type { Node as PmNode } from 'prosemirror-model';
import { NodeSelection, TextSelection, type Command, type EditorState } from 'prosemirror-state';
import { describe, expect, it } from 'vitest';
import { commands, createEditorState, insertTable, readStatus, setLink } from '../src/index.ts';

function open(markdown: string): EditorState {
  return createEditorState(markdown);
}

function locate(doc: PmNode, needle: string): { from: number; to: number } {
  const matches: { from: number; to: number }[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText || node.text === undefined) return;
    const index = node.text.indexOf(needle);
    if (index >= 0) matches.push({ from: pos + index, to: pos + index + needle.length });
  });

  const first = matches[0];
  if (!first) throw new Error(`"${needle}" is not in the document`);
  return first;
}

function select(state: EditorState, needle: string): EditorState {
  const { from, to } = locate(state.doc, needle);
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, from, to)));
}

function caretIn(state: EditorState, needle: string): EditorState {
  const { from } = locate(state.doc, needle);
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, from, from)));
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

describe('inline formatting', () => {
  it('wraps a selection in bold', () => {
    const state = select(open('hello world\n'), 'world');
    expect(markdownOf(run(state, commands.bold))).toBe('hello **world**\n');
  });

  it('removes bold when the selection already has it', () => {
    const state = select(open('hello **world**\n'), 'world');
    expect(markdownOf(run(state, commands.bold))).toBe('hello world\n');
  });

  it('applies strikethrough', () => {
    const state = select(open('hello world\n'), 'world');
    expect(markdownOf(run(state, commands.strike))).toBe('hello ~~world~~\n');
  });

  it('applies inline code', () => {
    const state = select(open('run npm now\n'), 'npm');
    expect(markdownOf(run(state, commands.code))).toBe('run `npm` now\n');
  });

  it('clears character formatting without touching the block', () => {
    const state = select(open('## a **bold** word\n'), 'bold');
    expect(markdownOf(run(state, commands.clearFormatting))).toBe('## a bold word\n');
  });

  it('adds and removes a link', () => {
    const selected = select(open('see the docs\n'), 'docs');
    const linked = run(selected, setLink('https://example.com'));
    expect(markdownOf(linked)).toBe('see the [docs](https://example.com)\n');

    const unlinked = run(select(linked, 'docs'), commands.removeLink);
    expect(markdownOf(unlinked)).toBe('see the docs\n');
  });

  it('retargets a link when the caret merely sits inside it', () => {
    const state = caretIn(open('see the [docs](https://old.example)\n'), 'docs');
    expect(markdownOf(run(state, setLink('https://new.example')))).toBe(
      'see the [docs](https://new.example)\n',
    );
  });
});

describe('block formatting', () => {
  it('turns a paragraph into a heading and back', () => {
    const paragraph = caretIn(open('Title\n'), 'Title');
    const heading = run(paragraph, commands.heading2);
    expect(markdownOf(heading)).toBe('## Title\n');
    expect(markdownOf(run(caretIn(heading, 'Title'), commands.heading2))).toBe('Title\n');
  });

  it('wraps and unwraps a block quote', () => {
    const paragraph = caretIn(open('Quoted\n'), 'Quoted');
    const quoted = run(paragraph, commands.blockquote);
    expect(markdownOf(quoted)).toBe('> Quoted\n');
    expect(markdownOf(run(caretIn(quoted, 'Quoted'), commands.blockquote))).toBe('Quoted\n');
  });

  it('turns a paragraph into a code block and back', () => {
    const paragraph = caretIn(open('const x = 1;\n'), 'const');
    const code = run(paragraph, commands.codeBlock);
    expect(markdownOf(code)).toBe('```\nconst x = 1;\n```\n');
    expect(markdownOf(run(caretIn(code, 'const'), commands.codeBlock))).toBe('const x = 1;\n');
  });

  it('inserts a horizontal rule', () => {
    const state = open('before\n');
    const end = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, state.doc.content.size - 1)),
    );
    expect(markdownOf(run(end, commands.horizontalRule))).toBe('before\n\n---\n');
  });
});

describe('lists', () => {
  it('wraps a paragraph in a bullet list and lifts it back out', () => {
    const paragraph = caretIn(open('item\n'), 'item');
    const list = run(paragraph, commands.bulletList);
    expect(markdownOf(list)).toBe('- item\n');
    expect(markdownOf(run(caretIn(list, 'item'), commands.bulletList))).toBe('item\n');
  });

  it('converts bullets to numbers in place rather than nesting them', () => {
    const bullets = caretIn(open('- one\n- two\n'), 'one');
    const numbered = markdownOf(run(bullets, commands.orderedList));
    expect(numbered).toBe('1. one\n2. two\n');
  });

  it('makes a task list', () => {
    const paragraph = caretIn(open('do it\n'), 'do it');
    expect(markdownOf(run(paragraph, commands.taskList))).toBe('- [ ] do it\n');
  });

  it('turns a task list back into a plain bullet list', () => {
    const tasks = caretIn(open('- [ ] do it\n'), 'do it');
    expect(markdownOf(run(tasks, commands.bulletList))).toBe('- do it\n');
  });

  it('indents an item into a nested list', () => {
    const state = caretIn(open('- one\n- two\n'), 'two');
    expect(markdownOf(run(state, commands.indent))).toBe('- one\n  - two\n');
  });

  it('outdents a nested item', () => {
    const state = caretIn(open('- one\n  - two\n'), 'two');
    expect(markdownOf(run(state, commands.outdent))).toBe('- one\n- two\n');
  });
});

describe('tables', () => {
  it('inserts a table with a header row', () => {
    const state = open('');
    const withTable = run(state, insertTable(3, 2));
    const table = withTable.doc.child(0);

    expect(table.type.name).toBe('table');
    expect(table.childCount).toBe(3);
    expect(table.child(0).child(0).type.name).toBe('tableHeader');
    // Empty cells make the narrowest legal GFM table; a single dash is a valid delimiter.
    expect(markdownOf(withTable)).toBe('|   |   |\n| - | - |\n|   |   |\n|   |   |\n');
  });

  it('formats text inside a cell', () => {
    const state = select(open('| a | b |\n| --- | --- |\n| c | d |\n'), 'c');
    // Column widths follow the widest cell, which is why the first column grows.
    expect(markdownOf(run(state, commands.bold))).toBe(
      '| a     | b |\n| ----- | - |\n| **c** | d |\n',
    );
  });
});

describe('status', () => {
  it('reports the active marks and heading level', () => {
    const status = readStatus(select(open('## a **bold** word\n'), 'bold'));
    expect(status.marks.bold).toBe(true);
    expect(status.marks.italic).toBe(false);
    expect(status.block).toBe('heading');
    expect(status.headingLevel).toBe(2);
  });

  it('distinguishes bullet, ordered and task lists', () => {
    expect(readStatus(caretIn(open('- one\n'), 'one')).list).toBe('bullet');
    expect(readStatus(caretIn(open('1. one\n'), 'one')).list).toBe('ordered');
    expect(readStatus(caretIn(open('- [x] one\n'), 'one')).list).toBe('task');
  });

  it('refuses block commands inside a table cell, and says why', () => {
    const status = readStatus(caretIn(open('| a | b |\n| --- | --- |\n| c | d |\n'), 'c'));
    expect(status.inTable).toBe(true);
    expect(status.can.table).toBe(false);
    expect(status.can.bulletList).toBe(false);
    expect(status.reason.table).toBe('A markdown table cell can only hold inline text.');
    // Inline formatting is still fine in a cell.
    expect(status.can.bold).toBe(true);
  });

  it('refuses formatting inside a code block, and says why', () => {
    const status = readStatus(select(open('```\nconst x = 1;\n```\n'), 'const'));
    expect(status.can.bold).toBe(false);
    expect(status.reason.bold).toBe('A code block holds plain text, so formatting does not apply.');
  });

  it('starts the caret in the first block that can hold one, not on leading frontmatter', () => {
    const state = open('---\ntitle: x\n---\n\nBody\n');
    expect(state.selection instanceof NodeSelection).toBe(false);
    expect(state.selection.$from.parent.textContent).toBe('Body');
  });

  it('refuses to restructure a verbatim block', () => {
    const state = open('---\ntitle: x\n---\n\nBody\n');
    const selected = state.apply(state.tr.setSelection(NodeSelection.create(state.doc, 0)));
    const status = readStatus(selected);

    expect(status.can.bulletList).toBe(false);
    expect(status.can.blockquote).toBe(false);
    expect(status.can.table).toBe(false);
    expect(status.reason.bulletList).toBe(
      'This block is kept as raw markdown and cannot be formatted.',
    );
  });

  it('reports the link under the caret', () => {
    const status = readStatus(caretIn(open('see the [docs](https://example.com)\n'), 'docs'));
    expect(status.link?.href).toBe('https://example.com');
  });
});
