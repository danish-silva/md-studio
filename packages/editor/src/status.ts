import type { Mark } from 'prosemirror-model';
import { NodeSelection, type EditorState } from 'prosemirror-state';
import { commands, type CommandName } from './commands.ts';
import { findAncestor, isMarkActive, isTaskList } from './queries.ts';
import { marks, nodes } from './schema-types.ts';

export type MarkName = 'bold' | 'italic' | 'strike' | 'code' | 'link';
export type BlockName = 'paragraph' | 'heading' | 'codeBlock' | 'other';
export type ListKind = 'bullet' | 'ordered' | 'task';

export interface EditorStatus {
  marks: Record<MarkName, boolean>;
  block: BlockName;
  headingLevel: number | null;
  inBlockquote: boolean;
  inTable: boolean;
  /** False when the caret is a plain cursor, which is what Ctrl+K needs to know. */
  hasSelection: boolean;
  list: ListKind | null;
  link: { href: string; title: string | null } | null;
  can: Record<CommandName, boolean>;
  /**
   * Why a command is unavailable here. The toolbar shows this on the disabled button, so
   * an action markdown cannot express explains itself instead of silently doing nothing.
   */
  reason: Partial<Record<CommandName, string>>;
}

const BLOCK_COMMANDS = new Set<CommandName>([
  'heading1',
  'heading2',
  'heading3',
  'heading4',
  'heading5',
  'heading6',
  'blockquote',
  'codeBlock',
  'bulletList',
  'orderedList',
  'taskList',
  'horizontalRule',
  'table',
]);

const MARK_COMMANDS = new Set<CommandName>([
  'bold',
  'italic',
  'strike',
  'code',
  'clearFormatting',
  'removeLink',
]);

const ATOM_BLOCKS = new Set(['rawBlock', 'frontmatter', 'horizontalRule']);

export function readStatus(state: EditorState): EditorStatus {
  const explain = explainer(state);

  const can = {} as Record<CommandName, boolean>;
  const reason: Partial<Record<CommandName, string>> = {};

  for (const [name, command] of Object.entries(commands) as [CommandName, (typeof commands)[CommandName]][]) {
    const allowed = command(state);
    can[name] = allowed;
    if (!allowed) {
      const why = explain(name);
      if (why !== undefined) reason[name] = why;
    }
  }

  const heading = findAncestor(state, nodes.heading);
  const code = findAncestor(state, nodes.codeBlock);
  const bullet = findAncestor(state, nodes.bulletList);
  const ordered = findAncestor(state, nodes.orderedList);

  let list: ListKind | null = null;
  if (bullet && (!ordered || bullet.depth > ordered.depth)) {
    list = isTaskList(bullet.node) ? 'task' : 'bullet';
  } else if (ordered) {
    list = 'ordered';
  }

  const linkMark = linkAt(state);

  return {
    marks: {
      bold: isMarkActive(state, marks.bold),
      italic: isMarkActive(state, marks.italic),
      strike: isMarkActive(state, marks.strike),
      code: isMarkActive(state, marks.code),
      link: linkMark !== undefined,
    },
    block: code ? 'codeBlock' : heading ? 'heading' : blockNameOf(state),
    headingLevel: heading ? numberOr(heading.node.attrs['level'], 1) : null,
    inBlockquote: findAncestor(state, nodes.blockquote) !== null,
    inTable: inTable(state),
    hasSelection: !state.selection.empty,
    list,
    link: linkMark
      ? {
          href: String(linkMark.attrs['href'] ?? ''),
          title: typeof linkMark.attrs['title'] === 'string' ? linkMark.attrs['title'] : null,
        }
      : null,
    can,
    reason,
  };
}

/**
 * A caret resting at the very start of a link sits on the boundary, and the link mark is
 * not inclusive, so `$from.marks()` reports nothing. Look at the nodes on either side too,
 * otherwise Ctrl+K on a link the user is clearly inside would create a second one.
 */
function linkAt(state: EditorState): Mark | undefined {
  const stored = state.storedMarks ? marks.link.isInSet(state.storedMarks) : undefined;
  if (stored) return stored;

  const { $from } = state.selection;
  return (
    marks.link.isInSet($from.marks()) ??
    marks.link.isInSet($from.nodeAfter?.marks ?? []) ??
    marks.link.isInSet($from.nodeBefore?.marks ?? [])
  );
}

function blockNameOf(state: EditorState): BlockName {
  return state.selection.$from.parent.type === nodes.paragraph ? 'paragraph' : 'other';
}

function inTable(state: EditorState): boolean {
  return (
    findAncestor(state, nodes.tableCell) !== null || findAncestor(state, nodes.tableHeader) !== null
  );
}

function explainer(state: EditorState): (name: CommandName) => string | undefined {
  const table = inTable(state);
  const code = findAncestor(state, nodes.codeBlock) !== null;
  const selection = state.selection;
  const atom = selection instanceof NodeSelection && ATOM_BLOCKS.has(selection.node.type.name);

  return (name) => {
    if (atom) {
      return 'This block is kept as raw markdown and cannot be formatted.';
    }
    if (table && BLOCK_COMMANDS.has(name)) {
      return 'A markdown table cell can only hold inline text.';
    }
    if (code && (MARK_COMMANDS.has(name) || BLOCK_COMMANDS.has(name))) {
      return 'A code block holds plain text, so formatting does not apply.';
    }
    return undefined;
  };
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' ? value : fallback;
}
