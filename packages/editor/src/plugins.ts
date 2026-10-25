import { markdownToDoc } from '@md-studio/markdown';
import { baseKeymap } from 'prosemirror-commands';
import { dropCursor } from 'prosemirror-dropcursor';
import { gapCursor } from 'prosemirror-gapcursor';
import { history } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import type { Node as PmNode } from 'prosemirror-model';
import { EditorState, Selection, TextSelection, type Plugin } from 'prosemirror-state';
import { markdownInputRules } from './input-rules.ts';
import { editorKeymap, type KeymapOptions } from './keymap.ts';
import { pastePlugin, type PasteOptions } from './paste.ts';
import { tableAlignmentDecorations } from './tables.ts';

export type EditorOptions = KeymapOptions & PasteOptions;

/**
 * Order is precedence: our bindings get first refusal, then the input rules, then
 * ProseMirror's defaults. gapCursor is what lets the caret sit beside an atom such as a
 * raw block or a rule, so those are not traps.
 */
export function createPlugins(options: EditorOptions = {}): Plugin[] {
  return [
    history(),
    editorKeymap(options),
    markdownInputRules(),
    pastePlugin(options),
    tableAlignmentDecorations(),
    keymap(baseKeymap),
    dropCursor({ color: 'var(--app-accent)', width: 2 }),
    gapCursor(),
  ];
}

export function createEditorState(markdown: string, options: EditorOptions = {}): EditorState {
  const doc = markdownToDoc(markdown);
  return EditorState.create({
    doc,
    selection: initialSelection(doc),
    plugins: createPlugins(options),
  });
}

/**
 * Start the caret in the first block that can hold one.
 *
 * `Selection.atStart` and `TextSelection.near` both settle on a leading atom — frontmatter,
 * typically — as a node selection, which opens the document with the whole toolbar
 * disabled and the YAML highlighted, before the user has done anything.
 */
function initialSelection(doc: PmNode): Selection {
  const textblocks: number[] = [];
  doc.descendants((node, pos) => {
    if (textblocks.length > 0) return false;
    if (node.isTextblock) {
      textblocks.push(pos + 1);
      return false;
    }
    return true;
  });

  const first = textblocks[0];
  return first === undefined ? Selection.atStart(doc) : TextSelection.create(doc, first);
}
