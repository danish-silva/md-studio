import type { MarkType } from 'prosemirror-model';
import {
  InputRule,
  inputRules,
  textblockTypeInputRule,
  wrappingInputRule,
} from 'prosemirror-inputrules';
import type { Plugin } from 'prosemirror-state';
import { marks, nodes } from './schema-types.ts';

/**
 * Typing markdown still works, even though the editor is visual: the syntax disappears
 * and the formatting appears, the way it does in Word's autoformat.
 */
export function markdownInputRules(): Plugin {
  return inputRules({
    rules: [
      // `# ` through `###### `
      textblockTypeInputRule(/^(#{1,6})\s$/, nodes.heading, (match) => ({
        level: match[1]?.length ?? 1,
      })),

      // ```` ```ts ````
      textblockTypeInputRule(/^```([A-Za-z0-9+#._-]*)\s$/, nodes.codeBlock, (match) => ({
        language: match[1] !== undefined && match[1].length > 0 ? match[1] : null,
      })),

      wrappingInputRule(/^\s*>\s$/, nodes.blockquote),
      wrappingInputRule(/^\s*([-+*])\s$/, nodes.bulletList),
      wrappingInputRule(
        /^(\d+)[.)]\s$/,
        nodes.orderedList,
        (match) => ({ start: Number(match[1]) }),
        (match, node) => node.childCount + Number(node.attrs['start']) === Number(match[1]),
      ),

      // `[ ] ` or `[x] ` typed at the start of a list item turns it into a task.
      new InputRule(/^\[([ xX])\]\s$/, (state, match, start, end) => {
        const $start = state.doc.resolve(start);
        if ($start.depth < 2 || $start.node(-1).type !== nodes.listItem) return null;
        const checked = match[1]?.toLowerCase() === 'x';
        return state.tr.delete(start, end).setNodeAttribute($start.before(-1), 'checked', checked);
      }),

      // `---`, `***` or `___` on their own line.
      new InputRule(/^(?:-{3}|\*{3}|_{3})\s$/, (state, _match, start, end) =>
        state.tr.replaceRangeWith(start, end, nodes.horizontalRule.create()),
      ),

      markRule(/(?:\*\*)([^*]+)(?:\*\*)$/, marks.bold),
      markRule(/(?:__)([^_]+)(?:__)$/, marks.bold),
      markRule(/(?:^|[^*])\*([^*]+)\*$/, marks.italic),
      markRule(/(?:^|[^_])_([^_]+)_$/, marks.italic),
      markRule(/(?:~~)([^~]+)(?:~~)$/, marks.strike),
      markRule(/(?:`)([^`]+)(?:`)$/, marks.code),
    ],
  });
}

/**
 * prosemirror-inputrules has no mark rule of its own. Replace the matched span with
 * marked text, then clear the stored mark so typing continues unformatted.
 */
function markRule(pattern: RegExp, type: MarkType): InputRule {
  return new InputRule(pattern, (state, match, start, end) => {
    const full = match[0];
    const captured = match[1];
    if (full === undefined || captured === undefined || captured.length === 0) return null;

    // The italic patterns carry a leading character so they do not fire inside `**bold**`.
    // Keep it, and replace only from the opening marker onwards.
    const markerStart = start + leadingWidth(full, captured);

    const tr = state.tr;
    tr.replaceWith(markerStart, end, state.schema.text(captured, [type.create()]));
    tr.removeStoredMark(type);
    return tr;
  });
}

/** How much of the match precedes the opening marker, and so must be left alone. */
function leadingWidth(full: string, captured: string): number {
  const before = full.slice(0, full.indexOf(captured));
  const marker = /[*_~`]+$/.exec(before);
  return before.length - (marker?.[0].length ?? 0);
}
