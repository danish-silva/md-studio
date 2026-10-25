import { useEffect, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { markdown } from '@codemirror/lang-markdown';
import { oneDark } from '@codemirror/theme-one-dark';
import { basicSetup } from 'codemirror';
import { readCachedState, writeCachedState } from '../lib/editor-cache';
import { moveSection, outlineOf, writeFrontmatter } from '@md-studio/markdown';
import { parse as parseYaml } from 'yaml';
import { useDocuments } from '../state/documents';
import { useFind, type FindAction } from '../state/find';
import { useNavigate, type NavigateRequest } from '../state/navigate';

const layout = EditorView.theme({
  '&': { height: '100%', fontSize: '14px' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: 'ui-monospace, "Cascadia Code", "JetBrains Mono", Consolas, monospace',
    lineHeight: '1.7',
  },
  '.cm-content': { padding: '18px 22px 40vh' },
  '.cm-gutters': { border: 'none' },
});

export interface SourceEditorProps {
  /**
   * Identity of the buffer on screen: path plus load revision. Changing it mounts a fresh
   * editor, so undo history never leaks across files and a reload from disk cannot leave
   * the previous text on screen.
   */
  documentKey: string;
  documentPath: string;
  initialText: string;
  onChange: (text: string) => void;
}

export function SourceEditor({ documentKey, documentPath, initialText, onChange }: SourceEditorProps) {
  const host = useRef<HTMLDivElement | null>(null);
  // Held in a ref so a new callback identity does not tear down the editor.
  const notify = useRef(onChange);
  notify.current = onChange;

  useEffect(() => {
    const parent = host.current;
    if (!parent) return;

    // Reuse the state this tab had when it was last on screen, so switching away and
    // back does not reset undo history.
    const cached = readCachedState<EditorState>(documentKey, initialText);

    const view = new EditorView({
      parent,
      state:
        cached ??
        EditorState.create({
          doc: initialText,
          extensions: [
            basicSetup,
            markdown(),
            oneDark,
            layout,
            EditorView.lineWrapping,
            EditorView.updateListener.of((update) => {
              if (update.docChanged) {
                notify.current(update.state.doc.toString());
              }
            }),
          ],
        }),
    });
    const remembered = useDocuments.getState().byPath[documentPath];
    if (!cached && remembered && remembered.cursor > 0) {
      const at = Math.min(remembered.cursor, view.state.doc.length);
      view.dispatch({ selection: { anchor: at } });
      requestAnimationFrame(() => {
        view.scrollDOM.scrollTop = remembered.scrollTop;
      });
    }
    view.focus();

    const stopFind = subscribeFind(view);
    const stopNavigate = subscribeNavigate(view);

    return () => {
      stopFind();
      stopNavigate();
      useDocuments.getState().recordViewState(documentPath, {
        cursor: view.state.selection.main.head,
        scrollTop: view.scrollDOM.scrollTop,
      });
      writeCachedState(documentKey, view.state, view.state.doc.toString());
      view.destroy();
    };
    // initialText is the seed for this mount only; later edits flow through onChange.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentKey, documentPath]);

  return <div ref={host} className="h-full overflow-hidden" />;
}

interface Span {
  from: number;
  to: number;
}

function findMatches(text: string, query: string, regex: boolean, caseSensitive: boolean): Span[] {
  const source = regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(source, caseSensitive ? 'g' : 'gi');

  const spans: Span[] = [];
  let found: RegExpExecArray | null;

  while ((found = pattern.exec(text)) !== null) {
    if (found[0].length === 0) {
      pattern.lastIndex += 1;
      continue;
    }
    spans.push({ from: found.index, to: found.index + found[0].length });
  }
  return spans;
}

/**
 * The same find bar drives the source view, but through CodeMirror's own selection rather
 * than decorations: basicSetup already highlights other occurrences of what is selected.
 */
function subscribeFind(view: EditorView): () => void {
  let lastNonce = 0;
  let current = -1;
  let lastQuery = '';

  const apply = () => {
    const find = useFind.getState();

    if (!find.open || find.query.length === 0) {
      current = -1;
      lastQuery = '';
      find.report({ total: 0, current: -1, error: null });
      return;
    }

    let matches: Span[] = [];
    let error: string | null = null;
    try {
      matches = findMatches(view.state.doc.toString(), find.query, find.regex, find.caseSensitive);
    } catch (problem) {
      error = problem instanceof Error ? problem.message : 'Invalid pattern';
    }

    if (find.query !== lastQuery) {
      lastQuery = find.query;
      current = matches.length > 0 ? 0 : -1;
      select(view, matches[0]);
    } else if (current >= matches.length) {
      current = matches.length > 0 ? 0 : -1;
    }

    const request = find.request;
    if (request !== null && request.nonce !== lastNonce) {
      lastNonce = request.nonce;
      current = run(view, request.action, matches, current, find.replacement);
      if (request.action === 'replace' || request.action === 'replaceAll') {
        matches = [];
        current = -1;
      }
    }

    find.report({ total: matches.length, current, error });
  };

  apply();
  return useFind.subscribe(apply);
}

function run(
  view: EditorView,
  action: FindAction,
  matches: Span[],
  current: number,
  replacement: string,
): number {
  if (matches.length === 0) return -1;

  if (action === 'next' || action === 'previous') {
    const delta = action === 'next' ? 1 : -1;
    const next = (current + delta + matches.length) % matches.length;
    select(view, matches[next]);
    return next;
  }

  if (action === 'replace') {
    const match = matches[Math.max(0, current)];
    if (match) view.dispatch({ changes: { ...match, insert: replacement } });
    return -1;
  }

  // Back to front keeps the earlier offsets valid as the document changes length.
  view.dispatch({
    changes: [...matches].reverse().map((match) => ({ ...match, insert: replacement })),
  });
  return -1;
}

function select(view: EditorView, match: Span | undefined): void {
  if (!match) return;
  view.dispatch({ selection: { anchor: match.from, head: match.to }, scrollIntoView: true });
}

function rewrite(text: string, request: NavigateRequest): string | null {
  if (request.kind === 'moveSection') {
    return moveSection(text, request.from, request.to);
  }
  if (request.kind === 'frontmatter') {
    try {
      const parsed: unknown = request.yaml.trim().length === 0 ? {} : parseYaml(request.yaml);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
      return writeFrontmatter(text, parsed as Record<string, never>);
    } catch {
      return null;
    }
  }
  return null;
}

function subscribeNavigate(view: EditorView): () => void {
  let lastNonce = 0;

  return useNavigate.subscribe(() => {
    const request = useNavigate.getState().request;
    if (request === null || request.nonce === lastNonce) return;
    lastNonce = request.nonce;

    const text = view.state.doc.toString();

    if (request.kind === 'insertMarkdown') {
      const at = view.state.selection.main;
      view.dispatch({ changes: { from: at.from, to: at.to, insert: request.markdown } });
      view.focus();
      return;
    }

    if (request.kind === 'heading') {
      const entry = outlineOf(text).find((candidate) => candidate.index === request.index);
      if (!entry) return;
      const line = view.state.doc.line(Math.min(entry.line, view.state.doc.lines));
      view.dispatch({ selection: { anchor: line.from }, scrollIntoView: true });
      view.focus();
      return;
    }

    // Replacing the whole document in one transaction keeps these undoable here too.
    const next = rewrite(text, request);
    if (next === null || next === text) return;

    const selection = Math.min(view.state.selection.main.head, next.length);
    view.dispatch({
      changes: { from: 0, to: text.length, insert: next },
      selection: { anchor: selection },
    });
    if (request.kind !== 'frontmatter') view.focus();
  });
}
