import type { Node as PmNode } from 'prosemirror-model';
import {
  Plugin,
  PluginKey,
  TextSelection,
  type Command,
  type EditorState,
  type Transaction,
} from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';

export interface SearchQuery {
  text: string;
  regex: boolean;
  caseSensitive: boolean;
}

export interface SearchMatch {
  from: number;
  to: number;
  /** Capture groups, so a regex replacement can refer to `$1`. */
  groups: string[];
}

export interface SearchState {
  query: SearchQuery | null;
  matches: SearchMatch[];
  /** Index into `matches`, or -1 when there is nothing to step through. */
  current: number;
  /** Set when a regex query does not compile, for the UI to show. */
  error: string | null;
}

export const searchKey = new PluginKey<SearchState>('md-studio-search');

/** Separate from the plugin key so stepping does not look like a new query. */
const CURRENT_META = 'md-studio-search-current';

const EMPTY: SearchState = { query: null, matches: [], current: -1, error: null };

/** Stands in for an inline atom so a match cannot silently span an image or raw node. */
const ATOM = '￼';

export function searchPlugin(): Plugin<SearchState> {
  return new Plugin<SearchState>({
    key: searchKey,

    state: {
      init: () => EMPTY,
      apply(tr, value, _old, newState) {
        const next = tr.getMeta(searchKey) as { query: SearchQuery | null } | undefined;

        if (next !== undefined) {
          return recompute(newState.doc, next.query, value.current);
        }
        if (tr.docChanged && value.query !== null) {
          return recompute(newState.doc, value.query, value.current);
        }

        const moved = tr.getMeta(CURRENT_META) as number | undefined;
        if (moved !== undefined) return { ...value, current: moved };

        return value;
      },
    },

    props: {
      decorations(state) {
        const search = searchKey.getState(state);
        if (!search || search.matches.length === 0) return DecorationSet.empty;

        return DecorationSet.create(
          state.doc,
          search.matches.map((match, index) =>
            Decoration.inline(match.from, match.to, {
              class: index === search.current ? 'md-search-current' : 'md-search-match',
            }),
          ),
        );
      },
    },
  });
}

function recompute(doc: PmNode, query: SearchQuery | null, previous: number): SearchState {
  if (query === null || query.text.length === 0) return EMPTY;

  let pattern: RegExp;
  try {
    pattern = buildPattern(query);
  } catch (error) {
    return {
      query,
      matches: [],
      current: -1,
      error: error instanceof Error ? error.message : 'Invalid pattern',
    };
  }

  const matches = collect(doc, pattern);
  const current = matches.length === 0 ? -1 : Math.min(Math.max(previous, 0), matches.length - 1);
  return { query, matches, current, error: null };
}

function buildPattern(query: SearchQuery): RegExp {
  const source = query.regex ? query.text : escapeLiteral(query.text);
  return new RegExp(source, query.caseSensitive ? 'gu' : 'giu');
}

function escapeLiteral(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Searching happens per text block, so a match never spans a paragraph boundary, and the
 * offset map accounts for inline atoms that occupy a position but contribute no text.
 */
function collect(doc: PmNode, pattern: RegExp): SearchMatch[] {
  const matches: SearchMatch[] = [];

  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;

    const { text, positions } = flatten(node, pos);
    if (text.length === 0) return false;

    pattern.lastIndex = 0;
    let found: RegExpExecArray | null;

    while ((found = pattern.exec(text)) !== null) {
      if (found[0].length === 0) {
        pattern.lastIndex += 1;
        continue;
      }

      const from = positions[found.index];
      const last = positions[found.index + found[0].length - 1];
      if (from === undefined || last === undefined) continue;

      matches.push({
        from,
        to: last + 1,
        groups: found.slice(1).map((group) => group ?? ''),
      });
    }
    return false;
  });

  return matches;
}

function flatten(block: PmNode, blockPos: number): { text: string; positions: number[] } {
  let text = '';
  const positions: number[] = [];
  let pos = blockPos + 1;

  block.forEach((child) => {
    if (child.isText && child.text !== undefined) {
      for (let index = 0; index < child.text.length; index += 1) {
        text += child.text[index];
        positions.push(pos + index);
      }
    } else {
      text += ATOM;
      positions.push(pos);
    }
    pos += child.nodeSize;
  });

  return { text, positions };
}

export function readSearch(state: EditorState): SearchState {
  return searchKey.getState(state) ?? EMPTY;
}

export function setSearchQuery(query: SearchQuery | null): Command {
  return (state, dispatch) => {
    if (dispatch) dispatch(state.tr.setMeta(searchKey, { query }));
    return true;
  };
}

/** Steps through matches, wrapping at either end, and puts the caret on the match. */
export function stepMatch(delta: 1 | -1): Command {
  return (state, dispatch) => {
    const search = readSearch(state);
    if (search.matches.length === 0) return false;

    const next =
      (search.current + delta + search.matches.length) % search.matches.length;
    const match = search.matches[next];
    if (!match) return false;

    if (dispatch) {
      dispatch(
        state.tr
          .setMeta(CURRENT_META, next)
          .setSelection(TextSelection.create(state.doc, match.from, match.to))
          .scrollIntoView(),
      );
    }
    return true;
  };
}

export function replaceCurrentMatch(replacement: string): Command {
  return (state, dispatch) => {
    const search = readSearch(state);
    const match = search.matches[search.current];
    if (!match) return false;

    if (dispatch) {
      const tr = state.tr;
      replaceRange(tr, state, match, expand(replacement, match, search.query));
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

export function replaceAllMatches(replacement: string): Command {
  return (state, dispatch) => {
    const search = readSearch(state);
    if (search.matches.length === 0) return false;

    if (dispatch) {
      const tr = state.tr;
      // Back to front, so earlier positions stay valid as the document shrinks or grows.
      for (const match of [...search.matches].reverse()) {
        replaceRange(tr, state, match, expand(replacement, match, search.query));
      }
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

/**
 * Replacement text inherits the marks the match sat inside, so replacing a word inside
 * **bold** does not quietly strip the bold.
 */
function replaceRange(
  tr: Transaction,
  state: EditorState,
  match: SearchMatch,
  text: string,
): void {
  if (text.length === 0) {
    tr.delete(match.from, match.to);
    return;
  }

  const from = state.doc.resolve(match.from);
  const marks = from.marksAcross(state.doc.resolve(match.to)) ?? from.marks();
  tr.replaceWith(match.from, match.to, state.schema.text(text, marks));
}

/** `$1`…`$9` refer to capture groups, but only when the query was a regex. */
function expand(replacement: string, match: SearchMatch, query: SearchQuery | null): string {
  if (query?.regex !== true) return replacement;

  return replacement.replace(/\$(\d)/g, (whole, digit: string) => {
    const index = Number(digit) - 1;
    return match.groups[index] ?? whole;
  });
}
