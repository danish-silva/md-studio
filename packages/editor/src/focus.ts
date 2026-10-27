import { Plugin } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';

/**
 * Marks the top-level block the caret is in.
 *
 * The decoration is always applied and costs nothing to draw; whether the rest of the
 * document is dimmed is left to CSS, so focus mode can be toggled without tearing the
 * editor down and losing undo history.
 */
export function activeBlockPlugin(): Plugin {
  return new Plugin({
    props: {
      decorations(state) {
        const { $from } = state.selection;
        if ($from.depth === 0) return DecorationSet.empty;

        const pos = $from.before(1);
        const node = state.doc.nodeAt(pos);
        if (!node) return DecorationSet.empty;

        return DecorationSet.create(state.doc, [
          Decoration.node(pos, pos + node.nodeSize, { class: 'md-active-block' }),
        ]);
      },
    },
  });
}
