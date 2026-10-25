import {
  commands,
  createEditorState,
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
  type TableStatus,
} from '@md-studio/editor';
import { docToMarkdown } from '@md-studio/markdown';
import { Fragment, Slice } from 'prosemirror-model';
import type { Command, EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { useCallback, useEffect, useRef, useState } from 'react';
import { storeImages } from '../lib/assets';
import { readCachedState, writeCachedState } from '../lib/editor-cache';
import { useDocuments } from '../state/documents';
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
      },
      dispatchTransaction(transaction) {
        const next = editor.state.apply(transaction);
        editor.updateState(next);
        setStatus(readStatus(next));
        setTable(readTableStatus(next));
        if (transaction.docChanged) {
          // The store keeps markdown, not a document, so the file on disk is never a
          // serialisation of something the user cannot see.
          notify.current(docToMarkdown(next.doc));
        }
      },
    });

    view.current = editor;
    setStatus(readStatus(editor.state));
    setTable(readTableStatus(editor.state));
    editor.focus();

    return () => {
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
