import { Slice } from 'prosemirror-model';
import { markdownToDoc } from '@md-studio/markdown';
import type { Command } from 'prosemirror-state';
import { nodes } from './schema-types.ts';

/**
 * Replaces the document's frontmatter with new YAML, as one transaction.
 *
 * Editing it through the document rather than rewriting the file means the change lands
 * in the editor's history and the caret is not thrown away on every keystroke in the form.
 */
export function setFrontmatter(value: string): Command {
  return (state, dispatch) => {
    const first = state.doc.firstChild;
    const hasFrontmatter = first?.type === nodes.frontmatter;
    const trimmed = value.trim();

    if (!hasFrontmatter && trimmed.length === 0) return false;

    if (dispatch) {
      if (hasFrontmatter && trimmed.length === 0) {
        dispatch(state.tr.delete(0, first.nodeSize).scrollIntoView());
      } else if (hasFrontmatter) {
        dispatch(state.tr.setNodeAttribute(0, 'value', trimmed));
      } else {
        dispatch(state.tr.insert(0, nodes.frontmatter.create({ value: trimmed })));
      }
    }
    return true;
  };
}

/**
 * Inserts markdown at the caret, used by templates. Block structure is inserted as
 * blocks; a single paragraph merges into the surrounding text.
 */
export function insertMarkdown(markdown: string): Command {
  return (state, dispatch) => {
    const doc = markdownToDoc(markdown);
    if (doc.content.size === 0) return false;

    if (dispatch) {
      const inline = doc.childCount === 1 && doc.firstChild?.isTextblock === true;
      const slice = new Slice(doc.content, inline ? 1 : 0, inline ? 1 : 0);
      dispatch(state.tr.replaceSelection(slice).scrollIntoView());
    }
    return true;
  };
}
