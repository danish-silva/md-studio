import {
  commands,
  createEditorState,
  insertMarkdown,
  moveSectionCommand,
  readSearch,
  replaceAllMatches,
  replaceCurrentMatch,
  revealHeading,
  setFrontmatter,
  setSearchQuery,
  stepMatch,
  insertTable,
  nodes,
  readStatus,
  readTableStatus,
  setColumnAlignment,
  setLink,
  tableCommands,
  type ColumnAlignment,
  type CommandName,
  type EditorStatus,
  type TableCommandName,
  type SearchQuery,
  type TableStatus,
} from '@md-studio/editor';
import { docToMarkdown } from '@md-studio/markdown';
import { Fragment, Slice } from 'prosemirror-model';
import { TextSelection, type Command, type EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { useCallback, useEffect, useRef, useState } from 'react';
import { storeImages } from '../lib/assets';
import { readCachedState, writeCachedState } from '../lib/editor-cache';
import { useDocuments } from '../state/documents';
import { useFind, type FindAction } from '../state/find';
import { useNavigate } from '../state/navigate';
import { useSettings } from '../state/settings';
import { CodeBlockView } from './CodeBlockView';
import { LinkBar } from './LinkBar';
import { TableToolbar } from './TableToolbar';
import { TaskItemView } from './TaskItemView';
import { Toolbar } from './Toolbar';

export interface WysiwygPaneProps {
  /** Path plus load revision: changing it mounts a fresh editor and a fresh history. */
  documentKey: string;
  documentPath: string;
  initialMarkdown: string;
  onChange: (markdown: string) => void;
}

export function WysiwygPane({
  documentKey,
  documentPath,
  initialMarkdown,
  onChange,
}: WysiwygPaneProps) {
  const host = useRef<HTMLDivElement | null>(null);
  const view = useRef<EditorView | null>(null);

  const notify = useRef(onChange);
  notify.current = onChange;
  const path = useRef(documentPath);
  path.current = documentPath;

  const [status, setStatus] = useState<EditorStatus | null>(null);
  const [table, setTable] = useState<TableStatus | null>(null);
  const [linkDraft, setLinkDraft] = useState<string | null>(null);

  const openLinkBar = useCallback(() => {
    const current = view.current;
    if (!current) return;
    setLinkDraft(readStatus(current.state).link?.href ?? '');
  }, []);

  /** Images arrive from a paste or a drop; both land here. */
  const takeImageFiles = useCallback((files: File[], editor: EditorView) => {
    void (async () => {
      try {
        const links = await storeImages(files, path.current);
        const images = links.map((src) => nodes.image.create({ src, alt: null, title: null }));
        editor.dispatch(
          editor.state.tr
            .replaceSelection(new Slice(Fragment.from(images), 0, 0))
            .scrollIntoView(),
        );
        editor.focus();
      } catch (error) {
        useDocuments
          .getState()
          .reportError(error instanceof Error ? error.message : String(error));
      }
    })();
  }, []);

  useEffect(() => {
    const parent = host.current;
    if (!parent) return;

    // Reuse the state this tab had when it was last on screen, so switching away and
    // back does not reset undo history.
    const cached = readCachedState<EditorState>(documentKey, initialMarkdown);

    const editor = new EditorView(parent, {
      state:
        cached ??
        createEditorState(initialMarkdown, {
          onRequestLink: openLinkBar,
          onImageFiles: takeImageFiles,
        }),
      nodeViews: {
        listItem: (node, editorView, getPos) => new TaskItemView(node, editorView, getPos),
        codeBlock: (node) => {
          const settings = useSettings.getState();
          return new CodeBlockView(node, {
            diagrams: settings.renderDiagrams,
            math: settings.renderMath,
            dark: document.documentElement.dataset['theme'] !== 'light',
          });
        },
      },
      dispatchTransaction(transaction) {
        const next = editor.state.apply(transaction);
        editor.updateState(next);
        setStatus(readStatus(next));
        setTable(readTableStatus(next));

        const search = readSearch(next);
        useFind.getState().report({
          total: search.matches.length,
          current: search.current,
          error: search.error,
        });

        if (useSettings.getState().typewriter && transaction.selectionSet) {
          keepCaretCentred(editor, parent);
        }

        if (transaction.docChanged) {
          // The store keeps markdown, not a document, so the file on disk is never a
          // serialisation of something the user cannot see.
          notify.current(docToMarkdown(next.doc));
        }
      },
    });

    view.current = editor;

    // A fresh state starts where the document was left; a cached one already is there.
    const remembered = useDocuments.getState().byPath[path.current];
    if (!cached && remembered) {
      restoreCaret(editor, remembered.cursor);
      requestAnimationFrame(() => {
        parent.scrollTop = remembered.scrollTop;
      });
    }

    setStatus(readStatus(editor.state));
    setTable(readTableStatus(editor.state));
    editor.focus();

    editor.dom.spellcheck = useSettings.getState().spellcheck;
    const stopSpellcheck = useSettings.subscribe((settings) => {
      editor.dom.spellcheck = settings.spellcheck;
    });

    const stopFind = subscribeFind(editor);
    const stopNavigate = subscribeNavigate(editor);

    return () => {
      stopSpellcheck();
      stopFind();
      stopNavigate();
      useDocuments.getState().recordViewState(path.current, {
        cursor: editor.state.selection.from,
        scrollTop: parent.scrollTop,
      });
      writeCachedState(documentKey, editor.state, docToMarkdown(editor.state.doc));
      editor.destroy();
      view.current = null;
      setStatus(null);
      setTable(null);
      setLinkDraft(null);
    };
    // initialMarkdown seeds this mount only; later edits flow outwards through onChange.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentKey, openLinkBar, takeImageFiles]);

  const dispatch = useCallback((command: Command) => {
    const editor = view.current;
    if (!editor) return;
    command(editor.state, editor.dispatch, editor);
    editor.focus();
  }, []);

  const runNamed = useCallback(
    (name: CommandName) => {
      dispatch(commands[name]);
    },
    [dispatch],
  );

  const runTable = useCallback(
    (name: TableCommandName) => {
      dispatch(tableCommands[name]);
    },
    [dispatch],
  );

  const alignColumn = useCallback(
    (alignment: ColumnAlignment) => {
      dispatch(setColumnAlignment(alignment));
    },
    [dispatch],
  );

  const addTable = useCallback(
    (rows: number, columns: number) => {
      dispatch(insertTable(rows, columns));
    },
    [dispatch],
  );

  const applyLink = useCallback(
    (href: string) => {
      setLinkDraft(null);
      const trimmed = href.trim();
      dispatch(trimmed.length > 0 ? setLink(trimmed) : commands.removeLink);
    },
    [dispatch],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Toolbar status={status} onRun={runNamed} onLink={openLinkBar} onInsertTable={addTable} />

      {table && <TableToolbar status={table} onRun={runTable} onAlign={alignColumn} />}

      {linkDraft !== null && (
        <LinkBar
          initialHref={linkDraft}
          onApply={applyLink}
          onCancel={() => {
            setLinkDraft(null);
            view.current?.focus();
          }}
        />
      )}

      <div ref={host} className="md-editor-host min-h-0 flex-1 overflow-y-auto" />
    </div>
  );
}

/** Typewriter mode: hold the line being edited at the middle of the pane. */
function keepCaretCentred(editor: EditorView, host: HTMLElement): void {
  try {
    const caret = editor.coordsAtPos(editor.state.selection.head);
    const bounds = host.getBoundingClientRect();
    host.scrollTop += caret.top - bounds.top - bounds.height / 2;
  } catch {
    // The position can be momentarily unmappable mid-transaction; skip this one.
  }
}

function sameQuery(a: SearchQuery | null, b: SearchQuery | null): boolean {
  if (a === null || b === null) return a === b;
  return a.text === b.text && a.regex === b.regex && a.caseSensitive === b.caseSensitive;
}

/**
 * The find bar states what it wants and this carries it out. Requests are identified by a
 * nonce so re-reading the store never replays the last action.
 */
function subscribeFind(editor: EditorView): () => void {
  let lastNonce = 0;

  const apply = () => {
    const find = useFind.getState();
    const wanted: SearchQuery | null =
      find.open && find.query.length > 0
        ? { text: find.query, regex: find.regex, caseSensitive: find.caseSensitive }
        : null;

    if (!sameQuery(readSearch(editor.state).query, wanted)) {
      setSearchQuery(wanted)(editor.state, editor.dispatch);
    }

    const request = find.request;
    if (request !== null && request.nonce !== lastNonce) {
      lastNonce = request.nonce;
      runFind(editor, request.action, find.replacement);
    }

    const search = readSearch(editor.state);
    find.report({
      total: search.matches.length,
      current: search.current,
      error: search.error,
    });
  };

  apply();
  return useFind.subscribe(apply);
}

function runFind(editor: EditorView, action: FindAction, replacement: string): void {
  // Focus deliberately stays in the find bar; only the document scrolls.
  if (action === 'next') {
    stepMatch(1)(editor.state, editor.dispatch);
  } else if (action === 'previous') {
    stepMatch(-1)(editor.state, editor.dispatch);
  } else if (action === 'replace') {
    replaceCurrentMatch(replacement)(editor.state, editor.dispatch);
    stepMatch(1)(editor.state, editor.dispatch);
  } else {
    replaceAllMatches(replacement)(editor.state, editor.dispatch);
  }
}

function subscribeNavigate(editor: EditorView): () => void {
  let lastNonce = 0;

  return useNavigate.subscribe(() => {
    const request = useNavigate.getState().request;
    if (request === null || request.nonce === lastNonce) return;
    lastNonce = request.nonce;

    if (request.kind === 'heading') {
      revealHeading(request.index)(editor.state, editor.dispatch);
    } else if (request.kind === 'moveSection') {
      moveSectionCommand(request.from, request.to)(editor.state, editor.dispatch);
    } else if (request.kind === 'frontmatter') {
      // Deliberately no focus steal: the caret belongs in the form the user is typing in.
      setFrontmatter(request.yaml)(editor.state, editor.dispatch);
      return;
    } else {
      insertMarkdown(request.markdown)(editor.state, editor.dispatch);
    }
    editor.focus();
  });
}

/** Positions shift when a file changes on disk, so a stale offset must not throw. */
function restoreCaret(editor: EditorView, cursor: number): void {
  if (cursor <= 0) return;
  const limit = Math.max(1, editor.state.doc.content.size - 1);

  try {
    const at = editor.state.doc.resolve(Math.min(cursor, limit));
    editor.dispatch(editor.state.tr.setSelection(TextSelection.near(at)));
  } catch {
    // Leave the caret where the document opened.
  }
}
