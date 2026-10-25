import { docToMarkdown } from '@md-studio/markdown';
import type { Command, EditorState } from 'prosemirror-state';
import { describe, expect, it } from 'vitest';
import {
  createEditorState,
  moveSectionCommand,
  readSearch,
  replaceAllMatches,
  replaceCurrentMatch,
  setSearchQuery,
  stepMatch,
} from '../src/index.ts';

function run(state: EditorState, command: Command): EditorState {
  let next = state;
  command(state, (tr) => {
    next = state.apply(tr);
  });
  return next;
}

function search(markdown: string, text: string, options: { regex?: boolean; caseSensitive?: boolean } = {}) {
  const state = createEditorState(markdown);
  return run(
    state,
    setSearchQuery({
      text,
      regex: options.regex ?? false,
      caseSensitive: options.caseSensitive ?? false,
    }),
  );
}

describe('finding', () => {
  it('finds every occurrence, ignoring case by default', () => {
    expect(readSearch(search('one Two two\n', 'two')).matches).toHaveLength(2);
  });

  it('respects case when asked', () => {
    const state = search('one Two two\n', 'two', { caseSensitive: true });
    expect(readSearch(state).matches).toHaveLength(1);
  });

  it('treats the query literally unless it is a regex', () => {
    expect(readSearch(search('a.b axb\n', 'a.b')).matches).toHaveLength(1);
    expect(readSearch(search('a.b axb\n', 'a.b', { regex: true })).matches).toHaveLength(2);
  });

  it('reports a regex that will not compile instead of throwing', () => {
    const state = search('text\n', '(unclosed', { regex: true });
    expect(readSearch(state).error).not.toBeNull();
    expect(readSearch(state).matches).toEqual([]);
  });

  it('does not match across a paragraph boundary', () => {
    expect(readSearch(search('end\n\nstart\n', 'end start')).matches).toEqual([]);
  });

  it('finds text that formatting splits in two', () => {
    // "hello" spans a plain span and a bold one, which are separate text nodes.
    expect(readSearch(search('hel**lo** there\n', 'hello')).matches).toHaveLength(1);
  });

  it('does not let a match swallow an inline image', () => {
    expect(readSearch(search('a![x](y.png)b\n', 'ab')).matches).toEqual([]);
  });

  it('steps through matches and wraps around', () => {
    let state = search('x x x\n', 'x');
    expect(readSearch(state).current).toBe(0);

    state = run(state, stepMatch(1));
    expect(readSearch(state).current).toBe(1);

    state = run(run(state, stepMatch(1)), stepMatch(1));
    expect(readSearch(state).current).toBe(0);
  });
});

describe('replacing', () => {
  it('replaces the current match only', () => {
    const state = search('cat cat\n', 'cat');
    expect(docToMarkdown(run(state, replaceCurrentMatch('dog')).doc)).toBe('dog cat\n');
  });

  it('replaces every match', () => {
    const state = search('cat cat cat\n', 'cat');
    expect(docToMarkdown(run(state, replaceAllMatches('dog')).doc)).toBe('dog dog dog\n');
  });

  it('expands capture groups in regex mode', () => {
    const state = search('Ada Lovelace\n', '(\\w+) (\\w+)', { regex: true });
    expect(docToMarkdown(run(state, replaceAllMatches('$2, $1')).doc)).toBe('Lovelace, Ada\n');
  });

  it('leaves $1 alone when the query was literal', () => {
    const state = search('a\n', 'a');
    expect(docToMarkdown(run(state, replaceAllMatches('$1')).doc)).toBe('$1\n');
  });

  it('keeps the formatting around a replaced word', () => {
    const state = search('a **bold** word\n', 'bold');
    expect(docToMarkdown(run(state, replaceAllMatches('brave')).doc)).toBe('a **brave** word\n');
  });
});

describe('moving sections in the document', () => {
  const document = '# A\n\nalpha\n\n# B\n\nbravo\n\n# C\n\ncharlie\n';

  it('moves a section down as one undoable step', () => {
    const state = createEditorState(document);
    const moved = run(state, moveSectionCommand(0, 2));
    expect(docToMarkdown(moved.doc)).toBe('# B\n\nbravo\n\n# A\n\nalpha\n\n# C\n\ncharlie\n');
  });

  it('moves a section up', () => {
    const state = createEditorState(document);
    expect(docToMarkdown(run(state, moveSectionCommand(4, 0)).doc)).toBe(
      '# C\n\ncharlie\n\n# A\n\nalpha\n\n# B\n\nbravo\n',
    );
  });

  it('refuses a drop inside the section being moved', () => {
    const nested = '# A\n\n## A1\n\nx\n\n# B\n\ny\n';
    const state = createEditorState(nested);
    expect(moveSectionCommand(0, 1)(state)).toBe(false);
  });
});
